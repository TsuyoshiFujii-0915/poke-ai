// @smogon/calc のデータ層とチャンピオンズ生成データをまとめるモジュール
//
// ポケモン・持ち物・技の候補と習得技は、Showdown championsモッドから
// ビルド時に生成したJSON（scripts/build-champions-data.mjs）を使う。
// gen9の素のデータはダメージ計算エンジン（@smogon/calc）にのみ使う。
import { Generations } from "@smogon/calc";
import { getItemEntries, getMoveEntries, getSpeciesEntries, type NameEntry } from "./names";
import artworkIds from "../data/artwork-ids.json";
import championsSpecies from "../data/champions-species.json";
import championsItems from "../data/champions-items.json";
import championsMoves from "../data/champions-moves.json";
import championsLearnsets from "../data/champions-learnsets.json";

export const gen = Generations.get(9);

export function toID(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function speciesEntries(): NameEntry[] {
  return getSpeciesEntries(championsSpecies as string[]);
}

export function moveEntries(): NameEntry[] {
  return getMoveEntries(championsMoves as string[]);
}

export function itemEntries(): NameEntry[] {
  return getItemEntries(championsItems as string[]);
}

/**
 * 公式絵(official-artwork)取得用のPokeAPI pokemon IDを返す。
 * メガシンカ等のフォームはフォーム専用ID（例: メガガブリアス=10058）。
 * 対応表はビルド時生成（scripts/build-artwork-ids.mjs）。
 * 対応表にない種（公式絵が存在しない）はnull。
 */
export function getArtworkId(nameEn: string): number | null {
  return (artworkIds as Record<string, number>)[nameEn] ?? null;
}

/**
 * チャンピオンズでの習得技（英語名リスト）を返す。
 * メガシンカ等のフォームは「完全一致 → 最初のハイフン前のベース種」の
 * 順で解決する（フォーム別エイリアスは生成データ側で展開済み）。
 * 生成データに無い種はnull（呼び出し側は絞り込みなしとして扱う）。
 */
export function getLearnset(speciesEn: string): string[] | null {
  const table = championsLearnsets as Record<string, string[]>;
  const candidates = [toID(speciesEn)];
  const hyphen = speciesEn.indexOf("-");
  if (hyphen > 0) candidates.push(toID(speciesEn.slice(0, hyphen)));
  for (const id of candidates) {
    const moves = table[id];
    if (moves) return moves;
  }
  return null;
}
