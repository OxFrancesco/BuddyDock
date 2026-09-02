#!/usr/bin/env bun

import { Command, Options } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Console, Effect, Option } from "effect"
import { applyManifest } from "./apply.ts"
import { scanDock } from "./dock.ts"
import { FalGateway } from "./fal.ts"
import { styleManifest } from "./style.ts"

const output = Options.directory("output").pipe(Options.withAlias("o"))
const scanOutput = output.pipe(Options.withDefault(".buddydock/scan"))
const runScanOutput = Options.directory("scan-output").pipe(Options.withDefault(".buddydock/scan"))
const theme = Options.text("theme").pipe(Options.withAlias("t"), Options.withDefault("candy cotton"))
const quality = Options.choice("quality", ["low", "medium", "high"] as const).pipe(Options.withDefault("medium"))
const removeBackground = Options.boolean("remove-background")
const limit = Options.integer("limit").pipe(Options.optional)
const resume = Options.boolean("resume").pipe(Options.withDescription("Reuse icons already present in the output directory instead of regenerating them"))

const scan = Command.make("scan", { output: scanOutput }, ({ output }) =>
  scanDock(output).pipe(
    Effect.flatMap((manifest) => Console.log(`Exported ${manifest.icons.length} Dock icons to ${output}`)),
    Effect.asVoid
  )
).pipe(Command.withDescription("Export pinned macOS Dock icons and a manifest"))

const style = Command.make("style", {
  manifest: Options.file("manifest").pipe(Options.withAlias("m"), Options.withDefault(".buddydock/scan/manifest.json")),
  output: output.pipe(Options.withDefault("styled-icons")),
  theme,
  quality,
  removeBackground,
  limit,
  resume
}, ({ manifest, output, theme, quality, removeBackground, limit, resume }) =>
  styleManifest({
    manifestPath: manifest,
    outputDirectory: output,
    theme,
    quality,
    removeBackground,
    limit: Option.getOrUndefined(limit),
    resume
  }).pipe(
    Effect.flatMap((result) => Console.log(`Created ${result.icons.length} styled icons in ${output}`)),
    Effect.asVoid
  )
).pipe(Command.withDescription("Restyle icons from a scan manifest with fal.ai"))

const run = Command.make("run", {
  scanOutput: runScanOutput,
  output: output.pipe(Options.withDefault("styled-icons")),
  theme,
  quality,
  removeBackground,
  limit
}, ({ scanOutput, output, theme, quality, removeBackground, limit }) =>
  Effect.gen(function*() {
    const scan = yield* scanDock(scanOutput)
    const result = yield* styleManifest({
      manifestPath: `${scanOutput}/manifest.json`,
      outputDirectory: output,
      theme,
      quality,
      removeBackground,
      limit: Option.getOrUndefined(limit)
    })
    yield* Console.log(`Exported ${scan.icons.length} icons and styled ${result.icons.length} in ${output}`)
  })
).pipe(Command.withDescription("Scan the Dock and style its icons in one command"))

const styledManifest = Options.file("manifest").pipe(Options.withAlias("m"), Options.withDefault("styled-icons/manifest.json"))
const noRestart = Options.boolean("no-restart")
const relaunch = Options.boolean("relaunch").pipe(Options.withDescription("Quit and reopen running apps so their Dock tile picks up the new icon"))

const summarize = (label: string) => (results: ReadonlyArray<{ applied: boolean }>) =>
  Console.log(`${label} ${results.filter((r) => r.applied).length}/${results.length} app icons`)

const apply = Command.make("apply", { manifest: styledManifest, noRestart, relaunch }, ({ manifest, noRestart, relaunch }) =>
  applyManifest({ manifestPath: manifest, reset: false, restartDock: !noRestart, relaunch }).pipe(
    Effect.flatMap(summarize("Applied")),
    Effect.asVoid
  )
).pipe(Command.withDescription("Set the styled icons from a manifest as custom icons on the Dock apps"))

const reset = Command.make("reset", { manifest: styledManifest, noRestart, relaunch }, ({ manifest, noRestart, relaunch }) =>
  applyManifest({ manifestPath: manifest, reset: true, restartDock: !noRestart, relaunch }).pipe(
    Effect.flatMap(summarize("Restored")),
    Effect.asVoid
  )
).pipe(Command.withDescription("Remove custom icons from the apps in a manifest, restoring the originals"))

const root = Command.make("buddydock").pipe(
  Command.withDescription("Create cohesive, AI-styled versions of your macOS Dock icons"),
  Command.withSubcommands([scan, style, run, apply, reset])
)

const cli = Command.run(root, { name: "BuddyDock", version: "0.1.0" })

Effect.suspend(() => cli(process.argv)).pipe(
  Effect.provide(FalGateway.live),
  Effect.provide(BunContext.layer),
  BunRuntime.runMain
)
