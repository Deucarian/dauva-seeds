#!/usr/bin/env bash

#
#  Project Zomboid Dedicated Server using SteamCMD Docker Image.
#  Copyright (C) 2021-2022 Renegade-Master [renegade.master.dev@protonmail.com]
#
#  This program is free software: you can redistribute it and/or modify
#  it under the terms of the GNU General Public License as published by
#  the Free Software Foundation, either version 3 of the License, or
#  (at your option) any later version.
#
#  This program is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU General Public License for more details.
#
#  You should have received a copy of the GNU General Public License
#  along with this program.  If not, see <https://www.gnu.org/licenses/>.
#

#######################################################################
#   Author: Renegade-Master
#   Contributors: JohnEarle, ramielrowe
#   Description: Install, update, and start a Dedicated Project Zomboid
#       instance.
#######################################################################

# Set to `-x` for Debug logging
set +x -o pipefail

# Handle shutting down the server, with optional RCON quit for graceful shutdown
function shutdown() {
    if [[ "$RCON_ENABLED" == "true" ]]; then
        printf "\n### Sending RCON quit command\n"
        rcon --address "$BIND_IP:$RCON_PORT" --password "$RCON_PASSWORD" quit
    else
        printf "\n### RCON not enabled: cannot issue quit command.\nSending SIGTERM...\n"
        pkill -P $$
    fi
}

# Apply the managed JVM budget before any server process can start.
function apply_memory_budget() {
    # Dauva 2026-09-07: apply the assigned memory budget BEFORE the first
    # temporary world-generation start, not only after post-install config.
    # Never let two fresh games reserve their larger factory JVM heaps.
    if [[ ! "$MAX_RAM" =~ ^[1-9][0-9]{0,5}[mMgG]$ ]]; then
        printf '\n### Invalid managed JVM memory budget.\n' >&2
        return 1
    fi
    local amount="${MAX_RAM%?}"
    if [[ "$MAX_RAM" == *[mM] && "$amount" -lt 128 ]]; then
        printf '\n### Managed JVM memory must be at least 128 MiB.\n' >&2
        return 1
    fi
    # Current game files omit Xms. Insert it into the actual JSON argument
    # array, preserving unrelated values; reject ambiguous/malformed input.
    python3 - "$SERVER_VM_CONFIG" "$MAX_RAM" <<'DAUVA_JVM'
import json
import os
import stat
import sys

path, budget = sys.argv[1:]
def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate launch property')
        result[key] = value
    return result

source_stat = os.lstat(path)
if not stat.S_ISREG(source_stat.st_mode) or source_stat.st_size > 1024 * 1024:
    raise ValueError('Unexpected launch file')
with open(path, encoding='utf-8') as stream:
    document = json.load(stream, object_pairs_hook=unique_object)
args = document.get('vmArgs') if isinstance(document, dict) else None
if not isinstance(args, list) or len(args) > 512 or not all(isinstance(arg, str) for arg in args):
    raise ValueError('Unexpected launch arguments')
if sum(arg.startswith('-Xmx') for arg in args) != 1 or sum(arg.startswith('-Xms') for arg in args) > 1:
    raise ValueError('Ambiguous managed heap arguments')
remaining = [arg for arg in args if not arg.startswith(('-Xmx', '-Xms'))]
document['vmArgs'] = ['-Xmx' + budget, '-Xms128m'] + remaining
temp = path + '.dauva-jvm-' + str(os.getpid())
try:
    with open(temp, 'x', encoding='utf-8') as stream:
        os.fchmod(stream.fileno(), stat.S_IMODE(source_stat.st_mode))
        json.dump(document, stream, separators=(',', ':'), ensure_ascii=False)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)
    directory = os.open(os.path.dirname(path), os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
finally:
    if os.path.exists(temp):
        os.unlink(temp)
DAUVA_JVM
}

# Start the Server
function start_server() {
    apply_memory_budget || return 1
    printf "\n### Starting Project Zomboid Server...\n"

    timeout "$TIMEOUT" "$BASE_GAME_DIR"/start-server.sh \
        -cachedir="$CONFIG_DIR" \
        -adminusername "$ADMIN_USERNAME" \
        -adminpassword "$ADMIN_PASSWORD" \
        -ip "$BIND_IP" -port "$DEFAULT_PORT" \
        -servername "$SERVER_NAME" \
        -steamvac "$STEAM_VAC" "$USE_STEAM" &

    server_pid=$!
    wait $server_pid

    # NOTE(ramielrowe): Apparently the first wait will return immediately after
    #   the trap handler returns. The server can take a couple seconds to fully
    #   shutdown after the `quit` command. So, call wait once more to ensure
    #   the server is fully stopped.
    wait $server_pid

    printf "\n### Project Zomboid Server stopped.\n"
}

