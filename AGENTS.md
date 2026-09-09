
<!-- codeview:start -->

## Reference codebases (codeview)

The `resources/` folder contains read-only clones of reference codebases.
If you need to implement code specific to one of these codebases, read the relevant
folder to gather information, feedback, patterns, and templates before writing code.

- `resources/ghostty` — Official Ghostty source: macOS native icon loading and configuration reload behavior
- `resources/effect` — Official Effect TypeScript monorepo — typed effects, concurrency, CLI, platform, and AI packages

<!-- codeview:end -->

## Applying artwork created elsewhere

- Use `buddydock import` for existing imagegen assets. Do not call `style` or `run` unless image generation through BuddyDock was requested.
- Imported Ghostty icons use `applyMethod: external`. Configure and reload Ghostty directly; keep it out of BuddyDock persistence.
- Verify stored icons with `status`, then verify the visible Dock. A running app can replace or cache its icon.
- Keep user-named active apps running. `--relaunch` requires exact `--app` selections and must not include an app with active work.
- Never replace or re-sign application resources to change an icon. If an app owned by the user overrides its icon at startup, fix that app's source and rebuild it normally.
- Run `bun run check` and `bun run build` before delivery. Native integration tests need normal macOS filesystem access for custom-icon metadata and `iconutil`.
