#!/usr/bin/env bash
set -Eeuo pipefail

# Xorg's displayfd writes the display number only after the server is ready.
# A Unix socket appearing alone does not establish successful initialization.
readonly ready_file="$(mktemp /tmp/dauva-display-ready.XXXXXX)"
display_ready=false
display_pid=''
cleanup() {
  rm -f -- "$ready_file"
  if [[ "$display_ready" != true && -n "$display_pid" ]]; then
    kill "$display_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
Xvfb :0 -screen 0 1024x768x16 -displayfd 3 3>"$ready_file" &
display_pid=$!
for ((attempt=0; attempt<150; attempt++)); do
  if [[ -s "$ready_file" ]] && [[ "$(<"$ready_file")" == 0 ]]; then
    display_ready=true
    exit 0
  fi
  if ! kill -0 "$display_pid" 2>/dev/null; then
    break
  fi
  sleep 0.1
done
printf '%s\n' 'Dauva V Rising: display initialization was not confirmed; game launch blocked.' >&2
exit 70
