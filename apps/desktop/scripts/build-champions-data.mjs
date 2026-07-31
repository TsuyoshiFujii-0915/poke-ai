// チャンピオンズ差分データの生成スクリプト
//
// Pokémon Showdown本体が公式に維持しているchampionsモッド
// （data/mods/champions/）を取得し、アプリが実行時に使うJSONを生成する。
// Showdownモッドはゲーム内データに追従して更新されるため、
// wiki等からの手動転記より信頼できる（実績: 手動調査で威力変更4件が漏れた）。
//
// 実行: node scripts/build-champions-data.mjs
// 出力:
//   src/data/champions-species.json    使用可能ポケモン（Showdown英語名の配列）
//   src/data/champions-base-stats.json Species name → Champions base stats
//   src/data/champions-items.json      使用可能な持ち物（英語名の配列）
//   src/data/champions-abilities.json  Species name → selectable ability names
//   src/data/champions-moves.json      存在する技（英語名の配列）
//   src/data/champions-learnsets.json  種ID → 習得技英語名の配列
//   src/data/champions-move-patch.json ダメージ計算に影響する技のオーバーライド
//   src/data/champions-source.json     Pinned upstream repository and file paths
//
// モッドのTypeScriptはesbuildでJSへ変換してから評価する。
// @smogon/calc が知らない種・技は計算不能なため出力から除外し、
// コンソールへ明示的に列挙する（暗黙のフォールバックはしない）。

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { Generations } from "@smogon/calc";
import { Dex } from "@pkmn/dex";

const SHOWDOWN_REPOSITORY = "https://github.com/smogon/pokemon-showdown";
const SHOWDOWN_COMMIT = "247863645fc1831ceab8366e32b81c7299df95e1";
const RAW_BASE = `https://raw.githubusercontent.com/smogon/pokemon-showdown/${SHOWDOWN_COMMIT}`;
const SOURCE_PATHS = [
  "data/pokedex.ts",
  "data/mods/champions/formats-data.ts",
  "data/mods/champions/items.ts",
  "data/mods/champions/learnsets.ts",
  "data/mods/champions/moves.ts",
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "../src/data");

const gen = Generations.get(9);
const dex = Dex.forGen(9);

const toID = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Fetches and evaluates one exported Showdown data table.
 *
 * @param {string} path Repository-relative source path.
 * @param {string} exportName Exported table name.
 * @returns {Promise<Record<string, Record<string, unknown>>>} Evaluated table.
 */
async function fetchTable(path, exportName) {
  const res = await fetch(`${RAW_BASE}/${path}`);
  if (!res.ok) throw new Error(`${path}@${SHOWDOWN_COMMIT}: HTTP ${res.status}`);
  const js = transformSync(await res.text(), { loader: "ts", format: "cjs" }).code;
  const mod = { exports: {} };
  new Function("module", "exports", js)(mod, mod.exports);
  const table = mod.exports[exportName];
  if (!table) throw new Error(`${path}@${SHOWDOWN_COMMIT}: missing export ${exportName}`);
  return table;
}

const [pokedexTable, formatsData, itemsTable, learnsetsTable, movesTable] = await Promise.all([
  fetchTable("data/pokedex.ts", "Pokedex"),
  fetchTable("data/mods/champions/formats-data.ts", "FormatsData"),
  fetchTable("data/mods/champions/items.ts", "Items"),
  fetchTable("data/mods/champions/learnsets.ts", "Learnsets"),
  fetchTable("data/mods/champions/moves.ts", "Moves"),
]);

const skipped = [];

// Showdown ID → @smogon/calc ID の表記ゆれ吸収
// aegislash: calcはフォーム名必須（Aegislash-Shieldが通常時の姿）
const SPECIES_ALIASES = { aegislash: "aegislashshield" };
const POKEDEX_ALIASES = { aegislashshield: "aegislash" };

// --- 使用可能ポケモン ---
// formats-data.ts はgen9全種を列挙し、不参加種に isNonstandard: "Past"、
// 実装予告のみの種（ミアレのマギアナのメガ等）に "Future" を付ける
const species = [];
for (const [id, data] of Object.entries(formatsData)) {
  if (data.isNonstandard != null || data.tier === "Illegal") continue;
  const calcSpecies = gen.species.get(SPECIES_ALIASES[id] ?? id);
  if (!calcSpecies) {
    skipped.push(`species ${id}（@smogon/calc未収録）`);
    continue;
  }
  species.push(calcSpecies.name);
}
species.sort();

