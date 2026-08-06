import assert from "node:assert/strict";
import test from "node:test";
import {
  partnerModePresentation,
  type PartnerMode,
} from "../src/lib/partner-mode.ts";

test("presents commentary and conversation as distinct partner modes", () => {
  const commentary = partnerModePresentation("commentary");
  const conversation = partnerModePresentation("conversation");

  assert.deepEqual(commentary, {
    label: "実況モード",
    message: "対戦情報を見ながら、Lizがここで実況してくれる予定です。",
  });
  assert.deepEqual(conversation, {
    label: "会話モード",
    message: "Lizとのボイス会話は、次のステップでここにつながります。",
  });
});

test("defines exactly the two modes available from the partner header", () => {
  const modes = ["commentary", "conversation"] satisfies PartnerMode[];

  assert.deepEqual(
    modes.map((mode) => partnerModePresentation(mode).label),
    ["実況モード", "会話モード"],
  );
});
