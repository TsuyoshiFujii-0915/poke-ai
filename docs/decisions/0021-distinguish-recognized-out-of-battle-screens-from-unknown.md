# Title

Distinguish recognized out-of-battle screens from unknown screens

# Status

Accepted

# Context

The scene observer currently reports both recognized non-battle screens and unsupported or ambiguous screens as `unknown`. The partner needs to stay quiet on known home screens and may later react once to a fully displayed battle result, while unsupported layouts must remain visible as detection gaps.

# Decision

Add an explicit `out_of_battle` scene. Emit it only when layout-specific visual evidence recognizes a supported non-battle screen. Keep `unknown` for unsupported or ambiguous screens. Treat result-screen recognition and one-shot image delivery as separate later work that must add its own tested visual evidence and delivery policy.

# Consequences

- The home screen can be distinguished from an unsupported screen without starting battle observation.
- `unknown` continues to expose detection gaps instead of becoming an implicit fallback.
- Additional non-battle layouts require explicit fixtures and detectors.
- This decision does not send images or change damage-calculator inputs.
