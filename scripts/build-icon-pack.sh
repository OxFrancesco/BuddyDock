#!/bin/bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/icon-pack-common.sh"

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <png-directory> <pack-directory> <manifest.tsv>" >&2
  exit 64
fi

source_dir="$(cd "${1%/}" && pwd)"
manifest_path="$(cd "$(dirname "$3")" && pwd)/$(basename "$3")"
mkdir -p "${2%/}"
pack_dir="$(cd "${2%/}" && pwd)"
work_dir="$(mktemp -d)"
built_dir="$work_dir/pack"
trap 'rm -rf "$work_dir"' EXIT

declare -a slot_names=(
  icon_16x16.png icon_16x16@2x.png
  icon_32x32.png icon_32x32@2x.png
  icon_128x128.png icon_128x128@2x.png
  icon_256x256.png icon_256x256@2x.png
  icon_512x512.png icon_512x512@2x.png
)
declare -a slot_sizes=(16 32 32 64 128 256 256 512 512 1024)

if [[ ! -f "$manifest_path" ]]; then
  echo "Missing pack manifest: $manifest_path" >&2
  exit 66
fi

mkdir -p "$built_dir"

while IFS=$'\t' read -r source_name app_name apply_method extra; do
  [[ -n "$source_name" && "${source_name:0:1}" != "#" ]] || continue

  apply_method="${apply_method:-fileicon}"
  if [[ -n "${extra:-}" || -z "$app_name" ]]; then
    echo "Invalid manifest row for $source_name" >&2
    exit 65
  fi
  if ! buddy_apply_method_is_supported "$apply_method"; then
    echo "Unsupported apply method '$apply_method' for $app_name" >&2
    exit 65
  fi

  source_path="$source_dir/$source_name"
  iconset="$work_dir/$app_name.iconset"

  if [[ ! -f "$source_path" ]]; then
    echo "Missing source icon: $source_path" >&2
    exit 66
  fi

  mkdir -p "$iconset"
  for index in "${!slot_names[@]}"; do
    size="${slot_sizes[$index]}"
    sips -z "$size" "$size" "$source_path" --out "$iconset/${slot_names[$index]}" >/dev/null
  done

  iconutil -c icns "$iconset" -o "$built_dir/$app_name.icns"
  echo "Built $app_name.icns"
done < "$manifest_path"

# Install only after every manifest row validates and every icon builds. The
# manifest moves last so apply/restore never observe new metadata for old icons.
for icon_file in "$built_dir"/*.icns; do
  cp "$icon_file" "$pack_dir/$(basename "$icon_file")"
done
manifest_temp="$(mktemp "$pack_dir/.manifest.tsv.XXXXXX")"
cp "$manifest_path" "$manifest_temp"
mv "$manifest_temp" "$pack_dir/manifest.tsv"
