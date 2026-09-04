#!/usr/bin/env bash
set -Eeuo pipefail

readonly image="${1:-dauva-vrising-runtime:test}"

if docker run --rm \
  --env VR_MAX_USERS=129 \
  --env DAUVA_VRISING_INITIAL_ADMINS=Test=76561197960265729 \
  "$image"; then
  echo "Out-of-range maximum players was accepted." >&2
  exit 1
fi

docker run --rm --entrypoint bash "$image" -Eeuo pipefail -c '
  first=76561197960265729
  second=76561197960265730
  export DAUVA_VRISING_INITIAL_ADMINS="First=${first};First duplicate=${first}"
  /usr/local/bin/dauva-vrising-reconcile-admins
  export DAUVA_VRISING_INITIAL_ADMINS="Second=${second}"
  /usr/local/bin/dauva-vrising-reconcile-admins
  printf "%s\n%s\n" "$first" "$second" > /tmp/expected-admins
  cmp /tmp/expected-admins /vrising/data/Settings/adminlist.txt
  test "$(tail -c 1 /vrising/data/Settings/adminlist.txt | od -An -t x1 | tr -d " ")" = "0a"
'

docker run --rm --entrypoint bash "$image" -Eeuo pipefail -c '
  mkdir -p /vrising/data/Settings
  printf "%s\n" 76561197960265729 > /vrising/data/Settings/adminlist.txt
  cp /vrising/data/Settings/adminlist.txt /tmp/original-admins
  export DAUVA_VRISING_INITIAL_ADMINS="Broken=not-a-steamid"
  if /usr/local/bin/dauva-vrising-reconcile-admins; then
    echo "Invalid SteamID64 was accepted." >&2
    exit 1
  fi
  cmp /tmp/original-admins /vrising/data/Settings/adminlist.txt
'

docker run --rm --entrypoint bash "$image" -Eeuo pipefail -c '
  mkdir -p /vrising/data/logs
  printf "%s\n" "[Server] Startup Completed - Disabling Scene Loading Systems" > /vrising/data/logs/latest.log
  bash -c "exec -a VRisingServer.exe sleep 10" &
  process=$!
  /usr/local/bin/dauva-vrising-healthcheck
  kill "$process"
'
