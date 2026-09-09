#!/usr/bin/env bun

import { Command, Options } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Console, Effect, Option } from "effect"
import { applyManifest, requireSuccess, statusManifest } from "./apply.ts"
import { importIcons } from "./import.ts"
import { scanDock } from "./dock.ts"
import { FalGateway } from "./fal.ts"
import { defaultIconPackDirectory, reapplyIconPack } from "./icon-pack.ts"
import { installAgent, requestAppManagementAccess, uninstallAgent } from "./persist.ts"
import { styleManifest } from "./style.ts"

const output = Options.directory("output").pipe(Options.withAlias("o"))
const scanOutput = output.pipe(Options.withDefault(".buddydock/scan"))
const runScanOutput = Options.directory("scan-output").pipe(Options.withDefault(".buddydock/scan"))
const theme = Options.text("theme").pipe(Options.withAlias("t"), Options.withDefault("candy cotton"))
const quality = Options.choice("quality", ["low", "medium", "high"] as const).pipe(Options.withDefault("medium"))
const removeBackground = Options.boolean("remove-background")
const limit = Options.integer("limit").pipe(Options.optional)
const resume = Options.boolean("resume").pipe(Options.withDescription("Reuse icons already present in the output directory instead of regenerating them"))
const pack = Options.directory("pack").pipe(
  Options.withAlias("p"),
  Options.withDefault(defaultIconPackDirectory)
)
const applicationsDirectory = Options.directory("applications-directory").pipe(
  Options.withAlias("a"),
  Options.withDefault("/Applications")
)
const useSudo = Options.boolean("sudo")
const apps = Options.text("app").pipe(Options.repeated, Options.withDescription("Select an exact app name or path; repeat to select multiple apps"))

const importCommand = Command.make("import", {
  manifest: Options.file("manifest").pipe(Options.withAlias("m")),
  output
}, ({ manifest, output }) => importIcons(manifest, output).pipe(
  Effect.flatMap((result) => Console.log(`Imported ${result.icons.length} existing images into ${output}. No images were generated.\nApply: buddydock apply --manifest ${output}/manifest.json\nCheck: buddydock status --manifest ${output}/manifest.json`)),
  Effect.asVoid
)).pipe(Command.withDescription("Package externally generated images for application without calling an image provider"))

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
const relaunch = Options.boolean("relaunch").pipe(Options.withDescription("Quit and reopen only apps explicitly selected with --app; never force-quit"))
const onlyMissing = Options.boolean("only-missing").pipe(Options.withDescription("Repair missing or stale icons; skip apps whose stored artwork already matches the manifest"))

const summarize = (label: string) => (results: ReadonlyArray<{ applied: boolean }>) =>
  Console.log(`${label} ${results.filter((r) => r.applied).length}/${results.length} app icons`)

const apply = Command.make("apply", { manifest: styledManifest, noRestart, relaunch, onlyMissing, apps }, ({ manifest, noRestart, relaunch, onlyMissing, apps }) =>
  applyManifest({ manifestPath: manifest, reset: false, restartDock: !noRestart, relaunch, onlyMissing, apps }).pipe(
    Effect.tap(summarize("Stored")),
    Effect.flatMap(requireSuccess),
    Effect.asVoid
  )
).pipe(Command.withDescription("Set the styled icons from a manifest as custom icons on the Dock apps"))

const reset = Command.make("reset", { manifest: styledManifest, noRestart, relaunch, apps }, ({ manifest, noRestart, relaunch, apps }) =>
  applyManifest({ manifestPath: manifest, reset: true, restartDock: !noRestart, relaunch, apps }).pipe(
    Effect.tap(summarize("Restored")),
    Effect.flatMap(requireSuccess),
    Effect.asVoid
  )
).pipe(Command.withDescription("Remove custom icons from the apps in a manifest, restoring the originals"))

const status = Command.make("status", { manifest: styledManifest, apps }, ({ manifest, apps }) =>
  statusManifest(manifest, apps).pipe(Effect.asVoid)
).pipe(Command.withDescription("Check stored custom icons and running apps without modifying them"))

const reapply = Command.make("reapply", {
  pack,
  applicationsDirectory,
  useSudo,
  apps
}, ({ pack, applicationsDirectory, useSudo, apps }) =>
  reapplyIconPack({
    packDirectory: pack,
    applicationsDirectory,
    useSudo,
    apps
  })
).pipe(Command.withDescription("Reapply a saved icon pack and refresh the Dock"))

const persist = Command.make("persist", {}, () => installAgent).pipe(
  Command.withDescription("Install a launchd agent that re-applies the last applied manifest whenever an app is updated")
)

const unpersist = Command.make("unpersist", {}, () => uninstallAgent).pipe(
  Command.withDescription("Remove the launchd agent installed by persist")
)

const grantAccess = Command.make("grant-access", {}, () => requestAppManagementAccess).pipe(
  Command.withDescription("Open the App Management privacy pane with the bun path ready to paste, so the persist agent may write inside app bundles")
)

const root = Command.make("buddydock").pipe(
  Command.withDescription("Create cohesive, AI-styled versions of your macOS Dock icons"),
    Command.withSubcommands([scan, style, run, importCommand, apply, reset, status, reapply, persist, unpersist, grantAccess])
)

const cli = Command.run(root, { name: "BuddyDock", version: "0.1.0" })

Effect.suspend(() => cli(process.argv)).pipe(
  Effect.provide(FalGateway.live),
  Effect.provide(BunContext.layer),
  BunRuntime.runMain
)
