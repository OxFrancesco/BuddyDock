#!/bin/bash

set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <png-directory> <pack-directory> <manifest.tsv>" >&2
  exit 64
fi

source_dir="${1%/}"
pack_dir="${2%/}"
manifest_path="$3"
work_dir="$(mktemp -d)"
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

mkdir -p "$pack_dir"

while IFS=$'\t' read -r source_name app_name; do
  [[ -n "$source_name" && "${source_name:0:1}" != "#" ]] || continue

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

  iconutil -c icns "$iconset" -o "$pack_dir/$app_name.icns"
  echo "Built $app_name.icns"
done < "$manifest_path"
