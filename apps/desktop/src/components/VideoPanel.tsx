// ゲーム画面表示（サイドカーのMJPEGストリーム）
import { useCallback, useState } from "react";

const STREAM_URL = "http://127.0.0.1:8787/stream";
const RETRY_MS = 3000;

export function VideoPanel() {
  const [src, setSrc] = useState(`${STREAM_URL}?t=${Date.now()}`);
  const [connected, setConnected] = useState(false);

  const retry = useCallback(() => {
    setConnected(false);
    setTimeout(() => setSrc(`${STREAM_URL}?t=${Date.now()}`), RETRY_MS);
  }, []);

  return (
    <div className="video-panel">
      {connected && <span className="live-badge">LIVE</span>}
      {!connected && (
        <div className="video-placeholder">
          <p>配信サーバーに接続中...</p>
          <p className="hint">キャプチャサイドカーが起動しているか確認して</p>
        </div>
      )}
      <img
        src={src}
        alt=""
        hidden={!connected}
        onLoad={() => setConnected(true)}
        onError={retry}
      />
    </div>
  );
}
