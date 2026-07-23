# Title

Rebuild stalled capture sessions without stopping local services

# Status

Accepted

# Context

When a connected iPad sleeps, its external screen-capture device can stop delivering frames. The current capture command exits when `AVCaptureSession` stops, and it cannot detect the case where the session still reports that it is running but no frames arrive. The MJPEG and detection-control connections then either disappear or remain attached to a permanently stalled session, and waking the iPad does not restore the application.

# Decision

Keep the capture process, MJPEG server, and detection-control server alive across source interruptions. Track the last received frame with a monotonic clock. When the session stops or no frame arrives for five seconds, stop and discard the current `AVCaptureSession`, rediscover the external screen-capture device, construct a new session, and resume on the existing servers. Reset an active OCR detector before starting the replacement session so that capture timestamps and visual baselines from different sessions cannot mix.

# Consequences

- Waking a sleeping iPad can restore video and OCR without restarting the desktop application or local servers.
- Existing MJPEG and Server-Sent Events clients remain connected while recovery runs.
- Recovery attempts repeat until a compatible screen-capture device is available.
- A process crash or explicit termination still requires relaunching the capture command.
- The five-second timeout adds a bounded delay before automatic recovery begins.
