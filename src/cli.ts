#!/usr/bin/env bun

import { Command, Options } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Console, Effect, Option } from "effect"
import { scanDock } from "./dock.ts"
import { FalGateway } from "./fal.ts"
import { defaultIconPackDirectory, reapplyIconPack } from "./icon-pack.ts"
import { styleManifest } from "./style.ts"

const output = Options.directory("output").pipe(Options.withAlias("o"))
const scanOutput = output.pipe(Options.withDefault(".buddydock/scan"))
const runScanOutput = Options.directory("scan-output").pipe(Options.withDefault(".buddydock/scan"))
const theme = Options.text("theme").pipe(Options.withAlias("t"), Options.withDefault("candy cotton"))
const quality = Options.choice("quality", ["low", "medium", "high"] as const).pipe(Options.withDefault("medium"))
const keepBackground = Options.boolean("keep-background")
const limit = Options.integer("limit").pipe(Options.optional)
const pack = Options.directory("pack").pipe(
  Options.withAlias("p"),
  Options.withDefault(defaultIconPackDirectory)
)
const applicationsDirectory = Options.directory("applications-directory").pipe(
  Options.withAlias("a"),
  Options.withDefault("/Applications")
)
const useSudo = Options.boolean("sudo")

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
  keepBackground,
  limit
}, ({ manifest, output, theme, quality, keepBackground, limit }) =>
  styleManifest({
    manifestPath: manifest,
    outputDirectory: output,
    theme,
    quality,
    removeBackground: !keepBackground,
    limit: Option.getOrUndefined(limit)
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
  keepBackground,
  limit
}, ({ scanOutput, output, theme, quality, keepBackground, limit }) =>
  Effect.gen(function*() {
    const scan = yield* scanDock(scanOutput)
    const result = yield* styleManifest({
      manifestPath: `${scanOutput}/manifest.json`,
      outputDirectory: output,
      theme,
      quality,
      removeBackground: !keepBackground,
      limit: Option.getOrUndefined(limit)
    })
    yield* Console.log(`Exported ${scan.icons.length} icons and styled ${result.icons.length} in ${output}`)
  })
).pipe(Command.withDescription("Scan the Dock and style its icons in one command"))

const reapply = Command.make("reapply", {
  pack,
  applicationsDirectory,
  useSudo
}, ({ pack, applicationsDirectory, useSudo }) =>
  reapplyIconPack({
    packDirectory: pack,
    applicationsDirectory,
    useSudo
  })
).pipe(Command.withDescription("Reapply a saved icon pack and refresh the Dock"))

const root = Command.make("buddydock").pipe(
  Command.withDescription("Create cohesive, AI-styled versions of your macOS Dock icons"),
  Command.withSubcommands([scan, style, run, reapply])
)

const cli = Command.run(root, { name: "BuddyDock", version: "0.1.0" })

Effect.suspend(() => cli(process.argv)).pipe(
  Effect.provide(FalGateway.live),
  Effect.provide(BunContext.layer),
  BunRuntime.runMain
)
