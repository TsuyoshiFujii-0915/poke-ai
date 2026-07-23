import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustStatStage,
  createNeutralStatStages,
  validateStatStages,
} from "../src/lib/stat-stage.ts";

test("adjusts one battle stat stage without changing the others", () => {
  const neutral = createNeutralStatStages();
  const raised = adjustStatStage(neutral, "atk", 1);
  const lowered = adjustStatStage(raised, "spd", -1);

  assert.deepEqual(neutral, { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
  assert.deepEqual(lowered, { atk: 1, def: 0, spa: 0, spd: -1, spe: 0 });
});

test("clamps battle stat stages between minus six and plus six", () => {
  const neutral = createNeutralStatStages();
  const maximum = adjustStatStage(neutral, "spa", 10);
  const minimum = adjustStatStage(maximum, "spa", -20);

  assert.equal(maximum.spa, 6);
  assert.equal(minimum.spa, -6);
});

test("rejects an out-of-range stage before damage calculation", () => {
  const invalid = { ...createNeutralStatStages(), def: 7 };

  assert.throws(
    () => validateStatStages(invalid),
    /stat stage 'def' must be an integer from -6 to 6: 7/,
  );
});
