import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { MixerController } from "../src/controller.ts";
import { parameterId } from "../src/catalog.ts";
import { buildActions, buildFeedbacks, buildPresets, compareValue } from "../src/definitions.ts";

test("every writable parameter has an action, every readable parameter has feedback", () => {
  const controller = new MixerController();
  const actions = buildActions(controller, () => {});
  const feedbacks = buildFeedbacks(controller);
  for (const entry of controller.catalog.entries) {
    assert.equal(Boolean(actions[parameterId(entry.address)]), entry.writable);
    assert.equal(Boolean(feedbacks[parameterId(entry.address)]), entry.readable);
  }
  assert(actions.patch_input);
  assert(actions.patch_output);
  assert(!feedbacks.patch_input);
});

test("presets reference real actions and feedbacks and have no destructive scene commands", () => {
  const controller = new MixerController();
  const actions = buildActions(controller, () => {});
  const feedbacks = buildFeedbacks(controller);
  const presets = buildPresets(controller);
  assert(Object.keys(presets).length > 400);
  for (const preset of Object.values(presets)) {
    if (!preset || preset.type !== "button") continue;
    for (const feedback of preset.feedbacks) assert(feedbacks[feedback.feedbackId]);
    for (const step of preset.steps) {
      for (const action of [...step.down, ...step.up]) {
        assert(actions[action.actionId], action.actionId);
        assert(!/store|delete|rename/.test(action.actionId));
      }
    }
  }
});

test("unknown feedback is false; numeric comparison handles tolerance and text handles contains", () => {
  assert.equal(compareValue(undefined, "0", "ne", 0), false);
  assert.equal(compareValue(-10.001, "-10", "eq", 0.01), true);
  assert.equal(compareValue(-10, "-5", "lt", 0), true);
  assert.equal(compareValue(1, "bad", "eq", 0), false);
  assert.equal(compareValue("VOCAL", "VOC", "contains", 0), true);
});

test("actions parse Companion variables and log rejected writes", async () => {
  const controller = new MixerController();
  let written: unknown[] = [];
  controller.write = (...args) => { written = args; };
  const errors: string[] = [];
  const actions = buildActions(controller, message => errors.push(message));
  const context = { parseVariablesInString: async () => "-12.5", setCustomVariableValue: () => {} };
  const action = { id: "test", controlId: "test", actionId: "input__n__fader", surfaceId: undefined,
    options: { n: 48, mode: "set", arg0: "$(custom:level)" } };
  await actions.input__n__fader!.callback(action, context);
  assert.deepEqual(written, ["/input/48/fader", ["-12.5"], "set"]);
  await actions.input__n__fader!.callback({ ...action, options: { ...action.options, n: 49 } }, context);
  assert.equal(errors.length, 1);
});

test("packaged module supports offline button configuration and IP changes during a failed handshake", {
  timeout: 10000,
  skip: !existsSync(new URL("../pkg/main.js", import.meta.url)),
}, async context => {
  const child = fork(fileURLToPath(new URL("../pkg/main.js", import.meta.url)), [], {
    execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...process.env,
      MODULE_MANIFEST: fileURLToPath(new URL("../pkg/companion/manifest.json", import.meta.url)),
      CONNECTION_ID: "sq-test", VERIFICATION_TOKEN: "local-test",
    },
  });
  context.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  });
  let stderr = "";
  child.stderr!.on("data", chunk => { stderr += chunk.toString(); });
  const definitions = new Map<string, Record<string, unknown>>();
  let nextId = 100;
  const pending = new Map<number, (packet: { success: boolean; payload: string }) => void>();
  let registered!: () => void;
  const registration = new Promise<void>(resolve => { registered = resolve; });
  child.on("message", (packet: { direction: string; name: string; payload: string; callbackId: number; success: boolean }) => {
    if (packet.direction === "response") {
      pending.get(packet.callbackId)?.(packet);
      pending.delete(packet.callbackId);
    } else if (packet.name === "register") {
      child.send({ direction: "response", callbackId: packet.callbackId, success: true, payload: "{}" });
      registered();
    } else if (packet.name.startsWith("set")) {
      definitions.set(packet.name, JSON.parse(packet.payload));
    }
  });
  const request = (name: string, payload: unknown) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const callbackId = nextId++;
    const timeout = setTimeout(() => reject(new Error(`${name} blocked on console connectivity`)), 2000);
    pending.set(callbackId, packet => {
      clearTimeout(timeout);
      if (packet.success) resolve(packet.payload && packet.payload !== "undefined" ? JSON.parse(packet.payload) : {});
      else reject(new Error(packet.payload));
    });
    child.send({ direction: "call", name, callbackId, payload: JSON.stringify(payload) });
  });
  await registration;
  await request("init", { label: "SQ", isFirstInit: false, lastUpgradeIndex: -1, actions: {}, feedbacks: {},
    config: { host: "", port: 51326, localInterface: "", reconnectMs: 3000 }, secrets: {} });
  assert(definitions.has("setActionDefinitions"));
  assert(definitions.has("setFeedbackDefinitions"));
  assert(definitions.has("setVariableDefinitions"));
  assert(definitions.has("setPresetDefinitions"));
  const config = await request("getConfigFields", {});
  assert.equal((config.fields as unknown[]).length, 4);
  const hostField = (config.fields as Array<{ id: string; required?: boolean }>).find(field => field.id === "host");
  assert(hostField);
  assert.notEqual(hostField.required, true);
  const configureButton = async () => {
    await request("updateActions", { actions: { "button-action": {
      id: "button-action", controlId: "bank:1-1", actionId: "input__n__mute", upgradeIndex: null,
      disabled: false, options: { n: 1, mode: "set", arg0: 1 },
    } } });
    await request("updateFeedbacks", { feedbacks: { "button-feedback": {
      id: "button-feedback", controlId: "bank:1-1", feedbackId: "input__n__mute", upgradeIndex: null,
      disabled: false, isInverted: false, options: { n: 1, operator: "eq", value: "1", tolerance: 0 },
    } } });
  };
  await configureButton();

  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  context.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const update = (host: string, port = address.port) => request("updateConfigAndLabel", {
    label: "SQ", config: { host, port, localInterface: "", reconnectMs: 3000 }, secrets: {},
  });
  const socketAccepted = once(server, "connection");
  await update("127.0.0.1");
  await socketAccepted;
  await configureButton();
  assert.equal((await request("getConfigFields", {})).fields instanceof Array, true);
  await update("127.0.0.2");
  await update("127.0.0.1", 0);
  await configureButton();
  assert.equal((await request("getConfigFields", {})).fields instanceof Array, true);
  await update("");
  assert(definitions.has("setActionDefinitions"));
  assert(definitions.has("setFeedbackDefinitions"));
  await request("destroy", {});
  assert.equal(stderr, "");
});