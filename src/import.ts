import { Effect } from "effect"
import { mkdir, mkdtemp, realpath, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { IconPackError } from "./errors.ts"
import { readJson } from "./files.ts"
import { ImportManifest, type StyledManifest } from "./model.ts"

const run = async (argv: string[]) => {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
  ])
  if (code !== 0) throw new Error(`${argv[0]} failed: ${err.trim() || out.trim()}`)
  return out
}

export const importIcons = (manifestPath: string, outputDirectory: string) =>
  Effect.gen(function*() {
    const input = yield* readJson(manifestPath, ImportManifest)
    return yield* Effect.tryPromise({
      try: async () => {
        const output = resolve(outputDirectory)
        if (await stat(output).then(() => true, (e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") return false
          throw e
        })) throw new Error(`Output already exists: ${output}. Use a new pack directory.`)

        const seen = new Set<string>()
        const sources = await Promise.all(input.icons.map(async (entry) => {
          const appPath = await realpath(resolve(dirname(resolve(manifestPath)), entry.appPath))
          if (!appPath.endsWith(".app") || !(await stat(appPath)).isDirectory()) {
            throw new Error(`Expected an application bundle: ${appPath}`)
          }
          if (seen.has(appPath)) throw new Error(`Duplicate application: ${appPath}`)
          seen.add(appPath)
          const name = basename(appPath, ".app")
          if (/[\t\r\n]/.test(name)) throw new Error(`Unsupported application name: ${name}`)
          const bundleIdentifier = (await run(["/usr/libexec/PlistBuddy", "-c", "Print :CFBundleIdentifier", join(appPath, "Contents/Info.plist")])).trim()
          const imagePath = await realpath(resolve(dirname(resolve(manifestPath)), entry.imagePath))
          const info = await run(["/usr/bin/sips", "-g", "pixelWidth", "-g", "pixelHeight", imagePath])
          const width = Number(info.match(/pixelWidth:\s*(\d+)/)?.[1])
          const height = Number(info.match(/pixelHeight:\s*(\d+)/)?.[1])
          if (!width || width !== height || width < 16 || width > 8192) {
            throw new Error(`Icon must be a readable square image between 16 and 8192 pixels: ${imagePath}`)
          }
          const applyMethod = entry.applyMethod ?? (bundleIdentifier === "com.mitchellh.ghostty" ? "external" : "finder")
          if (bundleIdentifier === "com.mitchellh.ghostty" && applyMethod !== "external") {
            throw new Error("Ghostty imports use its native configuration. Set applyMethod to external.")
          }
          return { appPath, name, bundleIdentifier, imagePath, applyMethod }
        }))
        const names = sources.map((entry) => entry.name)
        if (new Set(names).size !== names.length) throw new Error("Application names must be unique within a pack.")

        await mkdir(dirname(output), { recursive: true })
        const staging = await mkdtemp(join(dirname(output), ".buddydock-import-"))
        try {
          await mkdir(join(staging, "png"))
          const icons: StyledManifest["icons"][number][] = []
          const rows: string[] = []
          for (const [index, source] of sources.entries()) {
            const pngName = `${String(index + 1).padStart(2, "0")}.png`
            const png = join(staging, "png", pngName)
            await run(["/usr/bin/sips", "-s", "format", "png", "-z", "1024", "1024", source.imagePath, "--out", png])
            let styledIconPath = join(output, "png", pngName)
            if (source.applyMethod === "finder") {
              const iconset = join(staging, `${source.name}.iconset`)
              await mkdir(iconset)
              for (const size of [16, 32, 128, 256, 512]) {
                for (const scale of [1, 2]) {
                  const file = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`
                  await run(["/usr/bin/sips", "-z", String(size * scale), String(size * scale), png, "--out", join(iconset, file)])
                }
              }
              const icns = `${source.name}.icns`
              await run(["/usr/bin/iconutil", "-c", "icns", iconset, "-o", join(staging, icns)])
              await rm(iconset, { recursive: true })
              styledIconPath = join(output, icns)
              rows.push(`png/${pngName}\t${source.name}\tfileicon`)
            }
            icons.push({
              id: source.bundleIdentifier, name: source.name, bundleIdentifier: source.bundleIdentifier,
              appPath: source.appPath, iconPath: join(output, "png", pngName), styledIconPath,
              applyMethod: source.applyMethod, theme: input.name, editModel: "external", backgroundModel: "none"
            })
          }
          const manifest: StyledManifest = { version: 1, createdAt: new Date().toISOString(), theme: input.name, icons }
          await Bun.write(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
          await Bun.write(join(staging, "manifest.tsv"), rows.join("\n") + "\n")
          await rename(staging, output)
          return manifest
        } finally {
          await rm(staging, { recursive: true, force: true })
        }
      },
      catch: (cause) => new IconPackError({ message: `Could not import icons: ${cause instanceof Error ? cause.message : String(cause)}`, cause })
    })
  })
