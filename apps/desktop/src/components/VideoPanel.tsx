// ゲーム画面表示（サイドカーのMJPEGストリーム）
import { useCallback, useEffect, useReducer, useRef, type ReactNode } from "react";
import {
  createStreamConnectionState,
  updateStreamConnection,
} from "../lib/stream-connection";

const STREAM_URL = "http://127.0.0.1:8787/stream";
const CONTROL_EVENTS_URL = "http://127.0.0.1:8788/events";
const RETRY_MS = 3000;

export function VideoPanel(): ReactNode {
  const [connection, dispatch] = useReducer(
    updateStreamConnection,
    undefined,
    createStreamConnectionState,
  );
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetry = useCallback((): void => {
    if (retryTimer.current === null) return;
    clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  const retry = useCallback((): void => {
    dispatch("image-failed");
    clearRetry();
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      dispatch("retry-requested");
    }, RETRY_MS);
  }, [clearRetry]);

  useEffect(() => {
    const events = new EventSource(CONTROL_EVENTS_URL);
    events.onopen = (): void => {
      clearRetry();
      dispatch("control-opened");
    };
    return (): void => {
      clearRetry();
      events.close();
    };
  }, [clearRetry]);

  return (
    <div className="video-panel">
      {connection.connected && <span className="live-badge">LIVE</span>}
      {!connection.connected && (
        <div className="video-placeholder">
          <p>配信サーバーに接続中...</p>
          <p className="hint">キャプチャサイドカーが起動しているか確認して</p>
        </div>
      )}
      <img
        src={`${STREAM_URL}?revision=${connection.revision}`}
        alt=""
        hidden={!connection.connected}
        onLoad={() => dispatch("image-loaded")}
        onError={retry}
      />
    </div>
  );
}
