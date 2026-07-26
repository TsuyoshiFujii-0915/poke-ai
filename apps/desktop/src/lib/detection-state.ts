export type DetectionStatus = "idle" | "detecting";
export type DetectionSide = "player" | "opponent";

export interface DetectionSelectionState {
  status: DetectionStatus;
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
  status: DetectionStatus;
  player: DetectedPokemonPresence | null;
  opponent: DetectedPokemonPresence | null;
  failedSides: DetectionSide[];
}

export interface PokemonDetectionEvent {
  type: "pokemon_detected" | "pokemon_switched_in";
  timestamp: string;
  side: DetectionSide;
  pokemon: string;
  displayName: string;
  confidence: number;
  source: "ocr";
}

export type DetectionServerMessage = DetectionServerSnapshot | PokemonDetectionEvent;

export function createDetectionSelectionState(
  status: DetectionStatus,
  player: string,
  opponent: string,
): DetectionSelectionState {
  return { status, player, opponent };
}

export function applyServerSnapshot(
  state: DetectionSelectionState,
  snapshot: DetectionServerSnapshot,
): DetectionSelectionState {
  return {
    status: snapshot.status,
    player: snapshot.player?.pokemon ?? state.player,
    opponent: snapshot.opponent?.pokemon ?? state.opponent,
  };
}

export function applyDetectionResult(
  state: DetectionSelectionState,
  side: DetectionSide,
  pokemon: string,
): DetectionSelectionState {
  if (state.status === "idle") {
    return state;
  }
  return { ...state, [side]: pokemon };
}

export function applyUserSelection(
  state: DetectionSelectionState,
  side: DetectionSide,
  pokemon: string,
): DetectionSelectionState {
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
    return parseDetectionEvent(value);
  }
  throw new Error(`unsupported detection server message type: ${value.type}`);
}

function parseSnapshot(value: Record<string, unknown>): DetectionServerSnapshot {
  if (value.status !== "idle" && value.status !== "detecting") {
    throw new Error("detection state contains an invalid status");
  }
  if (!Array.isArray(value.failedSides) || !value.failedSides.every(isDetectionSide)) {
    throw new Error("detection state contains invalid failed sides");
  }
  return {
    type: "detection_state",
    status: value.status,
    player: parsePresence(value.player, "player"),
    opponent: parsePresence(value.opponent, "opponent"),
    failedSides: value.failedSides,
  };
}

function parseDetectionEvent(value: Record<string, unknown>): PokemonDetectionEvent {
  if (
    !isDetectionSide(value.side) ||
    typeof value.timestamp !== "string" ||
    typeof value.pokemon !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.confidence !== "number" ||
    value.source !== "ocr"
  ) {
    throw new Error("detection event has an invalid shape");
  }
  return {
    type: value.type as PokemonDetectionEvent["type"],
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

function isDetectionSide(value: unknown): value is DetectionSide {
  return value === "player" || value === "opponent";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
