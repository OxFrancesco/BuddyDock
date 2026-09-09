# Black and white claymation icons

Eleven icons recreated with the built-in imagegen tool on September 9, 2026.
The PNGs retain transparent backgrounds. Neutral gray shading gives the black and
white clay its depth. Cap uses its original concentric-ring symbol.

The pack includes Tailscale, Helium, Telegram, Ghostty, Grok Bot, Liny, T3 Code
Nightly, Beeper Desktop, Superhuman, Notion Calendar, and Cap.

Run `buddydock reapply` to apply this default pack. It applies ten Finder-managed
icons and leaves Ghostty to its native settings. Running apps can keep a cached
Dock tile until reopened. Do not close apps with active work.

For Tailscale, run `buddydock reapply --app Tailscale --sudo` in an interactive
terminal to enter the administrator password.

For Ghostty, set `macos-icon = custom` and point `macos-custom-icon` at the absolute
path of `png/04.png`, then reload with Command+Shift+Comma.

`import.json` maps apps to PNGs for rebuilding a pack with `buddydock import`.
`prompts.json` records the imagegen prompts, including corrections for transparency
and neutral whites. All visual changes used imagegen. BuddyDock only converted the
finished PNGs to the required sizes and ICNS format.
