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
attempt_state_dir="$(mktemp -d)"
trap 'rm -rf "$attempt_state_dir"' EXIT
if [[ -n "${BUDDYDOCK_APPS:-}" ]]; then
  while IFS= read -r selected_app; do
    if [[ ! -f "$icons_dir/$selected_app.icns" ]]; then
      echo "No icon in this pack for: $selected_app" >&2
      exit 66
    fi
  done <<< "$BUDDYDOCK_APPS"
fi
use_sudo=0
if [[ "$applications_dir" == "/Applications" && "${BUDDYDOCK_NO_SUDO:-0}" != "1" ]]; then
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

configure_ghostty_icon() {
  local icon_file="$1"
  local config_dir="${BUDDYDOCK_GHOSTTY_CONFIG_DIR:-$HOME/Library/Application Support/com.mitchellh.ghostty}"
  local config_file
  local icon_dir="$config_dir/icons"
  local installed_icon="$icon_dir/buddydock-$pack_name.icns"
  local state_dir="$config_dir/buddydock"
  local state_file="$state_dir/$pack_name.ghostty.previous"
  local temp_file

  config_file="$(buddy_ghostty_config_file "$config_dir")"
  mkdir -p "$icon_dir" "$state_dir" "$(dirname "$config_file")"
  touch "$config_file"

  if [[ ! -f "$state_file" ]]; then
    awk '
      /^[[:space:]]*macos-icon[[:space:]]*=/ ||
      /^[[:space:]]*macos-custom-icon[[:space:]]*=/ { print }
    ' "$config_file" > "$state_file"
  fi

  cp "$icon_file" "$installed_icon"
  temp_file="$(mktemp "${config_file}.buddydock.XXXXXX")"
  buddy_filter_ghostty_icon_settings "$config_file" "$temp_file"
  {
    echo
    echo "# BuddyDock: managed Ghostty icon for $pack_name"
    echo "macos-icon = custom"
    echo "macos-custom-icon = $installed_icon"
  } >> "$temp_file"
  mv "$temp_file" "$config_file"

  echo "Configured Ghostty's native Dock icon in $config_file"
}

remember_fileicon_state() {
  local app_name="$1"
  local app_path="$2"
  local state_icon="$fileicon_state_dir/$app_name.icns"
  local bundled_marker="$fileicon_state_dir/$app_name.bundled"
  local verification

  if [[ -f "$state_icon" || -f "$bundled_marker" ]]; then
    return 0
  fi

  mkdir -p "$fileicon_state_dir"
  verification="$($fileicon_bin test "$app_path" 2>&1 || true)"
  if grep -qi '^HAS custom icon:' <<< "$verification"; then
    "$fileicon_bin" get -f "$app_path" "$state_icon"
  else
    touch "$bundled_marker"
  fi
}

record_failure() {
  failed_apps+=("$1")
  failed_reasons+=("$2")
}

declare -a changed_apps=()
declare -a failed_apps=()
declare -a failed_reasons=()
declare -a refresh_failures=()
declare -a native_apps=()
declare -a preserved_apps=()

