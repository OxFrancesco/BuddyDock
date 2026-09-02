import { Effect } from "effect"
import { DockApplyError } from "./errors.ts"

// Ghostty sets its own Dock icon at runtime through AppKit, so a Finder custom icon
// does not stick. It does expose a native setting for this, which is what we manage:
//   macos-icon = custom
//   macos-custom-icon = <path>
// This mirrors scripts/apply-icon-pack.sh so both paths share config and state files.

export const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty"

const MANAGED_MARKER = "# BuddyDock: managed Ghostty icon"
const ICON_SETTING = /^\s*macos-(custom-)?icon\s*=/

const configDirectory = () =>
  process.env.BUDDYDOCK_GHOSTTY_CONFIG_DIR ?? `${process.env.HOME}/Library/Application Support/com.mitchellh.ghostty`

const configFile = async (directory: string) =>
  process.env.BUDDYDOCK_GHOSTTY_CONFIG_FILE
    ?? (await Bun.file(`${directory}/config`).exists() ? `${directory}/config` : `${directory}/config.ghostty`)

const readLines = async (path: string) =>
  (await Bun.file(path).exists()) ? (await Bun.file(path).text()).split("\n") : []

const withoutIconSettings = (lines: ReadonlyArray<string>) =>
  lines.filter((line) => !line.trimStart().startsWith(MANAGED_MARKER) && !ICON_SETTING.test(line))

const trimTrailingBlank = (lines: ReadonlyArray<string>) => {
  const trimmed = [...lines]
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") trimmed.pop()
  return trimmed
}

const writeConfig = (path: string, lines: ReadonlyArray<string>) =>
  Bun.write(path, `${trimTrailingBlank(lines).join("\n")}\n`)

const fail = (message: string) => (cause: unknown) => new DockApplyError({ message, cause })

export const applyGhosttyIcon = (packName: string, iconPath: string) =>
  Effect.tryPromise({
    try: async () => {
      const directory = configDirectory()
      const config = await configFile(directory)
      const extension = iconPath.split(".").pop() ?? "png"
      const installedIcon = `${directory}/icons/buddydock-${packName}.${extension}`
      const stateFile = `${directory}/buddydock/${packName}.ghostty.previous`

      await Bun.$`mkdir -p ${`${directory}/icons`} ${`${directory}/buddydock`}`.quiet()
      const lines = await readLines(config)
      const desired = `macos-custom-icon = ${installedIcon}`
      const installedMatches = await Bun.file(installedIcon).exists()
        && Buffer.from(await Bun.file(installedIcon).arrayBuffer()).equals(Buffer.from(await Bun.file(iconPath).arrayBuffer()))
      if (installedMatches && lines.some((l) => l.trim() === "macos-icon = custom") && lines.some((l) => l.trim() === desired)) return config
      if (!(await Bun.file(stateFile).exists())) {
        await Bun.write(stateFile, lines.filter((line) => ICON_SETTING.test(line)).join("\n"))
      }
      await Bun.write(installedIcon, Bun.file(iconPath))
      await writeConfig(config, [
        ...trimTrailingBlank(withoutIconSettings(lines)),
        "",
        `${MANAGED_MARKER} for ${packName}`,
        "macos-icon = custom",
        `macos-custom-icon = ${installedIcon}`
      ])
      return config
    },
    catch: fail("Could not update Ghostty's native icon settings")
  })

export const resetGhosttyIcon = (packName: string) =>
  Effect.tryPromise({
    try: async () => {
      const directory = configDirectory()
      const config = await configFile(directory)
      const stateFile = `${directory}/buddydock/${packName}.ghostty.previous`
      if (!(await Bun.file(stateFile).exists())) return null

      const previous = (await Bun.file(stateFile).text()).split("\n").filter((line) => line.trim() !== "")
      await writeConfig(config, [...trimTrailingBlank(withoutIconSettings(await readLines(config))), ...previous])
      await Bun.$`rm -f ${stateFile}`.quiet()
      return config
    },
    catch: fail("Could not restore Ghostty's native icon settings")
  })
