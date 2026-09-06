#!/usr/bin/env bash
set -Eeuo pipefail

# The upstream init script has already selected the game user and ownership.
export DISPLAY=:0.0
# Wine must see a ready display on its first invocation, including registry
# checks: an already-running headless wineserver can cache an unusable driver.
/usr/local/bin/dauva-vrising-prepare-display
/usr/local/bin/dauva-vrising-prepare-wine
/usr/local/bin/dauva-vrising-install-first-run
exec /vrising/scripts/upstream-start.sh
