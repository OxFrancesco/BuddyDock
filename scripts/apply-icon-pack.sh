#!/bin/bash

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <icon-pack-directory> [applications-directory]" >&2
  exit 64
fi

icons_dir="$(cd "$1" && pwd)"
applications_dir="${2:-/Applications}"

if ! command -v fileicon >/dev/null 2>&1; then
  echo "fileicon is required. Install it with: brew install fileicon" >&2
  exit 69
fi

if ! compgen -G "$icons_dir/*.icns" >/dev/null; then
  echo "No .icns files found in $icons_dir" >&2
  exit 66
fi

fileicon_bin="$(command -v fileicon)"
use_sudo=0
if [[ "$applications_dir" == "/Applications" ]]; then
  use_sudo=1
  sudo -v
fi

run_mutation() {
  if (( use_sudo )); then
    sudo "$@"
  else
    "$@"
  fi
}

declare -a changed_apps=()
declare -a failed_apps=()
declare -a refresh_failures=()

for icon_file in "$icons_dir"/*.icns; do
  [[ -e "$icon_file" ]] || continue

  app_name="$(basename "$icon_file" .icns)"
  app_path="$applications_dir/$app_name.app"

  if [[ ! -d "$app_path" ]]; then
    echo "Skip: $app_name.app is not installed in $applications_dir"
    continue
  fi

  if run_mutation "$fileicon_bin" set "$app_path" "$icon_file"; then
    changed_apps+=("$app_path")
  else
    failed_apps+=("$app_path")
  fi
done

if (( ${#changed_apps[@]} > 0 )); then
  for app_path in "${changed_apps[@]}"; do
    if ! run_mutation touch "$app_path"; then
      refresh_failures+=("$app_path")
    fi
  done
fi

killall Finder 2>/dev/null || true
killall Dock 2>/dev/null || true

if (( ${#failed_apps[@]} > 0 )); then
  echo >&2
  echo "macOS blocked these apps:" >&2
  printf '  %s\n' "${failed_apps[@]}" >&2
  echo >&2
  echo "Enable your terminal under System Settings > Privacy & Security > App Management," >&2
  echo "quit and reopen the terminal, then run this script again." >&2
  exit 77
fi

if (( ${#refresh_failures[@]} > 0 )); then
  echo "Icons were applied, but these apps could not be refreshed:" >&2
  printf '  %s\n' "${refresh_failures[@]}" >&2
  exit 74
fi

echo "Applied ${#changed_apps[@]} icons from $icons_dir"
