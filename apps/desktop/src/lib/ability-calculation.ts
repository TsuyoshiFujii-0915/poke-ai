export type DamageRole = "attacker" | "defender";

export interface ResolvedDamageAbility {
  ability: string;
  abilityOn: boolean;
}

/**
 * Converts Champions-only abilities to an exactly equivalent state understood
 * by the current damage engine. Unsupported formula changes fail explicitly.
 */
export function resolveAbilityForDamage(
  ability: string,
  role: DamageRole,
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
  return { ability, abilityOn: false };
}
