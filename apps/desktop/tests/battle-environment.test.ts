import assert from "node:assert/strict";
import test from "node:test";
import {
  createBattleEnvironment,
  resolveBattleField,
} from "../src/lib/battle-environment.ts";

test("applies global weather and terrain in both damage directions", () => {
  const environment = {
    ...createBattleEnvironment(),
    weather: "Rain" as const,
    terrain: "Electric" as const,
  };

  assert.deepEqual(resolveBattleField(environment, "player-attacks", "Special"), {
    weather: "Rain",
    terrain: "Electric",
    isReflect: false,
    isLightScreen: false,
  });
  assert.deepEqual(resolveBattleField(environment, "opponent-attacks", "Physical"), {
    weather: "Rain",
    terrain: "Electric",
    isReflect: false,
    isLightScreen: false,
  });
});

test("uses only the defending side wall and derives its screen from move category", () => {
  const environment = {
    ...createBattleEnvironment(),
    playerWallActive: true,
    opponentWallActive: false,
  };

  assert.deepEqual(resolveBattleField(environment, "player-attacks", "Physical"), {
    weather: undefined,
    terrain: undefined,
    isReflect: false,
    isLightScreen: false,
  });
  assert.deepEqual(resolveBattleField(environment, "opponent-attacks", "Physical"), {
    weather: undefined,
    terrain: undefined,
    isReflect: true,
    isLightScreen: false,
  });
  assert.deepEqual(resolveBattleField(environment, "opponent-attacks", "Special"), {
    weather: undefined,
    terrain: undefined,
    isReflect: false,
    isLightScreen: true,
  });
});
