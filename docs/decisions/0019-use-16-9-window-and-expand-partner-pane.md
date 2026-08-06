# Title

Use a 16:9 window and assign added width to the partner pane

# Status

Superseded by ADR-0020

# Context

The default 1440×900 desktop window uses a 16:10 aspect ratio, while the intended video presentation uses 16:9. The game capture and damage calculator share the left workspace and have already been balanced at their current width. Expanding those panels would change that balance.

# Decision

Use a 1600×900 default window. Keep the left workspace at its established width by increasing only the partner column from 372 pixels to 532 pixels. Increase the minimum window width by the same 160 pixels so resizing cannot make the left workspace narrower than before.

# Consequences

- The default desktop window matches the 16:9 video aspect ratio.
- The game capture and damage calculator retain their established width.
- The partner pane gains the full additional horizontal space.
- The minimum supported window width increases from 1180 to 1340 pixels.
