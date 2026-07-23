import assert from "node:assert/strict";
import test from "node:test";
import { stageKeysForDamageCategory } from "../src/lib/damage-stage.ts";

test("uses Attack and Defense stages for physical moves", () => {
  assert.deepEqual(stageKeysForDamageCategory("Physical"), {
    attacker: "atk",
    defender: "def",
  });
});

test("uses Special Attack and Special Defense stages for special moves", () => {
  assert.deepEqual(stageKeysForDamageCategory("Special"), {
    attacker: "spa",
    defender: "spd",
  });
});

test("does not show damage stage controls for status moves", () => {
  assert.equal(stageKeysForDamageCategory("Status"), null);
});
