export const STAT_STAGE_KEYS = ["atk", "def", "spa", "spd", "spe"] as const;

export type StatStageKey = (typeof STAT_STAGE_KEYS)[number];

export type StatStages = Record<StatStageKey, number>;

export function createNeutralStatStages(): StatStages {
  return { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
}

export function adjustStatStage(
  stages: StatStages,
  key: StatStageKey,
  delta: number,
): StatStages {
  validateStatStages(stages);
  if (!Number.isInteger(delta)) {
    throw new Error(`stat stage delta must be an integer: ${delta}`);
  }
  return {
    ...stages,
    [key]: Math.max(-6, Math.min(6, stages[key] + delta)),
  };
}

export function validateStatStages(stages: StatStages): void {
  for (const key of STAT_STAGE_KEYS) {
    const value = stages[key];
    if (!Number.isInteger(value) || value < -6 || value > 6) {
      throw new Error(`stat stage '${key}' must be an integer from -6 to 6: ${value}`);
    }
  }
}
