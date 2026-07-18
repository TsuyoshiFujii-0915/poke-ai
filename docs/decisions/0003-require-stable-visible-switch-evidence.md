# Title

Require stable visible evidence before reporting a Pokémon transition

# Status

Accepted

# Context

The first live iPad battle test correctly detected the initial Pokémon and three switches without confirming a wrong species. However, ordinary attack animations repeatedly caused `transitioning`, `recognizing`, and `waiting_for_stable_hud` status churn. The detector counted a hidden HUD as a changed name region and reported a transition after changed samples even while those samples were visually unstable.

Raising a luminance threshold would bind behavior to the tested animation and capture conditions without distinguishing a new name plate from a temporarily obscured one.

# Decision

A frame with a hidden HUD does not count as evidence of a Pokémon switch. In addition to the existing changed-sample window, require the configured number of consecutive frames to be visible, different from the confirmed name-region signature, and stable relative to the immediately preceding frame before reporting `transitioning`.

Continue to apply multi-frame OCR consensus after the transition has been reported. Do not weaken the existing OCR confirmation requirements.

# Consequences

- Attack animations that hide or rapidly alter the HUD do not start OCR confirmation.
- A real switch is reported after the replacement name plate has settled for the stability window, adding a bounded delay of that window.
- Both difference-from-confirmed and difference-from-previous measurements are required to begin a visual transition.
- OCR voting, stale-generation rejection, and switch event semantics remain unchanged.
