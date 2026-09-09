import { Console, Effect } from "effect"
import { DockApplyError } from "./errors.ts"
import { isCompiledApp, readJson, writeJson } from "./files.ts"
import { StyledManifest } from "./model.ts"

// App updaters replace the whole .app bundle, which drops the Finder custom icon
// A launchd agent with WatchPaths on
// /Applications and every managed bundle re-runs `apply` whenever they change.

export const AGENT_LABEL = "ai.buddydock.persist"

const stateDirectory = () =>
  process.env.BUDDYDOCK_STATE_DIR ?? `${process.env.HOME}/Library/Application Support/BuddyDock`
export const activeManifestPath = () => `${stateDirectory()}/active-manifest.json`
const agentPlistPath = () => `${process.env.HOME}/Library/LaunchAgents/${AGENT_LABEL}.plist`
const logPath = () => `${stateDirectory()}/persist.log`

const fail = (message: string) => (cause: unknown) => new DockApplyError({ message, cause })

// The copy stores absolute icon paths because the agent runs without our cwd.
export const rememberActiveManifest = (manifestPath: string, successfulApps?: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const manifest = yield* readJson(manifestPath, StyledManifest)
    const absolute = (path: string) => path.startsWith("/") ? path : `${process.cwd()}/${path}`
    yield* Effect.tryPromise({
      try: () => Bun.$`mkdir -p ${stateDirectory()}`.quiet(),
      catch: fail("Could not create the BuddyDock state directory")
    })
    const existing = (yield* Effect.promise(() => Bun.file(activeManifestPath()).exists()))
      ? yield* readJson(activeManifestPath(), StyledManifest)
      : { ...manifest, icons: [] }
    const external = new Set(manifest.icons.filter((icon) => icon.applyMethod === "external").map((icon) => icon.appPath))
    const updated = manifest.icons.filter((icon) => icon.applyMethod !== "external" && (!successfulApps || successfulApps.includes(icon.appPath)))
    const replacementPaths = new Set(updated.map((icon) => icon.appPath))
    const retained = existing.icons.filter((icon) => !external.has(icon.appPath) && !replacementPaths.has(icon.appPath))
    const next = {
      ...manifest,
      icons: [...retained, ...updated.map((icon) => ({ ...icon, iconPath: absolute(icon.iconPath), styledIconPath: absolute(icon.styledIconPath) }))]
    }
    if (JSON.stringify(existing.icons) !== JSON.stringify(next.icons)) yield* writeJson(activeManifestPath(), next)
  })

export const forgetActiveManifest = (appPaths: ReadonlyArray<string>) => Effect.gen(function*() {
  if (!(yield* Effect.promise(() => Bun.file(activeManifestPath()).exists()))) return
  const active = yield* readJson(activeManifestPath(), StyledManifest)
  yield* writeJson(activeManifestPath(), { ...active, icons: active.icons.filter((icon) => !appPaths.includes(icon.appPath)) })
})

const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export const agentPlist = (options: {
  readonly executable: string
  readonly manifest: string
  readonly watchPaths: ReadonlyArray<string>
}) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(options.executable)}</string>
    <string>apply</string>
    <string>--manifest</string>
    <string>${xml(options.manifest)}</string>
    <string>--only-missing</string>
    <string>--no-restart</string>
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
  const executable = yield* appExecutable
  const plist = agentPlist({ executable, manifest, watchPaths })
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
  yield* Console.log("If the log shows \"write denied by macOS App Management\", run `buddydock grant-access` once.")
})

// macOS grants App Management to the executable that does the writing, so the
// agent runs the compiled BuddyDock.app rather than bun. That is what shows up in
// System Settings and what the user grants.
const appExecutable = Effect.gen(function*() {
  if (isCompiledApp) return process.execPath
  const bundled = new URL("../dist/BuddyDock.app/Contents/MacOS/BuddyDock", import.meta.url).pathname
  if (yield* Effect.promise(() => Bun.file(bundled).exists())) return bundled
  return yield* new DockApplyError({ message: "dist/BuddyDock.app is missing. Run `bun run build` first." })
})

const appBundle = (executable: string) => executable.replace(/\/Contents\/MacOS\/BuddyDock$/, "")

// TCC's per-user database is readable by the user; 2 = allowed, 0 = denied/off.
const appManagementStatus = Effect.promise(async () => {
  const db = `${process.env.HOME}/Library/Application Support/com.apple.TCC/TCC.db`
  const out = await Bun.$`sqlite3 ${db} ${"select auth_value from access where service='kTCCServiceSystemPolicyAppBundles' and client='ai.buddydock.cli'"}`.nothrow().quiet()
  const value = out.text().trim()
  return value === "" ? "missing" as const : value === "2" ? "allowed" as const : "off" as const
})

export const requestAppManagementAccess = Effect.gen(function*() {
  const bundle = appBundle(yield* appExecutable)
  const status = yield* appManagementStatus
  if (status === "allowed") {
    return yield* Console.log("BuddyDock already has App Management access.")
  }
  if (status === "off") {
    yield* Effect.tryPromise({
      try: () => Bun.$`open ${"x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles"}`.quiet(),
      catch: fail("Could not open System Settings")
    })
    return yield* Console.log("BuddyDock is already listed under App Management but switched off. Turn its toggle on.")
  }
  yield* Effect.tryPromise({
    try: async () => {
      await Bun.$`open ${"x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles"}`.quiet()
      const clip = Bun.spawn(["pbcopy"], { stdin: "pipe" })
      clip.stdin.write(bundle)
      clip.stdin.end()
      await clip.exited
    },
    catch: fail("Could not open System Settings")
  })
  yield* Console.log("Opened System Settings > Privacy & Security > App Management.")
  yield* Console.log(`BuddyDock.app's path is in your clipboard: ${bundle}`)
  yield* Console.log("Click +, press Cmd+Shift+G, paste, Enter, then Open, and make sure BuddyDock's toggle is on.")
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
