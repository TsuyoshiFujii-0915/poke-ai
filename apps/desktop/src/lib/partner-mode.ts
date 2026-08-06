export type PartnerMode = "commentary" | "conversation";

export interface PartnerModePresentation {
  label: string;
  message: string;
}

const PARTNER_MODE_PRESENTATIONS: Record<PartnerMode, PartnerModePresentation> = {
  commentary: {
    label: "実況モード",
    message: "対戦情報を見ながら、Lizがここで実況してくれる予定です。",
  },
  conversation: {
    label: "会話モード",
    message: "Lizとのボイス会話は、次のステップでここにつながります。",
  },
};

export function partnerModePresentation(mode: PartnerMode): PartnerModePresentation {
  return PARTNER_MODE_PRESENTATIONS[mode];
}
