# Capture and name-recognition PoC

## Build and test

```bash
swift build
swift test --disable-xctest --enable-swift-testing
```

The package pins Swift Testing 6.1.2 because the standalone Apple Command Line Tools installation used by this project does not include the XCTest Swift module.

## Recognize a Pokémon name in an iPad battle HUD image

The input image must contain only the active game frame. Do not include the React viewer's black letterbox area.

```bash
swift run poke-capture-poc recognize-ipad-image \
  <image-path> \
  <player|opponent> \
  ../../apps/desktop/src/data/champions-species.json \
  ../../apps/desktop/src/data/ja-names.json
```

Example:

```bash
swift run poke-capture-poc recognize-ipad-image \
  Tests/CaptureRecognitionTests/Fixtures/meowscarada-vs-archaludon.png \
  opponent \
  ../../apps/desktop/src/data/champions-species.json \
  ../../apps/desktop/src/data/ja-names.json
```

The command reports one of four explicit outcomes:

- `detected`: one catalog entry is the unique closest match within one edit.
- `noText`: Vision found no text in the selected region.
- `noMatch`: text was found but no catalog entry is close enough.
- `ambiguous`: multiple catalog entries have the same best distance.

## Coordinate contract

Recognition runs on the source image or `CVPixelBuffer`, before MJPEG scaling and encoding. Application-owned regions use normalized coordinates with a top-left origin. The Vision boundary converts them to Vision's bottom-left coordinate system.

The current regions were measured from the 2360 x 1640 iPad capture and apply only to the normal battle HUD:

| Side | Top-left normalized region `(x, y, width, height)` |
| --- | --- |
| Player | `(0.06452, 0.86964, 0.14144, 0.06429)` |
| Opponent | `(0.81141, 0.02500, 0.13896, 0.06429)` |

Team selection, summary screens, and animation frames use different layouts or hide the HUD. They must not be interpreted using these regions.

## Detect live name changes from an iPad capture

The live command keeps the MJPEG stream on port 8787 and emits structured recognition events as `EVENT_JSON <json>` lines:

```bash
swift run poke-capture-poc recognize-stream \
  ../../apps/desktop/src/data/champions-species.json \
  ../../apps/desktop/src/data/ja-names.json
```

The live detector processes the source `CVPixelBuffer` before JPEG encoding. Each side is independent:

- A compact luminance signature is sampled at 8 Hz.
- Three changed samples in a five-sample window start a transition.
- OCR waits for three visually stable samples.
- Confirmation uses five distinct frames, with up to three burst attempts.
- Exact names require three votes. One-edit corrections require four votes and a confidence threshold.
- A three-second accurate Japanese OCR probe recovers visual transitions that the signature detector missed. The target Vision runtime does not support Japanese in fast mode.
- Vision runs on a dedicated serial queue, so OCR does not block capture or MJPEG encoding.
- Results from an invalidated generation are reported as stale and cannot update the detected Pokémon.

The command accepts only the `ipad-battle-hud-v1` layout. A source with an incompatible aspect ratio or orientation fails explicitly. iPhone and Nintendo Switch layouts require separately measured profiles.

Battle-state integration is not part of this PoC command yet. Consumers should parse only lines prefixed with `EVENT_JSON`; diagnostic logs use the existing timestamped format.
