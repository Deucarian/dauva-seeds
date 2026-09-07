#!/usr/bin/env bash
set -euo pipefail
image=${1:?candidate image required}
docker run --rm --network none --entrypoint /bin/bash "$image" -euc '
  test "$(id -u)" = 1000
  test "$(id -g)" = 1000
  test -d /home/steam/Zomboid
  test -d /home/steam/ZomboidDedicatedServer
  test -x /home/steam/run_server.sh
  test -x /home/steam/edit_server_config.py
  test -x /usr/bin/rcon
  test -f /usr/share/dauva/project-zomboid/source/LICENSE
  grep -aFq GLIBCXX_3.4.29 /usr/lib/x86_64-linux-gnu/libstdc++.so.6
  bash -n /home/steam/run_server.sh
  python3 -c "import configparser; import sys"
'

# Exercise the exact image's launcher without Steam downloads or game ports.
docker run --rm -i --network none --entrypoint /bin/bash "$image" \
  -seu /home/steam/run_server.sh < "$(dirname "$0")/test-launcher.sh"
