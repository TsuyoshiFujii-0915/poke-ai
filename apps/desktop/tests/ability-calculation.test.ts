import assert from "node:assert/strict";
import test from "node:test";
import { resolveAbilityForDamage } from "../src/lib/ability-calculation.ts";

test("passes supported abilities to the damage engine unchanged", () => {
  assert.deepEqual(resolveAbilityForDamage("Huge Power", "attacker"), {
    ability: "Huge Power",
    abilityOn: false,
  });
});

test("adapts Fire Mane to an equivalent active Fire boost", () => {
  assert.deepEqual(resolveAbilityForDamage("Firemane", "attacker"), {
    ability: "Flash Fire",
    abilityOn: true,
  });
});

test("adapts Eelevate to Levitate for Ground immunity", () => {
  assert.deepEqual(resolveAbilityForDamage("Eelevate", "defender"), {
    ability: "Levitate",
    abilityOn: false,
  });
});

test("rejects formula-changing Champions abilities the engine cannot represent", () => {
  assert.throws(
    () => resolveAbilityForDamage("Dragonize", "attacker"),
    /unsupported Champions damage ability: Dragonize/,
  );
  assert.throws(
    () => resolveAbilityForDamage("Mega Sol", "attacker"),
    /unsupported Champions damage ability: Mega Sol/,
  );
});

test("allows non-damage sides of unsupported attacker abilities", () => {
  assert.deepEqual(resolveAbilityForDamage("Dragonize", "defender"), {
    ability: "Dragonize",
    abilityOn: false,
  });
});
