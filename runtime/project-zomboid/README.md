# Project Zomboid compatibility runtime — candidate only

The released upstream image cannot load the current Steam server binary because
its libstdc++ lacks GLIBCXX_3.4.29. This rebuild uses a pinned current SteamCMD
base (Debian 13) while retaining UID/GID1000, /home/steam/Zomboid and
/home/steam/ZomboidDedicatedServer, and the existing launch/settings contract.
It does not adopt the newer upstream image's different UID10000/data layout.

The launcher/config editor/Steam recipe and GPL license are derived
from https://github.com/jsknnr/zomboid-dedicated-server at
09c57b2bdbc67642fa2c70bfab72a7f4b822c8cd. The complete corresponding wrapper
source, license, Dockerfile and version are also included in the image. The
existing pinned image supplies its RCON utility; game files are downloaded by
SteamCMD at first start and are not redistributed inside this image.

Dauva additionally applies MAX_RAM and a bounded initial heap before the first
temporary world-generation start. The archived launcher applied its memory
limit only afterwards. The disposable VM became unresponsive during two
simultaneous first starts. Guest kernel logs subsequently confirmed a global
out-of-memory kill of a Project Zomboid process. Both affected tests were
stopped through their existing durable identities; no VM/host reboot was needed.
The first diagnostic image did not include this hardening. Do not reuse its
image hash as evidence for the updated source.

A fresh Steam initialization may resume its same app/path once (two attempts
maximum). Existing-install updates get one attempt, Steam command errors now
fail explicitly, and missing launch files cannot count as successful installation.
The launcher does not proceed into world startup after a rejected installation.
The current game's launch file has a maximum heap but no initial heap entry.
Dauva edits the real JSON argument array, adds the initial limit, and selects a
reviewed garbage collector without discarding unrelated flags or truncating
compact JSON. Malformed or ambiguous launch files fail before world startup.

Run `bash runtime/project-zomboid/test-launcher.sh` for the isolated launcher
regressions (no Docker or game start). Run `bash runtime/project-zomboid/test-runtime.sh
<exact-image>` for candidate-image dependency and launcher checks. Neither is
real-game qualification. The candidate has not been published or promoted.
The repository's Project Zomboid workflow runs these same no-game checks for
pull requests and changes on Develop/Main. It does not publish an image or
alter the catalog. When archiving this directory on Windows for a Linux build,
use `git -c core.autocrlf=false archive`; a subtree archive does not inherit its
parent directory's shell line-ending attributes.

This directory is not a Seed promotion or runtime proof. Qualify both current
variants in separate disposable persistent worlds, including gameplay settings,
password handling, native readback and second ordinary restarts. Any published
image requires a new exact Seed version, authenticated proof and the governed
promotion flow. Do not replace an owner's running world using this candidate.
