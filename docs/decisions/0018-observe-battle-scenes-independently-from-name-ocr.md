# Title

Observe battle scenes independently from user-triggered name OCR

# Status

Accepted

# Context

The partner needs to react to battle flow even when the damage calculator is not requesting Pokémon-name recognition. ADR-0010 limits name OCR to explicit user requests so an automatic detector cannot overwrite a deliberate manual correction. Scene observation has different requirements: it must be inexpensive enough to run continuously, must distinguish stable input screens from animations and menu overlays, and must never mutate calculator inputs.

# Decision

Add an always-on scene observer to the Swift capture process. Sample lightweight visual features from the source `CVPixelBuffer` at 8 Hz, independently from the user-triggered OCR detector. Track the player and opponent HUD regions separately and combine them with fixed-layout evidence for team selection and the in-battle party overview. Use temporal confirmation before publishing a stable scene.

Publish read-only scene snapshots through the existing loopback Server-Sent Events connection. The React partner pane may display these snapshots for diagnostics, but scene observation must not update Pokémon selections or any other damage-calculator input.

Treat HUD disappearance as evidence that high-frequency observation should begin, not as sufficient proof of a particular action. Keep an explicit `unknown` scene instead of forcing unrelated or unsupported screens into a battle category.

# Consequences

- Scene monitoring remains active while name OCR is idle.
- ADR-0010 continues to govern all OCR and calculator mutations.
- Battle animations and switches can trigger partner observation without repeatedly sending stable input screens to an AI model.
- Team selection and party overview require layout-specific, tested visual evidence.
- Unsupported layouts and ambiguous screens remain explicit instead of receiving an implicit fallback classification.
