import { useState, type ReactNode } from "react";
import {
  partnerModePresentation,
  type PartnerMode,
} from "../lib/partner-mode";
import { SceneMonitor } from "./SceneMonitor";

const PARTNER_IMAGE_SRC = "/partners/liz-anime-knee-up.png";

interface PartnerModeButtonProps {
  mode: PartnerMode;
  selectedMode: PartnerMode;
  icon: ReactNode;
  onSelect: (mode: PartnerMode) => void;
}

function CommentaryIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 14.5V9.7a2 2 0 0 1 2-2h2l4-3v15l-4-3H6a2 2 0 0 1-2-2Z" />
      <path d="M15.3 8.2a5.2 5.2 0 0 1 0 7.6M18.2 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function ConversationIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.6 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
      <path d="M7.5 11.5h.01M12 11.5h.01M16.5 11.5h.01" />
    </svg>
  );
}

function PartnerModeButton({
  mode,
  selectedMode,
  icon,
  onSelect,
}: PartnerModeButtonProps): ReactNode {
  const presentation = partnerModePresentation(mode);
  const selected = mode === selectedMode;

  return (
    <button
      type="button"
      className={`partner-mode-button ${selected ? "selected" : ""}`}
      aria-label={presentation.label}
      aria-pressed={selected}
      title={presentation.label}
      onClick={() => onSelect(mode)}
    >
      {icon}
    </button>
  );
}

export function PartnerPane(): ReactNode {
  const [mode, setMode] = useState<PartnerMode>("commentary");
  const presentation = partnerModePresentation(mode);

  return (
    <div className="partner-pane">
      <header className="partner-header">
        <div className="partner-identity">
          <span className="partner-title">AI PARTNER</span>
          <span className="partner-name">LIZ</span>
        </div>
        <div className="partner-mode-control" aria-label="パートナーモード">
          <PartnerModeButton
            mode="commentary"
            selectedMode={mode}
            icon={<CommentaryIcon />}
            onSelect={setMode}
          />
          <PartnerModeButton
            mode="conversation"
            selectedMode={mode}
            icon={<ConversationIcon />}
            onSelect={setMode}
          />
        </div>
      </header>

      <div className="partner-stage">
        <div className="partner-stage-grid" aria-hidden="true" />
        <div className="partner-stage-glow" aria-hidden="true" />
        <span className="partner-preview-badge">
          <span aria-hidden="true" />
          PREVIEW
        </span>
        <SceneMonitor />
        <div className="partner-character-frame">
          <img
            className="partner-character"
            src={PARTNER_IMAGE_SRC}
            alt="Lizの立ち絵"
          />
        </div>
        <div className="partner-caption" aria-live="polite">
          <p>{presentation.message}</p>
        </div>
      </div>
    </div>
  );
}
