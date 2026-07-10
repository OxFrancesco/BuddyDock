import { Effect, Schema } from "effect"
import { DockScanError } from "./errors.ts"
import { ensureDirectory, writeJson } from "./files.ts"
import { DockIcons, type ScanManifest } from "./model.ts"

export const scanDock = (outputDirectory: string) =>
  Effect.gen(function*() {
    if (process.platform !== "darwin") {
      return yield* new DockScanError({ message: "Dock scanning requires macOS" })
    }

    const iconDirectory = `${outputDirectory}/icons`
    yield* ensureDirectory(iconDirectory)

    const compiledInspector = new URL("../dist/buddydock-inspector", import.meta.url).pathname
    const sourceInspector = new URL("../native/DockInspector.swift", import.meta.url).pathname
    const inspector = yield* Effect.promise(async () =>
      await Bun.file(compiledInspector).exists() ? compiledInspector : sourceInspector
    )
    const command = inspector.endsWith(".swift")
      ? ["swift", inspector, iconDirectory]
      : [inspector, iconDirectory]

    const processResult = yield* Effect.tryPromise({
      try: async () => {
        const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).arrayBuffer(),
          new Response(child.stderr).text(),
          child.exited
        ])
        if (exitCode !== 0) throw new Error(stderr.trim() || `Inspector exited with code ${exitCode}`)
        return new Uint8Array(stdout)
      },
      catch: (cause) => new DockScanError({ message: "The native Dock inspector failed", cause })
    })

    const icons = yield* Schema.decodeUnknown(DockIcons)(JSON.parse(new TextDecoder().decode(processResult))).pipe(
      Effect.mapError((cause) => new DockScanError({ message: "The Dock inspector returned invalid data", cause }))
    )
    const manifest: ScanManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      icons
    }
    yield* writeJson(`${outputDirectory}/manifest.json`, manifest)
    return manifest
  })
