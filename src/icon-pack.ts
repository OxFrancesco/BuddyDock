import { Effect } from "effect"
import { IconPackError } from "./errors.ts"
import { basename, dirname, join, resolve } from "node:path"
import { isCompiledApp } from "./files.ts"

export interface ReapplyIconPackOptions {
  readonly packDirectory: string
  readonly applicationsDirectory: string
  readonly useSudo: boolean
  readonly apps?: ReadonlyArray<string>
}

const packageRoot = isCompiledApp
  ? resolve(dirname(process.execPath), "../Resources")
  : new URL("..", import.meta.url).pathname
export const defaultIconPackDirectory = join(packageRoot, "icon-packs/claymation-black-white")

export const reapplyIconPack = Effect.fn("IconPack.reapply")(function*(
  options: ReapplyIconPackOptions
) {
  if (process.platform !== "darwin") {
    return yield* new IconPackError({ message: "Icon packs can only be applied on macOS" })
  }

  const scriptPath = join(packageRoot, "scripts/apply-icon-pack.sh")
  const scriptExists = yield* Effect.promise(() => Bun.file(scriptPath).exists())
  if (!scriptExists) {
    return yield* new IconPackError({ message: `BuddyDock apply script was not found at ${scriptPath}` })
  }

  const exitCode = yield* Effect.tryPromise({
    try: () => {
      const selected = (options.apps ?? []).map((app) => {
        const name = app.startsWith("/") ? basename(app, ".app") : app
        if (/[\r\n/]/.test(name)) throw new Error(`Invalid app name: ${app}`)
        if (app.startsWith("/") && resolve(app) !== resolve(options.applicationsDirectory, `${name}.app`)) {
          throw new Error(`App is outside the selected applications directory: ${app}`)
        }
        return name
      })
      const child = Bun.spawn(
        ["bash", scriptPath, options.packDirectory, options.applicationsDirectory],
        {
          env: {
            ...process.env,
            BUDDYDOCK_APPS: selected.join("\n"),
            ...(options.useSudo ? {} : { BUDDYDOCK_NO_SUDO: "1" })
          },
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit"
        }
      )
      return child.exited
    },
    catch: (cause) => new IconPackError({ message: "Could not start the icon-pack apply script", cause })
  })

  if (exitCode !== 0) {
    return yield* new IconPackError({
      message: `The icon-pack apply script exited with code ${exitCode}`
    })
  }
})
