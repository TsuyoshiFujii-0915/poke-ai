import assert from "node:assert/strict";
import test from "node:test";
import {
  isManualAbilityTrigger,
  resolveAbilityForDamage,
} from "../src/lib/ability-calculation.ts";

test("passes supported abilities to the damage engine unchanged", () => {
  assert.deepEqual(resolveAbilityForDamage("Huge Power", "attacker", false), {
    ability: "Huge Power",
    abilityOn: false,
  });
});

test("passes weather-dependent damage abilities to the damage engine unchanged", () => {
  for (const ability of ["Sand Force", "Solar Power"]) {
    assert.deepEqual(resolveAbilityForDamage(ability, "attacker", false), {
      ability,
      abilityOn: false,
    }, ability);
  }
});

test("adapts Fire Mane to an equivalent active Fire boost", () => {
  assert.deepEqual(resolveAbilityForDamage("Firemane", "attacker", false), {
    ability: "Flash Fire",
    abilityOn: true,
  });
});

test("passes a manual Flash Fire trigger only when activated", () => {
  assert.deepEqual(resolveAbilityForDamage("Flash Fire", "attacker", false), {
    ability: "Flash Fire",
    abilityOn: false,
  });
  assert.deepEqual(resolveAbilityForDamage("Flash Fire", "attacker", true), {
    ability: "Flash Fire",
    abilityOn: true,
  });
});

test("identifies only directly supported manual damage triggers", () => {
  for (const ability of ["Flash Fire", "Electromorphosis", "Plus", "Minus"]) {
    assert.equal(isManualAbilityTrigger(ability), true, ability);
  }
  for (const ability of ["Adaptability", "Intimidate", "Supreme Overlord", "Guts"]) {
    assert.equal(isManualAbilityTrigger(ability), false, ability);
  }
});

test("excludes abilities whose missing battle context would produce an assumed modifier", () => {
  for (const ability of [
    "Analytic",
    "Blaze",
    "Guts",
    "Multiscale",
    "Rivalry",
    "Supreme Overlord",
  ]) {
    assert.deepEqual(resolveAbilityForDamage(ability, "attacker", false), {
      ability: undefined,
      abilityOn: false,
    }, ability);
  }
});

test("adapts Eelevate to Levitate for Ground immunity", () => {
  assert.deepEqual(resolveAbilityForDamage("Eelevate", "defender", false), {
    ability: "Levitate",
    abilityOn: false,
  });
});

test("rejects formula-changing Champions abilities the engine cannot represent", () => {
  assert.throws(
    () => resolveAbilityForDamage("Dragonize", "attacker", false),
    /unsupported Champions damage ability: Dragonize/,
  );
  assert.throws(
    () => resolveAbilityForDamage("Mega Sol", "attacker", false),
    /unsupported Champions damage ability: Mega Sol/,
  );
});

test("allows non-damage sides of unsupported attacker abilities", () => {
  assert.deepEqual(resolveAbilityForDamage("Dragonize", "defender", false), {
    ability: "Dragonize",
    abilityOn: false,
  });
});
