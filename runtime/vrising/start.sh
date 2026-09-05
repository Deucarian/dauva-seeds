#!/usr/bin/env bash
set -Eeuo pipefail

# The upstream init script has already selected the game user and ownership.
/usr/local/bin/dauva-vrising-prepare-wine
exec /vrising/scripts/upstream-start.sh
