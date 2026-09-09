import { Effect, Schema } from "effect"
import { ManifestError } from "./errors.ts"
import { rename, rm } from "node:fs/promises"

// Running from source, import.meta.url points into src/. Running as the compiled
// BuddyDock.app binary it points into a virtual bundle, so helpers live next to
// the executable instead.
export const isCompiledApp = process.execPath.endsWith("/Contents/MacOS/BuddyDock")
const executableDirectory = process.execPath.replace(/\/[^/]*$/, "")

export const resolveNativeHelper = (name: string, swiftSource: string) =>
  Effect.promise(async () => {
    const candidates = isCompiledApp
      ? [`${executableDirectory}/${name}`]
      : [new URL(`../dist/${name}`, import.meta.url).pathname]
    for (const candidate of candidates) if (await Bun.file(candidate).exists()) return [candidate]
    return ["swift", new URL(`../native/${swiftSource}`, import.meta.url).pathname]
  })

export const ensureDirectory = (path: string) =>
  Effect.tryPromise({
    try: () => Bun.$`mkdir -p ${path}`.quiet(),
    catch: (cause) => new ManifestError({ message: `Could not create directory: ${path}`, cause })
  })

export const writeJson = (path: string, value: unknown) =>
  Effect.tryPromise({
    try: async () => {
      const temporary = `${path}.${crypto.randomUUID()}.tmp`
      try {
        await Bun.write(temporary, `${JSON.stringify(value, null, 2)}\n`)
        await rename(temporary, path)
      } finally {
        await rm(temporary, { force: true })
      }
    },
    catch: (cause) => new ManifestError({ message: `Could not write ${path}`, cause })
  })

export const readJson = <A, I>(path: string, schema: Schema.Schema<A, I>) =>
  Effect.tryPromise({
    try: async () => JSON.parse(await Bun.file(path).text()) as unknown,
    catch: (cause) => new ManifestError({ message: `Could not read ${path}`, cause })
  }).pipe(
    Effect.flatMap(Schema.decodeUnknown(schema)),
    Effect.mapError((cause) =>
      cause instanceof ManifestError
        ? cause
        : new ManifestError({ message: `Invalid manifest: ${path}`, cause })
    )
  )
