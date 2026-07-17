// 公式絵ID対応表の生成スクリプト
//
// PokeAPIの公式絵(official-artwork)はフォーム専用のpokemon ID
// （例: メガガブリアス = 10058）でホストされており、全国図鑑Noからは
// 導出できない。そこでPokeAPIリポジトリの静的CSVから
// { Showdown英語名 → PokeAPI pokemon ID } のマッピングを生成する。
//
// 実行: node scripts/build-artwork-ids.mjs
// 出力: src/data/artwork-ids.json
//
// スラッグ候補: Showdown名をPokeAPI表記へ変換したものに加え、
// 性別略記を展開したもの（Meowstic-F-Mega → meowstic-female-mega）。
//
// 解決手順（候補ごとに上から順に試す）:
// 1. スラッグが pokemon.csv の identifier と完全一致
// 2. スラッグを前方一致で拡張する identifier が一意に存在（例:
//    oinkologne-f → oinkologne-female）
// 3. スラッグ末尾のセグメントを削りながら pokemon_species.csv の
//    identifier に一致したら、その種のデフォルトフォームID（例:
//    toxtricity → toxtricity-amped の849）
// 4. メガシンカのみ: PokeAPI未収録のフォームは -Mega を除いた
//    ベース名で再解決し、ベース種の絵で代用する。
//    代用したフォームはコンソールに明示的に列挙する。
// 未解決の種はJSONに含めず、コンソールに明示的に列挙する。

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Generations } from "@smogon/calc";

const BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../src/data/artwork-ids.json");

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

/** Showdown英語名 → PokeAPI identifier形式のスラッグ */
function toSlug(showdownName) {
  return showdownName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // é → e
    .toLowerCase()
    .replace(/[’'.:%]/g, "")
    .replace(/ /g, "-");
}

/** スラッグ候補（元の表記 + 性別略記を展開した表記）を優先順で返す */
function slugCandidates(showdownName) {
  const slug = toSlug(showdownName);
  const expanded = slug.replace(/-f(?=-|$)/, "-female").replace(/-m(?=-|$)/, "-male");
  return expanded === slug ? [slug] : [slug, expanded];
}

const [pokemonRows, speciesRows] = await Promise.all([
  fetchCsv("pokemon.csv"),
  fetchCsv("pokemon_species.csv"),
]);

// pokemon.csv: id, identifier, species_id, height, weight, base_exp, order, is_default
const pokemonIdByIdentifier = new Map();
const defaultPokemonBySpeciesId = new Map();
for (const [id, identifier, speciesId, , , , , isDefault] of pokemonRows) {
  pokemonIdByIdentifier.set(identifier, Number(id));
  if (isDefault === "1") defaultPokemonBySpeciesId.set(speciesId, Number(id));
}

// pokemon_species.csv: id, identifier, ...
const speciesIdByIdentifier = new Map();
for (const [id, identifier] of speciesRows) {
  speciesIdByIdentifier.set(identifier, id);
}

/** スラッグをPokeAPI pokemon IDへ解決する。未解決はnull */
function resolve(slug) {
  const exact = pokemonIdByIdentifier.get(slug);
  if (exact !== undefined) return exact;

  const prefixMatches = [];
  for (const [identifier, id] of pokemonIdByIdentifier) {
    if (identifier.startsWith(slug)) prefixMatches.push(id);
  }
  if (prefixMatches.length === 1) return prefixMatches[0];

  let base = slug;
  while (base) {
    const speciesId = speciesIdByIdentifier.get(base);
    if (speciesId !== undefined) {
      const defaultId = defaultPokemonBySpeciesId.get(speciesId);
      if (defaultId !== undefined) return defaultId;
    }
    const lastHyphen = base.lastIndexOf("-");
    if (lastHyphen < 0) break;
    base = base.slice(0, lastHyphen);
  }
  return null;
}

const MEGA_SUFFIX = /-Mega(-X|-Y)?$/;

const gen = Generations.get(9);
const out = {};
const unresolved = [];
const megaBaseFallbacks = [];

for (const s of gen.species) {
  const megaMatch = s.name.match(MEGA_SUFFIX);

  if (megaMatch) {
    // メガシンカはフォーム専用IDへの完全一致のみを正解とする。
    // 未収録ならベース名で再解決してベース種の絵で代用する。
    const exact = slugCandidates(s.name)
      .map((slug) => pokemonIdByIdentifier.get(slug))
      .find((id) => id !== undefined);
    if (exact !== undefined) {
      out[s.name] = exact;
      continue;
    }
    const baseName = s.name.slice(0, -megaMatch[0].length);
    const baseId = slugCandidates(baseName)
      .map((slug) => resolve(slug))
      .find((id) => id !== null);
    if (baseId === undefined) {
      unresolved.push(s.name);
      continue;
    }
    out[s.name] = baseId;
    megaBaseFallbacks.push(`${s.name} → ${baseId}`);
    continue;
  }

  const id = slugCandidates(s.name)
    .map((slug) => resolve(slug))
    .find((resolved) => resolved !== null);
  if (id === undefined) {
    unresolved.push(s.name);
    continue;
  }
  out[s.name] = id;
}

// スラッグ変換の退行検知: 代表ケースが既知のフォームIDへ解決できること
const CANONICAL_CASES = [
  ["Garchomp-Mega", 10058],
  ["Charizard-Mega-X", 10034],
  ["Rotom-Wash", 10009],
  ["Zygarde-10%", 10181],
];
for (const [name, expected] of CANONICAL_CASES) {
  if (out[name] !== expected) {
    throw new Error(`解決ロジックの退行: ${name} は ${expected} のはずが ${out[name]}`);
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`解決: ${Object.keys(out).length} / 未解決: ${unresolved.length}`);
if (unresolved.length > 0) console.log(`未解決（絵はプレースホルダー表示）:\n  ${unresolved.join("\n  ")}`);
if (megaBaseFallbacks.length > 0) {
  console.log(`PokeAPI未収録のためベース種の絵で代用するメガ: ${megaBaseFallbacks.length}件\n  ${megaBaseFallbacks.join("\n  ")}`);
}
console.log(`出力: ${OUT}`);
