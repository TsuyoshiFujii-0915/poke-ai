import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { createBattleEnvironment } from "../src/lib/battle-environment.ts";
import { createNeutralStatStages } from "../src/lib/stat-stage.ts";

const vite = await createServer({ appType: "custom", server: { middlewareMode: true } });
const { calcMyAttack } = await vite.ssrLoadModule("/src/lib/calc.ts") as {
  calcMyAttack: (
    me: Record<string, unknown>,
    opp: Record<string, unknown>,
    environment: Record<string, unknown>,
  ) => {
    presets: Array<{ minPercent: number; maxPercent: number }>;
  };
};

after(async () => {
  await vite.close();
});

function playerConfig(
  species: string,
  ability: string,
  move: string,
): Record<string, unknown> {
  return {
    species,
    ability,
    abilityTriggerActive: false,
    item: "",
    move,
    points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    stages: createNeutralStatStages(),
  };
}

function opponentConfig(): Record<string, unknown> {
  return {
    species: "Snorlax",
    ability: "Immunity",
    abilityTriggerActive: false,
    item: "",
    move: "",
    stages: createNeutralStatStages(),
  };
}

test("rain increases Water damage", () => {
  const neutral = calcMyAttack(
    playerConfig("Blastoise", "Torrent", "Surf"),
    opponentConfig(),
    createBattleEnvironment(),
  );
  const rain = calcMyAttack(
    playerConfig("Blastoise", "Torrent", "Surf"),
    opponentConfig(),
    { ...createBattleEnvironment(), weather: "Rain" },
  );

  assert.ok(rain.presets[0].minPercent > neutral.presets[0].minPercent * 1.4);
});

test("the opponent wall reduces only player damage", () => {
  const neutral = calcMyAttack(
    playerConfig("Toucannon", "Sheer Force", "Body Slam"),
    opponentConfig(),
    createBattleEnvironment(),
  );
  const screened = calcMyAttack(
    playerConfig("Toucannon", "Sheer Force", "Body Slam"),
    opponentConfig(),
    { ...createBattleEnvironment(), opponentWallActive: true },
  );

  assert.ok(screened.presets[0].maxPercent < neutral.presets[0].maxPercent * 0.6);
});

test("Electric Terrain increases grounded Electric damage", () => {
  const neutral = calcMyAttack(
    playerConfig("Pikachu", "Static", "Thunderbolt"),
    opponentConfig(),
    createBattleEnvironment(),
  );
  const electric = calcMyAttack(
    playerConfig("Pikachu", "Static", "Thunderbolt"),
    opponentConfig(),
    { ...createBattleEnvironment(), terrain: "Electric" },
  );

  assert.ok(electric.presets[0].minPercent > neutral.presets[0].minPercent * 1.2);
});
