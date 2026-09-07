# Project Zomboid compatibility runtime — unpromoted

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
real-game qualification. The repository's Project Zomboid workflow runs these
same no-game checks for pull requests and changes on Develop/Main. Pull
requests and Develop have read-only credentials; only the protected Main
publication job can publish to Dauva's own registry identity. No job alters
the catalog. When archiving this directory on Windows for a Linux build,
use `git -c core.autocrlf=false archive`; a subtree archive does not inherit its
parent directory's shell line-ending attributes.

This directory is not a Seed promotion or runtime proof. Qualify both current
variants in separate disposable persistent worlds, including gameplay settings,
password handling, native readback and second ordinary restarts. Any published
image requires a new exact Seed version, authenticated proof and the governed
promotion flow. Do not replace an owner's running world using this candidate.

See [the bounded manual qualification record](qualification-20260907.md) for
both candidate variants. It records what was observed and what remains unproven;
it does not authorize catalog promotion.

## Runtime publication (1.0.1)

The only publication target is
`ghcr.io/deucarian/dauva-project-zomboid-runtime`. Version 1.0.1 adds the governed
publication path; it does not change the previously tested launcher behavior.
The old local diagnostic `docker.io/sknnr` alias must never be pushed as if
Dauva owned upstream's repository. The original 1.0.0 manual result is not an
authenticated or exact-image qualification for a newly published 1.0.1 digest.

The protected Main job first checks the image, then publishes an OCI candidate
under a source-commit-bound reference with provenance and an SBOM. It pulls and
tests that exact registry digest before assigning the semantic-version tag.
Both tags and the runtime source-tree identity are checked on resume. An
existing semantic version with another source tree is a conflict, never an
overwrite. One publication job runs at a time; timeout/lost-response recovery
reconciles the same candidate/version references. The named 10/20/100-second
lost-response tests use controllable clocks. Only an authenticated authoritative
manifest-not-found response permits first publication; authorization failures,
rate limits and timeouts remain unknown observations.

GitHub creates new container packages as private by default. The owner must
set this one package's visibility to Public before the job can confirm anonymous
access and assign its version tag. If it pauses there, keep the candidate and
rerun the same workflow revision after correcting visibility. Do not rebuild,
repush another identity, publish credentials, or weaken anonymous-access checks.
This one-time package setting is not Leaf or server enrollment.

The publication result is explicitly **not Seed proof**. The trusted Leaf
profile/catalog must separately allow this exact new repository, both variants
need exact-image settings/client/lifecycle qualification and authenticated proof,
and a new Seed version must use the governed release bundle. Existing owner
worlds, legacy images and production Seed manifests remain untouched.

Publication behavior follows [Docker's same-manifest copy contract](https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/)
and [GitHub's package authentication/visibility contract](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
