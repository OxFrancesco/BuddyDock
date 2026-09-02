import { describe, expect, test } from "bun:test"
import { defaultIconPackDirectory } from "../src/icon-pack.ts"

describe("reapply command", () => {
  test("defaults to the bundled claymation icon pack", async () => {
    expect(defaultIconPackDirectory).toEndWith("/icon-packs/claymation-black-white")
    expect(await Bun.file(`${defaultIconPackDirectory}/manifest.tsv`).exists()).toBe(true)
  })

  test("is exposed by the BuddyDock CLI", async () => {
    const child = Bun.spawn(["bun", "run", "src/cli.ts", "reapply", "--help"], {
      cwd: new URL("..", import.meta.url).pathname,
      stdout: "pipe",
      stderr: "pipe"
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ])

    expect(stderr).toBe("")
    expect(exitCode).toBe(0)
    expect(stdout).toContain("Reapply a saved icon pack")
    expect(stdout).toContain("--sudo")
  })
})
