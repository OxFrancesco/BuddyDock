import { Console, Effect, Schema } from "effect"
import { DockApplyError } from "./errors.ts"
import { readJson } from "./files.ts"
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

export const applyManifest = (options: ApplyOptions) =>
  Effect.gen(function*() {
    if (process.platform !== "darwin") {
      return yield* new DockApplyError({ message: "Applying Dock icons requires macOS" })
    }
    const manifest = yield* readJson(options.manifestPath, StyledManifest)
    const requests = manifest.icons.map((icon) => ({
      appPath: icon.appPath,
      iconPath: options.reset
        ? null
        : icon.styledIconPath.startsWith("/") ? icon.styledIconPath : `${process.cwd()}/${icon.styledIconPath}`
    }))

    const results = yield* runApplier(options.reset ? "reset" : "apply", requests)
    yield* Effect.forEach(results, (result, index) =>
      Console.log(
        `[${index + 1}/${results.length}] ${result.applied ? "ok  " : "FAIL"} ${manifest.icons[index]?.name ?? result.appPath}` +
          (result.error ? ` — ${result.error}` : "")
      ))

    if (options.restartDock) yield* restartDock
    return results
  })
