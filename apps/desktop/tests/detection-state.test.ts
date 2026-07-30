import assert from "node:assert/strict";
import test from "node:test";
import {
  applyServerSnapshot,
  applyUserSelection,
  createDetectionSelectionState,
  detectionControlContent,
  type DetectionServerSnapshot,
} from "../src/lib/detection-state.ts";

test("shows SCAN, a spinner, then VS as detection progresses", () => {
  const initial = createDetectionSelectionState("idle", "", "");
  const detecting = { ...initial, status: "detecting" as const };
  const completed = {
    ...initial,
    player: "Blastoise",
    opponent: "Garchomp",
    appliedRunIDs: { player: 1, opponent: 1 },
  };

  assert.equal(detectionControlContent(initial, false), "scan");
  assert.equal(detectionControlContent(initial, true), "loading");
  assert.equal(detectionControlContent(detecting, false), "loading");
  assert.equal(detectionControlContent(completed, false), "vs");
});

test("starting a detection run preserves current names until results arrive", () => {
  const current = createDetectionSelectionState("idle", "Raichu-Mega-X", "Garchomp-Mega");
  const snapshot: DetectionServerSnapshot = {
    type: "detection_state",
    runID: 1,
    revision: 1,
    status: "detecting",
    player: null,
    opponent: null,
    failedSides: [],
  };

  assert.deepEqual(
    applyServerSnapshot(current, snapshot),
    {
      ...createDetectionSelectionState("detecting", "Raichu-Mega-X", "Garchomp-Mega"),
      latestRevision: 1,
    },
  );
});

test("a completed partial run applies successes and preserves failed sides", () => {
  const current = createDetectionSelectionState("detecting", "Raichu-Mega-X", "Garchomp-Mega");
  const snapshot: DetectionServerSnapshot = {
    type: "detection_state",
    runID: 1,
    revision: 2,
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
    {
      ...createDetectionSelectionState("idle", "Raichu", "Garchomp-Mega"),
      latestRevision: 2,
      appliedRunIDs: { player: 1, opponent: 0 },
    },
  );
});

test("reconnecting to the same run does not overwrite a manual Mega correction", () => {
  const detected = applyServerSnapshot(
    createDetectionSelectionState("detecting", "Raichu-Mega-X", "Garchomp"),
    {
      type: "detection_state",
      runID: 4,
      revision: 8,
      status: "detecting",
      player: {
        side: "player",
        pokemon: "Raichu",
        displayName: "ライチュウ",
        confidence: 0.9,
      },
      opponent: null,
      failedSides: [],
    },
  );
  const corrected = applyUserSelection(detected, "player", "Raichu-Mega-X");

  const reconnected = applyServerSnapshot(corrected, {
    type: "detection_state",
    runID: 4,
    revision: 9,
    status: "idle",
    player: {
      side: "player",
      pokemon: "Raichu",
      displayName: "ライチュウ",
      confidence: 0.9,
    },
    opponent: {
      side: "opponent",
      pokemon: "Garchomp",
      displayName: "ガブリアス",
      confidence: 0.88,
    },
    failedSides: [],
  });

  assert.equal(reconnected.player, "Raichu-Mega-X");
  assert.equal(reconnected.opponent, "Garchomp");
  assert.equal(reconnected.status, "idle");
});

test("a result from the next detection run replaces the manual correction", () => {
  const current = applyUserSelection(
    {
      ...createDetectionSelectionState("idle", "Raichu", "Garchomp"),
      latestRevision: 9,
      appliedRunIDs: { player: 4, opponent: 4 },
    },
    "player",
    "Raichu-Mega-X",
  );

  const nextRun = applyServerSnapshot(current, {
    type: "detection_state",
    runID: 5,
    revision: 11,
    status: "idle",
    player: {
      side: "player",
      pokemon: "Raichu",
      displayName: "ライチュウ",
      confidence: 0.91,
    },
    opponent: null,
    failedSides: ["opponent"],
  });

  assert.equal(nextRun.player, "Raichu");
  assert.equal(nextRun.opponent, "Garchomp");
});

test("an older server snapshot cannot move the detection state backward", () => {
  const current = {
    ...createDetectionSelectionState("idle", "Raichu", "Garchomp"),
    latestRevision: 12,
    appliedRunIDs: { player: 5, opponent: 5 },
  };

  const stale = applyServerSnapshot(current, {
    type: "detection_state",
    runID: 5,
    revision: 11,
    status: "detecting",
    player: null,
    opponent: null,
    failedSides: [],
  });

  assert.deepEqual(stale, current);
});

test("name inputs remain editable while no detection is running", () => {
  const idle = createDetectionSelectionState("idle", "Raichu", "Garchomp");

  assert.deepEqual(
    applyUserSelection(idle, "player", "Raichu-Mega-X"),
    createDetectionSelectionState("idle", "Raichu-Mega-X", "Garchomp"),
  );
});
