#!/usr/bin/env bash
set -Eeuo pipefail

readonly data_root="/vrising/data"
readonly settings_root="${data_root}/Settings"
readonly admin_file="${settings_root}/adminlist.txt"
readonly steam_id_min=76561197960265728
readonly steam_id_max=76561202255233023

fail() {
  printf 'Dauva V Rising runtime: %s\n' "$1" >&2
  exit 64
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

validate_steam_id64() {
  local value="$1"
  [[ "$value" =~ ^[0-9]{17}$ ]] || return 1
  (( 10#$value >= steam_id_min && 10#$value <= steam_id_max ))
}

declare -A seen_admins=()
declare -a ordered_admins=()

append_unique_admin() {
  local value="$1"
  if [[ -z "${seen_admins[$value]+present}" ]]; then
    seen_admins["$value"]=1
    ordered_admins+=("$value")
  fi
}

readonly supplied="${DAUVA_VRISING_INITIAL_ADMINS:-}"
[[ -n "$supplied" ]] || fail "At least one administrator must be supplied."
(( ${#supplied} <= 4096 )) || fail "The administrator value is too large."
[[ "$supplied" != *$'\n'* && "$supplied" != *$'\r'* ]] || \
  fail "Administrators must use semicolon-separated Name=SteamID64 entries."

mkdir -p -- "$settings_root"

if [[ -f "$admin_file" ]]; then
  while IFS= read -r raw || [[ -n "$raw" ]]; do
    line="$(trim "${raw%$'\r'}")"
    [[ -z "$line" ]] && continue
    validate_steam_id64 "$line" || \
      fail "The existing administrator file is invalid; it was left unchanged."
    append_unique_admin "$line"
  done < "$admin_file"
fi

entries=()
IFS=';' read -r -a entries <<< "$supplied"
for raw in "${entries[@]}"; do
  line="$(trim "$raw")"
  [[ "$line" == *=* ]] || \
    fail "Administrators must use Name=SteamID64 entries."
  label="$(trim "${line%%=*}")"
  steam_id="$(trim "${line#*=}")"
  [[ "$label" =~ ^[A-Za-z0-9][A-Za-z0-9._\ -]{0,63}$ ]] || \
    fail "An administrator label is invalid."
  validate_steam_id64 "$steam_id" || \
    fail "An administrator SteamID64 is invalid."
  append_unique_admin "$steam_id"
done

temporary="$(mktemp "${settings_root}/.adminlist.XXXXXX")"
trap 'rm -f -- "${temporary:-}"' EXIT
chmod 0600 "$temporary"
printf '%s\n' "${ordered_admins[@]}" > "$temporary"
mv -f -- "$temporary" "$admin_file"
trap - EXIT
printf 'Dauva V Rising runtime: administrator list reconciled (%d entries).\n' \
  "${#ordered_admins[@]}"
