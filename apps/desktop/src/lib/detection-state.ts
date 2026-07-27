export type DetectionStatus = "idle" | "detecting";
export type DetectionSide = "player" | "opponent";

export interface DetectionSelectionState {
  status: DetectionStatus;
  player: string;
  opponent: string;
  latestRevision: number;
  appliedRunIDs: Record<DetectionSide, number>;
}

export interface DetectedPokemonPresence {
  side: DetectionSide;
  pokemon: string;
  displayName: string;
  confidence: number;
}

export interface DetectionServerSnapshot {
  type: "detection_state";
  runID: number;
  revision: number;
  status: DetectionStatus;
  player: DetectedPokemonPresence | null;
  opponent: DetectedPokemonPresence | null;
  failedSides: DetectionSide[];
}

export function createDetectionSelectionState(
  status: DetectionStatus,
  player: string,
  opponent: string,
): DetectionSelectionState {
  return {
    status,
    player,
    opponent,
    latestRevision: 0,
    appliedRunIDs: { player: 0, opponent: 0 },
  };
}

export function applyServerSnapshot(
  state: DetectionSelectionState,
  snapshot: DetectionServerSnapshot,
): DetectionSelectionState {
  if (snapshot.revision < state.latestRevision) {
    return state;
  }
  const playerPresence = snapshot.player;
  const opponentPresence = snapshot.opponent;
  const shouldApplyPlayer =
    playerPresence !== null && snapshot.runID > state.appliedRunIDs.player;
  const shouldApplyOpponent =
    opponentPresence !== null && snapshot.runID > state.appliedRunIDs.opponent;
  return {
    status: snapshot.status,
    player: shouldApplyPlayer && playerPresence !== null ? playerPresence.pokemon : state.player,
    opponent: shouldApplyOpponent && opponentPresence !== null
      ? opponentPresence.pokemon
      : state.opponent,
    latestRevision: snapshot.revision,
    appliedRunIDs: {
      player: shouldApplyPlayer ? snapshot.runID : state.appliedRunIDs.player,
      opponent: shouldApplyOpponent ? snapshot.runID : state.appliedRunIDs.opponent,
    },
  };
}

export function applyUserSelection(
  state: DetectionSelectionState,
  side: DetectionSide,
  pokemon: string,
): DetectionSelectionState {
  return { ...state, [side]: pokemon };
}

export function parseDetectionServerMessage(raw: string): DetectionServerSnapshot {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("detection server message must contain a string type");
  }
  if (value.type === "detection_state") {
    return parseSnapshot(value);
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
  if (!isNonNegativeSafeInteger(value.runID) || !isNonNegativeSafeInteger(value.revision)) {
    throw new Error("detection state contains an invalid run identifier or revision");
  }
  return {
    type: "detection_state",
    runID: value.runID,
    revision: value.revision,
    status: value.status,
    player: parsePresence(value.player, "player"),
    opponent: parsePresence(value.opponent, "opponent"),
    failedSides: value.failedSides,
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

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
