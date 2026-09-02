# BuddyDock

BuddyDock is a macOS CLI that exports the pinned icons in your Dock and creates a cohesive styled set with fal.ai. It is built with Bun, Effect, `@effect/cli`, a native Swift/AppKit inspector, GPT Image 2 edit, and Ideogram background removal.

Styling only creates exported PNG files. There are two ways to put them on your Mac:
the quick `apply`/`reset` commands set them as custom Finder icons straight from a
styled manifest (the same mechanism as Get Info > drag icon), and the icon-pack
scripts documented below convert them to `.icns`, apply verified custom icons, and
restore the icon state that existed before the pack was applied. Neither path
modifies application bundle contents, and app updates will overwrite custom icons.

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

For a cheap one-icon smoke test, add `--limit 1 --quality low`. Every icon is masked into a macOS squircle (824px tile on a 1024px canvas) by the native `Squircle` helper, so shapes are consistent regardless of what the model draws; the unmasked output is kept in `raw/`. Add `--remove-background` to also run Ideogram background removal on the artwork.

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
- `reapply`: reapplies a saved `.icns` icon pack via the scripts below (`--sudo` for root-owned apps).

Generated icons include a second manifest recording source paths, theme, and model IDs. BuddyDock processes sequentially to keep cost and rate behavior predictable.

## Claymation icon pack

The repository includes the black-and-white claymation pack in
`icon-packs/claymation-black-white`. The CLI generates PNGs; the scripts in this
section convert those PNGs to macOS `.icns` files, apply them, and restore the
previous custom icons or bundled defaults.

### Apply the included pack

Install the free, open-source [`fileicon`](https://github.com/mklement0/fileicon)
CLI once, then apply the pack:

```sh
brew install fileicon
./scripts/apply-icon-pack.sh ./icon-packs/claymation-black-white
```

After linking BuddyDock with `bun link`, reapply the bundled pack from any directory
with:

```sh
buddydock reapply
```

The command applies user-writable apps without prompting and preserves any existing
custom icon on an app it cannot write, such as a root-owned Tailscale installation.
Run `buddydock reapply --sudo` from an interactive terminal when a root-owned app has
lost its custom icon. macOS may require both an administrator password and App
Management access for that terminal.

The script asks for your administrator password once when targeting `/Applications`.
It clears incomplete custom-icon metadata, applies each icon, verifies the result,
touches only the changed apps, and refreshes Finder and Dock once at the end.

Ghostty is handled through its supported `macos-icon = custom` setting instead of
`fileicon`. BuddyDock copies the pack icon into Ghostty's Application Support
directory, remembers the previous Ghostty icon settings, and updates its active
configuration file. Restart Ghostty after applying or restoring a pack. This is
necessary because Ghostty controls its running Dock icon through AppKit; a Finder
custom icon can look correct in `/Applications` but revert when dragged into the
Dock.

Restore the original Finder icons and the previous Ghostty icon settings with:

```sh
./scripts/restore-icon-pack.sh ./icon-packs/claymation-black-white
```

### Create a new icon pack

Create a directory for the source PNGs and a tab-separated manifest. Application
names must match the bundle name in `/Applications` exactly, without `.app`:

```tsv
# source PNG	application name	apply method
01-chatgpt.png	ChatGPT	fileicon
02-ghostty.png	Ghostty	ghostty
```

Supported apply methods are:

- `fileicon`: the default for normal macOS apps.
- `ghostty`: uses Ghostty's native custom-icon configuration. Use this for
  `Ghostty.app`; do not modify or re-sign its application bundle.

Build the `.icns` files with the macOS-provided `sips` and `iconutil` tools:

```sh
./scripts/build-icon-pack.sh \
  ./styled-icons/my-theme \
  ./icon-packs/my-theme \
  ./icon-packs/my-theme/manifest.tsv
```

The generated `.icns` filename comes from the manifest's application name, so the
result is immediately compatible with the apply and restore scripts. The build
script also copies the manifest to `<pack>/manifest.tsv` when it was supplied from
another directory, preserving native handlers such as `ghostty`:

```sh
./scripts/apply-icon-pack.sh ./icon-packs/my-theme
```

### Troubleshooting macOS icons

#### `Cannot modify ... you do not have write permissions`

Grant the terminal running the script access under **System Settings → Privacy &
Security → App Management**. Quit that terminal completely, reopen it, and rerun
the script. Running `sudo` alone does not bypass macOS privacy controls. Do not use
`touch /Applications/*.app`; BuddyDock refreshes only the apps in the pack.

#### `associated icon data was not` set or `Has NO custom icon`

This is a half-applied Finder icon: the `com.apple.FinderInfo` flag exists but the
associated `Icon\r` data does not. The apply script now removes stale metadata
before setting an icon and verifies `fileicon test` afterward. Always pass a real
`.icns` file to `fileicon`; use `build-icon-pack.sh` to convert generated PNGs.

#### The icon changes in Applications but reverts in the Dock

The app is probably setting its running Dock icon itself. Ghostty does this and is
therefore marked with the `ghostty` apply method. For another app with the same
behavior, prefer that app's built-in custom-icon setting. Replacing resources inside
a signed `.app` and ad-hoc re-signing it can make Gatekeeper reject the app, so
BuddyDock never modifies application bundle contents.

For Ghostty 1.2 or newer, the equivalent manual configuration is:

```ini
macos-icon = custom
macos-custom-icon = /absolute/path/to/icon.icns
```

Ghostty also accepts PNG and JPEG files. Its custom setting changes the Dock and
app-switcher icon, while Finder continues to show the signed bundle icon.

#### An icon changes back after an application update

Many app updaters replace the entire application bundle and remove Finder custom
icons. Rerun `apply-icon-pack.sh`; it is designed to be repeatable. Ghostty's native
setting points to a stable copy outside the app bundle and normally survives updates.
BuddyDock stores the Finder icon state that existed before the first application of
each named pack under `~/Library/Application Support/BuddyDock/icon-pack-state`, so
restore can recover a previous custom icon instead of always returning to the bundled
default. If no saved state exists—for example, when restoring a pack applied by an
older BuddyDock version—the restore script leaves that app unchanged rather than
guessing which icon to remove.

#### An app is skipped

The `.icns` filename must match the installed bundle name exactly. For example, the
Codex desktop app is currently installed as `ChatGPT.app`, so its pack file is
`ChatGPT.icns`. Skipped apps are reported without stopping the rest of the pack.

#### The Dock still shows a cached icon

The scripts restart Finder and Dock once after all changes. If a verified icon is
still stale, remove that app from the Dock, apply the pack again, and add the app
back. Do not repeatedly clear global icon-service caches; that did not solve
Ghostty's runtime-icon behavior and can make unrelated icons rebuild slowly.

## Development

```sh
bun run check
bun run buddydock --help
```

The CLI automatically uses the optimized Swift inspector when it exists in `dist`; otherwise it runs the checked-in Swift source directly.
