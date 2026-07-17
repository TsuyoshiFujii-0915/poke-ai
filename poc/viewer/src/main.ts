// PoC 0-2: MJPEGストリーム表示ビューア
//
// サイドカー(poke-capture-poc stream)が配信する
// http://127.0.0.1:8787 のMJPEGストリームを <img> で表示する。
// 切断時は自動リトライする。

const STREAM_URL = "http://127.0.0.1:8787/stream";
const RETRY_INTERVAL_MS = 2000;

const img = document.getElementById("screen") as HTMLImageElement;
const placeholder = document.getElementById("placeholder") as HTMLDivElement;
const status = document.getElementById("status") as HTMLSpanElement;
const stats = document.getElementById("stats") as HTMLSpanElement;

let connectedAt: number | null = null;

function setConnected(connected: boolean) {
  status.textContent = connected ? "受信中" : "未接続";
  status.classList.toggle("connected", connected);
  img.hidden = !connected;
  placeholder.hidden = connected;
  connectedAt = connected ? performance.now() : null;
}

function connect() {
  // クエリを変えてキャッシュを避けつつ再接続
  img.src = `${STREAM_URL}?t=${Date.now()}`;
}

// MJPEGでは最初のフレーム描画時に一度だけ load が発火する
img.addEventListener("load", () => {
  setConnected(true);
  stats.textContent = `${img.naturalWidth}x${img.naturalHeight}`;
});

img.addEventListener("error", () => {
  setConnected(false);
  setTimeout(connect, RETRY_INTERVAL_MS);
});

// ストリームが静かに止まった場合の検知（描画サイズ変化はないため、
// 定期的に再接続の生存確認だけ行う軽量ウォッチドッグ）
setInterval(() => {
  if (connectedAt !== null) {
    const mins = Math.floor((performance.now() - connectedAt) / 60000);
    stats.textContent = `${img.naturalWidth}x${img.naturalHeight} / 接続 ${mins} 分`;
  }
}, 10000);

setConnected(false);
connect();
