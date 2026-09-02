import { fal } from "@fal-ai/client"
import { Context, Effect, Layer, Schedule, Schema } from "effect"
import { FalError } from "./errors.ts"

const falKey = process.env.FAL_KEY ?? process.env.FAL_API_KEY
if (falKey) fal.config({ credentials: falKey })

const EditResponse = Schema.Struct({
  images: Schema.Array(Schema.Struct({ url: Schema.String }))
})

const BackgroundResponse = Schema.Struct({
  image: Schema.Struct({ url: Schema.String })
})

export interface StyleRequest {
  readonly imagePath: string
  readonly prompt: string
  readonly quality: "low" | "medium" | "high"
  readonly removeBackground: boolean
}

export interface FalGatewayShape {
  readonly style: (request: StyleRequest) => Effect.Effect<Uint8Array, FalError>
}

export class FalGateway extends Context.Tag("buddydock/FalGateway")<FalGateway, FalGatewayShape>() {
  static readonly live = Layer.succeed(FalGateway, {
    style: (request) =>
      Effect.gen(function*() {
        const sourceFile = Bun.file(request.imagePath)
        const sourceUrl = yield* Effect.tryPromise({
          try: () => fal.storage.upload(sourceFile),
          catch: (cause) => new FalError({ stage: "upload", message: `Could not upload ${request.imagePath}`, cause })
        })

        const editResult = yield* Effect.tryPromise({
          try: () => fal.subscribe("openai/gpt-image-2/edit", {
            input: {
              prompt: request.prompt,
              image_urls: [sourceUrl],
              image_size: "auto",
              quality: request.quality,
              num_images: 1,
              output_format: "png"
            }
          }),
          catch: (cause) => new FalError({ stage: "edit", message: "GPT Image 2 edit failed", cause })
        }).pipe(Effect.retry({ times: 2, schedule: Schedule.exponential("2 seconds") }))
        const edit = yield* Schema.decodeUnknown(EditResponse)(editResult.data).pipe(
          Effect.mapError((cause) => new FalError({ stage: "edit", message: "GPT Image 2 returned an invalid response", cause }))
        )
        const editedUrl = edit.images[0]?.url
        if (!editedUrl) {
          return yield* new FalError({ stage: "edit", message: "GPT Image 2 returned no image" })
        }

        const finalUrl = request.removeBackground
          ? yield* Effect.tryPromise({
              try: () => fal.subscribe("fal-ai/birefnet/v2", {
                input: {
                  image_url: editedUrl,
                  model: "General Use (Light)",
                  operating_resolution: "1024x1024",
                  refine_foreground: true,
                  output_format: "png"
                }
              }),
              catch: (cause) => new FalError({
                stage: "background-removal",
                message: "Background removal failed",
                cause
              })
            }).pipe(
              Effect.flatMap((result) => Schema.decodeUnknown(BackgroundResponse)(result.data)),
              Effect.map((result) => result.image.url),
              Effect.mapError((cause) => cause instanceof FalError
                ? cause
                : new FalError({ stage: "background-removal", message: "Background model returned an invalid response", cause }))
            )
          : editedUrl

        return yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(finalUrl)
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return new Uint8Array(await response.arrayBuffer())
          },
          catch: (cause) => new FalError({ stage: "download", message: "Could not download the styled icon", cause })
        })
      })
  })
}
