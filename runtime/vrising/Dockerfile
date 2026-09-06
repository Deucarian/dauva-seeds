FROM docker.io/zkoesters/vrising-server@sha256:5d39d8a859eb92f1d8dac4f1e35acd3ac1b003f7f93d46e1e22d38d3a6373f58

LABEL org.opencontainers.image.title="Dauva V Rising runtime" \
      org.opencontainers.image.description="Audited Wine runtime for Dauva-managed V Rising dedicated Servers" \
      org.opencontainers.image.source="https://github.com/Deucarian/dauva-seeds" \
      org.opencontainers.image.licenses="MIT" \
      dev.dauva.runtime.version="1.2.2" \
      dev.dauva.upstream.image="docker.io/zkoesters/vrising-server@sha256:5d39d8a859eb92f1d8dac4f1e35acd3ac1b003f7f93d46e1e22d38d3a6373f58"

COPY --chmod=0755 dauva-entrypoint.sh /usr/local/bin/dauva-vrising-entrypoint
COPY --chmod=0755 reconcile-admins.sh /usr/local/bin/dauva-vrising-reconcile-admins
COPY --chmod=0755 healthcheck.sh /usr/local/bin/dauva-vrising-healthcheck
COPY --chmod=0755 prepare-wine.sh /usr/local/bin/dauva-vrising-prepare-wine
COPY --chmod=0755 prepare-display.sh /usr/local/bin/dauva-vrising-prepare-display
COPY --chmod=0755 install-first-run.sh /usr/local/bin/dauva-vrising-install-first-run
RUN mv /vrising/scripts/start.sh /vrising/scripts/upstream-start.sh
# The pinned launcher otherwise starts Xvfb asynchronously after Wine was
# initialized without DISPLAY. Refuse upstream drift instead of a loose edit.
RUN grep -Fxq 'Xvfb :0 -screen 0 1024x768x16 &' /vrising/scripts/upstream-start.sh \
    && sed -i 's#^Xvfb :0 -screen 0 1024x768x16 &$#test -S /tmp/.X11-unix/X0 || exit 70#' /vrising/scripts/upstream-start.sh
COPY --chmod=0755 start.sh /vrising/scripts/start.sh

ENV DAUVA_SETTINGS_PROFILE_VERSION=1 \
    UPDATE_ON_BOOT=false \
    AUTO_UPDATE_ENABLED=false \
    AUTO_REBOOT_ENABLED=false \
    AUTO_ANNOUNCE_ENABLED=false \
    COMPILE_HOST_SETTINGS=false \
    COMPILE_GAME_SETTINGS=false \
    VR_RCON_ENABLED=false \
    VR_SECURE=true \
    VR_LAN_MODE=false \
    VR_RESET_DAYS_INTERVAL=0

HEALTHCHECK --interval=30s --timeout=10s --start-period=30m --retries=3 \
  CMD ["/usr/local/bin/dauva-vrising-healthcheck"]

STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/dauva-vrising-entrypoint"]