for icon_file in "$icons_dir"/*.icns; do
  [[ -e "$icon_file" ]] || continue

  app_name="$(basename "$icon_file" .icns)"
  if [[ -n "${BUDDYDOCK_APPS:-}" ]]; then
    case $'\n'"$BUDDYDOCK_APPS"$'\n' in
      *$'\n'"$app_name"$'\n'*) ;;
      *) continue ;;
    esac
  fi
  app_path="$applications_dir/$app_name.app"

  if [[ ! -d "$app_path" ]]; then
    echo "Skip: $app_name.app is not installed in $applications_dir"
    continue
  fi

  apply_method="$(buddy_apply_method_for_app "$pack_manifest" "$app_name")"
  case "$apply_method" in
    fileicon|"")
      if (( ! use_sudo )) && [[ ! -w "$app_path" ]]; then
        verification="$($fileicon_bin test "$app_path" 2>&1 || true)"
        if grep -qi '^HAS custom icon:' <<< "$verification"; then
          record_failure "$app_path" "application is not writable; existing custom icon preserved, requested replacement not installed"
        else
          record_failure "$app_path" "application is not writable and has no custom icon"
        fi
        continue
      fi

      # Clear half-applied Finder metadata before retrying. fileicon can otherwise
      # leave the custom-icon flag set without its associated Icon\r data.
      if ! remember_fileicon_state "$app_name" "$app_path"; then
        record_failure "$app_path" "could not back up the existing custom icon"
        continue
      fi
      attempt_icon="$attempt_state_dir/$app_name.icns"
      verification="$($fileicon_bin test "$app_path" 2>&1 || true)"
      if grep -qi '^HAS custom icon:' <<< "$verification"; then
        if ! "$fileicon_bin" get -f "$app_path" "$attempt_icon" >/dev/null; then
          record_failure "$app_path" "could not preserve the current custom icon"
          continue
        fi
      fi
      run_mutation "$fileicon_bin" rm "$app_path" >/dev/null 2>&1 || true
      if run_mutation "$fileicon_bin" set "$app_path" "$icon_file"; then
        verification="$($fileicon_bin test "$app_path" 2>&1 || true)"
        if grep -qi '^HAS custom icon:' <<< "$verification"; then
          changed_apps+=("$app_path")
        else
          echo "$verification" >&2
          run_mutation "$fileicon_bin" rm "$app_path" >/dev/null 2>&1 || true
          record_failure "$app_path" "fileicon reported success but verification failed"
        fi
      else
        record_failure "$app_path" "fileicon could not modify the application"
      fi
      if (( ${#failed_apps[@]} > 0 )) && [[ "${failed_apps[${#failed_apps[@]}-1]}" == "$app_path" ]] && [[ -f "$attempt_icon" ]]; then
        run_mutation "$fileicon_bin" set "$app_path" "$attempt_icon" >/dev/null 2>&1 || true
      fi
      ;;
    ghostty)
      if configure_ghostty_icon "$icon_file"; then
        native_apps+=("$app_path")
      else
        record_failure "$app_path" "could not update Ghostty's native icon settings"
      fi
      ;;
    *)
      record_failure "$app_path" "unsupported apply method '$apply_method'"
      ;;
  esac
done

if (( ${#changed_apps[@]} > 0 )); then
  for app_path in "${changed_apps[@]}"; do
    if ! run_mutation touch "$app_path"; then
      refresh_failures+=("$app_path")
    fi
  done
fi

if [[ "${BUDDYDOCK_NO_REFRESH:-0}" != "1" ]] && (( ${#changed_apps[@]} > 0 || ${#native_apps[@]} > 0 )); then
  killall Finder 2>/dev/null || true
  killall Dock 2>/dev/null || true
fi

if (( ${#failed_apps[@]} > 0 )); then
  echo >&2
  echo "Could not apply these icons:" >&2
  for index in "${!failed_apps[@]}"; do
    echo "  ${failed_apps[$index]}: ${failed_reasons[$index]}" >&2
  done
  echo >&2
  echo "For fileicon permission failures, enable your terminal under System Settings >" >&2
  echo "Privacy & Security > App Management, quit and reopen it, then retry." >&2
  exit 77
fi

if (( ${#refresh_failures[@]} > 0 )); then
  echo "Icons were applied, but these apps could not be refreshed:" >&2
  printf '  %s\n' "${refresh_failures[@]}" >&2
  exit 74
fi

echo "Applied ${#changed_apps[@]} Finder icons, configured ${#native_apps[@]} native icons, and preserved ${#preserved_apps[@]} existing custom icons from $icons_dir"
echo "Stored icons were verified. Running apps may still display a cached or runtime-supplied icon."
if (( ${#native_apps[@]} > 0 )); then
  echo "Restart Ghostty to load its native custom icon."
fi
