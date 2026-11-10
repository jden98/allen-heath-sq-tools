import { buildRegistry } from "../../sq-osc/src/registry/index.ts";
import type { OscArg, OscEntry } from "../../sq-osc/src/registry/types.ts";
import { extraEntries } from "./extra.ts";

export type { OscArg, OscEntry };

export interface ParameterTarget {
  entry: OscEntry;
  address: string;
  indices: number[];
  variableId: string;
}

export function parameterId(address: string): string {
  return address.replace(/^\//, "").replace(/[^a-zA-Z0-9_]/g, "_");
}

export function indexLimit(entry: OscEntry): number {
  const group = entry.address.split("/")[1];
  const limits: Record<string, number> = {
    input: 48, stereo: 3, fxreturn: 4, bus: 12, dca: 8,
    "mute-group": 8, scene: 300,
  };
  if (group === "talkback") {
    const destination = entry.address.split("/")[3];
    const destinations: Record<string, number> = { group: 4, aux: 8, matrix: 6 };
    return destinations[destination] ?? 1;
  }
  return limits[group] ?? 1;
}

export function buildCatalog(): { entries: OscEntry[]; targets: ParameterTarget[] } {
  const entries = [...buildRegistry().entries.filter(entry => entry.address !== "/bridge/status"), ...extraEntries()];
  const targets = entries.flatMap(entry => {
    const indexed = entry.address.includes("{n}");
    return Array.from({ length: indexed ? indexLimit(entry) : 1 }, (_, offset) => {
      const address = entry.address.replace("{n}", String(offset + 1));
      return {
        entry, address,
        indices: indexed ? [offset + 1] : [],
        variableId: parameterId(address),
      };
    });
  });
  return { entries, targets };
}

export function validateValue(arg: OscArg, value: unknown): number | string {
  if (arg.type === "s") {
    const text = String(value ?? "");
    if (arg.choices && !arg.choices.includes(text)) throw new Error(`Invalid ${arg.name} choice`);
    return text;
  }
  if (value === "" || value === undefined || value === null) throw new Error(`${arg.name} is required`);
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || (arg.type === "i" && !Number.isInteger(numeric))) {
    throw new Error(`${arg.name} must be a finite ${arg.type === "i" ? "integer" : "number"}`);
  }
  if (arg.min !== undefined && numeric < arg.min) throw new Error(`${arg.name} must be >= ${arg.min}`);
  if (arg.max !== undefined && numeric > arg.max) throw new Error(`${arg.name} must be <= ${arg.max}`);
  if (arg.choices && !arg.choices.includes(numeric)) throw new Error(`Invalid ${arg.name} choice`);
  return numeric;
}