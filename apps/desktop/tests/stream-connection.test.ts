import assert from "node:assert/strict";
import test from "node:test";
import {
  createStreamConnectionState,
  updateStreamConnection,
} from "../src/lib/stream-connection.ts";

test("reloads the MJPEG request when capture control reconnects", () => {
  const initial = createStreamConnectionState();
  const loaded = updateStreamConnection(initial, "image-loaded");
  const reconnected = updateStreamConnection(loaded, "control-opened");

  assert.equal(loaded.connected, true);
  assert.deepEqual(reconnected, { connected: false, revision: 1 });
});

test("keeps one retry generation per failed image request", () => {
  const initial = createStreamConnectionState();
  const failed = updateStreamConnection(initial, "image-failed");
  const retry = updateStreamConnection(failed, "retry-requested");

  assert.deepEqual(failed, { connected: false, revision: 0 });
  assert.deepEqual(retry, { connected: false, revision: 1 });
});
