# BuddyDock

BuddyDock is a macOS CLI that exports the pinned icons in your Dock and creates a cohesive styled set with fal.ai. It is built with Bun, Effect, `@effect/cli`, a native Swift/AppKit inspector, GPT Image 2 edit, and BiRefNet background removal.

Styling only creates exported PNG files. The optional `apply` command then sets them as custom Finder icons on the app bundles (the same mechanism as Get Info > drag icon), and `reset` restores the originals. App updates will overwrite custom icons.

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

For a cheap one-icon smoke test, add `--limit 1 --quality low`. Every icon is masked into a macOS squircle (824px tile on a 1024px canvas) by the native `Squircle` helper, so shapes are consistent regardless of what the model draws; the unmasked output is kept in `raw/`. Add `--remove-background` to also run BiRefNet on the artwork.

Apply a styled set to your Dock (restarts the Dock), or undo it:

```sh
bun run buddydock apply --manifest styled-icons/manifest.json
bun run buddydock reset --manifest styled-icons/manifest.json
```

## Commands

- `scan`: reads `com.apple.dock` and exports each pinned app icon plus `manifest.json`.
- `style`: styles the icons in an existing scan manifest and masks them into squircles.
- `run`: scans and styles in one pass.
- `apply`: sets the styled icons from a styled manifest as custom icons on their apps, then restarts the Dock (`--no-restart` to skip). Running apps keep drawing their old tile from memory, so pass `--relaunch` to quit and reopen them, or reopen them yourself.
- `reset`: removes the custom icons for the apps in a styled manifest.

Generated icons include a second manifest recording source paths, theme, and model IDs. BuddyDock processes sequentially to keep cost and rate behavior predictable.

## Development

```sh
bun run check
bun run buddydock --help
```

The CLI automatically uses the optimized Swift inspector when it exists in `dist`; otherwise it runs the checked-in Swift source directly.
