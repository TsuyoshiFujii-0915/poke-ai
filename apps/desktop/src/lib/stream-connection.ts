export interface StreamConnectionState {
  connected: boolean;
  revision: number;
}

export type StreamConnectionEvent =
  | "control-opened"
  | "image-loaded"
  | "image-failed"
  | "retry-requested";

export function createStreamConnectionState(): StreamConnectionState {
  return { connected: false, revision: 0 };
}

export function updateStreamConnection(
  state: StreamConnectionState,
  event: StreamConnectionEvent,
): StreamConnectionState {
  switch (event) {
    case "control-opened":
      return state;
    case "retry-requested":
      return { connected: false, revision: state.revision + 1 };
    case "image-loaded":
      return { ...state, connected: true };
    case "image-failed":
      return { ...state, connected: false };
  }
}
