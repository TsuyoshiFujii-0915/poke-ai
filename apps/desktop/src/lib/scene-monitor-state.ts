export type GameScene =
  | "unknown"
  | "out_of_battle"
  | "battle_result"
  | "team_selection"
  | "battle_input"
  | "party_overview"
  | "battle_action";

export type SceneStability = "stable" | "transitioning";
export type HUDVisibility = "visible" | "hidden";
export type SceneMonitorTone = "idle" | "stable" | "active";

export interface SceneMonitorSnapshot {
  type: "scene_state";
  revision: number;
  scene: GameScene;
  candidate: GameScene;
  stability: SceneStability;
  playerHUD: HUDVisibility;
  opponentHUD: HUDVisibility;
}

export interface SceneMonitorPresentation {
  label: string;
  detail: string;
  tone: SceneMonitorTone;
}

export function parseSceneMonitorMessage(raw: string): SceneMonitorSnapshot {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.type !== "scene_state") {
    throw new Error("scene monitor message must have type scene_state");
  }
  if (!isGameScene(value.scene) || !isGameScene(value.candidate)) {
    throw new Error("scene monitor message contains an invalid scene");
  }
  if (value.stability !== "stable" && value.stability !== "transitioning") {
    throw new Error("scene monitor message contains invalid stability");
  }
  if (!isHUDVisibility(value.playerHUD) || !isHUDVisibility(value.opponentHUD)) {
    throw new Error("scene monitor message contains invalid HUD visibility");
  }
  if (!isNonNegativeSafeInteger(value.revision)) {
    throw new Error("scene monitor message contains an invalid revision");
  }
  return {
    type: "scene_state",
    revision: value.revision,
    scene: value.scene,
    candidate: value.candidate,
    stability: value.stability,
    playerHUD: value.playerHUD,
    opponentHUD: value.opponentHUD,
  };
}

export function sceneMonitorPresentation(
  snapshot: SceneMonitorSnapshot,
): SceneMonitorPresentation {
  if (snapshot.stability === "transitioning") {
    if (snapshot.candidate === "battle_action") {
      return {
        label: "技・交代を検出中",
        detail: "画面変化を高頻度で確認しています",
        tone: "active",
      };
    }
    return {
      label: `${sceneLabel(snapshot.candidate)}へ遷移中`,
      detail: "状態が安定するまで確認しています",
      tone: "active",
    };
  }

  switch (snapshot.scene) {
    case "unknown":
      return {
        label: "判定待ち",
        detail: "対応している対戦画面を待っています",
        tone: "idle",
      };
    case "out_of_battle":
      return {
        label: "対戦外",
        detail: "対応済みの対戦外画面を確認しています",
        tone: "idle",
      };
    case "battle_result":
      return {
        label: "勝敗画面",
        detail: "対戦結果が完全に表示されています",
        tone: "stable",
      };
    case "team_selection":
      return {
        label: "選出画面",
        detail: "対戦に出すポケモンを選択中です",
        tone: "stable",
      };
    case "battle_input":
      return {
        label: "入力待ち",
        detail: "プレイヤーのコマンド選択を待っています",
        tone: "stable",
      };
    case "party_overview":
      return {
        label: "ポケモン一覧",
        detail: "交代先の選択画面を確認しています",
        tone: "stable",
      };
    case "battle_action":
      return {
        label: "技・交代を実行中",
        detail: "画面変化を高頻度で確認しています",
        tone: "active",
      };
  }
}

function sceneLabel(scene: GameScene): string {
  switch (scene) {
    case "unknown":
      return "不明な画面";
    case "out_of_battle":
      return "対戦外";
    case "battle_result":
      return "勝敗画面";
    case "team_selection":
      return "選出画面";
    case "battle_input":
      return "入力待ち";
    case "party_overview":
      return "ポケモン一覧";
    case "battle_action":
      return "技・交代実行";
  }
}

function isGameScene(value: unknown): value is GameScene {
  return value === "unknown"
    || value === "out_of_battle"
    || value === "battle_result"
    || value === "team_selection"
    || value === "battle_input"
    || value === "party_overview"
    || value === "battle_action";
}

function isHUDVisibility(value: unknown): value is HUDVisibility {
  return value === "visible" || value === "hidden";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
