import { combineRgb } from "@companion-module/base";
import type {
  CompanionActionDefinitions, CompanionFeedbackDefinitions, CompanionOptionValues,
  CompanionPresetDefinitions, SomeCompanionActionInputField, CompanionInputFieldNumber,
} from "@companion-module/base";
import { indexLimit, parameterId } from "./catalog.ts";
import type { OscArg, OscEntry } from "./catalog.ts";
import type { MixerController } from "./controller.ts";

function argumentOption(arg: OscArg, index: number): SomeCompanionActionInputField {
  const id = `arg${index}`;
  const label = `${arg.description}${arg.unit ? ` (${arg.unit})` : ""}`;
  if (arg.choices) return {
    type: "dropdown", id, label, default: arg.choices[0],
    choices: arg.choices.map(value => ({ id: value, label: String(value) })),
  };
  if (arg.type === "i" && arg.min === 0 && arg.max === 1) return {
    type: "dropdown", id, label, default: 1,
    choices: [{ id: 0, label: "Off" }, { id: 1, label: "On" }],
  };
  return { type: "textinput", id, label, useVariables: true,
    default: arg.type === "s" ? "" : String(Math.max(arg.min ?? 0, Math.min(0, arg.max ?? 0))) };
}

function indexOptions(entry: OscEntry): CompanionInputFieldNumber[] {
  if (!entry.address.includes("{n}")) return [];
  return [{ type: "number", id: "n", label: "Channel / scene / group number", default: 1, min: 1, max: indexLimit(entry) }];
}

function resolveAddress(entry: OscEntry, options: CompanionOptionValues): string {
  if (!entry.address.includes("{n}")) return entry.address;
  const index = Number(options.n);
  if (!Number.isInteger(index) || index < 1 || index > indexLimit(entry)) throw new Error("Invalid channel / scene / group number");
  return entry.address.replace("{n}", String(index));
}

export function buildActions(controller: MixerController, logError: (message: string) => void): CompanionActionDefinitions {
  const actions: CompanionActionDefinitions = {};
  for (const entry of controller.catalog.entries.filter(entry => entry.writable)) {
    const id = parameterId(entry.address);
    const numeric = entry.readable && entry.setArgs.length === 1 && entry.setArgs[0].type !== "s";
    const boolean = numeric && entry.setArgs[0].min === 0 && entry.setArgs[0].max === 1;
    const modes = [{ id: "set", label: "Set value" }];
    if (boolean) modes.push({ id: "toggle", label: "Toggle" });
    else if (numeric) modes.push({ id: "relative", label: "Adjust by amount" });
    actions[id] = {
      name: `${entry.group}: ${entry.description}`, description: entry.address,
      options: [...indexOptions(entry), ...(modes.length > 1 ? [{
        type: "dropdown" as const, id: "mode", label: "Operation", default: "set", choices: modes,
      }] : []), ...entry.setArgs.map(argumentOption)],
      callback: async (action, context) => {
        try {
          const args = await Promise.all(entry.setArgs.map((arg, index) => {
            const value = action.options[`arg${index}`];
            return typeof value === "string" ? context.parseVariablesInString(value) : value;
          }));
          const mode = action.options.mode ?? "set";
          if (mode !== "set" && mode !== "toggle" && mode !== "relative") throw new Error("Invalid operation");
          controller.write(resolveAddress(entry, action.options), args, mode);
        } catch (error) { logError(String(error)); }
      },
      learn: entry.readable ? action => {
        try {
          controller.refresh();
          const value = controller.values.get(resolveAddress(entry, action.options));
          return value === undefined ? undefined : { ...action.options, mode: "set", arg0: value };
        } catch { return undefined; }
      } : undefined,
    };
  }
  return actions;
}

export function compareValue(actual: number | string | undefined, expected: string, operator: string, tolerance: number): boolean {
  if (actual === undefined) return false;
  if (typeof actual === "string") {
    if (operator === "eq") return actual === expected;
    if (operator === "ne") return actual !== expected;
    if (operator === "contains") return actual.includes(expected);
    return false;
  }
  if (!expected.trim()) return false;
  const value = Number(expected);
  if (!Number.isFinite(value) || !Number.isFinite(tolerance) || tolerance < 0) return false;
  switch (operator) {
    case "eq": return Math.abs(actual - value) <= tolerance;
    case "ne": return Math.abs(actual - value) > tolerance;
    case "gt": return actual > value;
    case "ge": return actual >= value;
    case "lt": return actual < value;
    case "le": return actual <= value;
    default: return false;
  }
}

