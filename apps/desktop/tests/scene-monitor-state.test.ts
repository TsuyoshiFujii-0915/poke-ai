import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSceneMonitorMessage,
  sceneMonitorPresentation,
  type SceneMonitorSnapshot,
} from "../src/lib/scene-monitor-state.ts";

test("parses a stable battle input scene from the capture process", () => {
  const snapshot = parseSceneMonitorMessage(JSON.stringify({
    type: "scene_state",
    revision: 12,
    scene: "battle_input",
    candidate: "battle_input",
    stability: "stable",
    playerHUD: "visible",
    opponentHUD: "visible",
  }));

  assert.deepEqual(snapshot, {
    type: "scene_state",
    revision: 12,
    scene: "battle_input",
    candidate: "battle_input",
    stability: "stable",
    playerHUD: "visible",
    opponentHUD: "visible",
  });
});

test("rejects an unsupported scene instead of silently treating it as unknown", () => {
  assert.throws(
    () => parseSceneMonitorMessage(JSON.stringify({
      type: "scene_state",
      revision: 1,
      scene: "result_screen",
      candidate: "result_screen",
      stability: "stable",
      playerHUD: "hidden",
      opponentHUD: "hidden",
    })),
    /invalid scene/,
  );
});

test("presents a recognized out-of-battle screen separately from unknown", () => {
  const snapshot = parseSceneMonitorMessage(JSON.stringify({
    type: "scene_state",
    revision: 13,
    scene: "out_of_battle",
    candidate: "out_of_battle",
    stability: "stable",
    playerHUD: "hidden",
    opponentHUD: "hidden",
  }));

  assert.deepEqual(sceneMonitorPresentation(snapshot), {
    label: "対戦外",
    detail: "対応済みの対戦外画面を確認しています",
    tone: "idle",
  });
});

test("presents a completed battle result as a distinct stable scene", () => {
  const snapshot = parseSceneMonitorMessage(JSON.stringify({
    type: "scene_state",
    revision: 14,
    scene: "battle_result",
    candidate: "battle_result",
    stability: "stable",
    playerHUD: "hidden",
    opponentHUD: "hidden",
  }));

  assert.deepEqual(sceneMonitorPresentation(snapshot), {
    label: "勝敗画面",
    detail: "対戦結果が完全に表示されています",
    tone: "stable",
  });
});

test("presents an action transition as a high-frequency observation state", () => {
  const snapshot: SceneMonitorSnapshot = {
    type: "scene_state",
    revision: 8,
    scene: "battle_input",
    candidate: "battle_action",
    stability: "transitioning",
    playerHUD: "hidden",
    opponentHUD: "hidden",
  };

  assert.deepEqual(sceneMonitorPresentation(snapshot), {
    label: "技・交代を検出中",
    detail: "画面変化を高頻度で確認しています",
    tone: "active",
  });
});
