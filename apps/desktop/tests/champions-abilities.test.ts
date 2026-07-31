import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type AbilityTable = Record<string, string[]>;
type BaseStats = {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
};
type BaseStatTable = Record<string, BaseStats>;
type JapaneseNames = {
  species: Record<string, string>;
  moves: Record<string, string>;
  items: Record<string, string>;
  abilities: Record<string, string>;
};
type ChampionsSource = {
  repository: string;
  commit: string;
  paths: string[];
};

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as T;
}

test("generated Champions data includes every selectable Garchomp ability", () => {
  const abilities = readJson<AbilityTable>("../src/data/champions-abilities.json");
  assert.deepEqual(abilities.Garchomp, ["Sand Veil", "Rough Skin"]);
});

test("generated Champions data uses the fixed Mega ability", () => {
  const abilities = readJson<AbilityTable>("../src/data/champions-abilities.json");
  assert.deepEqual(abilities["Garchomp-Mega"], ["Sand Force"]);
});

test("generated Champions base stats use the Champions Mega Starmie value", () => {
  const baseStats = readJson<BaseStatTable>("../src/data/champions-base-stats.json");
  const species = readJson<string[]>("../src/data/champions-species.json");

  assert.equal(Object.keys(baseStats).length, species.length);
  assert.deepEqual(baseStats["Starmie-Mega"], {
    hp: 60,
    atk: 100,
    def: 105,
    spa: 130,
    spd: 105,
    spe: 120,
  });
});

test("generated Champions data records its pinned Showdown source", () => {
  const source = readJson<ChampionsSource>("../src/data/champions-source.json");

  assert.equal(source.repository, "https://github.com/smogon/pokemon-showdown");
  assert.match(source.commit, /^[0-9a-f]{40}$/);
  assert.ok(source.paths.includes("data/pokedex.ts"));
  assert.ok(source.paths.includes("data/mods/champions/formats-data.ts"));
});

test("Japanese names include standard and Champions-specific abilities", () => {
  const names = readJson<JapaneseNames>("../src/data/ja-names.json");
  assert.equal(names.abilities["Rough Skin"], "さめはだ");
  assert.equal(names.abilities.Dragonize, "ドラゴンスキン");
  assert.equal(names.abilities.Eelevate, "うなぎのぼり");
  assert.equal(names.abilities.Firemane, "ほのおのたてがみ");
  assert.equal(names.abilities["Mega Sol"], "メガソーラー");
  assert.equal(names.abilities["Piercing Drill"], "かんつうドリル");
  assert.equal(names.abilities["Spicy Spray"], "とびだすハバネロ");
});

test("every selectable Champions entry has a Japanese display name", () => {
  const names = readJson<JapaneseNames>("../src/data/ja-names.json");
  const species = readJson<string[]>("../src/data/champions-species.json");
  const moves = readJson<string[]>("../src/data/champions-moves.json");
  const items = readJson<string[]>("../src/data/champions-items.json");
  const abilities = readJson<AbilityTable>("../src/data/champions-abilities.json");
  const abilityNames = [...new Set(Object.values(abilities).flat())];

  assert.deepEqual(species.filter((name) => names.species[name] === undefined), []);
  assert.deepEqual(moves.filter((name) => names.moves[name] === undefined), []);
  assert.deepEqual(items.filter((name) => names.items[name] === undefined), []);
  assert.deepEqual(abilityNames.filter((name) => names.abilities[name] === undefined), []);
});
