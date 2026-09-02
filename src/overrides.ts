import { Effect } from "effect"
import { DockApplyError } from "./errors.ts"

// Some apps set their own Dock icon at runtime from an image inside the bundle,
// so a Finder custom icon is overridden the moment they launch. For those we
// swap the image files they load, keeping the originals so reset can undo it.
// Paths are relative to the .app bundle. App updates replace the bundle and
// therefore revert this; re-run apply afterwards.
export const RUNTIME_ICON_RESOURCES: Record<string, ReadonlyArray<string>> = {
  "com.superhuman.electron": [
    "Contents/Resources/assets/app.png",
    "Contents/Resources/assets/app-origin.png"
  ]
}

const backupDirectory = (bundleIdentifier: string) =>
  process.env.BUDDYDOCK_BACKUP_DIR ?? `${process.env.HOME}/Library/Application Support/BuddyDock/resource-backups/${bundleIdentifier}`

const fail = (message: string) => (cause: unknown) => new DockApplyError({ message, cause })

export const applyRuntimeIconResources = (appPath: string, bundleIdentifier: string, iconPath: string, onlyMissing = false) =>
  Effect.tryPromise({
    try: async () => {
      const backups = backupDirectory(bundleIdentifier)
      await Bun.$`mkdir -p ${backups}`.quiet()
      const patched: Array<string> = []
      for (const relative of RUNTIME_ICON_RESOURCES[bundleIdentifier] ?? []) {
        const target = `${appPath}/${relative}`
        if (!(await Bun.file(target).exists())) continue
        if (onlyMissing && Buffer.from(await Bun.file(target).arrayBuffer()).equals(Buffer.from(await Bun.file(iconPath).arrayBuffer()))) continue
        const backup = `${backups}/${relative.replaceAll("/", "__")}`
        if (!(await Bun.file(backup).exists())) await Bun.write(backup, Bun.file(target))
        await Bun.write(target, Bun.file(iconPath))
        patched.push(relative)
      }
      return patched
    },
    catch: fail(`Could not patch runtime icon resources in ${appPath}`)
  })

export const resetRuntimeIconResources = (appPath: string, bundleIdentifier: string) =>
  Effect.tryPromise({
    try: async () => {
      const backups = backupDirectory(bundleIdentifier)
      const restored: Array<string> = []
      for (const relative of RUNTIME_ICON_RESOURCES[bundleIdentifier] ?? []) {
        const backup = `${backups}/${relative.replaceAll("/", "__")}`
        if (!(await Bun.file(backup).exists())) continue
        await Bun.write(`${appPath}/${relative}`, Bun.file(backup))
        await Bun.$`rm -f ${backup}`.quiet()
        restored.push(relative)
      }
      return restored
    },
    catch: fail(`Could not restore runtime icon resources in ${appPath}`)
  })
