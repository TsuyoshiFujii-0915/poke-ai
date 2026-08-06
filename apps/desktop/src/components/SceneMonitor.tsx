import type { ReactNode } from "react";
import {
  sceneMonitorPresentation,
  type HUDVisibility,
  type SceneMonitorPresentation,
} from "../lib/scene-monitor-state";
import { useSceneMonitor } from "../lib/use-scene-monitor";

export function SceneMonitor(): ReactNode {
  const { snapshot, synchronized, error } = useSceneMonitor();
  const presentation: SceneMonitorPresentation = snapshot === null
    ? disconnectedPresentation(error)
    : sceneMonitorPresentation(snapshot);

  return (
    <section
      className={`scene-monitor scene-monitor-${presentation.tone}`}
      aria-label="画面状態モニター"
      aria-live="polite"
      title={error ?? undefined}
    >
      <header className="scene-monitor-header">
        <span className="scene-monitor-title">
          <span aria-hidden="true" />
          SCENE MONITOR
        </span>
        <span className={`scene-monitor-link ${synchronized ? "online" : "offline"}`}>
          {synchronized ? "SYNC" : "WAIT"}
        </span>
      </header>
      <strong className="scene-monitor-label">{presentation.label}</strong>
      <p className="scene-monitor-detail">{presentation.detail}</p>
      <div className="scene-monitor-huds" aria-label="HUD表示状態">
        <HUDStatus label="YOU" visibility={snapshot?.playerHUD ?? "hidden"} />
        <HUDStatus label="RIVAL" visibility={snapshot?.opponentHUD ?? "hidden"} />
      </div>
    </section>
  );
}

interface HUDStatusProps {
  label: string;
  visibility: HUDVisibility;
}

function HUDStatus({ label, visibility }: HUDStatusProps): ReactNode {
  const visible = visibility === "visible";
  return (
    <span className={visible ? "visible" : "hidden"}>
      <i aria-hidden="true" />
      {label} {visible ? "ON" : "OFF"}
    </span>
  );
}

function disconnectedPresentation(error: string | null): SceneMonitorPresentation {
  if (error !== null) {
    return {
      label: "モニター停止",
      detail: "キャプチャ側との接続を確認してください",
      tone: "idle",
    };
  }
  return {
    label: "接続中",
    detail: "画面状態の同期を待っています",
    tone: "idle",
  };
}