// Generate both fields from the same pinned Pokédex revision. The calculation
// package can lag behind Showdown species corrections.
const baseStats = {};
const abilities = {};
for (const speciesName of species) {
  const speciesId = toID(speciesName);
  const pokedexId = POKEDEX_ALIASES[speciesId] ?? speciesId;
  const speciesData = pokedexTable[pokedexId];
  if (!speciesData) {
    throw new Error(`pinned Pokédex species not found: ${speciesName} (${pokedexId})`);
  }
  const stats = speciesData.baseStats;
  if (!stats || ["hp", "atk", "def", "spa", "spd", "spe"].some((key) => !Number.isInteger(stats[key]))) {
    throw new Error(`invalid pinned Pokédex base stats: ${speciesName} (${pokedexId})`);
  }
  baseStats[speciesName] = {
    hp: stats.hp,
    atk: stats.atk,
    def: stats.def,
    spa: stats.spa,
    spd: stats.spd,
    spe: stats.spe,
  };
  if (!speciesData.abilities) {
    throw new Error(`pinned Pokédex abilities not found: ${speciesName} (${pokedexId})`);
  }
  const names = [...new Set(Object.values(speciesData.abilities).filter(Boolean))];
  if (names.length === 0) {
    throw new Error(`no selectable abilities: ${speciesName}`);
  }
  abilities[speciesName] = names;
}

// --- 技（存在する技の全リスト）---
// ベースのgen9標準技から、モッドで isNonstandard: "Past" の技を除き、
// モッドで再有効化（isNonstandard: null）された技を加える
const legalMoveIds = new Set();
for (const move of dex.moves.all()) {
  if (move.isNonstandard == null && move.exists) legalMoveIds.add(move.id);
}
for (const [id, data] of Object.entries(movesTable)) {
  if (!("isNonstandard" in data)) continue; // ベースの扱いを継承
  if (data.isNonstandard == null) legalMoveIds.add(id); // 再有効化
  else legalMoveIds.delete(id); // "Past"（廃止）/ "Future"（未実装）
}
const moves = [];
for (const id of legalMoveIds) {
  const calcMove = gen.moves.get(id);
  if (!calcMove) {
    skipped.push(`move ${id}（@smogon/calc未収録）`);
    continue;
  }
  if (calcMove.name === "(No Move)") continue;
  moves.push(calcMove.name);
}
moves.sort();
const legalMoveNames = new Set(moves);

// --- 習得技 ---
const learnsets = {};
for (const [id, data] of Object.entries(learnsetsTable)) {
  if (!data.learnset) continue;
  const names = [];
  for (const moveId of Object.keys(data.learnset)) {
    const calcMove = gen.moves.get(moveId);
    if (!calcMove) {
      skipped.push(`learnset ${id}/${moveId}（@smogon/calc未収録）`);
      continue;
    }
    if (!legalMoveNames.has(calcMove.name)) {
      skipped.push(`learnset ${id}/${moveId}（チャンピオンズ廃止技）`);
      continue;
    }
    names.push(calcMove.name);
  }
  names.sort();
  learnsets[id] = names;
}

// アプリはメガ等のフォームを「完全一致 → 最初のハイフン前のベース種」の
// 順で引く（dex.ts getLearnset）。その規則で解決できない種は明示エイリアス
// で補う。フロエッテのメガの習得元はフロエッテ(えいえん)。
const LEARNSET_ALIASES = { floettemega: "floetteeternal" };
for (const [alias, source] of Object.entries(LEARNSET_ALIASES)) {
  if (!learnsets[source]) throw new Error(`learnsetエイリアス元が見つからない: ${source}`);
  learnsets[alias] = learnsets[source];
}

// ビルド時保証: 全使用可能種が習得技を解決できること
const unresolvedLearnsets = species.filter((name) => {
  const candidates = [toID(name)];
  const hyphen = name.indexOf("-");
  if (hyphen > 0) candidates.push(toID(name.slice(0, hyphen)));
  return !candidates.some((id) => learnsets[id]);
});
if (unresolvedLearnsets.length > 0) {
  throw new Error(`習得技を解決できない使用可能種: ${unresolvedLearnsets.join(", ")}`);
}

