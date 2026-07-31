import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import {
  createBattleEnvironment,
  type BattleEnvironment,
} from "../src/lib/battle-environment.ts";
import type {
  DirectionResult,
  MySideConfig,
  OpponentConfig,
} from "../src/lib/calc.ts";
import { createNeutralStatStages } from "../src/lib/stat-stage.ts";

const vite = await createServer({ appType: "custom", server: { middlewareMode: true } });
const { calcMyAttack } = await vite.ssrLoadModule("/src/lib/calc.ts") as {
  calcMyAttack: (
    me: MySideConfig,
    opp: OpponentConfig,
    environment: BattleEnvironment,
  ) => DirectionResult;
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
): MySideConfig {
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

function opponentConfig(): OpponentConfig {
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

test("Sand Force activates automatically only in sand for a matching move type", () => {
  const sand: BattleEnvironment = { ...environment, weather: "Sand" };
  const neutralEarthquake = calcMyAttack(
    myConfig("Garchomp-Mega", "Sand Force", "Earthquake", false),
    opponentConfig(),
    environment,
  );
  const sandEarthquake = calcMyAttack(
    myConfig("Garchomp-Mega", "Sand Force", "Earthquake", false),
    opponentConfig(),
    sand,
  );
  const sandDragonClaw = calcMyAttack(
    myConfig("Garchomp-Mega", "Sand Force", "Dragon Claw", false),
    opponentConfig(),
    sand,
  );
  const neutralDragonClaw = calcMyAttack(
    myConfig("Garchomp-Mega", "Sand Force", "Dragon Claw", false),
    opponentConfig(),
    environment,
  );

  assert.equal(neutralEarthquake.attackerAbilityApplied, false);
  assert.equal(sandEarthquake.attackerAbilityApplied, true);
  assert.ok(
    sandEarthquake.presets[0].minPercent > neutralEarthquake.presets[0].minPercent * 1.2,
  );
  assert.equal(sandDragonClaw.attackerAbilityApplied, false);
  assert.equal(
    sandDragonClaw.presets[0].minPercent,
    neutralDragonClaw.presets[0].minPercent,
  );
});

test("Solar Power activates automatically only in sun for a special move", () => {
  const sun: BattleEnvironment = { ...environment, weather: "Sun" };
  const neutralAirSlash = calcMyAttack(
    myConfig("Charizard", "Solar Power", "Air Slash", false),
    opponentConfig(),
    environment,
  );
  const sunAirSlash = calcMyAttack(
    myConfig("Charizard", "Solar Power", "Air Slash", false),
    opponentConfig(),
    sun,
  );
  const sunWingAttack = calcMyAttack(
    myConfig("Charizard", "Solar Power", "Wing Attack", false),
    opponentConfig(),
    sun,
  );

  assert.equal(neutralAirSlash.attackerAbilityApplied, false);
  assert.equal(sunAirSlash.attackerAbilityApplied, true);
  assert.ok(sunAirSlash.presets[0].minPercent > neutralAirSlash.presets[0].minPercent * 1.4);
  assert.equal(sunWingAttack.attackerAbilityApplied, false);
});

test("Cloud Nine automatically suppresses selected weather from either side", () => {
  const sun: BattleEnvironment = { ...environment, weather: "Sun" };
  const cloudNineAttacker = calcMyAttack(
    myConfig("Altaria", "Cloud Nine", "Flamethrower", false),
    opponentConfig(),
    sun,
  );
  const cloudNineAttackerWithoutWeather = calcMyAttack(
    myConfig("Altaria", "Cloud Nine", "Flamethrower", false),
    opponentConfig(),
    environment,
  );
  const cloudNineDefender: OpponentConfig = {
    species: "Altaria",
    ability: "Cloud Nine",
    abilityTriggerActive: false,
    item: "",
    move: "",
    stages: createNeutralStatStages(),
  };
  const defenderInSun = calcMyAttack(
    myConfig("Arcanine", "Intimidate", "Flamethrower", false),
    cloudNineDefender,
    sun,
  );
  const defenderWithoutWeather = calcMyAttack(
    myConfig("Arcanine", "Intimidate", "Flamethrower", false),
    cloudNineDefender,
    environment,
  );

  assert.equal(cloudNineAttacker.attackerAbilityApplied, true);
  assert.equal(cloudNineAttackerWithoutWeather.attackerAbilityApplied, false);
  assert.equal(
    cloudNineAttacker.presets[0].minPercent,
    cloudNineAttackerWithoutWeather.presets[0].minPercent,
  );
  assert.equal(defenderInSun.defenderAbilityApplied, true);
  assert.equal(defenderWithoutWeather.defenderAbilityApplied, false);
  assert.equal(
    defenderInSun.presets[0].minPercent,
    defenderWithoutWeather.presets[0].minPercent,
  );
});

test("Mega Sol prevents adverse weather from weakening solar moves", () => {
  for (const move of ["Solar Beam", "Solar Blade"]) {
    const neutral = calcMyAttack(
      myConfig("Meganium-Mega", "Mega Sol", move, false),
      opponentConfig(),
      environment,
    );
    for (const weather of ["Rain", "Sand", "Snow"] as const) {
      const adverseWeather = calcMyAttack(
        myConfig("Meganium-Mega", "Mega Sol", move, false),
        opponentConfig(),
        { ...environment, weather },
      );

      assert.equal(adverseWeather.attackerAbilityApplied, true, `${move} in ${weather}`);
      assert.equal(
        adverseWeather.presets[0].minPercent,
        neutral.presets[0].minPercent,
        `${move} in ${weather}`,
      );
      assert.equal(
        adverseWeather.presets[0].maxPercent,
        neutral.presets[0].maxPercent,
        `${move} in ${weather}`,
      );
    }
  }
});

test("Mega Starmie uses its Champions Attack stat before Huge Power", () => {
  const result = calcMyAttack(
    myConfig("Starmie-Mega", "Huge Power", "Liquidation", false),
    opponentConfig(),
    environment,
  );

  assert.ok(result.presets[0].minPercent > 57 && result.presets[0].minPercent < 58);
  assert.ok(result.presets[0].maxPercent > 68 && result.presets[0].maxPercent < 69);
});
