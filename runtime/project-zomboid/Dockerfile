# Preserve the released Dauva PZ data paths, UID and launch contract while
# updating the OS C++ runtime required by the current Steam server binary.
FROM docker.io/cm2network/steamcmd@sha256:45f6515d6c4dcde659c9ad6872bdbeacd1bf5c4e7f241829c4d2f28fb5eda581

LABEL org.opencontainers.image.title="Dauva Project Zomboid compatibility runtime" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.source="https://github.com/Deucarian/dauva-seeds" \
      org.opencontainers.image.licenses="GPL-3.0-or-later" \
      dev.dauva.upstream.revision="09c57b2bdbc67642fa2c70bfab72a7f4b822c8cd"

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3-minimal procps musl \
    && rm -rf /var/lib/apt/lists/* \
    && test "$(id -u steam)" = 1000 \
    && test "$(id -g steam)" = 1000

# Reuse the immutable deployed image's RCON utility; do not fetch a mutable
# unauthenticated executable. No game binaries or owner world are copied.
COPY --from=docker.io/sknnr/project-zomboid-server@sha256:380245ec450d0ac76bd4a96e7ca3e693db18ac16ac6bce344b55512a0c22fb42 /usr/bin/rcon /usr/bin/rcon
COPY --chown=1000:1000 upstream/src/ /home/steam/
COPY upstream/ /usr/share/dauva/project-zomboid/source/
COPY Dockerfile VERSION /usr/share/dauva/project-zomboid/source/
RUN chmod 0755 /home/steam/run_server.sh /home/steam/edit_server_config.py /usr/bin/rcon \
    && mkdir -p /home/steam/Zomboid /home/steam/ZomboidDedicatedServer \
    && chown 1000:1000 /home/steam/Zomboid /home/steam/ZomboidDedicatedServer
USER 1000:1000
WORKDIR /home/steam
ENTRYPOINT ["/bin/bash", "/home/steam/run_server.sh"]