// --- 持ち物 ---
// ベースのgen9標準アイテムから、モッドで Past の物を除き、
// モッドで再有効化された物（メガストーン等）を加える。
// モッド新規定義（ベースに無いZA新メガストーン等）もそのまま加える
const itemNameById = new Map();
for (const item of dex.items.all()) {
  if (item.isNonstandard == null && item.exists) itemNameById.set(item.id, item.name);
}
for (const [id, data] of Object.entries(itemsTable)) {
  if ("isNonstandard" in data && data.isNonstandard != null) {
    itemNameById.delete(id); // "Past"（廃止）/ "Future"（未実装）
    continue;
  }
  const baseItem = dex.items.get(id);
  const name = baseItem?.exists ? baseItem.name : data.name;
  if (!name) {
    skipped.push(`item ${id}（名前不明）`);
    continue;
  }
  itemNameById.set(id, name);
}
const items = [...itemNameById.values()].sort();

// --- 技オーバーライド（ダメージ計算に影響する差分のみ）---
// @smogon/calc の Move overrides はdeep mergeのため、フラグの削除は
// 明示的に 0 を書いて打ち消す
const DAMAGE_FLAG_KEYS = ["slicing", "punch", "bite", "sound", "pulse", "contact"];
const movePatch = {};
for (const [id, data] of Object.entries(movesTable)) {
  if (data.isNonstandard === "Past") continue;
  const base = gen.moves.get(id);
  if (!base) continue;
  if (base.category === "Status") continue;
  const override = {};
  if (data.basePower !== undefined && data.basePower !== base.basePower) {
    override.basePower = data.basePower;
  }
  if (data.type !== undefined && data.type !== base.type) {
    override.type = data.type;
  }
  if (data.flags !== undefined) {
    // モッドのflagsは完全な置き換え。ダメージに影響するフラグの増減だけ拾う
    const baseFlags = base.flags ?? {};
    const flagDiff = {};
    for (const flag of DAMAGE_FLAG_KEYS) {
      const before = baseFlags[flag] ? 1 : 0;
      const after = data.flags[flag] ? 1 : 0;
      if (before !== after) flagDiff[flag] = after;
    }
    if (Object.keys(flagDiff).length > 0) override.flags = flagDiff;
  }
  for (const key of ["multihit", "drain", "recoil", "willCrit"]) {
    if (data[key] !== undefined && JSON.stringify(data[key]) !== JSON.stringify(base[key])) {
      override[key] = data[key];
    }
  }
  if (Object.keys(override).length > 0) movePatch[base.name] = override;
}

// 生成ロジックの退行検知: 既知の代表ケース
const CANONICAL = [
  ["First Impression", "basePower", 100],
  ["Bolt Beak", "basePower", 80],
  ["Snap Trap", "type", "Steel"],
];
for (const [name, key, expected] of CANONICAL) {
  if (movePatch[name]?.[key] !== expected) {
    throw new Error(`技パッチ生成の退行: ${name}.${key} は ${expected} のはずが ${JSON.stringify(movePatch[name])}`);
  }
}
if (!(movePatch["Dragon Claw"]?.flags?.slicing === 1)) {
  throw new Error(`技パッチ生成の退行: Dragon Claw に slicing:1 が付いていない`);
}

mkdirSync(OUT_DIR, { recursive: true });
const write = (file, data) => writeFileSync(join(OUT_DIR, file), JSON.stringify(data));
write("champions-species.json", species);
write("champions-base-stats.json", baseStats);
write("champions-items.json", items);
write("champions-abilities.json", abilities);
write("champions-moves.json", moves);
write("champions-learnsets.json", learnsets);
const sortedPatch = Object.fromEntries(
  Object.keys(movePatch).sort().map((name) => [name, movePatch[name]]),
);
writeFileSync(join(OUT_DIR, "champions-move-patch.json"), JSON.stringify(sortedPatch, null, 2) + "\n");
writeFileSync(join(OUT_DIR, "champions-source.json"), JSON.stringify({
  repository: SHOWDOWN_REPOSITORY,
  commit: SHOWDOWN_COMMIT,
  paths: SOURCE_PATHS,
}, null, 2) + "\n");

console.log(`使用可能ポケモン: ${species.length}種 / 持ち物: ${items.length}個 / 技: ${moves.length}種`);
console.log(`習得技テーブル: ${Object.keys(learnsets).length}種分 / 技オーバーライド: ${Object.keys(movePatch).length}技`);
if (skipped.length > 0) {
  const unique = [...new Set(skipped)];
  console.log(`除外 ${unique.length}件:\n  ${unique.join("\n  ")}`);
}
console.log(`出力: ${OUT_DIR}/champions-*.json`);
