export interface MegaEvolutionState {
  baseSpecies: string;
  variants: string[];
  activeVariant: string | null;
}

const EXPLICIT_MEGA_BASES: Readonly<Record<string, string>> = {
  "Floette-Mega": "Floette-Eternal",
};

export function getMegaEvolutionState(
  species: string,
  catalog: readonly string[],
): MegaEvolutionState | null {
  if (species === "") {
    return null;
  }
  const baseSpecies = megaBaseSpecies(species, catalog);
  const variants = catalog.filter(
    (candidate) => candidate.includes("-Mega") && megaBaseSpecies(candidate, catalog) === baseSpecies,
  );
  if (variants.length === 0) {
    return null;
  }
  return {
    baseSpecies,
    variants,
    activeVariant: variants.includes(species) ? species : null,
  };
}

export function isSameMegaEvolutionFamily(
  firstSpecies: string,
  secondSpecies: string,
  catalog: readonly string[],
): boolean {
  const first = getMegaEvolutionState(firstSpecies, catalog);
  const second = getMegaEvolutionState(secondSpecies, catalog);
  return first !== null && second !== null && first.baseSpecies === second.baseSpecies;
}

function megaBaseSpecies(species: string, catalog: readonly string[]): string {
  const explicitBase = EXPLICIT_MEGA_BASES[species];
  if (explicitBase !== undefined) {
    if (!catalog.includes(explicitBase)) {
      throw new Error(`Mega base species is absent from the catalog: ${species} -> ${explicitBase}`);
    }
    return explicitBase;
  }
  if (!species.includes("-Mega")) {
    return species;
  }
  const bases = catalog
    .filter((candidate) => !candidate.includes("-Mega") && species.startsWith(`${candidate}-`))
    .sort((first, second) => second.length - first.length);
  const base = bases[0];
  if (base === undefined) {
    throw new Error(`Mega species has no playable base form: ${species}`);
  }
  return base;
}
