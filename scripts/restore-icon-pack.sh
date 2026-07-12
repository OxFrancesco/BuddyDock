#!/bin/bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/icon-pack-common.sh"

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <icon-pack-directory> [applications-directory]" >&2
  exit 64
fi

icons_dir="$(cd "$1" && pwd)"
applications_dir="${2:-/Applications}"
pack_name="$(basename "$icons_dir")"
pack_manifest="$icons_dir/manifest.tsv"
fileicon_state_dir="${BUDDYDOCK_STATE_DIR:-$HOME/Library/Application Support/BuddyDock/icon-pack-state}/$pack_name/fileicon"

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

restore_ghostty_icon() {
  local config_dir="${BUDDYDOCK_GHOSTTY_CONFIG_DIR:-$HOME/Library/Application Support/com.mitchellh.ghostty}"
  local config_file
  local state_file="$config_dir/buddydock/$pack_name.ghostty.previous"
  local installed_icon="$config_dir/icons/buddydock-$pack_name.icns"
  local temp_file

  config_file="$(buddy_ghostty_config_file "$config_dir")"
  if [[ ! -f "$state_file" || ! -f "$config_file" ]]; then
    echo "No BuddyDock Ghostty state found for $pack_name; leaving Ghostty settings unchanged." >&2
    return 0
  fi

  temp_file="$(mktemp "${config_file}.buddydock.XXXXXX")"
  buddy_filter_ghostty_icon_settings "$config_file" "$temp_file"
  if [[ -s "$state_file" ]]; then
    echo >> "$temp_file"
    cat "$state_file" >> "$temp_file"
  fi
  mv "$temp_file" "$config_file"
  rm -f "$state_file" "$installed_icon"
  echo "Restored Ghostty's previous native icon settings in $config_file"
}

restore_fileicon_state() {
  local app_name="$1"
  local app_path="$2"
  local state_icon="$fileicon_state_dir/$app_name.icns"
  local bundled_marker="$fileicon_state_dir/$app_name.bundled"

  if [[ -f "$state_icon" ]]; then
    run_mutation "$fileicon_bin" set "$app_path" "$state_icon" &&
      run_mutation touch "$app_path" &&
      rm -f "$state_icon"
  elif [[ -f "$bundled_marker" ]]; then
    run_mutation "$fileicon_bin" rm "$app_path" &&
      run_mutation touch "$app_path" &&
      rm -f "$bundled_marker"
  else
    echo "Skip: no saved pre-pack icon state for $app_name.app"
    return 3
  fi
}

record_failure() {
  failed_apps+=("$1")
  failed_reasons+=("$2")
}

declare -a restored_apps=()
declare -a failed_apps=()
declare -a failed_reasons=()
declare -a native_apps=()
declare -a unchanged_apps=()

for icon_file in "$icons_dir"/*.icns; do
  [[ -e "$icon_file" ]] || continue

  app_name="$(basename "$icon_file" .icns)"
  app_path="$applications_dir/$app_name.app"

  if [[ -d "$app_path" ]]; then
    apply_method="$(buddy_apply_method_for_app "$pack_manifest" "$app_name")"
    case "$apply_method" in
      fileicon|"")
        restore_status=0
        restore_fileicon_state "$app_name" "$app_path" || restore_status=$?
        case "$restore_status" in
          0) restored_apps+=("$app_path") ;;
          3) unchanged_apps+=("$app_path") ;;
          *) record_failure "$app_path" "fileicon could not restore the previous icon" ;;
        esac
        ;;
      ghostty)
        if restore_ghostty_icon; then
          native_apps+=("$app_path")
        else
          record_failure "$app_path" "could not restore Ghostty's native icon settings"
        fi
        ;;
      *)
        record_failure "$app_path" "unsupported apply method '$apply_method'"
        ;;
    esac
  fi
done

if [[ "${BUDDYDOCK_NO_REFRESH:-0}" != "1" ]]; then
  killall Finder 2>/dev/null || true
  killall Dock 2>/dev/null || true
fi

if (( ${#failed_apps[@]} > 0 )); then
  echo "Could not restore these apps:" >&2
  for index in "${!failed_apps[@]}"; do
    echo "  ${failed_apps[$index]}: ${failed_reasons[$index]}" >&2
  done
  exit 77
fi

echo "Restored ${#restored_apps[@]} Finder icons and ${#native_apps[@]} native icon settings"
if (( ${#unchanged_apps[@]} > 0 )); then
  echo "Left ${#unchanged_apps[@]} apps unchanged because no pre-pack icon state was saved."
fi
if (( ${#native_apps[@]} > 0 )); then
  echo "Restart Ghostty to load its restored icon settings."
fi
