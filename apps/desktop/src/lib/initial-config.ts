import type { MySideConfig } from "./calc";
import { createNeutralStatStages } from "./stat-stage.ts";

export function createInitialMySideConfig(): MySideConfig {
  return {
    species: "",
    ability: "",
    item: "",
    move: "",
    points: {
      hp: 0,
      atk: 0,
      def: 0,
      spa: 0,
      spd: 0,
      spe: 0,
    },
    stages: createNeutralStatStages(),
  };
}
