# Title

Control Pokémon name detection at the capture boundary

# Status

Accepted

# Context

The desktop application needs both automatic name detection and a manual mode for calculating damage against Pokémon that are not currently visible. The current capture process owns the source video frames and OCR pipeline, while the React application only displays the MJPEG stream. Ignoring OCR events in React would leave Vision recognition running and would allow stale recognition work to update the interface after a mode change.

# Decision

Keep detection mode authoritative in the Swift capture process. Expose the current mode, confirmed automatic presences, recognition events, and mode changes through a loopback-only HTTP and Server-Sent Events service. When manual mode is requested, deactivate the current detector and stop forwarding captured frames to OCR while keeping MJPEG video active. When automatic mode is requested again, construct a fresh detector and clear the previous automatic presences before accepting new detections.

The React application mirrors the authoritative mode. Automatic recognition events may update the selected Pokémon only in automatic mode. Manual selections may update them only in manual mode and remain local inputs for damage calculation.

# Consequences

- Manual mode does not consume OCR resources and in-flight results from the deactivated detector cannot update the application.
- Returning to automatic mode performs a fresh initial detection instead of reusing a stale visual baseline.
- Video streaming remains uninterrupted across mode changes.
- The desktop application must show an explicit synchronization error when the loopback control service is unavailable or returns invalid data.
- Mega Evolution cannot be inferred from an unchanged name plate; a separately measured visual signal is required for automatic form detection.
