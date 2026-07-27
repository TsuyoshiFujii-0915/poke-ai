import assert from "node:assert/strict";
import test from "node:test";
import { createInitialMySideConfig } from "../src/lib/initial-config.ts";

test("all player training points start at zero", () => {
  const config = createInitialMySideConfig();

  assert.deepEqual(config.points, {
    hp: 0,
    atk: 0,
    def: 0,
    spa: 0,
    spd: 0,
    spe: 0,
  });
});
