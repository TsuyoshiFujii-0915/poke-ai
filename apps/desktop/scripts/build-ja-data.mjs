// 日本語名マッピングJSONの生成スクリプト
//
// PokeAPIリポジトリの静的CSV（GitHub raw）から日本語名を取得し、
// @smogon/calc (Gen 9) のポケモン・技・持ち物それぞれについて
// { 英語名(Showdown表記) → 日本語名 } のマッピングを生成する。
//
// 実行: node scripts/build-ja-data.mjs
// 出力: src/data/ja-names.json
//
// メガシンカ等のフォーム名はCSVの種名に存在しないため、
// 接尾辞ルール（-Mega → メガ○○ 等）で合成する。合成できないものは
// 日本語名なし（英語検索のみ）として出力する。

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Generations } from "@smogon/calc";

const BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const JA = "11"; // 日本語(漢字かな交じり)
const EN = "9";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../src/data/ja-names.json");

/** 引用符対応の簡易CSVパーサー（PokeAPIのCSVは単純な構造） */
function parseCsv(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuote = false;
        else cur += ch;
      } else if (ch === '"') inQuote = true;
      else if (ch === ",") { cols.push(cur); cur = ""; }
      else cur += ch;
    }
    cols.push(cur);
    rows.push(cols);
  }
  return rows.slice(1); // ヘッダー除去
}

