import { Schema } from "effect"

export class DockIcon extends Schema.Class<DockIcon>("DockIcon")({
  id: Schema.String,
  name: Schema.String,
  bundleIdentifier: Schema.NullOr(Schema.String),
  appPath: Schema.String,
  iconPath: Schema.String
}) {}

export const DockIcons = Schema.Array(DockIcon)

export class StyledIcon extends Schema.Class<StyledIcon>("StyledIcon")({
  ...DockIcon.fields,
  styledIconPath: Schema.String,
  theme: Schema.String,
  editModel: Schema.String,
  backgroundModel: Schema.String
}) {}

export const StyledIcons = Schema.Array(StyledIcon)

export const ScanManifest = Schema.Struct({
  version: Schema.Literal(1),
  createdAt: Schema.String,
  icons: DockIcons
})

export type ScanManifest = typeof ScanManifest.Type

export const StyledManifest = Schema.Struct({
  version: Schema.Literal(1),
  createdAt: Schema.String,
  theme: Schema.String,
  icons: StyledIcons
})

export type StyledManifest = typeof StyledManifest.Type
