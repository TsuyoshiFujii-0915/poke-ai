// 双方向・3プリセット同時ダメージ計算サービス（ポケモンチャンピオンズ仕様）
//
// チャンピオンズの育成仕様（2026-07調査・検証済み）:
// - 能力ポイント: 1ステータス最大+32、合計66。1ポイント = 実数値+1
// - 個体値: 全員31固定 / レベル: 全員Lv50相当
// - 性格補正: 1.1倍/0.9倍（VPで自由変更可能）
//
// 実装方式（ChampionsAdapter）:
// Lv50では種族値+1 = 実数値+1（性格補正前）となるため、
// @smogon/calc の overrides.baseStats に能力ポイントをそのまま加算することで
// チャンピオンズの実数値を正確に再現する（検証: ゲンガーHP135→+32pt→167 一致）。
//
// プリセット:
// - 自分→相手（相手の耐久想定）: 無振り / H+32 / H+32・耐久+32
// - 相手→自分（相手の火力想定）: 無振り / +32 / +32+性格1.1倍

import { calculate, Field, Move, Pokemon, type State } from "@smogon/calc";
import { resolveAbilityForDamage, type DamageRole } from "./ability-calculation";
import { validateAbilitySelection } from "./ability-selection";
import {
  stageKeysForDamageCategory,
  type DamageStageKeys,
} from "./damage-stage";
import { gen, getAbilityNames, toID } from "./dex";
import { toJapaneseKoText } from "./ko-text";
import { validateStatStages, type StatStages } from "./stat-stage";
import movePatch from "../data/champions-move-patch.json";

/**
 * チャンピオンズで本編（SV/gen9データ）から仕様変更された技のオーバーライド。
 * ダメージ計算に影響する変更のみを収録する: 威力・タイプ・切断技分類。
 * 出典: Showdown championsモッド data/mods/champions/moves.ts と
 * Bulbapedia "Pokémon Champions"（2026-07-16 調査、両者で相互確認）。
 * 検証: scripts/champions-verify.mjs セクション3。
 */
const CHAMPIONS_MOVE_OVERRIDES = movePatch as Record<string, State.Move["overrides"]>;

/** チャンピオンズ差分パッチを適用したMoveを作る */
function championsMove(moveEn: string, attackerAbility: string): Move {
  const move = new Move(gen, moveEn, { overrides: CHAMPIONS_MOVE_OVERRIDES[moveEn] });
  if (attackerAbility !== "Dragonize") return move;

  const cannotChangeType = new Set([
    "Judgment",
    "Multi-Attack",
    "Natural Gift",
    "Revelation Dance",
    "Techno Blast",
    "Terrain Pulse",
    "Weather Ball",
    "Struggle",
  ]);
  if (!move.hasType("Normal") || cannotChangeType.has(move.originalName)) return move;
  if (move.named("Flail")) {
    throw new Error("unsupported Champions damage ability: Dragonize with Flail");
  }

  move.type = "Dragon";
  move.bp = Math.floor((move.bp * 4915) / 4096 + 0.5);
  return move;
}

export const LEVEL = 50;

/** チャンピオンズの能力ポイント（各0〜32、合計66まで） */
export interface ChampionPoints {
  hp?: number;
  atk?: number;
  def?: number;
  spa?: number;
  spd?: number;
  spe?: number;
}

/** 性格補正の対象になれるステータス（HPは性格補正対象外） */
export type NatureStatKey = "atk" | "def" | "spa" | "spd" | "spe";

/** 性格補正の指定。plus=1.1倍、minus=0.9倍（未指定は補正なし） */
export interface NatureMods {
  plus?: NatureStatKey;
  minus?: NatureStatKey;
}

/** 自分側の設定（実際の育成が分かっている側） */
export interface MySideConfig {
  species: string;
  ability: string;
  item?: string;
  move?: string;
  points: ChampionPoints;
  stages: StatStages;
  /** 性格補正で1.1倍にするステータス（未指定 = 上昇補正なし） */
  plusStat?: NatureStatKey;
  /** 性格補正で0.9倍にするステータス（未指定 = 下降補正なし） */
  minusStat?: NatureStatKey;
}

/** 相手側の設定（型が不明な側） */
export interface OpponentConfig {
  species: string;
  ability: string;
  item?: string;
  move?: string;
  stages: StatStages;
}

