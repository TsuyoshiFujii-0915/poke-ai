import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type AbilityTable = Record<string, string[]>;
type JapaneseNames = {
  abilities: Record<string, string>;
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
