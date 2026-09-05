#!/usr/bin/env bash
set -Eeuo pipefail

# An interrupted first Wine boot can leave an update marker with almost none
# of the default registry entries. Wine then skips initialization, and V Rising
# runs while every autosave fails in CryptAcquireContext/RandomNumberGenerator.
export WINEDEBUG=-all

crypto_provider_ready() {
  wine reg query \
    'HKLM\Software\Microsoft\Cryptography\Defaults\Provider Types\Type 001' \
    /ve >/dev/null 2>&1 &&
  wine reg query \
    'HKLM\Software\Microsoft\Cryptography\Defaults\Provider\Microsoft Enhanced RSA and AES Cryptographic Provider' \
    /v 'Image Path' >/dev/null 2>&1
}

if crypto_provider_ready; then
  exit 0
fi

printf '%s\n' 'Dauva V Rising: repairing incomplete Wine cryptography registration.'
wineboot --update
wineserver -w
if ! crypto_provider_ready; then
  printf '%s\n' 'Dauva V Rising: Wine cryptography is unavailable; refusing to start a server that cannot save.' >&2
  exit 70
fi
wineserver -w
