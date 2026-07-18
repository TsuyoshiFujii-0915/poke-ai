# Title

Confirm OCR-verified switches during visible battle animation

# Status

Accepted

# Context

The third live iPad battle test eliminated false `transitioning` states and correctly detected two switches. Whimsicott to Skeledirge was confirmed in approximately one second, but Meowscarada to Gyarados took approximately 28 seconds. After the background probe had already returned the different exact name, the detector repeatedly invalidated confirmation because the full name region continued to change during battle animation.

The five-frame OCR consensus already prevents one transient or incorrect reading from emitting a switch. Requiring pixel stability again after an exact different-name probe duplicated protection while coupling confirmation latency to unrelated movement inside the captured HUD region.

# Decision

After a background probe returns a confident exact match for a different Pokémon, report `transitioning` and enter multi-frame confirmation immediately. While confirming an OCR-verified switch, require the HUD to remain visible but do not reject a frame because its pixels differ from the preceding frame.

If the HUD becomes hidden, invalidate the pending recognition generation. Resume confirmation after the configured number of consecutive visible frames, without requiring those visible frames to be pixel-stable. Keep the existing pixel-stability requirement for initial detection, where no prior OCR evidence identifies the screen as a switch.

# Consequences

- Battle animation and changing HUD decoration do not repeatedly reset a verified switch confirmation.
- A temporarily hidden HUD still prevents OCR from sampling an invalid screen.
- Initial detection remains conservative.
- The existing five-frame voting and confidence requirements continue to protect the emitted switch event.
- A normal verified switch can begin collecting confirmation frames one recognition interval after the probe result.
