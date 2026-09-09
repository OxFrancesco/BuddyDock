import { Console, Effect, Schema } from "effect"
import { DockApplyError } from "./errors.ts"
import { applyGhosttyIcon, GHOSTTY_BUNDLE_ID, resetGhosttyIcon } from "./ghostty.ts"
import { readJson, resolveNativeHelper } from "./files.ts"
import { StyledManifest, type StyledIcon } from "./model.ts"
import { forgetActiveManifest, rememberActiveManifest } from "./persist.ts"
import { basename, dirname, resolve } from "node:path"

const ApplyResult = Schema.Struct({
  appPath: Schema.String,
  applied: Schema.Boolean,
  error: Schema.optional(Schema.NullOr(Schema.String)),
  running: Schema.Boolean,
  changed: Schema.Boolean
})
const ApplyResults = Schema.Array(ApplyResult)
export type ApplyResult = typeof ApplyResult.Type

export interface ApplyOptions {
  readonly manifestPath: string
  readonly reset: boolean
  readonly restartDock: boolean
  readonly relaunch: boolean
  readonly onlyMissing?: boolean
  readonly apps?: ReadonlyArray<string>
}

const resolveApplier = resolveNativeHelper("buddydock-applier", "DockApplier.swift")

export const runApplier = (mode: "apply" | "apply-missing" | "reset" | "status" | "relaunch", requests: ReadonlyArray<{ appPath: string; iconPath: string | null }>) =>
  Effect.gen(function*() {
    if (requests.length === 0) return []
    const applier = yield* resolveApplier
    const stdout = yield* Effect.tryPromise({
      try: async () => {
        const child = Bun.spawn([...applier, mode], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
        child.stdin.write(JSON.stringify(requests))
        child.stdin.end()
        const [out, err, exitCode] = await Promise.all([
          new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
        ])
        if (exitCode !== 0) throw new Error(err.trim() || `Applier exited with code ${exitCode}`)
        return JSON.parse(out) as unknown
      },
      catch: (cause) => new DockApplyError({ message: "The native Dock applier failed. Run bun run build after updating BuddyDock.", cause })
    })
    return yield* Schema.decodeUnknown(ApplyResults)(stdout).pipe(
      Effect.mapError((cause) => new DockApplyError({ message: "The Dock applier returned invalid data. Run bun run build.", cause }))
    )
  })

export const restartDock = Effect.tryPromise({
  try: () => Bun.$`killall Dock`.quiet(),
  catch: (cause) => new DockApplyError({ message: "Could not restart the Dock", cause })
})

export const applyMethod = (icon: StyledIcon) =>
  icon.applyMethod ?? (icon.bundleIdentifier === GHOSTTY_BUNDLE_ID ? "ghostty" : "finder")

export const selectIcons = (icons: ReadonlyArray<StyledIcon>, apps: ReadonlyArray<string> = []) => {
  for (const app of apps) {
    if (!icons.some((icon) => icon.name === app || icon.appPath === app)) {
      throw new Error(`App is not in this manifest: ${app}`)
    }
  }
  return apps.length === 0 ? icons : icons.filter((icon) => apps.includes(icon.name) || apps.includes(icon.appPath))
}

const selectedIcons = (icons: ReadonlyArray<StyledIcon>, apps?: ReadonlyArray<string>) => Effect.try({
  try: () => selectIcons(icons, apps),
  catch: (cause) => new DockApplyError({ message: String(cause), cause })
})

export const requireSuccess = (results: ReadonlyArray<ApplyResult>) => {
  const failures = results.filter((result) => !result.applied)
  return failures.length === 0 ? Effect.void : Effect.fail(new DockApplyError({
    message: `${failures.length} icon operation(s) failed. Successful icons were kept; retry only the listed apps.`
  }))
}

export const applyManifest = (options: ApplyOptions) =>
  Effect.gen(function*() {
    if (process.platform !== "darwin") {
      return yield* new DockApplyError({ message: "Applying Dock icons requires macOS" })
    }
    const manifest = yield* readJson(options.manifestPath, StyledManifest)
    const icons = yield* selectedIcons(manifest.icons, options.apps)
    if (options.relaunch && !options.apps?.length) {
      return yield* new DockApplyError({ message: "--relaunch requires --app <name>. Select only apps that are safe to close." })
    }
    const managed = icons.filter((icon) => applyMethod(icon) !== "external")
    for (const icon of icons.filter((icon) => applyMethod(icon) === "external")) {
      yield* Console.log(`External: ${icon.name}. Use its native settings with ${icon.styledIconPath}; BuddyDock did not change or relaunch it.`)
    }
    const finder = managed.filter((icon) => applyMethod(icon) === "finder")
    const results: ApplyResult[] = [...yield* runApplier(options.reset ? "reset" : options.onlyMissing ? "apply-missing" : "apply", finder.map((icon) => ({
      appPath: icon.appPath, iconPath: options.reset ? null : icon.styledIconPath
    })))]

    const packName = basename(dirname(resolve(options.manifestPath)))
    for (const icon of managed.filter((icon) => applyMethod(icon) === "ghostty")) {
      const native = yield* (options.reset ? resetGhosttyIcon(packName) : applyGhosttyIcon(packName, icon.styledIconPath)).pipe(
        Effect.map((config): ApplyResult => ({
          appPath: icon.appPath, applied: config !== null, changed: config !== null, running: false,
          error: config === null ? "no saved Ghostty settings" : `native config saved at ${config}; reload Ghostty with Command+Shift+Comma`
        })),
        Effect.catchAll((e) => Effect.succeed<ApplyResult>({ appPath: icon.appPath, applied: false, changed: false, running: false, error: e.message }))
      )
      results.push(native)
    }

    if (options.relaunch) {
      const toRelaunch = results.filter((result) => result.applied && result.running)
      const relaunched = yield* runApplier("relaunch", toRelaunch.map((result) => ({ appPath: result.appPath, iconPath: null })))
      for (const result of relaunched) {
        const index = results.findIndex((entry) => entry.appPath === result.appPath)
        if (!result.applied) results[index] = { ...results[index]!, applied: false, error: result.error }
        else yield* Console.log(`Reopened ${result.appPath}. Verify its Dock tile visually.`)
      }
    }
    for (const result of results) {
      const name = managed.find((icon) => icon.appPath === result.appPath)!.name
      yield* Console.log(`${result.applied ? "Stored" : "FAILED"}: ${name}${result.error ? `. ${result.error}` : ""}`)
      if (result.applied && result.running && !options.relaunch && !options.onlyMissing) {
        yield* Console.log(`  ${name} is running; its Dock tile may stay cached until the app is reopened. No app was closed.`)
      }
    }
    if (options.reset) yield* forgetActiveManifest(results.filter((result) => result.applied).map((result) => result.appPath))
    else yield* rememberActiveManifest(options.manifestPath, results.filter((result) => result.applied).map((result) => result.appPath))
    if (options.restartDock && results.some((result) => result.changed)) yield* restartDock
    return results
  })

export const statusManifest = (manifestPath: string, apps: ReadonlyArray<string> = []) =>
  Effect.gen(function*() {
    const manifest = yield* readJson(manifestPath, StyledManifest)
    const icons = yield* selectedIcons(manifest.icons, apps)
    const results = yield* runApplier("status", icons.map((icon) => ({ appPath: icon.appPath, iconPath: null })))
    for (const icon of icons) {
      const result = results.find((entry) => entry.appPath === icon.appPath)!
      const method = applyMethod(icon)
      const storage = method === "finder" ? result.applied ? "custom icon stored" : "custom icon missing" : `${method} native settings; Finder metadata is not proof of the Dock icon`
      yield* Console.log(`${icon.name}: ${storage}; ${result.running ? "running" : "not running"}`)
    }
    yield* Console.log("Status checks stored metadata and running processes. Verify the visible Dock separately.")
    return results
  })
