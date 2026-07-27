import assert from "node:assert/strict";
import test from "node:test";
import {
  getMegaEvolutionState,
  isSameMegaEvolutionFamily,
} from "../src/lib/mega-evolution.ts";

const species = [
  "Lucario",
  "Lucario-Mega",
  "Raichu",
  "Raichu-Alola",
  "Raichu-Mega-X",
  "Raichu-Mega-Y",
  "Meowstic",
  "Meowstic-F-Mega",
  "Meowstic-M-Mega",
  "Floette-Eternal",
  "Floette-Mega",
  "Kingambit",
] as const;

test("a species with one Mega form resolves to a one-button family", () => {
  assert.deepEqual(getMegaEvolutionState("Lucario", species), {
    baseSpecies: "Lucario",
    variants: ["Lucario-Mega"],
    activeVariant: null,
  });
  assert.deepEqual(getMegaEvolutionState("Lucario-Mega", species), {
    baseSpecies: "Lucario",
    variants: ["Lucario-Mega"],
    activeVariant: "Lucario-Mega",
  });
});

test("X and Y Mega forms remain explicit choices", () => {
  assert.deepEqual(getMegaEvolutionState("Raichu", species), {
    baseSpecies: "Raichu",
    variants: ["Raichu-Mega-X", "Raichu-Mega-Y"],
    activeVariant: null,
  });
  assert.deepEqual(getMegaEvolutionState("Raichu-Mega-Y", species)?.activeVariant, "Raichu-Mega-Y");
  assert.equal(getMegaEvolutionState("Raichu-Alola", species), null);
});

test("gendered and Champions-specific Mega names resolve to their playable base", () => {
  assert.equal(getMegaEvolutionState("Meowstic-M-Mega", species)?.baseSpecies, "Meowstic");
  assert.equal(getMegaEvolutionState("Floette-Eternal", species)?.variants[0], "Floette-Mega");
});

test("species without a Mega form keep the regular ball icon", () => {
  assert.equal(getMegaEvolutionState("Kingambit", species), null);
});

test("base and Mega forms are recognized as one family", () => {
  assert.equal(isSameMegaEvolutionFamily("Lucario", "Lucario-Mega", species), true);
  assert.equal(isSameMegaEvolutionFamily("Raichu-Mega-X", "Raichu-Mega-Y", species), true);
  assert.equal(isSameMegaEvolutionFamily("Raichu-Alola", "Raichu-Mega-X", species), false);
});
