import { Console, Effect } from "effect"
import { ensureDirectory, readJson, writeJson } from "./files.ts"
import { FalGateway } from "./fal.ts"
import { ScanManifest, type StyledIcon, type StyledManifest } from "./model.ts"

export interface StyleOptions {
  readonly manifestPath: string
  readonly outputDirectory: string
  readonly theme: string
  readonly quality: "low" | "medium" | "high"
  readonly removeBackground: boolean
  readonly limit?: number
}

export const stylePrompt = (name: string, theme: string) =>
  `Restyle this ${name} macOS app icon in a cohesive ${theme} aesthetic. ` +
  "Preserve its core silhouette and recognizable brand cues, centered and occupying about 60% of the frame. " +
  "Fill the ENTIRE square canvas edge to edge with a solid, opaque, high-contrast themed background — no transparency, " +
  "no white margins, no rounded tile, no drop shadow outside the artwork; the rounded corners are added later. " +
  "Use polished, production-quality materials and lighting. Do not add words, letters, watermarks, or borders."

const resolveSquircle = Effect.promise(async () => {
  const compiled = new URL("../dist/buddydock-squircle", import.meta.url).pathname
  const source = new URL("../native/Squircle.swift", import.meta.url).pathname
  return await Bun.file(compiled).exists() ? [compiled] : ["swift", source]
})

const squircle = (inputPath: string, outputPath: string) =>
  Effect.gen(function*() {
    const tool = yield* resolveSquircle
    yield* Effect.tryPromise({
      try: async () => {
        const child = Bun.spawn([...tool, inputPath, outputPath], { stdout: "ignore", stderr: "pipe" })
        const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
        if (exitCode !== 0) throw new Error(stderr.trim() || `Squircle exited with code ${exitCode}`)
      },
      catch: (cause) => new Error(`Could not mask ${inputPath}: ${String(cause)}`)
    })
  })

export const styleManifest = (options: StyleOptions) =>
  Effect.gen(function*() {
    const gateway = yield* FalGateway
    const manifest = yield* readJson(options.manifestPath, ScanManifest)
    yield* ensureDirectory(options.outputDirectory)
    const selected = options.limit === undefined ? manifest.icons : manifest.icons.slice(0, options.limit)

    const icons = yield* Effect.forEach(selected, (icon, index) =>
      Effect.gen(function*() {
        yield* Console.log(`[${index + 1}/${selected.length}] Styling ${icon.name}`)
        const bytes = yield* gateway.style({
          imagePath: icon.iconPath,
          prompt: stylePrompt(icon.name, options.theme),
          quality: options.quality,
          removeBackground: options.removeBackground
        })
        const fileName = `${String(index + 1).padStart(2, "0")}-${icon.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`
        const styledIconPath = `${options.outputDirectory}/${fileName}`
        const rawIconPath = `${options.outputDirectory}/raw/${fileName}`
        yield* Effect.tryPromise({
          try: () => Bun.write(rawIconPath, bytes),
          catch: (cause) => new Error(`Could not write ${rawIconPath}: ${String(cause)}`)
        })
        yield* squircle(rawIconPath, styledIconPath)
        return {
          ...icon,
          styledIconPath,
          theme: options.theme,
          editModel: "openai/gpt-image-2/edit",
          backgroundModel: options.removeBackground ? "fal-ai/birefnet/v2" : "none"
        } satisfies StyledIcon
      }), { concurrency: 1 })

    const styledManifest: StyledManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      theme: options.theme,
      icons
    }
    yield* writeJson(`${options.outputDirectory}/manifest.json`, styledManifest)
    return styledManifest
  })
