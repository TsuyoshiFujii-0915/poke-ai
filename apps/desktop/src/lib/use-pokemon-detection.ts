import { useCallback, useEffect, useState } from "react";
import {
  applyDetectionResult,
  applyServerSnapshot,
  applyUserSelection,
  createDetectionSelectionState,
  parseDetectionServerMessage,
  type DetectionSelectionState,
  type DetectionServerSnapshot,
  type DetectionSide,
} from "./detection-state";

const DETECTION_CONTROL_URL = "http://127.0.0.1:8788";

export interface PokemonDetectionControl {
  selection: DetectionSelectionState;
  synchronized: boolean;
  requestingDetection: boolean;
  error: string | null;
  detect: () => Promise<void>;
  selectPokemon: (side: DetectionSide, pokemon: string) => void;
}

export function usePokemonDetection(): PokemonDetectionControl {
  const [selection, setSelection] = useState<DetectionSelectionState>(() =>
    createDetectionSelectionState("idle", "", ""),
  );
  const [synchronized, setSynchronized] = useState(false);
  const [requestingDetection, setRequestingDetection] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const events = new EventSource(`${DETECTION_CONTROL_URL}/events`);
    events.onmessage = (message: MessageEvent<string>): void => {
      try {
        const event = parseDetectionServerMessage(message.data);
        if (event.type === "detection_state") {
          setSelection((current) => applyServerSnapshot(current, event));
          setError(detectionFailureMessage(event));
        } else {
          setSelection((current) =>
            applyDetectionResult(current, event.side, event.pokemon),
          );
        }
        setSynchronized(true);
      } catch (cause) {
        setSynchronized(false);
        setError(describeError("検出状態の受信に失敗しました", cause));
        events.close();
      }
    };
    events.onerror = (): void => {
      setSynchronized(false);
      setError("検出プロセスに接続できません");
    };
    return (): void => {
      events.close();
    };
  }, []);

  const detect = useCallback(async (): Promise<void> => {
    setRequestingDetection(true);
    try {
      const response = await fetch(`${DETECTION_CONTROL_URL}/detect`, {
        method: "POST",
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }
      const snapshot = parseDetectionServerMessage(await response.text());
      if (snapshot.type !== "detection_state") {
        throw new Error("detection response is not a detection state");
      }
      setSelection((current) => applyServerSnapshot(current, snapshot));
      setSynchronized(true);
      setError(detectionFailureMessage(snapshot));
    } catch (cause) {
      setError(describeError("ポケモン名を検出できませんでした", cause));
    } finally {
      setRequestingDetection(false);
    }
  }, []);

  const selectPokemon = useCallback(
    (side: DetectionSide, pokemon: string): void => {
      setSelection((current) => applyUserSelection(current, side, pokemon));
    },
    [],
  );

  return {
    selection,
    synchronized,
    requestingDetection,
    error,
    detect,
    selectPokemon,
  };
}

function detectionFailureMessage(snapshot: DetectionServerSnapshot): string | null {
  if (snapshot.failedSides.length === 0) {
    return null;
  }
  const labels = snapshot.failedSides.map((side) =>
    side === "player" ? "自分側" : "相手側",
  );
  return `${labels.join("・")}の名前を検出できませんでした`;
}

function describeError(message: string, cause: unknown): string {
  if (cause instanceof Error) {
    return `${message}: ${cause.message}`;
  }
  return message;
}
