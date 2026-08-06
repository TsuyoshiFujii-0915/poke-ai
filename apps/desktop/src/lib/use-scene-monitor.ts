import { useEffect, useState } from "react";
import {
  parseSceneMonitorMessage,
  type SceneMonitorSnapshot,
} from "./scene-monitor-state";

const SCENE_MONITOR_URL = "http://127.0.0.1:8788/scene-events";

export interface SceneMonitorControl {
  snapshot: SceneMonitorSnapshot | null;
  synchronized: boolean;
  error: string | null;
}

export function useSceneMonitor(): SceneMonitorControl {
  const [snapshot, setSnapshot] = useState<SceneMonitorSnapshot | null>(null);
  const [synchronized, setSynchronized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const events = new EventSource(SCENE_MONITOR_URL);
    events.onmessage = (message: MessageEvent<string>): void => {
      try {
        const nextSnapshot = parseSceneMonitorMessage(message.data);
        setSnapshot((current) => {
          if (current !== null && nextSnapshot.revision < current.revision) {
            return current;
          }
          return nextSnapshot;
        });
        setSynchronized(true);
        setError(null);
      } catch (cause) {
        setSynchronized(false);
        setError(describeError("画面状態の受信に失敗しました", cause));
        events.close();
      }
    };
    events.onerror = (): void => {
      setSnapshot(null);
      setSynchronized(false);
      setError("画面状態モニターに接続できません");
    };
    return (): void => {
      events.close();
    };
  }, []);

  return { snapshot, synchronized, error };
}

function describeError(message: string, cause: unknown): string {
  if (cause instanceof Error) {
    return `${message}: ${cause.message}`;
  }
  return message;
}
