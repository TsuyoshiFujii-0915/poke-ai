/** Keeps a legal ability selected, or selects the species' primary visible ability. */
export function reconcileAbilitySelection(
  currentAbility: string,
  abilityCandidates: string[],
): string {
  if (abilityCandidates.length === 0) {
    throw new Error("no ability candidates");
  }
  return abilityCandidates.includes(currentAbility)
    ? currentAbility
    : abilityCandidates[0];
}

/** Rejects a stale or invalid ability before it reaches the damage engine. */
export function validateAbilitySelection(
  species: string,
  ability: string,
  abilityCandidates: string[],
): void {
  if (!abilityCandidates.includes(ability)) {
    throw new Error(`${species} cannot use ability ${ability || "(empty)"}`);
  }
}