export function buildFeedbacks(controller: MixerController): CompanionFeedbackDefinitions {
  const feedbacks: CompanionFeedbackDefinitions = {
    connected: {
      type: "boolean", name: "Console connected", options: [],
      defaultStyle: { bgcolor: combineRgb(0, 130, 70), color: combineRgb(255, 255, 255) },
      callback: () => controller.connected,
    },
    scene_active: {
      type: "boolean", name: "Last recalled scene", options: [{ type: "number", id: "n", label: "Scene", min: 1, max: 300, default: 1 }],
      defaultStyle: { bgcolor: combineRgb(0, 130, 70) },
      callback: () => false,
    },
  };
  for (const entry of controller.catalog.entries.filter(entry => entry.readable)) {
    feedbacks[parameterId(entry.address)] = {
      type: "boolean", name: `${entry.group}: ${entry.description}`, description: entry.address,
      defaultStyle: { bgcolor: combineRgb(190, 35, 45), color: combineRgb(255, 255, 255) },
      options: [...indexOptions(entry), {
        type: "dropdown", id: "operator", label: "Comparison", default: "eq",
        choices: [{ id: "eq", label: "Equals" }, { id: "ne", label: "Not equal" },
          ...(entry.getArgs[0]?.type === "s" ? [{ id: "contains", label: "Contains" }] : [
            { id: "gt", label: "Greater than" }, { id: "ge", label: "Greater or equal" },
            { id: "lt", label: "Less than" }, { id: "le", label: "Less or equal" },
          ])],
      }, { type: "textinput", id: "value", label: "Value", default: "1", useVariables: true },
      { type: "number", id: "tolerance", label: "Numeric equality tolerance", default: 0.01, min: 0, max: 100 }],
      callback: async (feedback, context) => {
        try {
          return compareValue(controller.values.get(resolveAddress(entry, feedback.options)),
            await context.parseVariablesInString(String(feedback.options.value ?? "")),
            String(feedback.options.operator ?? "eq"), Number(feedback.options.tolerance ?? 0.01));
        } catch { return false; }
      },
      learn: feedback => {
        try {
          const value = controller.values.get(resolveAddress(entry, feedback.options));
          return value === undefined ? undefined : { ...feedback.options, value: String(value) };
        } catch { return undefined; }
      },
    };
  }
  return feedbacks;
}

export function buildPresets(controller: MixerController): CompanionPresetDefinitions {
  const presets: CompanionPresetDefinitions = {};
  const style = { text: "", size: "auto" as const, color: combineRgb(255, 255, 255), bgcolor: combineRgb(35, 35, 35) };
  for (const target of controller.catalog.targets.filter(target => target.entry.readable && target.entry.writable && /\/(mute|pafl)$/.test(target.address))) {
    const id = parameterId(target.entry.address);
    const options = { n: target.indices[0] ?? 1, mode: "toggle", arg0: 1 };
    const prefix = target.address.replace(/\/(mute|pafl)$/, "");
    presets[target.variableId] = {
      type: "button", category: `${target.entry.group}: Mute / PAFL`, name: target.address,
      style: { ...style, text: `$(this:${parameterId(`${prefix}/name`)})\n${target.address.endsWith("/mute") ? "MUTE" : "PAFL"}` },
      steps: [{ down: [{ actionId: id, options }], up: [] }],
      feedbacks: [{ feedbackId: id, options: { n: options.n, operator: "eq", value: "1", tolerance: 0 } }],
    };
  }
  presets.talkback = {
    type: "button", category: "Talkback", name: "Push to talk", style: { ...style, text: "TALKBACK" },
    steps: [{ down: [{ actionId: "talkback_on", options: { mode: "set", arg0: 1 } }],
      up: [{ actionId: "talkback_on", options: { mode: "set", arg0: 0 } }] }],
    feedbacks: [{ feedbackId: "talkback_on", options: { operator: "eq", value: "1", tolerance: 0 } }],
  };
  for (let scene = 1; scene <= 300; scene++) {
    presets[`scene_${scene}`] = {
      type: "button", category: "Scenes", name: `Recall scene ${scene}`,
      style: { ...style, text: `${scene}\n$(this:scene_${scene}_name)` },
      steps: [{ down: [{ actionId: "scene__n__recall", options: { n: scene } }], up: [] }],
      feedbacks: [{ feedbackId: "scene_active", options: { n: scene } }],
    };
  }
  return presets;
}