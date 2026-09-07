#!/usr/bin/env bash
set -euo pipefail
launcher=${1:-"$(dirname "$0")/upstream/src/run_server.sh"}
bash -n "$launcher"
# Import functions only. Never execute SteamCMD or the launcher's main block.
source <(sed '/^## Main/,$d' "$launcher")
fixture_dir=$(mktemp -d)
trap 'rm -f -- "$fixture_dir/ProjectZomboid64.json"; rmdir -- "$fixture_dir"' EXIT
SERVER_VM_CONFIG="$fixture_dir/ProjectZomboid64.json"

reset_fixture() {
    printf '%s\n' '{"vmArgs":["-Xmx8192m","-Xms8192m","-XX:+UseZGC"],"preserve":"unchanged"}' > "$SERVER_VM_CONFIG"
}
for budget in 4096m 128m 4g 4G 4096M; do
    reset_fixture
    MAX_RAM=$budget
    apply_memory_budget
    grep -Fq -- "\"-Xmx$budget\"" "$SERVER_VM_CONFIG"
    grep -Fq -- '"-Xms128m"' "$SERVER_VM_CONFIG"
    grep -Fq -- '"preserve":"unchanged"' "$SERVER_VM_CONFIG"
    grep -Fq -- '"-XX:+UseZGC"' "$SERVER_VM_CONFIG"
done
for budget in '' invalid 0m 127m 01g 1t 1000000g '4g;exit 1'; do
    reset_fixture
    before=$(cksum < "$SERVER_VM_CONFIG")
    MAX_RAM=$budget
    if apply_memory_budget 2>/dev/null; then
        printf 'Unexpectedly accepted invalid budget: %s\n' "$budget" >&2
        exit 1
    fi
    test "$(cksum < "$SERVER_VM_CONFIG")" = "$before"
done

# Unknown launch formats fail closed, without starting the game.
MAX_RAM=4096m
for content in '{"vmArgs":["-Xmx8192m"]}' '{"vmArgs":["-Xms8192m"]}' '{}'; do
    printf '%s\n' "$content" > "$SERVER_VM_CONFIG"
    before=$(cksum < "$SERVER_VM_CONFIG")
    if apply_memory_budget; then exit 1; fi
    test "$(cksum < "$SERVER_VM_CONFIG")" = "$before"
done

# Prove the first start receives the limit, not only post-install startup.
reset_fixture
BASE_GAME_DIR=$fixture_dir
CONFIG_DIR=$fixture_dir
ADMIN_USERNAME=fixture
ADMIN_PASSWORD=fixture
BIND_IP=127.0.0.1
DEFAULT_PORT=16261
SERVER_NAME=fixture
STEAM_VAC=true
USE_STEAM=-nosteam
TIMEOUT=60
timeout() {
    test "$1" = 60
    grep -Fq -- '"-Xmx4096m"' "$SERVER_VM_CONFIG"
    grep -Fq -- '"-Xms128m"' "$SERVER_VM_CONFIG"
}
start_server
MAX_RAM=invalid
if start_server 2>/dev/null; then exit 1; fi
printf 'Launcher memory-budget regression tests passed (no game started).\n'
