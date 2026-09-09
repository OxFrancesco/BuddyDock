import { expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

test("reapply changes only selected apps and reports protected existing icons as failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buddydock-reapply-"))
  const apps = join(directory, "apps")
  const pack = join(directory, "pack")
  const mockBin = join(directory, "bin")
  try {
    await Promise.all([mkdir(apps), mkdir(pack), mkdir(mockBin)])
    for (const name of ["Liny", "T3 Code", "Protected"]) {
      await mkdir(join(apps, `${name}.app`))
      await Bun.write(join(pack, `${name}.icns`), "fixture")
    }
    const executable = join(mockBin, "fileicon")
    await Bun.write(executable, `#!/bin/bash
case "$1" in
  test) echo 'HAS custom icon:' ;;
  get) echo fixture > "$4" ;;
  set) echo "$2" >> "$EVENTS" ;;
  rm) : ;;
esac
`)
    await chmod(executable, 0o755)
    const events = join(directory, "events")
    const run = async (name: string) => {
      const child = Bun.spawn(["bash", new URL("../scripts/apply-icon-pack.sh", import.meta.url).pathname, pack, apps], {
        env: { ...process.env, PATH: `${mockBin}:${process.env.PATH}`, EVENTS: events, BUDDYDOCK_STATE_DIR: join(directory, "state"), BUDDYDOCK_NO_SUDO: "1", BUDDYDOCK_NO_REFRESH: "1", BUDDYDOCK_APPS: name },
        stdout: "pipe", stderr: "pipe"
      })
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      return { text: out + err, code }
    }
    expect((await run("Liny")).code).toBe(0)
    expect((await Bun.file(events).text()).trim()).toBe(join(apps, "Liny.app"))
    expect((await run("Typo")).code).not.toBe(0)
    await chmod(join(apps, "Protected.app"), 0o555)
    const protectedResult = await run("Protected")
    expect(protectedResult.code).not.toBe(0)
    expect(protectedResult.text).toContain("requested replacement not installed")
    expect((await Bun.file(events).text()).trim()).toBe(join(apps, "Liny.app"))
  } finally {
    await chmod(join(apps, "Protected.app"), 0o755).catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
})
