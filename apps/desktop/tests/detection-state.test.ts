import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAutomaticDetection,
  applyManualSelection,
  applyServerSnapshot,
  createDetectionSelectionState,
  type DetectionServerSnapshot,
} from "../src/lib/detection-state.ts";

test("manual mode accepts typed selections and blocks automatic replacements", () => {
  const manual = createDetectionSelectionState("manual", "Meowscarada", "Garchomp");
  const selected = applyManualSelection(manual, "opponent", "Lucario-Mega");
  const afterAutomaticEvent = applyAutomaticDetection(selected, "opponent", "Dragonite");

  assert.equal(selected.opponent, "Lucario-Mega");
  assert.deepEqual(afterAutomaticEvent, selected);
});

test("automatic mode accepts recognized names and rejects manual selections", () => {
  const automatic = createDetectionSelectionState("auto", "", "");

  assert.equal(
    applyAutomaticDetection(automatic, "player", "Meowscarada").player,
    "Meowscarada",
  );
  assert.throws(
    () => applyManualSelection(automatic, "player", "Lucario"),
    /manual selection requires manual detection mode/,
  );
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

test("a fresh automatic snapshot replaces stale manual names", () => {
  const current = createDetectionSelectionState("manual", "Lucario-Mega", "Garchomp-Mega");
  const snapshot: DetectionServerSnapshot = {
    type: "detection_state",
    mode: "auto",
    player: null,
    opponent: null,
  };

  assert.deepEqual(
    applyServerSnapshot(current, snapshot),
    createDetectionSelectionState("auto", "", ""),
  );
});
