export type DetectionMode = "auto" | "manual";
export type DetectionSide = "player" | "opponent";

export interface DetectionSelectionState {
  mode: DetectionMode;
  player: string;
  opponent: string;
}

export interface DetectedPokemonPresence {
  side: DetectionSide;
  pokemon: string;
  displayName: string;
  confidence: number;
}

export interface DetectionServerSnapshot {
  type: "detection_state";
  mode: DetectionMode;
  player: DetectedPokemonPresence | null;
  opponent: DetectedPokemonPresence | null;
}

export interface AutomaticPokemonEvent {
  type: "pokemon_detected" | "pokemon_switched_in";
  timestamp: string;
  side: DetectionSide;
  pokemon: string;
  displayName: string;
  confidence: number;
  source: "ocr";
}

export type DetectionServerMessage = DetectionServerSnapshot | AutomaticPokemonEvent;

export function createDetectionSelectionState(
  mode: DetectionMode,
  player: string,
  opponent: string,
): DetectionSelectionState {
  return { mode, player, opponent };
}

export function applyServerSnapshot(
  state: DetectionSelectionState,
  snapshot: DetectionServerSnapshot,
): DetectionSelectionState {
  if (snapshot.mode === "manual") {
    return { ...state, mode: "manual" };
  }
  return {
    mode: "auto",
    player: snapshot.player?.pokemon ?? "",
    opponent: snapshot.opponent?.pokemon ?? "",
  };
}

export function applyAutomaticDetection(
  state: DetectionSelectionState,
  side: DetectionSide,
  pokemon: string,
): DetectionSelectionState {
  if (state.mode === "manual") {
    return state;
  }
  return { ...state, [side]: pokemon };
}

export function applyManualSelection(
  state: DetectionSelectionState,
  side: DetectionSide,
  pokemon: string,
): DetectionSelectionState {
  if (state.mode !== "manual") {
    throw new Error("manual selection requires manual detection mode");
  }
  return { ...state, [side]: pokemon };
}

export function parseDetectionServerMessage(raw: string): DetectionServerMessage {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("detection server message must contain a string type");
  }
  if (value.type === "detection_state") {
    return parseSnapshot(value);
  }
  if (value.type === "pokemon_detected" || value.type === "pokemon_switched_in") {
    return parseAutomaticEvent(value);
  }
  throw new Error(`unsupported detection server message type: ${value.type}`);
}

function parseSnapshot(value: Record<string, unknown>): DetectionServerSnapshot {
  if (value.mode !== "auto" && value.mode !== "manual") {
    throw new Error("detection state contains an invalid mode");
  }
  return {
    type: "detection_state",
    mode: value.mode,
    player: parsePresence(value.player, "player"),
    opponent: parsePresence(value.opponent, "opponent"),
  };
}

function parseAutomaticEvent(value: Record<string, unknown>): AutomaticPokemonEvent {
  if (
    (value.side !== "player" && value.side !== "opponent") ||
    typeof value.timestamp !== "string" ||
    typeof value.pokemon !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.confidence !== "number" ||
    value.source !== "ocr"
  ) {
    throw new Error("automatic detection event has an invalid shape");
  }
  return {
    type: value.type as AutomaticPokemonEvent["type"],
    timestamp: value.timestamp,
    side: value.side,
    pokemon: value.pokemon,
    displayName: value.displayName,
    confidence: value.confidence,
    source: "ocr",
  };
}

function parsePresence(
  value: unknown,
  expectedSide: DetectionSide,
): DetectedPokemonPresence | null {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    value.side !== expectedSide ||
    typeof value.pokemon !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.confidence !== "number"
  ) {
    throw new Error(`detection state contains an invalid ${expectedSide} presence`);
  }
  return {
    side: expectedSide,
    pokemon: value.pokemon,
    displayName: value.displayName,
    confidence: value.confidence,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
