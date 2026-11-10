import assert from "node:assert/strict";
import { test } from "node:test";
import type { SQMixer } from "@allen-heath-sq-tools/api";
import { buildRegistry } from "../../sq-osc/src/registry/index.ts";
import { buildCatalog, validateValue } from "../src/catalog.ts";

test("catalog covers all mixer registry entries with unique concrete addresses", () => {
  const { entries, targets } = buildCatalog();
  for (const entry of buildRegistry().entries.filter(entry => entry.address !== "/bridge/status")) {
    assert(entries.some(candidate => candidate.address === entry.address));
  }
  assert.equal(new Set(targets.map(target => target.address)).size, targets.length);
  assert.equal(new Set(targets.map(target => target.variableId)).size, targets.length);
  assert(targets.some(target => target.address === "/input/48/send/12"));
  assert(targets.some(target => target.address === "/scene/300/recall"));
  assert(!targets.some(target => target.address.includes("{") || target.address === "/input/49/mute"));
});

test("catalog setters and getters use the direct mixer API", () => {
  let muted = false;
  const sq = { inputs: [{ muted: false, setMute: (value: boolean) => { muted = value; } }] } as unknown as SQMixer;
  const target = buildCatalog().targets.find(target => target.address === "/input/1/mute")!;
  target.entry.set!(sq, target.indices, [1]);
  assert.equal(muted, true);
  assert.deepEqual(target.entry.get!(sq, target.indices), [0]);
});

test("arguments reject non-finite values, invalid choices, and out-of-range writes", () => {
  const arg = { name: "on", type: "i" as const, description: "state", min: 0, max: 1 };
  assert.equal(validateValue(arg, "1"), 1);
  for (const value of ["", "NaN", Infinity, -1, 2, 0.5]) assert.throws(() => validateValue(arg, value));
  assert.throws(() => validateValue({ ...arg, choices: [0] }, 1));
});