export interface PresetResult {
  label: string;
  minPercent: number;
  maxPercent: number;
  koText: string;
}

export interface DirectionResult {
  moveEn: string;
  presets: PresetResult[];
  error?: string;
}

/**
 * ChampionsAdapter: 能力ポイントと性格補正を反映したPokemonを作る。
 *
 * Lv50・IV31・EV0では「実数値 = 種族値 + ポイント + 20（HP以外、補正前）」
 * が成り立つ（検証: scripts/champions-verify.mjs）。性格は常にHardyとし、
 * 性格補正(1.1/0.9)は補正後の実数値から逆算した種族値を overrides に
 * 渡すことで表現する。実在の性格を割り当てる方式と違い、指定していない
 * ステータスへ副作用（例: 補正↑だけ欲しいのに何かが0.9倍になる）が出ない。
 */
export function championsPokemon(
  species: string,
  opts: {
    points?: ChampionPoints;
    mods?: NatureMods;
    item?: string;
    ability: string;
    stages: StatStages;
  },
): Pokemon {
  const data = gen.species.get(toID(species) as never);
  if (!data) throw new Error(`unknown species: ${species}`);
  const p = opts.points ?? {};
  const mods = opts.mods ?? {};
  validateAbilitySelection(species, opts.ability, getAbilityNames(species));
  validateStatStages(opts.stages);
  const withMod = (key: NatureStatKey): number => {
    const base = data.baseStats[key] + (p[key] ?? 0);
    const mod = mods.plus === key ? 1.1 : mods.minus === key ? 0.9 : 1.0;
    if (mod === 1.0) return base;
    // 実数値 base+20 に補正を掛けた値になるよう種族値を逆算する
    return Math.floor((base + 20) * mod) - 20;
  };
  return new Pokemon(gen, species, {
    level: LEVEL,
    ability: opts.ability as State.Pokemon["ability"],
    item: opts.item || undefined,
    nature: "Hardy",
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    evs: {},
    boosts: opts.stages,
    overrides: {
      baseStats: {
        hp: data.baseStats.hp + (p.hp ?? 0),
        atk: withMod("atk"),
        def: withMod("def"),
        spa: withMod("spa"),
        spd: withMod("spd"),
        spe: withMod("spe"),
      },
    },
  });
}

/** Speed benchmarks for Pokémon Champions at level 50 with a perfect IV. */
export interface SpeedTiers {
  /** Zero points with a neutral nature. */
  noInvest: number;
  /** 32 points with a neutral nature. */
  semi: number;
  /** 32 points with a Speed-boosting nature. */
  max: number;
}

export function speedTiers(baseSpeed: number): SpeedTiers {
  // At level 50 with a perfect IV, the final stat is base Speed + points + 20.
  const noInvest = baseSpeed + 20;
  const semi = baseSpeed + 32 + 20;
  return { noInvest, semi, max: Math.floor(semi * 1.1) };
}

function moveCategory(moveEn: string): "Physical" | "Special" | "Status" {
  const data = gen.moves.get(toID(moveEn) as never);
  return (data?.category ?? "Status") as "Physical" | "Special" | "Status";
}

export function damageStageKeysForMove(moveEn: string): DamageStageKeys | null {
  if (!moveEn) return null;
  return stageKeysForDamageCategory(moveCategory(moveEn));
}

function applyDamageAbility(pokemon: Pokemon, role: DamageRole): Pokemon {
  if (!pokemon.ability) throw new Error(`${role} ability is not selected`);
  const resolved = resolveAbilityForDamage(pokemon.ability, role);
  const prepared = pokemon.clone();
  prepared.ability = resolved.ability as State.Pokemon["ability"];
  prepared.abilityOn = resolved.abilityOn;
  return prepared;
}

function prepareAttackerAbility(pokemon: Pokemon): Pokemon {
  if (pokemon.ability !== "Dragonize" && pokemon.ability !== "Mega Sol") {
    return applyDamageAbility(pokemon, "attacker");
  }
  const prepared = pokemon.clone();
  prepared.ability = undefined;
  prepared.abilityOn = false;
  return prepared;
}

