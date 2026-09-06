#!/usr/bin/env bash
set -Eeuo pipefail
source "${SCRIPTSDIR}/helper_functions.sh"
source "${SCRIPTSDIR}/helper_install.sh"

# Never refresh an existing installation. UPDATE_ON_BOOT remains controlled by
# Dauva. A new SteamCMD client can return Missing configuration on first login;
# resume that same install directory only after its process actually exits.
if IsInstalled; then
  exit 0
fi
for ((attempt=1; attempt<=2; attempt++)); do
  printf 'Dauva V Rising: preparing initial game installation (attempt %s/2).\n' "$attempt"
  if InstallServer && IsInstalled; then
    exit 0
  fi
  if ((attempt < 2)); then
    sleep 2
  fi
done
printf '%s\n' 'Dauva V Rising: initial installation was not verified; game launch blocked.' >&2
exit 70
