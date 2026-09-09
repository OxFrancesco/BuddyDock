import { afterEach, beforeEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyManifest, runApplier, selectIcons } from "../src/apply.ts"
import { importIcons } from "../src/import.ts"
import { StyledManifest } from "../src/model.ts"
import { activeManifestPath, rememberActiveManifest } from "../src/persist.ts"
import { readJson } from "../src/files.ts"

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "buddydock-import-"))
  process.env.BUDDYDOCK_STATE_DIR = join(directory, "state")
  process.env.BUDDYDOCK_GHOSTTY_CONFIG_DIR = join(directory, "ghostty")
})

afterEach(async () => {
  delete process.env.BUDDYDOCK_STATE_DIR
  delete process.env.BUDDYDOCK_GHOSTTY_CONFIG_DIR
  await rm(directory, { recursive: true, force: true })
})

const makeApp = async (name: string, id: string) => {
  const app = join(directory, `${name}.app`)
  await mkdir(join(app, "Contents/Resources/assets"), { recursive: true })
  await Bun.write(join(app, "Contents/Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`)
  return app
}

const icon = new URL("../icon-packs/claymation-black-white/Telegram.icns", import.meta.url).pathname

test("imports external art, preserves signed resources, and leaves external Ghostty alone", async () => {
  const app = await makeApp("Example App", "com.superhuman.electron")
  const ghostty = await makeApp("Ghostty", "com.mitchellh.ghostty")
  const resource = join(app, "Contents/Resources/assets/app.png")
  await Bun.write(resource, "signed-resource-sentinel")
  await Bun.write(join(directory, "ghostty/config"), "macos-icon = official\n")
  const manifestPath = join(directory, "input.json")
  await Bun.write(manifestPath, JSON.stringify({ version: 1, name: "Test art", icons: [
    { appPath: app, imagePath: icon }, { appPath: ghostty, imagePath: icon }
  ] }))
  const pack = join(directory, "my pack")
  const imported = await Effect.runPromise(importIcons(manifestPath, pack))
  expect(imported.icons[0]!.styledIconPath).toBe(join(pack, "Example App.icns"))
  expect(imported.icons[1]!.applyMethod).toBe("external")
  expect(await Bun.file(join(pack, "Ghostty.icns")).exists()).toBe(false)
  expect(await Bun.file(join(pack, "manifest.tsv")).text()).not.toContain("Ghostty")
  expect(Buffer.from(await Bun.file(imported.icons[0]!.styledIconPath).arrayBuffer()).subarray(0, 4).toString()).toBe("icns")

  const result = await Effect.runPromise(applyManifest({ manifestPath: join(pack, "manifest.json"), reset: false, restartDock: false, relaunch: false }))
  expect(result).toHaveLength(1)
  expect(result[0]!.applied).toBe(true)
  expect(await Bun.file(resource).text()).toBe("signed-resource-sentinel")
  expect(await Bun.file(join(directory, "ghostty/config")).text()).toBe("macos-icon = official\n")
  const externalStatus = await Effect.runPromise(runApplier("status", [{ appPath: ghostty, iconPath: null }]))
  expect(externalStatus[0]!.applied).toBe(false)
  const active = await Effect.runPromise(readJson(activeManifestPath(), StyledManifest))
  expect(active.icons.map((entry) => entry.appPath)).toEqual([imported.icons[0]!.appPath])

  await expect(Effect.runPromise(importIcons(manifestPath, pack))).rejects.toThrow("Output already exists")
}, 60000)

test("rejects unreadable images before publishing a pack", async () => {
  const app = await makeApp("Example", "example.invalid")
  await Bun.write(join(directory, "bad.png"), "not an image")
  const manifest = join(directory, "input.json")
  await Bun.write(manifest, JSON.stringify({ version: 1, name: "invalid", icons: [{ appPath: app, imagePath: "bad.png" }] }))
  await expect(Effect.runPromise(importIcons(manifest, join(directory, "pack")))).rejects.toThrow("readable square image")
  expect(await Bun.file(join(directory, "pack/manifest.json")).exists()).toBe(false)
})

test("targeted updates retain other apps and remove external apps from persistence", async () => {
  const makeIcon = (name: string) => ({ id: name, name, appPath: `/${name}.app`, iconPath: icon, styledIconPath: icon, theme: "test", editModel: "external", backgroundModel: "none", bundleIdentifier: null })
  const old = { version: 1, createdAt: "old", theme: "old", icons: [makeIcon("Liny"), makeIcon("T3 Code"), makeIcon("Ghostty")] }
  await Bun.write(activeManifestPath(), JSON.stringify(old))
  const manifest = join(directory, "update.json")
  await Bun.write(manifest, JSON.stringify({ ...old, icons: [
    { ...makeIcon("Liny"), styledIconPath: "/new.icns" },
    { ...makeIcon("Ghostty"), applyMethod: "external" }
  ] }))
  await Effect.runPromise(rememberActiveManifest(manifest, ["/Liny.app"]))
  const active = await Effect.runPromise(readJson(activeManifestPath(), StyledManifest))
  expect(active.icons.find((entry) => entry.name === "Liny")!.styledIconPath).toBe("/new.icns")
  expect(active.icons.find((entry) => entry.name === "T3 Code")!.styledIconPath).toBe(icon)
  expect(active.icons.some((entry) => entry.name === "Ghostty")).toBe(false)
  expect(selectIcons(active.icons, ["Liny"]).map((entry) => entry.name)).toEqual(["Liny"])
  expect(() => selectIcons(active.icons, ["typo"])).toThrow("App is not in this manifest")
})

test("CLI exits with failure when the native app icon cannot be applied", async () => {
  const manifest = join(directory, "missing.json")
  await Bun.write(manifest, JSON.stringify({ version: 1, createdAt: "now", theme: "test", icons: [{
    id: "missing", name: "Missing", appPath: join(directory, "Missing.app"), iconPath: icon, styledIconPath: icon,
    theme: "test", editModel: "external", backgroundModel: "none", bundleIdentifier: null
  }] }))
  const child = Bun.spawn(["bun", "run", "src/cli.ts", "apply", "--manifest", manifest, "--no-restart"], {
    cwd: new URL("..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe"
  })
  const [stdout, , code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(code).not.toBe(0)
  expect(stdout).toContain("FAILED: Missing")
  const unscoped = Bun.spawn(["bun", "run", "src/cli.ts", "apply", "--manifest", manifest, "--relaunch", "--no-restart"], {
    cwd: new URL("..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe"
  })
  const [out, err, unscopedCode] = await Promise.all([new Response(unscoped.stdout).text(), new Response(unscoped.stderr).text(), unscoped.exited])
  expect(unscopedCode).not.toBe(0)
  expect(out + err).toContain("--relaunch requires --app")
})
