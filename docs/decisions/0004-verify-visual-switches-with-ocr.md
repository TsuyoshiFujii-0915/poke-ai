# Title

Verify visual switch evidence with OCR before reporting a transition

# Status

Accepted

# Context

The second live iPad battle test correctly detected Meowscarada versus Dragonite and the switch from Dragonite to Garchomp without confirming a wrong species. Requiring a visible and stable changed region was not sufficient to prevent status churn: ordinary battle effects could remain visually stable for the configured window while differing from the signature captured at confirmation time.

The detector reported `transitioning` before OCR determined whether the visible name still belonged to the confirmed Pokémon. Reconfirming the same Pokémon then returned the state to `stable`, producing unnecessary public state changes and repeated OCR bursts.

# Decision

Treat stable visual difference as a request for a single background OCR probe, not as a public transition. Keep the confirmed Pokémon stable while that probe is pending. Report `transitioning` and begin multi-frame confirmation only when the probe returns a confident exact match for a different Pokémon.

When the probe returns the currently confirmed Pokémon, keep the public state unchanged and replace the confirmed visual signature with the probe frame. When the probe is inconclusive, keep the public state unchanged, discard the accumulated visual-change evidence, and delay another visual probe until the heartbeat interval has elapsed.

# Consequences

- Stable battle effects cannot produce `transitioning` without OCR evidence of a different Pokémon.
- Reconfirming the current Pokémon adapts the visual baseline without emitting a duplicate event.
- Inconclusive probes do not start five-frame OCR bursts and are rate-limited before visual retry.
- A real switch still requires the existing five-frame consensus before emitting `pokemon_switched_in`.
- Switch detection now includes one additional probe before the confirmation burst.
