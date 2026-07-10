import { Effect, Schema } from "effect"
import { ManifestError } from "./errors.ts"

export const ensureDirectory = (path: string) =>
  Effect.tryPromise({
    try: () => Bun.$`mkdir -p ${path}`.quiet(),
    catch: (cause) => new ManifestError({ message: `Could not create directory: ${path}`, cause })
  })

export const writeJson = (path: string, value: unknown) =>
  Effect.tryPromise({
    try: () => Bun.write(path, `${JSON.stringify(value, null, 2)}\n`),
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
