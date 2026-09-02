import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { applyGhosttyIcon, resetGhosttyIcon } from "../src/ghostty.ts"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(`${tmpdir()}/buddydock-ghostty-`)
  process.env.BUDDYDOCK_GHOSTTY_CONFIG_DIR = dir
})

afterEach(() => {
  delete process.env.BUDDYDOCK_GHOSTTY_CONFIG_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe("Ghostty native icon", () => {
  test("apply writes managed settings and reset restores the previous ones", async () => {
    await Bun.write(`${dir}/config`, "font-size = 14\nmacos-icon = blueprint\n")
    await Bun.write(`${dir}/icon.png`, new Uint8Array([1, 2, 3]))

    await Effect.runPromise(applyGhosttyIcon("test-pack", `${dir}/icon.png`))
    const applied = await Bun.file(`${dir}/config`).text()
    expect(applied).toContain("font-size = 14")
    expect(applied).toContain("macos-icon = custom")
    expect(applied).toContain(`macos-custom-icon = ${dir}/icons/buddydock-test-pack.png`)
    expect(applied).not.toContain("macos-icon = blueprint")
    expect(await Bun.file(`${dir}/icons/buddydock-test-pack.png`).exists()).toBe(true)

    await Effect.runPromise(resetGhosttyIcon("test-pack"))
    const restored = await Bun.file(`${dir}/config`).text()
    expect(restored).toBe("font-size = 14\nmacos-icon = blueprint\n")
  })

  test("reset without saved state leaves the config alone", async () => {
    await Bun.write(`${dir}/config`, "font-size = 14\n")
    expect(await Effect.runPromise(resetGhosttyIcon("missing"))).toBeNull()
    expect(await Bun.file(`${dir}/config`).text()).toBe("font-size = 14\n")
  })
})
