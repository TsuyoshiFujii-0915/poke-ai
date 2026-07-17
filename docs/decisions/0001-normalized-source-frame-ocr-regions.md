# Title

Define OCR regions in normalized source-frame coordinates

# Status

Accepted

# Context

The application can receive game video from devices with different aspect ratios. The captured iPad frame is 2360 x 1640, current iPhones are wider, and Nintendo Switch video is 16:9. The React UI displays every source with `object-fit: contain`, which introduces device-dependent letterboxing. OCR regions based on window pixels would therefore move when the application window or input aspect ratio changes.

# Decision

Run OCR on the source `CVPixelBuffer` in the Swift capture process before JPEG encoding. Define every OCR region as a normalized rectangle within the source frame, using a top-left origin for application-owned coordinates. Convert the rectangle to Vision's bottom-left coordinate system only at the Vision API boundary.

The player name region is anchored to the bottom-left of the source frame. The opponent name region is anchored to the top-right. React display coordinates are derived separately from the active video rectangle and are not inputs to OCR.

# Consequences

- OCR accuracy is independent of MJPEG scaling, compression, application window size, and display letterboxing.
- Region definitions remain proportional when the source resolution changes without changing its layout.
- A device whose game UI uses a different layout requires measured region values for that layout; it must not silently reuse an incompatible region.
- Any React overlay showing a recognized region must account for the active video's scale and letterbox offsets.
