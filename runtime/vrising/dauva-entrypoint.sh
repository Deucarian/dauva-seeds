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

readonly difficulty="${DAUVA_VRISING_DIFFICULTY:-normal}"
case "${difficulty,,}" in
  easy) export VR_DIFFICULTY_PRESET="Difficulty_Easy" ;;
  normal) export VR_DIFFICULTY_PRESET="Difficulty_Normal" ;;
  brutal) export VR_DIFFICULTY_PRESET="Difficulty_Brutal" ;;
  *) fail "Difficulty must be easy, normal, or brutal." ;;
esac

/usr/local/bin/dauva-vrising-reconcile-admins
exec /vrising/scripts/init.sh