function apply_postinstall_config() {
    printf "\n### Applying Post Install Configuration...\n"

    # Set the Autosave Interval
    "$EDIT_CONFIG" "$SERVER_CONFIG" "SaveWorldEveryMinutes" "$AUTOSAVE_INTERVAL"

    # Set the default Server Port
    "$EDIT_CONFIG" "$SERVER_CONFIG" "DefaultPort" "$DEFAULT_PORT"

    # Set the default extra UDP Port
    "$EDIT_CONFIG" "$SERVER_CONFIG" "UDPPort" "$UDP_PORT"

    # Set the Max Players
    "$EDIT_CONFIG" "$SERVER_CONFIG" "MaxPlayers" "$MAX_PLAYERS"

    # Set the Mod names
    "$EDIT_CONFIG" "$SERVER_CONFIG" "Mods" "$MOD_NAMES"

    # Set the Map names
    "$EDIT_CONFIG" "$SERVER_CONFIG" "Map" "$MAP_NAMES"

    # Set the Mod Workshop IDs
    "$EDIT_CONFIG" "$SERVER_CONFIG" "WorkshopItems" "$MOD_WORKSHOP_IDS"

    # Set the Pause on Empty Server
    "$EDIT_CONFIG" "$SERVER_CONFIG" "PauseEmpty" "$PAUSE_ON_EMPTY"

    # Set the Server Publicity status
    "$EDIT_CONFIG" "$SERVER_CONFIG" "Open" "$PUBLIC_SERVER"

    # Set the Server RCON Password
    "$EDIT_CONFIG" "$SERVER_CONFIG" "RCONPassword" "$RCON_PASSWORD"

    # Set the Server RCON Port
    "$EDIT_CONFIG" "$SERVER_CONFIG" "RCONPort" "$RCON_PORT"

    # Set the Server Name
    "$EDIT_CONFIG" "$SERVER_CONFIG" "PublicName" "$SERVER_NAME"

    # Set the Server Password
    "$EDIT_CONFIG" "$SERVER_CONFIG" "Password" "$SERVER_PASSWORD"

    # Dauva applies both heap limits before every start, including first run.

    # Set the GC for the JVM (advanced, some crashes can be fixed with a different GC algorithm)
    sed -i "s/-XX:+Use.*/-XX:+Use${GC_CONFIG}\",/g" "${SERVER_VM_CONFIG}"

    printf "\n### Post Install Configuration applied.\n"
}

# Test if this is the the first time the server has run
function test_first_run() {
    printf "\n### Checking if this is the first run...\n"

    if [[ ! -f "$SERVER_CONFIG" ]] || [[ ! -f "$SERVER_RULES_CONFIG" ]]; then
        printf "\n### This is the first run.\nStarting server for %s seconds\n" "$TIMEOUT"
        start_server || return 1
        TIMEOUT=0
    else
        printf "\n### This is not the first run.\n"
        TIMEOUT=0
    fi

    printf "\n### First run check complete.\n"
}

# Fixed Steam entry point; separated so no-game regressions can stub it.
function run_steam_install() {
    /home/steam/steamcmd/steamcmd.sh +runscript "$STEAM_INSTALL_FILE"
}

# Update the server
function update_server() {
    printf "\n### Updating Project Zomboid Server...\n"

    # Dauva 2026-09-07: a fresh SteamCMD install can need one initialization
    # retry. Resume the same fixed app/path at most twice, never loop forever
    # or report a failed update as successful because the last printf worked.
    local attempts=1
    local attempt
    if [[ ! -x "$BASE_GAME_DIR/start-server.sh" || ! -s "$SERVER_VM_CONFIG" ]]; then
        attempts=2
    fi
    for ((attempt=1; attempt<=attempts; attempt++)); do
        if run_steam_install && [[ -x "$BASE_GAME_DIR/start-server.sh" && -s "$SERVER_VM_CONFIG" ]]; then
            printf "\n### Project Zomboid Server updated.\n"
            return 0
        fi
        printf '\n### Steam install attempt %s/%s did not complete.\n' "$attempt" "$attempts" >&2
    done

    return 1
}

