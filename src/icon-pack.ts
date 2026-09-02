import { Effect } from "effect"
import { IconPackError } from "./errors.ts"

export interface ReapplyIconPackOptions {
  readonly packDirectory: string
  readonly applicationsDirectory: string
  readonly useSudo: boolean
}

export const defaultIconPackDirectory = new URL(
  "../icon-packs/claymation-black-white",
  import.meta.url
).pathname

export const reapplyIconPack = Effect.fn("IconPack.reapply")(function*(
  options: ReapplyIconPackOptions
) {
  if (process.platform !== "darwin") {
    return yield* new IconPackError({ message: "Icon packs can only be applied on macOS" })
  }

  const scriptPath = new URL("../scripts/apply-icon-pack.sh", import.meta.url).pathname
  const scriptExists = yield* Effect.promise(() => Bun.file(scriptPath).exists())
  if (!scriptExists) {
    return yield* new IconPackError({ message: `BuddyDock apply script was not found at ${scriptPath}` })
  }

  const exitCode = yield* Effect.tryPromise({
    try: () => {
      const child = Bun.spawn(
        ["bash", scriptPath, options.packDirectory, options.applicationsDirectory],
        {
          env: {
            ...process.env,
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
