import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { createNeutralStatStages } from "../src/lib/stat-stage.ts";
import { createBattleEnvironment } from "../src/lib/battle-environment.ts";

const vite = await createServer({ appType: "custom", server: { middlewareMode: true } });
const { calcMyAttack } = await vite.ssrLoadModule("/src/lib/calc.ts") as {
  calcMyAttack: (
    me: Record<string, unknown>,
    opp: Record<string, unknown>,
    environment: Record<string, unknown>,
  ) => {
    attackerAbilityApplied: boolean;
    presets: Array<{ minPercent: number; maxPercent: number }>;
  };
};
const environment = createBattleEnvironment();

after(async () => {
  await vite.close();
});

function myConfig(
  species: string,
  ability: string,
  move: string,
  abilityTriggerActive: boolean,
) {
  return {
    species,
    ability,
    abilityTriggerActive,
    item: "",
    move,
    points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    stages: createNeutralStatStages(),
  };
}

function opponentConfig() {
  return {
    species: "Snorlax",
    ability: "Immunity",
    abilityTriggerActive: false,
    item: "",
    move: "",
    stages: createNeutralStatStages(),
  };
}

test("reports Adaptability as automatically applied only to a matching STAB move", () => {
  const applied = calcMyAttack(
    myConfig("Basculegion", "Adaptability", "Surf", false),
    opponentConfig(),
    environment,
  );
  const notApplied = calcMyAttack(
    myConfig("Basculegion", "Adaptability", "Thunderbolt", false),
    opponentConfig(),
    environment,
  );

  assert.equal(applied.attackerAbilityApplied, true);
  assert.equal(notApplied.attackerAbilityApplied, false);
});

test("manual Flash Fire activation changes Fire damage and remains user-controlled", () => {
  const inactive = calcMyAttack(
    myConfig("Arcanine", "Flash Fire", "Flamethrower", false),
    opponentConfig(),
    environment,
  );
  const active = calcMyAttack(
    myConfig("Arcanine", "Flash Fire", "Flamethrower", true),
    opponentConfig(),
    environment,
  );

  assert.equal(inactive.attackerAbilityApplied, false);
  assert.equal(active.attackerAbilityApplied, true);
  assert.ok(active.presets[0].minPercent > inactive.presets[0].minPercent);
});

test("manual Electromorphosis activation doubles Electric move power", () => {
  const inactive = calcMyAttack(
    myConfig("Bellibolt", "Electromorphosis", "Thunderbolt", false),
    opponentConfig(),
    environment,
  );
  const active = calcMyAttack(
    myConfig("Bellibolt", "Electromorphosis", "Thunderbolt", true),
    opponentConfig(),
    environment,
  );

  assert.equal(active.attackerAbilityApplied, true);
  assert.ok(active.presets[0].minPercent > inactive.presets[0].minPercent * 1.9);
  assert.ok(active.presets[0].maxPercent > inactive.presets[0].maxPercent * 1.9);
});

test("Skill Link automatically uses the maximum hit count", () => {
  const regular = calcMyAttack(
    myConfig("Toucannon", "Sheer Force", "Bullet Seed", false),
    opponentConfig(),
    environment,
  );
  const skillLink = calcMyAttack(
    myConfig("Toucannon", "Skill Link", "Bullet Seed", false),
    opponentConfig(),
    environment,
  );

  assert.equal(skillLink.attackerAbilityApplied, true);
  assert.ok(skillLink.presets[0].minPercent > regular.presets[0].minPercent * 1.5);
  assert.ok(skillLink.presets[0].maxPercent > regular.presets[0].maxPercent * 1.5);
});
