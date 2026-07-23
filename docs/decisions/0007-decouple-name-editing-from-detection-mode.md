# Title

Decouple Pokémon name editing from automatic detection mode

# Status

Accepted

# Context

ADR-0006 treated manual mode as both an OCR pause and the only state in which a user could edit Pokémon names. Live use showed that these are separate concerns. A user may need to correct an automatic result immediately while keeping future screen detection active, or pause screen detection while continuing to edit either side.

# Decision

Detection mode controls only whether captured frames are forwarded to the OCR detector. Pokémon name inputs remain editable in both automatic and manual modes. Changing detection mode does not clear either input. A user selection updates the current damage-calculation input immediately. While automatic mode remains active, a later confirmed screen detection may replace that selection. Manual mode prevents those automatic replacements because the capture process does not run the detector.

# Consequences

- Users can correct an automatic name without changing detection mode.
- Automatic mode may replace a user correction when a later detection is confirmed.
- Manual mode freezes screen-derived changes but does not change the editing interface.
- The UI can represent detection mode with a single `AUTO` switch instead of separate input-mode choices.
