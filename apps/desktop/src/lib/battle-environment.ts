export type BattleWeather = "None" | "Sun" | "Rain" | "Sand" | "Snow";
export type BattleTerrain = "None" | "Electric" | "Grassy" | "Psychic" | "Misty";
export type DamageDirection = "player-attacks" | "opponent-attacks";
export type DamageMoveCategory = "Physical" | "Special";

export interface BattleEnvironment {
  weather: BattleWeather;
  terrain: BattleTerrain;
  playerWallActive: boolean;
  opponentWallActive: boolean;
}

export interface ResolvedBattleField {
  weather: Exclude<BattleWeather, "None"> | undefined;
  terrain: Exclude<BattleTerrain, "None"> | undefined;
  isReflect: boolean;
  isLightScreen: boolean;
}

export function createBattleEnvironment(): BattleEnvironment {
  return {
    weather: "None",
    terrain: "None",
    playerWallActive: false,
    opponentWallActive: false,
  };
}

export function resolveBattleField(
  environment: BattleEnvironment,
  direction: DamageDirection,
  category: DamageMoveCategory,
): ResolvedBattleField {
  const wallActive = direction === "player-attacks"
    ? environment.opponentWallActive
    : environment.playerWallActive;
  return {
    weather: environment.weather === "None" ? undefined : environment.weather,
    terrain: environment.terrain === "None" ? undefined : environment.terrain,
    isReflect: wallActive && category === "Physical",
    isLightScreen: wallActive && category === "Special",
  };
}
