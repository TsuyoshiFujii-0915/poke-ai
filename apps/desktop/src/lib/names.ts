// 日本語名マッピングと検索ユーティリティ
import jaNames from "../data/ja-names.json";

export interface NameEntry {
  /** Showdown表記の英語名（@smogon/calcへ渡すID） */
  en: string;
  /** 日本語名（ない場合は英語名で代用） */
  ja: string;
  /** 検索用に正規化済みの文字列群 */
  keys: string[];
}

/** ひらがな→カタカナ変換 + 小文字化（インクリメンタル検索用の正規化） */
export function normalize(input: string): string {
  return input
    .replace(/[\u3041-\u3096]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) + 0x60),
    )
    .toLowerCase()
    .trim();
}

function buildEntries(table: Record<string, string>, enList: string[]): NameEntry[] {
  return enList.map((en) => {
    const ja = table[en] ?? en;
    return { en, ja, keys: [normalize(ja), normalize(en)] };
  });
}

const tables = jaNames as {
  species: Record<string, string>;
  moves: Record<string, string>;
  items: Record<string, string>;
  abilities: Record<string, string>;
};

let speciesEntries: NameEntry[] | null = null;
let moveEntries: NameEntry[] | null = null;
let itemEntries: NameEntry[] | null = null;

export function getSpeciesEntries(allEn: string[]): NameEntry[] {
  speciesEntries ??= buildEntries(tables.species, allEn);
  return speciesEntries;
}

export function getMoveEntries(allEn: string[]): NameEntry[] {
  moveEntries ??= buildEntries(tables.moves, allEn);
  return moveEntries;
}

export function getItemEntries(allEn: string[]): NameEntry[] {
  itemEntries ??= buildEntries(tables.items, allEn);
  return itemEntries;
}

export function getAbilityEntries(allEn: string[]): NameEntry[] {
  return buildEntries(tables.abilities, allEn);
}

export function jaSpecies(en: string): string {
  return tables.species[en] ?? en;
}

export function jaMove(en: string): string {
  return tables.moves[en] ?? en;
}

export function jaItem(en: string): string {
  return tables.items[en] ?? en;
}

export function jaAbility(en: string): string {
  return tables.abilities[en] ?? en;
}

/** 前方一致 > 部分一致 の順で最大limit件返す */
export function searchEntries(
  entries: NameEntry[],
  query: string,
  limit = 12,
): NameEntry[] {
  const q = normalize(query);
  if (!q) return entries.slice(0, limit);
  const starts: NameEntry[] = [];
  const includes: NameEntry[] = [];
  for (const e of entries) {
    if (e.keys.some((k) => k.startsWith(q))) starts.push(e);
    else if (e.keys.some((k) => k.includes(q))) includes.push(e);
    if (starts.length >= limit) break;
  }
  return [...starts, ...includes].slice(0, limit);
}
