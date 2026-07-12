#!/bin/bash

buddy_apply_method_for_app() {
  local manifest_path="$1"
  local app_name="$2"

  if [[ -f "$manifest_path" ]]; then
    awk -F '\t' -v app="$app_name" '
      $1 !~ /^#/ && $2 == app { print ($3 == "" ? "fileicon" : $3); exit }
    ' "$manifest_path"
  else
    echo "fileicon"
  fi
}

buddy_apply_method_is_supported() {
  # Adding a method requires matching handlers in apply-icon-pack.sh and
  # restore-icon-pack.sh, plus its validation entry here.
  [[ "$1" == "fileicon" || "$1" == "ghostty" ]]
}

buddy_ghostty_config_file() {
  local config_dir="$1"

  if [[ -n "${BUDDYDOCK_GHOSTTY_CONFIG_FILE:-}" ]]; then
    echo "$BUDDYDOCK_GHOSTTY_CONFIG_FILE"
  elif [[ -f "$config_dir/config" ]]; then
    echo "$config_dir/config"
  else
    echo "$config_dir/config.ghostty"
  fi
}

buddy_filter_ghostty_icon_settings() {
  local source_file="$1"
  local destination_file="$2"

  awk '
    !/^[[:space:]]*# BuddyDock: managed Ghostty icon/ &&
    !/^[[:space:]]*macos-icon[[:space:]]*=/ &&
    !/^[[:space:]]*macos-custom-icon[[:space:]]*=/ { print }
  ' "$source_file" > "$destination_file"
}
