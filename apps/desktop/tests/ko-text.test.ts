import assert from "node:assert/strict";
import test from "node:test";
import { toJapaneseKoText } from "../src/lib/ko-text.ts";

test("shortens probabilistic OHKO text", () => {
  assert.equal(toJapaneseKoText("6.3% chance to OHKO"), "乱1 (6.3%)");
  assert.equal(toJapaneseKoText("75% chance to OHKO"), "乱1 (75%)");
});

test("keeps other KO counts consistent", () => {
  assert.equal(toJapaneseKoText("guaranteed OHKO"), "確1");
  assert.equal(toJapaneseKoText("69.9% chance to 2HKO"), "乱2 (69.9%)");
});
