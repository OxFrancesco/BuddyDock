import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { applyRuntimeIconResources, resetRuntimeIconResources } from "../src/overrides.ts"

let dir: string
const app = () => `${dir}/Superhuman.app`
const bundleId = "com.superhuman.electron"

beforeEach(() => {
  dir = mkdtempSync(`${tmpdir()}/buddydock-overrides-`)
  process.env.BUDDYDOCK_BACKUP_DIR = `${dir}/backups`
  mkdirSync(`${app()}/Contents/Resources/assets`, { recursive: true })
})

afterEach(() => {
  delete process.env.BUDDYDOCK_BACKUP_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe("runtime icon resources", () => {
  test("apply swaps the bundled PNGs and reset restores the originals", async () => {
    const target = `${app()}/Contents/Resources/assets/app.png`
    await Bun.write(target, "original")
    await Bun.write(`${dir}/styled.png`, "styled")

    const patched = await Effect.runPromise(applyRuntimeIconResources(app(), bundleId, `${dir}/styled.png`))
    expect(patched).toEqual(["Contents/Resources/assets/app.png"])
    expect(await Bun.file(target).text()).toBe("styled")

    // A second apply must not overwrite the backup with the styled image.
    await Bun.write(`${dir}/styled2.png`, "styled2")
    await Effect.runPromise(applyRuntimeIconResources(app(), bundleId, `${dir}/styled2.png`))

    const restored = await Effect.runPromise(resetRuntimeIconResources(app(), bundleId))
    expect(restored).toEqual(["Contents/Resources/assets/app.png"])
    expect(await Bun.file(target).text()).toBe("original")
  })

  test("unknown bundle ids are a no-op", async () => {
    expect(await Effect.runPromise(applyRuntimeIconResources(app(), "com.example.other", `${dir}/nope.png`))).toEqual([])
  })
})