# Apply user configuration to the server
function apply_preinstall_config() {
    printf "\n### Applying Pre Install Configuration...\n"

    # Set the selected game version
    sed -i "s/beta .* /beta $GAME_VERSION /g" "$STEAM_INSTALL_FILE"

    printf "\n### Pre Install Configuration applied.\n"
}

# Set variables for use in the script
function set_variables() {
    printf "\n### Setting variables...\n"

    TIMEOUT="60"
    EDIT_CONFIG="/home/steam/edit_server_config.py"
    STEAM_INSTALL_FILE="/home/steam/install_server.scmd"
    BASE_GAME_DIR="/home/steam/ZomboidDedicatedServer"
    CONFIG_DIR="/home/steam/Zomboid"

    # Set the Server Admin Password variable
    ADMIN_USERNAME=${ADMIN_USERNAME:-"admin"}

    # Set the Server Admin Password variable
    ADMIN_PASSWORD=${ADMIN_PASSWORD:-"changeme"}

    # Set the Autosave Interval variable
    AUTOSAVE_INTERVAL=${AUTOSAVE_INTERVAL:-"15"}

    # Set the IP address variable
    # NOTE: Project Zomboid cannot handle the IN_ANY address
    if [[ -z "$BIND_IP" ]] || [[ "$BIND_IP" == "0.0.0.0" ]]; then
        BIND_IP=($(hostname -I))
        BIND_IP="${BIND_IP[0]}"
    else
        BIND_IP="$BIND_IP"
    fi
    echo "$BIND_IP" > "$CONFIG_DIR/ip.txt"

    # Set the IP Game Port variable
    DEFAULT_PORT=${DEFAULT_PORT:-"16261"}

    # Set the extra UDP Game Port variable
    UDP_PORT=${UDP_PORT:-"16262"}

    # Set the game version variable
    GAME_VERSION=${GAME_VERSION:-"public"}

    # Set the Max Players variable
    MAX_PLAYERS=${MAX_PLAYERS:-"16"}

    # Set the Maximum RAM variable
    MAX_RAM=${MAX_RAM:-"4096m"}

    # Sets GC
    GC_CONFIG=${GC_CONFIG:-"ZGC"}

    # Set the Mods to use from workshop
    MOD_NAMES=${MOD_NAMES:-""}
    MOD_WORKSHOP_IDS=${MOD_WORKSHOP_IDS:-""}

    # Set the Maps to use
    MAP_NAMES=${MAP_NAMES:-"Muldraugh, KY"}

    # Set the Pause on Empty variable
    PAUSE_ON_EMPTY=${PAUSE_ON_EMPTY:-"true"}

    # Set the Server Publicity variable
    PUBLIC_SERVER=${PUBLIC_SERVER:-"true"}

    # Set the IP Query Port variable
    DEFAULT_PORT=${DEFAULT_PORT:-"16261"}

    # Set the Server name variable
    SERVER_NAME=${SERVER_NAME:-"ZomboidServer"}

    # Set the Server Password variable
    SERVER_PASSWORD=${SERVER_PASSWORD:-""}

    # Set Steam VAC Protection variable
    STEAM_VAC=${STEAM_VAC:-"true"}

    # Set server type variable
    if [[ -z "$USE_STEAM" ]] || [[ "$USE_STEAM" == "true" ]]; then
        USE_STEAM=""
    else
        USE_STEAM="-nosteam"
    fi

    # Set RCON configuration
    if [[ -z "$RCON_PORT" ]] || [[ "$RCON_PORT" == "0" ]]; then
        RCON_ENABLED="false"
    else
        RCON_ENABLED="true"
        RCON_PORT=${RCON_PORT:-"27015"}
        RCON_PASSWORD=${RCON_PASSWORD:-"changeme_rcon"}
    fi

    SERVER_CONFIG="$CONFIG_DIR/Server/$SERVER_NAME.ini"
    SERVER_VM_CONFIG="$BASE_GAME_DIR/ProjectZomboid64.json"
    SERVER_RULES_CONFIG="$CONFIG_DIR/Server/${SERVER_NAME}_SandboxVars.lua"
}

## Main
set_variables
apply_preinstall_config
update_server || exit 1
test_first_run || exit 1
apply_postinstall_config

# Intercept termination signals to stop the server gracefully
trap shutdown SIGTERM SIGINT

start_server
