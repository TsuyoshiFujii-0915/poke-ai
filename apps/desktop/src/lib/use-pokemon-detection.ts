import { useCallback, useEffect, useState } from "react";
import {
  applyAutomaticDetection,
  applyServerSnapshot,
  applyUserSelection,
  createDetectionSelectionState,
  parseDetectionServerMessage,
  type DetectionMode,
  type DetectionSelectionState,
  type DetectionSide,
} from "./detection-state";

const DETECTION_CONTROL_URL = "http://127.0.0.1:8788";

export interface PokemonDetectionControl {
  selection: DetectionSelectionState;
  synchronized: boolean;
  changingMode: boolean;
  error: string | null;
  changeMode: (mode: DetectionMode) => Promise<void>;
  selectPokemon: (side: DetectionSide, pokemon: string) => void;
}

export function usePokemonDetection(): PokemonDetectionControl {
  const [selection, setSelection] = useState<DetectionSelectionState>(() =>
    createDetectionSelectionState("auto", "", ""),
  );
  const [synchronized, setSynchronized] = useState(false);
  const [changingMode, setChangingMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const events = new EventSource(`${DETECTION_CONTROL_URL}/events`);
    events.onmessage = (message: MessageEvent<string>): void => {
      try {
        const event = parseDetectionServerMessage(message.data);
        if (event.type === "detection_state") {
          setSelection((current) => applyServerSnapshot(current, event));
        } else {
          setSelection((current) =>
            applyAutomaticDetection(current, event.side, event.pokemon),
          );
        }
        setSynchronized(true);
        setError(null);
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

  const changeMode = useCallback(async (mode: DetectionMode): Promise<void> => {
    setChangingMode(true);
    try {
      const response = await fetch(`${DETECTION_CONTROL_URL}/mode/${mode}`, {
        method: "POST",
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }
      const snapshot = parseDetectionServerMessage(await response.text());
      if (snapshot.type !== "detection_state") {
        throw new Error("mode change response is not a detection state");
      }
      setSelection((current) => applyServerSnapshot(current, snapshot));
      setSynchronized(true);
      setError(null);
    } catch (cause) {
      setSynchronized(false);
      setError(describeError("検出モードを変更できませんでした", cause));
    } finally {
      setChangingMode(false);
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
    changingMode,
    error,
    changeMode,
    selectPokemon,
  };
}

function describeError(message: string, cause: unknown): string {
  if (cause instanceof Error) {
    return `${message}: ${cause.message}`;
  }
  return message;
}
