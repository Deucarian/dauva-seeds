#!/usr/bin/env bash
set -Eeuo pipefail

readonly log_file="/vrising/data/logs/latest.log"

server_running=false
for command_line in /proc/[0-9]*/cmdline; do
  if grep -aFq 'VRisingServer.exe' "$command_line" 2>/dev/null; then
    server_running=true
    break
  fi
done
[[ "$server_running" == true ]]
[[ -s "$log_file" ]]
grep -Fq '[Server] Startup Completed - Disabling Scene Loading Systems' "$log_file"
if grep -Fq "CryptographicException: Couldn't access random source." "$log_file"; then
  printf '%s\n' 'V Rising cannot save: Wine cryptography failed.' >&2
  exit 1
fi
# The game can still generate a world, autosave and log Startup Completed after
# this authoritative Steam initialization failure. Neither a save nor a bound
# UDP socket makes that process joinable. Match the game's fatal messages, not
# generic DNS/connection timeouts that can occur during normal operation.
if grep -Fq \
  -e 'Waited for GameServer LogOn for over 30 seconds. Fatal error.' \
  -e 'Failed to initialize SteamNetworking' \
  -e 'SteamNetworking Server API was not initialized when ServerSteamTransportLayer was spawned!' \
  "$log_file"; then
  printf '%s\n' 'V Rising networking is unavailable: Steam initialization failed.' >&2
  exit 1
fi
