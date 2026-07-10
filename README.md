# BuddyDock

BuddyDock is a macOS CLI that exports the pinned icons in your Dock and creates a cohesive styled set with fal.ai. It is built with Bun, Effect, `@effect/cli`, a native Swift/AppKit inspector, GPT Image 2 edit, and BiRefNet background removal.

It only creates exported PNG files. It does not modify app bundles or apply icons to your Mac.

## Requirements

- macOS with the Swift toolchain
- [Bun](https://bun.sh)
- A fal.ai API key exposed as `FAL_KEY` or `FAL_API_KEY`

## Setup

```sh
bun install
bun run build
```

The build creates `dist/buddydock.js` and the optimized native helper at `dist/buddydock-inspector`.

## Usage

Scan the pinned Dock apps without calling fal:

```sh
bun run buddydock scan --output .buddydock/scan
```

Create a candy-cotton set from the scan:

```sh
doppler run -- bun run buddydock style \
  --manifest .buddydock/scan/manifest.json \
  --theme "candy cotton, fluffy pastel sugar fibers, soft pink and baby blue" \
  --quality medium \
  --output styled-icons
```

Scan and style in one operation:

```sh
doppler run -- bun run buddydock run --theme "candy cotton" --quality medium
```

For a cheap one-icon smoke test, add `--limit 1 --quality low`. Add `--keep-background` to skip BiRefNet.

## Commands

- `scan`: reads `com.apple.dock` and exports each pinned app icon plus `manifest.json`.
- `style`: styles the icons in an existing scan manifest.
- `run`: scans and styles in one pass.

Generated icons include a second manifest recording source paths, theme, and model IDs. BuddyDock processes sequentially to keep cost and rate behavior predictable.

## Development

```sh
bun run check
bun run buddydock --help
```

The CLI automatically uses the optimized Swift inspector when it exists in `dist`; otherwise it runs the checked-in Swift source directly.
