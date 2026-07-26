import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDetectionResult,
  applyServerSnapshot,
  applyUserSelection,
  createDetectionSelectionState,
  type DetectionServerSnapshot,
} from "../src/lib/detection-state.ts";

test("idle detection preserves a manually corrected Mega form", () => {
  const idle = createDetectionSelectionState("idle", "Raichu-Mega-X", "Garchomp");
  const delayedResult = applyDetectionResult(idle, "player", "Raichu");

  assert.deepEqual(delayedResult, idle);
});

test("an active detection run accepts OCR results", () => {
  const detecting = createDetectionSelectionState("detecting", "Raichu-Mega-X", "Garchomp");

  assert.deepEqual(
    applyDetectionResult(detecting, "player", "Raichu"),
    createDetectionSelectionState("detecting", "Raichu", "Garchomp"),
  );
});

test("starting a detection run preserves current names until results arrive", () => {
  const current = createDetectionSelectionState("idle", "Raichu-Mega-X", "Garchomp-Mega");
  const snapshot: DetectionServerSnapshot = {
    type: "detection_state",
    status: "detecting",
    player: null,
    opponent: null,
    failedSides: [],
  };

  assert.deepEqual(
    applyServerSnapshot(current, snapshot),
    createDetectionSelectionState("detecting", "Raichu-Mega-X", "Garchomp-Mega"),
  );
});

test("a completed partial run applies successes and preserves failed sides", () => {
  const current = createDetectionSelectionState("detecting", "Raichu-Mega-X", "Garchomp-Mega");
  const snapshot: DetectionServerSnapshot = {
    type: "detection_state",
    status: "idle",
    player: {
      side: "player",
      pokemon: "Raichu",
      displayName: "ライチュウ",
      confidence: 0.9,
    },
    opponent: null,
    failedSides: ["opponent"],
  };

  assert.deepEqual(
    applyServerSnapshot(current, snapshot),
    createDetectionSelectionState("idle", "Raichu", "Garchomp-Mega"),
  );
});

test("name inputs remain editable while no detection is running", () => {
  const idle = createDetectionSelectionState("idle", "Raichu", "Garchomp");

  assert.deepEqual(
    applyUserSelection(idle, "player", "Raichu-Mega-X"),
    createDetectionSelectionState("idle", "Raichu-Mega-X", "Garchomp"),
  );
});
