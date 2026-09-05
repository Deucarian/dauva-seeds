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
