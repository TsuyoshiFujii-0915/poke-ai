import type { StatStageKey } from "./stat-stage";

export type DamageMoveCategory = "Physical" | "Special" | "Status";
export type DamageStageKey = Extract<StatStageKey, "atk" | "def" | "spa" | "spd">;

export interface DamageStageKeys {
  attacker: DamageStageKey;
  defender: DamageStageKey;
}

export function stageKeysForDamageCategory(
  category: DamageMoveCategory,
): DamageStageKeys | null {
  switch (category) {
    case "Physical":
      return { attacker: "atk", defender: "def" };
    case "Special":
      return { attacker: "spa", defender: "spd" };
    case "Status":
      return null;
  }
}