async function fetchCsv(name) {
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

/** id→{en, ja} のマップを作る（names系CSVは [id, lang, name, ...] 形式） */
function buildNameTable(rows) {
  const table = new Map();
  for (const [id, lang, name] of rows) {
    if (lang !== JA && lang !== EN) continue;
    const entry = table.get(id) ?? {};
    entry[lang === JA ? "ja" : "en"] = name;
    table.set(id, entry);
  }
  // en → ja の逆引き
  const enToJa = new Map();
  for (const { en, ja } of table.values()) {
    if (en && ja) enToJa.set(canonicalEnglishName(en), ja);
  }
  return enToJa;
}

/**
 * Normalizes punctuation differences between PokeAPI and Showdown names.
 *
 * @param {string} name English display name.
 * @returns {string} Canonical Showdown-compatible name.
 */
function canonicalEnglishName(name) {
  return name.replaceAll("’", "'");
}

// フォーム接尾辞 → 日本語表現（プレフィックス or サフィックス）
const FORM_RULES = [
  { suffix: "-Mega-X", ja: (base) => `メガ${base}X` },
  { suffix: "-Mega-Y", ja: (base) => `メガ${base}Y` },
  { suffix: "-Mega", ja: (base) => `メガ${base}` },
  { suffix: "-Alola", ja: (base) => `アローラ${base}` },
  { suffix: "-Galar", ja: (base) => `ガラル${base}` },
  { suffix: "-Hisui", ja: (base) => `ヒスイ${base}` },
  { suffix: "-Paldea", ja: (base) => `パルデア${base}` },
  { suffix: "-Therian", ja: (base) => `${base}(れいじゅう)` },
  { suffix: "-Incarnate", ja: (base) => `${base}(けしん)` },
  { suffix: "-Origin", ja: (base) => `${base}(オリジン)` },
];

function speciesJa(enName, enToJa) {
  const exact = enToJa.get(enName);
  if (exact) return exact;
  for (const rule of FORM_RULES) {
    if (enName.endsWith(rule.suffix)) {
      const base = enToJa.get(enName.slice(0, -rule.suffix.length));
      if (base) return rule.ja(base);
    }
  }
  // その他のフォーム: ベース種名が引ければ「日本語名(フォーム)」とする
  const hyphen = enName.indexOf("-");
  if (hyphen > 0) {
    const base = enToJa.get(enName.slice(0, hyphen));
    if (base) return `${base}(${enName.slice(hyphen + 1)})`;
  }
  return null;
}

const [speciesRows, moveRows, itemRows, abilityRows] = await Promise.all([
  fetchCsv("pokemon_species_names.csv"),
  fetchCsv("move_names.csv"),
  fetchCsv("item_names.csv"),
  fetchCsv("ability_names.csv"),
]);

const speciesTable = buildNameTable(speciesRows);
const moveTable = buildNameTable(moveRows);
const itemTable = buildNameTable(itemRows);
const abilityTable = buildNameTable(abilityRows);

// PokeAPI does not yet contain the Champions ability names. Keep the official
// Japanese in-game names explicit until the upstream CSV starts publishing them.
const CHAMPIONS_ABILITY_NAMES = {
  Dragonize: "ドラゴンスキン",
  Eelevate: "うなぎのぼり",
  Firemane: "ほのおのたてがみ",
  "Fire Mane": "ほのおのたてがみ",
  "Mega Sol": "メガソーラー",
  "Piercing Drill": "かんつうドリル",
  "Spicy Spray": "とびだすハバネロ",
};

// PokeAPI exposes identifiers for these items but does not publish localized
// item_names rows yet. These are their Japanese in-game names.
const CHAMPIONS_ITEM_NAMES = {
  Barbaracite: "ガメノデスナイト",
  Chandelurite: "シャンデラナイト",
  Chesnaughtite: "ブリガロナイト",
  Chimechite: "チリーンナイト",
  Clefablite: "ピクシナイト",
  Crabominite: "ケケンカニナイト",
  Delphoxite: "マフォクシナイト",
  Dragalgite: "ドラミドナイト",
  Dragoninite: "カイリュナイト",
  Drampanite: "ジジーロナイト",
  Eelektrossite: "シビルドナイト",
  Emboarite: "エンブオナイト",
  Excadrite: "ドリュウズナイト",
  Falinksite: "タイレーツナイト",
  Feraligite: "オーダイルナイト",
  Floettite: "フラエッテナイト",
  Froslassite: "ユキメノコナイト",
  Glimmoranite: "キラフロルナイト",
  Golurkite: "ゴルーグナイト",
  Greninjite: "ゲッコウガナイト",
  Hawluchanite: "ルチャブルナイト",
  Malamarite: "カラマネナイト",
  Meganiumite: "メガニウムナイト",
  Meowsticite: "ニャオニクスナイト",
  Pyroarite: "カエンジシナイト",
  "Raichunite X": "ライチュウナイトX",
  "Raichunite Y": "ライチュウナイトY",
  Scolipite: "ペンドラナイト",
  Scovillainite: "スコヴィラナイト",
  Scraftinite: "ズルズキナイト",
  Skarmorite: "エアームドナイト",
  Staraptite: "ムクホークナイト",
  Starminite: "スターミナイト",
  Victreebelite: "ウツボットナイト",
};

const gen = Generations.get(9);
const out = { species: {}, moves: {}, items: {}, abilities: {} };
const stats = { species: [0, 0], moves: [0, 0], items: [0, 0], abilities: [0, 0] };

for (const s of gen.species) {
  const ja = speciesJa(s.name, speciesTable);
  stats.species[ja ? 0 : 1]++;
  if (ja) out.species[s.name] = ja;
}
for (const m of gen.moves) {
  if (m.name === "(No Move)") continue;
  const ja = moveTable.get(m.name);
  stats.moves[ja ? 0 : 1]++;
  if (ja) out.moves[m.name] = ja;
}
for (const i of gen.items) {
  const ja = itemTable.get(i.name);
  stats.items[ja ? 0 : 1]++;
  if (ja) out.items[i.name] = ja;
}
for (const a of gen.abilities) {
  const ja = abilityTable.get(a.name);
  stats.abilities[ja ? 0 : 1]++;
  if (ja) out.abilities[a.name] = ja;
}
Object.assign(out.abilities, CHAMPIONS_ABILITY_NAMES);
Object.assign(out.items, CHAMPIONS_ITEM_NAMES);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`species: ja付与 ${stats.species[0]} / 未付与 ${stats.species[1]}`);
console.log(`moves:   ja付与 ${stats.moves[0]} / 未付与 ${stats.moves[1]}`);
console.log(`items:   ja付与 ${stats.items[0]} / 未付与 ${stats.items[1]}`);
console.log(`abilities: ja付与 ${stats.abilities[0]} / 未付与 ${stats.abilities[1]}`);
console.log(`出力: ${OUT}`);
