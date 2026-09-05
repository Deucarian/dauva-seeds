#!/usr/bin/env bash
set -Eeuo pipefail

readonly image="${1:-dauva-vrising-runtime:test}"

# This fixture replaces only the final launcher inside a disposable container.
# It proves startup precedence without downloading or starting the actual game.
docker run --rm --entrypoint bash "$image" -Eeuo pipefail -c '
  mkdir -p /vrising/data/Settings
  printf "%s\n" "{\"TeleportBoundItems\":false,\"ClanSize\":8}" > /vrising/data/Settings/ServerGameSettings.json
  printf "%s\n" "{\"MaxConnectedUsers\":12,\"GameSettingsPreset\":\"\",\"GameDifficultyPreset\":\"\"}" > /vrising/data/Settings/ServerHostSettings.json
  cp /vrising/data/Settings/ServerGameSettings.json /tmp/original-game
  printf "%s\n" "#!/usr/bin/env bash" "set -Eeuo pipefail" \
    "test -z \"\${VR_PRESET+x}\"" "test -z \"\${VR_DIFFICULTY_PRESET+x}\"" \
    "test -z \"\${VR_MAX_USERS+x}\"" \
    "test \"\${VR_GAME_PORT}\" = 27777" \
    "cmp /tmp/original-game /vrising/data/Settings/ServerGameSettings.json" \
    > /vrising/scripts/init.sh
  chmod +x /vrising/scripts/init.sh
  export DAUVA_NATIVE_SETTINGS=true VR_PRESET=StandardPvE VR_DIFFICULTY_PRESET=Difficulty_Brutal
  export VR_MAX_USERS=10 VR_GAME_PORT=27777
  /usr/local/bin/dauva-vrising-entrypoint
'

docker run --rm --entrypoint bash "$image" -Eeuo pipefail -c '
  unset DAUVA_VRISING_INITIAL_ADMINS
  /usr/local/bin/dauva-vrising-reconcile-admins
  test -f /vrising/data/Settings/adminlist.txt
  test ! -s /vrising/data/Settings/adminlist.txt
'

if docker run --rm \
  --env VR_MAX_USERS=129 \
  --env DAUVA_VRISING_INITIAL_ADMINS=Test=76561197960265729 \
  "$image"; then
  echo "Out-of-range maximum players was accepted." >&2
  exit 1
fi

if docker run --rm \
  --env DAUVA_VRISING_PASSWORD_ENABLED=true \
  --env DAUVA_VRISING_INITIAL_ADMINS=Test=76561197960265729 \
  "$image"; then
  echo "Missing enabled join password was accepted." >&2
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
  printf "%b\n" "CryptographicException: Couldn\047t access random source." >> /vrising/data/logs/latest.log
  if /usr/local/bin/dauva-vrising-healthcheck; then
    echo "A server with failing autosaves was reported healthy." >&2
    kill "$process"
    exit 1
  fi
  kill "$process"
'

# Reproduce the incomplete-prefix failure without starting a game or touching
# a persistent world. Initialization must restore the missing provider.
docker run --rm --user 1000:1000 --entrypoint bash "$image" -Eeuo pipefail -c '
  /usr/local/bin/dauva-vrising-prepare-wine
  provider="HKLM\\Software\\Microsoft\\Cryptography\\Defaults\\Provider Types\\Type 001"
  WINEDEBUG=-all wine reg delete "$provider" /f
  WINEDEBUG=-all wineserver -w
  if WINEDEBUG=-all wine reg query "$provider" /ve >/dev/null 2>&1; then
    echo "Failed to create the incomplete-prefix regression fixture." >&2
    exit 1
  fi
  /usr/local/bin/dauva-vrising-prepare-wine
  WINEDEBUG=-all wine reg query "$provider" /ve >/dev/null
  WINEDEBUG=-all wineserver -w
'