function championsField(move: Move, attackerAbility: string): Field {
  const megaSolUsesSun = attackerAbility === "Mega Sol" && (
    move.originalName === "Weather Ball" || move.hasType("Fire", "Water")
  );
  return new Field(megaSolUsesSun ? { weather: "Sun" } : {});
}

function runOne(attacker: Pokemon, defender: Pokemon, moveEn: string, label: string): PresetResult {
  if (!attacker.ability) throw new Error("attacker ability is not selected");
  const attackerAbility = attacker.ability;
  const move = championsMove(moveEn, attackerAbility);
  const result = calculate(
    gen,
    prepareAttackerAbility(attacker),
    applyDamageAbility(defender, "defender"),
    move,
    championsField(move, attackerAbility),
  );
  const range = result.range();
  const maxHP = result.defender.maxHP();
  let koText = "-";
  try {
    koText = toJapaneseKoText(result.kochance().text);
  } catch {
    koText = "-";
  }
  return {
    label,
    minPercent: (range[0] / maxHP) * 100,
    maxPercent: (range[1] / maxHP) * 100,
    koText,
  };
}

/** 自分→相手: 相手の耐久3プリセット（能力ポイント想定） */
export function calcMyAttack(me: MySideConfig, opp: OpponentConfig): DirectionResult {
  if (!me.species || !opp.species || !me.move) {
    return { moveEn: me.move ?? "", presets: [], error: "入力待ち" };
  }
  if (!me.ability || !opp.ability) {
    return { moveEn: me.move, presets: [], error: "特性を選択" };
  }
  const category = moveCategory(me.move);
  if (category === "Status") {
    return { moveEn: me.move, presets: [], error: "変化技（ダメージなし）" };
  }
  const defStat = category === "Physical" ? "def" : "spd";
  const defLabel = category === "Physical" ? "B" : "D";

  const presets: Array<[string, ChampionPoints]> = [
    ["無振り", {}],
    ["H+32", { hp: 32 }],
    [`H+32 ${defLabel}+32`, { hp: 32, [defStat]: 32 }],
  ];

  try {
    const attacker = championsPokemon(me.species, {
      points: me.points,
      mods: { plus: me.plusStat, minus: me.minusStat },
      item: me.item,
      ability: me.ability,
      stages: me.stages,
    });
    return {
      moveEn: me.move,
      presets: presets.map(([label, points]) => {
        const defender = championsPokemon(opp.species, {
          points,
          item: opp.item,
          ability: opp.ability,
          stages: opp.stages,
        });
        return runOne(attacker, defender, me.move!, label);
      }),
    };
  } catch (e) {
    return { moveEn: me.move, presets: [], error: String(e) };
  }
}

/** 相手→自分: 相手の火力3プリセット（能力ポイント想定） */
export function calcOpponentAttack(me: MySideConfig, opp: OpponentConfig): DirectionResult {
  if (!me.species || !opp.species || !opp.move) {
    return { moveEn: opp.move ?? "", presets: [], error: "入力待ち" };
  }
  if (!me.ability || !opp.ability) {
    return { moveEn: opp.move, presets: [], error: "特性を選択" };
  }
  const category = moveCategory(opp.move);
  if (category === "Status") {
    return { moveEn: opp.move, presets: [], error: "変化技（ダメージなし）" };
  }
  const atkStat: NatureStatKey = category === "Physical" ? "atk" : "spa";
  const atkLabel = category === "Physical" ? "A" : "C";

  const presets: Array<[string, ChampionPoints, NatureMods]> = [
    ["無振り", {}, {}],
    [`${atkLabel}+32`, { [atkStat]: 32 }, {}],
    [`${atkLabel}+32 補正↑`, { [atkStat]: 32 }, { plus: atkStat }],
  ];

  try {
    const defender = championsPokemon(me.species, {
      points: me.points,
      mods: { plus: me.plusStat, minus: me.minusStat },
      item: me.item,
      ability: me.ability,
      stages: me.stages,
    });
    return {
      moveEn: opp.move,
      presets: presets.map(([label, points, mods]) => {
        const attacker = championsPokemon(opp.species, {
          points,
          mods,
          item: opp.item,
          ability: opp.ability,
          stages: opp.stages,
        });
        return runOne(attacker, defender, opp.move!, label);
      }),
    };
  } catch (e) {
    return { moveEn: opp.move, presets: [], error: String(e) };
  }
}
