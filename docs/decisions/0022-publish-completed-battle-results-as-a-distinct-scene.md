# Title

Publish completed battle results as a distinct scene

# Status

Accepted

# Context

ADR-0021 distinguishes recognized non-battle screens from unknown layouts. The partner should eventually receive one image after a battle result is fully displayed, but a generic `out_of_battle` event cannot distinguish a completed result from the home screen. The animated `WIN` or `LOSE` banner also appears before the result becomes interactive and is not the desired capture point.

# Decision

Add a distinct `battle_result` scene. Recognize the completed result layout from the three stacked rank and reward panels plus the three bottom action buttons. Require normal temporal confirmation before publishing the stable scene. Do not classify the animated `WIN` or `LOSE` banner as a completed result.

# Consequences

- A future image-delivery component can trigger on the stable `battle_result` transition without reacting to the home screen.
- The unchanged stable scene is published once by the existing scene stream.
- The detector does not determine whether the player won or lost.
- A captured iPad result frame must replace the public-layout reference fixture after device validation.
