# Title

Use event-driven temporal consensus for live Pokémon name detection

# Status

Superseded by [ADR-0003](0003-require-stable-visible-switch-evidence.md)

# Context

Running accurate OCR continuously on captured video wastes resources and makes transient battle animations look like Pokémon changes. A single OCR result is also insufficient because the name plate can be hidden, partially rendered, or temporarily covered by effects. At the same time, a fixed cooldown can miss legitimate rapid switches.

The capture delegate currently receives source `CVPixelBuffer` frames on the same serial queue that creates the MJPEG stream. Synchronous Vision work on that queue would delay both capture and display.

# Decision

Detect each battle side independently with an event-driven state machine.

Sample a compact luminance signature from each normalized name region at 8 Hz. While a Pokémon is confirmed, compare new signatures with the confirmed baseline. Treat three changed samples in a five-sample window as a possible transition. Also issue a low-frequency accurate Japanese OCR probe every three seconds so a missed visual transition can be recovered. Japanese is not supported by Vision's fast recognition path in the target runtime.

After a possible transition, wait until three consecutive sampled frames are visually stable. Then run accurate OCR on five distinct frames spaced over time. Confirm an exact catalog match when at least three results agree. Confirm a one-edit correction only when at least four results agree and their median Vision confidence meets the configured threshold. Ties and insufficient evidence remain explicitly unconfirmed.

Retry an inconclusive five-frame burst at most twice while the HUD remains stable, for three burst attempts in total. If all three attempts fail, emit an explicit detection-failed result and keep the current presence unconfirmed until a later recovery attempt or manual correction.

Do not use a fixed post-detection cooldown. Suppress duplicate events by comparing the confirmed Pokémon identifier. Preserve the previous detection as history during a transition, but do not expose it as the currently confirmed Pokémon after a transition has started.

Extract signatures synchronously on the capture queue, but perform Vision requests on a dedicated serial recognition queue. Allow at most one outstanding request per side. Tag requests with a generation identifier and return an explicit stale-result rejection for results from an older generation.

Require an explicit capture layout profile. The first supported profile is the measured iPad normal battle HUD. Reject incompatible source dimensions or orientation instead of reusing that profile implicitly.

# Consequences

- Accurate OCR runs only at startup, after suspected changes, and during low-frequency recovery probes.
- Transient animation frames cannot update battle state from a single OCR result.
- A confirmed switch normally appears after the name plate has been stable for the five-frame confirmation window.
- The application can represent transition and unconfirmed states without silently retaining stale battle state.
- The recognition pipeline requires deterministic timing, consensus, stale-generation, and layout-validation tests.
- Supporting another device or battle layout requires a separately measured and tested layout profile.
