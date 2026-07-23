import assert from "node:assert/strict";
import test from "node:test";
import { normalizePointInput } from "../src/lib/point-input.ts";

test("removes leading zeroes from point input", () => {
  assert.equal(normalizePointInput("02"), "2");
  assert.equal(normalizePointInput("00032"), "32");
});

test("keeps a single zero and already normalized values", () => {
  assert.equal(normalizePointInput("0"), "0");
  assert.equal(normalizePointInput("32"), "32");
});

test("represents an empty point input as zero", () => {
  assert.equal(normalizePointInput(""), "0");
});
