#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf 'Dauva V Rising runtime: %s\n' "$1" >&2
  exit 64
}

normalize_boolean() {
  case "${1,,}" in
    true) printf 'true' ;;
    false) printf 'false' ;;
    *) fail "$2 must be true or false." ;;
  esac
}

readonly native_settings="$(normalize_boolean \
  "${DAUVA_NATIVE_SETTINGS:-false}" "Native settings")"
if [[ "$native_settings" == true ]]; then
  # Native mode uses persistent configuration, never Steam-owned presets.
  # Retain only Dauva-owned identity/network/security environment overrides.
  test -s /vrising/data/Settings/ServerHostSettings.json ||
    fail "Native host settings are missing."
  test -s /vrising/data/Settings/ServerGameSettings.json ||
    fail "Native game settings are missing."
  while IFS= read -r variable; do
    case "$variable" in
      VR_GAME_PORT|VR_QUERY_PORT|VR_ADDRESS|VR_BIND_ADDRESS|VR_SAVE_NAME|VR_SECURE|VR_LAN_MODE|VR_RCON_*|VR_RESET_DAYS_INTERVAL) ;;
      *) unset "$variable" ;;
    esac
  done < <(compgen -A variable VR_)
  export COMPILE_HOST_SETTINGS=false COMPILE_GAME_SETTINGS=false
  /usr/local/bin/dauva-vrising-reconcile-admins
  exec /vrising/scripts/init.sh
fi

export VR_LIST_ON_EOS
VR_LIST_ON_EOS="$(normalize_boolean \
  "${DAUVA_VRISING_PUBLIC_LISTING:-false}" \
  "Public listing")"
export VR_LIST_ON_STEAM="$VR_LIST_ON_EOS"

readonly max_users="${VR_MAX_USERS:-10}"
[[ "$max_users" =~ ^[0-9]+$ ]] || \
  fail "Maximum players must be a whole number from 1 through 128."
(( 10#$max_users >= 1 && 10#$max_users <= 128 )) || \
  fail "Maximum players must be from 1 through 128."
export VR_MAX_USERS="$((10#$max_users))"

readonly password_enabled="$(normalize_boolean \
  "${DAUVA_VRISING_PASSWORD_ENABLED:-false}" \
  "Password protection")"
readonly join_password="${VR_PASSWORD:-}"
if [[ "$password_enabled" == true ]]; then
  (( ${#join_password} >= 4 && ${#join_password} <= 128 )) || \
    fail "A 4 to 128 character join password is required when password protection is on."
  export VR_PASSWORD="$join_password"
else
  export VR_PASSWORD=""
fi

readonly difficulty="${DAUVA_VRISING_DIFFICULTY:-normal}"
case "${difficulty,,}" in
  easy) export VR_DIFFICULTY_PRESET="Difficulty_Easy" ;;
  normal) export VR_DIFFICULTY_PRESET="Difficulty_Normal" ;;
  brutal) export VR_DIFFICULTY_PRESET="Difficulty_Brutal" ;;
  *) fail "Difficulty must be easy, normal, or brutal." ;;
esac

/usr/local/bin/dauva-vrising-reconcile-admins
exec /vrising/scripts/init.sh
