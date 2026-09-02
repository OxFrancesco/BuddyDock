import { Data } from "effect"

export class DockScanError extends Data.TaggedError("DockScanError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class DockApplyError extends Data.TaggedError("DockApplyError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class ManifestError extends Data.TaggedError("ManifestError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class FalError extends Data.TaggedError("FalError")<{
  readonly stage: "upload" | "edit" | "background-removal" | "download"
  readonly message: string
  readonly cause?: unknown
}> {}

export class IconPackError extends Data.TaggedError("IconPackError")<{
  readonly message: string
  readonly cause?: unknown
}> {}
