import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FalGateway } from "../src/fal.ts"
import { stylePrompt } from "../src/style.ts"

describe("stylePrompt", () => {
  test("includes the app identity and requested theme", () => {
    const prompt = stylePrompt("Safari", "candy cotton")
    expect(prompt).toContain("Safari")
    expect(prompt).toContain("candy cotton")
    expect(prompt).toContain("Do not add words")
  })
})

describe("FalGateway", () => {
  test("can be replaced without network access", async () => {
    const fake = Layer.succeed(FalGateway, {
      style: () => Effect.succeed(new Uint8Array([1, 2, 3]))
    })
    const bytes = await Effect.runPromise(
      Effect.flatMap(FalGateway, (gateway) => gateway.style({
        imagePath: "fixture.png",
        prompt: "test",
        quality: "low",
        removeBackground: true
      })).pipe(Effect.provide(fake))
    )
    expect([...bytes]).toEqual([1, 2, 3])
  })
})
