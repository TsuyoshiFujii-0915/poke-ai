export type DamageRole = "attacker" | "defender";

export interface ResolvedDamageAbility {
  ability: string | undefined;
  abilityOn: boolean;
}

const MANUAL_DAMAGE_TRIGGERS = new Set([
  "Electromorphosis",
  "Flash Fire",
  "Minus",
  "Plus",
]);

const OMITTED_CONTEXT_ABILITIES = new Set([
  "Analytic",
  "Blaze",
  "Defeatist",
  "Guts",
  "Marvel Scale",
  "Merciless",
  "Multiscale",
  "Overgrow",
  "Quick Feet",
  "Rivalry",
  "Sand Force",
  "Solar Power",
  "Supreme Overlord",
  "Swarm",
  "Torrent",
]);

export function isManualAbilityTrigger(ability: string): boolean {
  return MANUAL_DAMAGE_TRIGGERS.has(ability);
}

/**
 * Converts Champions-only abilities to an exactly equivalent state understood
 * by the current damage engine. Unsupported formula changes fail explicitly,
 * while effects that require absent battle context are deliberately omitted.
 */
export function resolveAbilityForDamage(
  ability: string,
  role: DamageRole,
  triggerActive: boolean,
): ResolvedDamageAbility {
  if ((ability === "Fire Mane" || ability === "Firemane") && role === "attacker") {
    return { ability: "Flash Fire", abilityOn: true };
  }
  if (ability === "Eelevate") {
    return { ability: "Levitate", abilityOn: false };
  }
  if (role === "attacker" && (ability === "Dragonize" || ability === "Mega Sol")) {
    throw new Error(`unsupported Champions damage ability: ${ability}`);
  }
  if (OMITTED_CONTEXT_ABILITIES.has(ability)) {
    return { ability: undefined, abilityOn: false };
  }
  return {
    ability,
    abilityOn: isManualAbilityTrigger(ability) && triggerActive,
  };
}
