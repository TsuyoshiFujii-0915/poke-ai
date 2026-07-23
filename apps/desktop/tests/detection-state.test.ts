import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAutomaticDetection,
  applyServerSnapshot,
  applyUserSelection,
  createDetectionSelectionState,
  type DetectionServerSnapshot,
} from "../src/lib/detection-state.ts";

test("manual mode accepts typed selections and blocks automatic replacements", () => {
  const manual = createDetectionSelectionState("manual", "Meowscarada", "Garchomp");
  const selected = applyUserSelection(manual, "opponent", "Lucario-Mega");
  const afterAutomaticEvent = applyAutomaticDetection(selected, "opponent", "Dragonite");

  assert.equal(selected.opponent, "Lucario-Mega");
  assert.deepEqual(afterAutomaticEvent, selected);
});

test("automatic mode accepts both recognized names and user selections", () => {
  const automatic = createDetectionSelectionState("auto", "", "");

  const recognized = applyAutomaticDetection(automatic, "player", "Meowscarada");
  const corrected = applyUserSelection(recognized, "player", "Lucario");

  assert.equal(recognized.player, "Meowscarada");
  assert.equal(corrected.player, "Lucario");
});

test("a manual server snapshot preserves current names", () => {
  const current = createDetectionSelectionState("auto", "Meowscarada", "Garchomp");
  const snapshot: DetectionServerSnapshot = {
    type: "detection_state",
    mode: "manual",
    player: null,
    opponent: null,
  };

  assert.deepEqual(
    applyServerSnapshot(current, snapshot),
    createDetectionSelectionState("manual", "Meowscarada", "Garchomp"),
  );
});

test("a fresh automatic snapshot preserves names until detection finishes", () => {
  const current = createDetectionSelectionState("manual", "Lucario-Mega", "Garchomp-Mega");
  const snapshot: DetectionServerSnapshot = {
    type: "detection_state",
    mode: "auto",
    player: null,
    opponent: null,
  };

  assert.deepEqual(
    applyServerSnapshot(current, snapshot),
    createDetectionSelectionState("auto", "Lucario-Mega", "Garchomp-Mega"),
  );
});
