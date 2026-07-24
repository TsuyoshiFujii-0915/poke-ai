import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileAbilitySelection,
  validateAbilitySelection,
} from "../src/lib/ability-selection.ts";

test("keeps a selected ability when the new species can use it", () => {
  assert.equal(
    reconcileAbilitySelection("Rough Skin", ["Sand Veil", "Rough Skin"]),
    "Rough Skin",
  );
});

test("shows the primary ability when a species change invalidates the selection", () => {
  assert.equal(
    reconcileAbilitySelection("Cursed Body", ["Sand Veil", "Rough Skin"]),
    "Sand Veil",
  );
});

test("rejects species data without an ability", () => {
  assert.throws(
    () => reconcileAbilitySelection("", []),
    /no ability candidates/,
  );
});

test("rejects an ability that the selected species cannot use", () => {
  assert.throws(
    () => validateAbilitySelection("Garchomp", "Cursed Body", ["Sand Veil", "Rough Skin"]),
    /Garchomp cannot use ability Cursed Body/,
  );
});

test("accepts an explicitly selected legal ability", () => {
  assert.doesNotThrow(() =>
    validateAbilitySelection("Garchomp", "Rough Skin", ["Sand Veil", "Rough Skin"]),
  );
});
