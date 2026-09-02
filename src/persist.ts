import { Console, Effect } from "effect"
import { DockApplyError } from "./errors.ts"
import { readJson, writeJson } from "./files.ts"
import { StyledManifest } from "./model.ts"

// App updaters replace the whole .app bundle, which drops the Finder custom icon
// and any patched runtime resources. A launchd agent with WatchPaths on
// /Applications and every managed bundle re-runs `apply` whenever they change.

export const AGENT_LABEL = "ai.buddydock.persist"

const stateDirectory = () =>
  process.env.BUDDYDOCK_STATE_DIR ?? `${process.env.HOME}/Library/Application Support/BuddyDock`
export const activeManifestPath = () => `${stateDirectory()}/active-manifest.json`
const agentPlistPath = () => `${process.env.HOME}/Library/LaunchAgents/${AGENT_LABEL}.plist`
const logPath = () => `${stateDirectory()}/persist.log`

const fail = (message: string) => (cause: unknown) => new DockApplyError({ message, cause })

// The copy stores absolute icon paths because the agent runs without our cwd.
export const rememberActiveManifest = (manifestPath: string) =>
  Effect.gen(function*() {
    const manifest = yield* readJson(manifestPath, StyledManifest)
    const absolute = (path: string) => path.startsWith("/") ? path : `${process.cwd()}/${path}`
    yield* Effect.tryPromise({
      try: () => Bun.$`mkdir -p ${stateDirectory()}`.quiet(),
      catch: fail("Could not create the BuddyDock state directory")
    })
    yield* writeJson(activeManifestPath(), {
      ...manifest,
      icons: manifest.icons.map((icon) => ({ ...icon, iconPath: absolute(icon.iconPath), styledIconPath: absolute(icon.styledIconPath) }))
    })
  })

export const forgetActiveManifest = Effect.tryPromise({
  try: () => Bun.$`rm -f ${activeManifestPath()}`.quiet(),
  catch: fail("Could not clear the active manifest")
})

const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export const agentPlist = (options: {
  readonly bun: string
  readonly cli: string
  readonly manifest: string
  readonly watchPaths: ReadonlyArray<string>
}) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(options.bun)}</string>
    <string>${xml(options.cli)}</string>
    <string>apply</string>
    <string>--manifest</string>
    <string>${xml(options.manifest)}</string>
    <string>--only-missing</string>
  </array>
  <key>WatchPaths</key>
  <array>
${options.watchPaths.map((p) => `    <string>${xml(p)}</string>`).join("\n")}
  </array>
  <key>ThrottleInterval</key><integer>20</integer>
  <key>StandardOutPath</key><string>${xml(logPath())}</string>
  <key>StandardErrorPath</key><string>${xml(logPath())}</string>
</dict>
</plist>
`

export const installAgent = Effect.gen(function*() {
  const manifest = activeManifestPath()
  if (!(yield* Effect.promise(() => Bun.file(manifest).exists()))) {
    return yield* new DockApplyError({ message: "No active manifest. Run `buddydock apply --manifest <file>` first." })
  }
  const styled = yield* readJson(manifest, StyledManifest)
  const watchPaths = ["/Applications", ...styled.icons.flatMap((icon) => [icon.appPath, `${icon.appPath}/Contents`])]
  const plist = agentPlist({
    bun: process.execPath,
    cli: new URL("./cli.ts", import.meta.url).pathname,
    manifest,
    watchPaths
  })
  const path = agentPlistPath()
  yield* Effect.tryPromise({
    try: async () => {
      await Bun.$`mkdir -p ${stateDirectory()} ${`${process.env.HOME}/Library/LaunchAgents`}`.quiet()
      await Bun.$`launchctl bootout gui/${process.getuid!()}/${AGENT_LABEL}`.nothrow().quiet()
      await Bun.write(path, plist)
      await Bun.$`launchctl bootstrap gui/${process.getuid!()} ${path}`.quiet()
    },
    catch: fail("Could not install the launchd agent")
  })
  yield* Console.log(`Installed ${AGENT_LABEL}: watching ${watchPaths.length} paths, re-applying ${styled.icons.length} icons on change`)
  yield* Console.log(`Log: ${logPath()}`)
})

export const uninstallAgent = Effect.gen(function*() {
  const path = agentPlistPath()
  yield* Effect.tryPromise({
    try: async () => {
      await Bun.$`launchctl bootout gui/${process.getuid!()}/${AGENT_LABEL}`.nothrow().quiet()
      await Bun.$`rm -f ${path}`.quiet()
    },
    catch: fail("Could not remove the launchd agent")
  })
  yield* Console.log(`Removed ${AGENT_LABEL}`)
})
