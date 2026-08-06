# Title

Retain the 16:10 default window

# Status

Accepted

# Context

ADR-0019 changed the default window from 1440×900 to 1600×900 to match a 16:9 video frame. The primary development display exposes 1512 logical pixels of usable width, so a 1600-pixel-wide window cannot fit at its intended size. Reducing the height to preserve 16:9 would disturb the established vertical balance of the game capture and damage calculator.

# Decision

Restore the 1440×900 default window, the 1180-pixel minimum width, and the 372-pixel partner column. Keep the partner image centered independently of the window aspect ratio.

# Consequences

- The default window remains 16:10 and fits the primary development display.
- The established game capture and damage calculator dimensions remain unchanged.
- The partner column keeps its previous width.
- A 16:9 presentation would require a separate layout or display strategy.
