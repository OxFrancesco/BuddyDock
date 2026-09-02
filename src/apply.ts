import { Console, Effect, Schema } from "effect"
import { DockApplyError } from "./errors.ts"
import { applyGhosttyIcon, GHOSTTY_BUNDLE_ID, resetGhosttyIcon } from "./ghostty.ts"
import { readJson } from "./files.ts"
import { applyRuntimeIconResources, resetRuntimeIconResources, RUNTIME_ICON_RESOURCES } from "./overrides.ts"
import { StyledManifest } from "./model.ts"

const ApplyResult = Schema.Struct({
  appPath: Schema.String,
  applied: Schema.Boolean,
  error: Schema.optional(Schema.NullOr(Schema.String))
})
const ApplyResults = Schema.Array(ApplyResult)

export interface ApplyOptions {
  readonly manifestPath: string
  readonly reset: boolean
  readonly restartDock: boolean
  readonly relaunch: boolean
}

const resolveApplier = Effect.promise(async () => {
  const compiled = new URL("../dist/buddydock-applier", import.meta.url).pathname
  const source = new URL("../native/DockApplier.swift", import.meta.url).pathname
  return await Bun.file(compiled).exists() ? [compiled] : ["swift", source]
})

const runApplier = (mode: "apply" | "reset", requests: ReadonlyArray<{ appPath: string; iconPath: string | null }>) =>
  Effect.gen(function*() {
    const applier = yield* resolveApplier
    const stdout = yield* Effect.tryPromise({
      try: async () => {
        const child = Bun.spawn([...applier, mode], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
        child.stdin.write(JSON.stringify(requests))
        child.stdin.end()
        const [out, err, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited
        ])
        if (exitCode !== 0) throw new Error(err.trim() || `Applier exited with code ${exitCode}`)
        return out
      },
      catch: (cause) => new DockApplyError({ message: "The native Dock applier failed", cause })
    })
    return yield* Schema.decodeUnknown(ApplyResults)(JSON.parse(stdout)).pipe(
      Effect.mapError((cause) => new DockApplyError({ message: "The Dock applier returned invalid data", cause }))
    )
  })

export const restartDock = Effect.tryPromise({
  try: () => Bun.$`killall Dock`.quiet(),
  catch: (cause) => new DockApplyError({ message: "Could not restart the Dock", cause })
})

// A running app draws its Dock tile from memory, so a changed icon only shows after it relaunches.
const relaunchIfRunning = (appPath: string, bundleIdentifier: string | null) =>
  Effect.tryPromise({
    try: async () => {
      const running = bundleIdentifier
        ? (await Bun.$`pgrep -fq ${appPath}/Contents/MacOS/`.nothrow().quiet()).exitCode === 0
        : false
      if (!running) return false
      await Bun.$`osascript -e ${`tell application id "${bundleIdentifier}" to quit`}`.quiet()
      for (let i = 0; i < 50; i++) {
        if ((await Bun.$`pgrep -fq ${appPath}/Contents/MacOS/`.nothrow().quiet()).exitCode !== 0) break
        await Bun.sleep(200)
      }
      await Bun.$`open -g ${appPath}`.quiet()
      return true
    },
    catch: (cause) => new DockApplyError({ message: `Could not relaunch ${appPath}`, cause })
  })

export const applyManifest = (options: ApplyOptions) =>
  Effect.gen(function*() {
    if (process.platform !== "darwin") {
      return yield* new DockApplyError({ message: "Applying Dock icons requires macOS" })
    }
    const manifest = yield* readJson(options.manifestPath, StyledManifest)
    const absoluteManifest = options.manifestPath.startsWith("/") ? options.manifestPath : `${process.cwd()}/${options.manifestPath}`
    const packName = absoluteManifest.split("/").at(-2) ?? "styled-icons"
    const absolute = (path: string) => path.startsWith("/") ? path : `${process.cwd()}/${path}`
    const isGhostty = (icon: { bundleIdentifier: string | null }) => icon.bundleIdentifier === GHOSTTY_BUNDLE_ID

    const finderIcons = manifest.icons.filter((icon) => !isGhostty(icon))
    const finderResults = yield* runApplier(options.reset ? "reset" : "apply", finderIcons.map((icon) => ({
      appPath: icon.appPath,
      iconPath: options.reset ? null : absolute(icon.styledIconPath)
    })))
    const ghosttyResults = yield* Effect.forEach(manifest.icons.filter(isGhostty), (icon) =>
      (options.reset ? resetGhosttyIcon(packName) : applyGhosttyIcon(packName, absolute(icon.styledIconPath))).pipe(
        Effect.map((config) => ({
          appPath: icon.appPath,
          applied: config !== null,
          error: config === null ? "no saved Ghostty state for this pack; settings left unchanged" : `via Ghostty config ${config}`
        })),
        Effect.catchAll((e) => Effect.succeed({ appPath: icon.appPath, applied: false, error: e.message }))
      ))

    const runtimeNotes = yield* Effect.forEach(
      manifest.icons.filter((icon) => icon.bundleIdentifier !== null && icon.bundleIdentifier in RUNTIME_ICON_RESOURCES),
      (icon) =>
        (options.reset
          ? resetRuntimeIconResources(icon.appPath, icon.bundleIdentifier!)
          : applyRuntimeIconResources(icon.appPath, icon.bundleIdentifier!, absolute(icon.styledIconPath))).pipe(
            Effect.map((files) => [icon.appPath, `${options.reset ? "restored" : "patched"} ${files.length} bundle resource(s)`] as const),
            Effect.catchAll((e) => Effect.succeed([icon.appPath, e.message] as const))
          )
    )
    const noteFor = new Map(runtimeNotes)

    const results = manifest.icons.map((icon) => {
      const base = [...finderResults, ...ghosttyResults].find((r) => r.appPath === icon.appPath)
        ?? { appPath: icon.appPath, applied: false, error: "no result" }
      const note = noteFor.get(icon.appPath)
      return note ? { ...base, error: [base.error, note].filter(Boolean).join("; ") } : base
    })
    yield* Effect.forEach(results, (result, index) =>
      Console.log(
        `[${index + 1}/${results.length}] ${result.applied ? "ok  " : "FAIL"} ${manifest.icons[index]?.name ?? result.appPath}` +
          (result.error ? ` — ${result.error}` : "")
      ))

    if (options.relaunch) {
      yield* Effect.forEach(manifest.icons.filter((_, i) => results[i]?.applied), (icon) =>
        relaunchIfRunning(icon.appPath, icon.bundleIdentifier).pipe(
          Effect.tap((relaunched) => relaunched ? Console.log(`Relaunched ${icon.name}`) : Effect.void)
        ), { concurrency: 1 })
    }
    if (options.restartDock) yield* restartDock
    return results
  })
