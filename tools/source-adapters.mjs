const httpsUrlPattern = /^https:\/\//;

export function normalizeSource(descriptor) {
  const kind = String(descriptor.kind ?? "").trim().toLowerCase();
  if (!["oci", "steamcmd", "linuxgsm", "dauva"].includes(kind)) {
    throw new Error(`Unsupported Seed source '${descriptor.kind}'.`);
  }
  const homepage = requireHttps(descriptor.homepage, "homepage");
  const repository = requireHttps(descriptor.repository, "repository");
  const imageRegistries = [
    ...new Set(
      (descriptor.imageRegistries ?? [])
        .map((value) => String(value).trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
  if (imageRegistries.length === 0) {
    throw new Error("A Seed source requires at least one OCI registry.");
  }
  return {
    kind,
    homepage,
    repository,
    imageRegistries,
    ...(descriptor.upstreamId
      ? { upstreamId: String(descriptor.upstreamId).trim() }
      : {}),
  };
}

export function sourceRuntimeDefaults(source, { reviewedAt } = {}) {
  const normalized = normalizeSource(source);
  if (
    typeof reviewedAt !== "string" ||
    !/^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$/.test(reviewedAt) ||
    Number.isNaN(Date.parse(`${reviewedAt}T00:00:00.000Z`))
  ) {
    throw new Error("Source review date must be supplied as YYYY-MM-DD.");
  }
  return {
    source: normalized,
    trust: {
      level: normalized.kind === "dauva" ? "verified" : "community",
      reviewedAt,
      mutableRuntimeImagesAllowed: false,
    },
    updatePolicy: {
      discovery:
        normalized.kind === "steamcmd" || normalized.kind === "linuxgsm"
          ? "steamcmd"
          : "oci-tag",
      automaticCheck: true,
      automaticInstall: false,
      requiresBackup: false,
      rollback: true,
    },
  };
}

export function linuxGsmDescriptor({
  gameId,
  homepage,
  repository = "https://github.com/GameServerManagers/docker-gameserver",
  registry = "docker.io",
}) {
  const normalizedGameId = String(gameId ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedGameId)) {
    throw new Error("LinuxGSM gameId must be a Dauva identifier.");
  }
  return normalizeSource({
    kind: "linuxgsm",
    homepage,
    repository,
    imageRegistries: [registry],
    upstreamId: normalizedGameId,
  });
}

export function steamCmdDescriptor({
  appId,
  homepage,
  repository = "https://github.com/GameServerManagers/docker-steamcmd",
  registry = "docker.io",
}) {
  const normalizedAppId = String(appId ?? "").trim();
  if (!/^[0-9]+$/.test(normalizedAppId)) {
    throw new Error("SteamCMD appId must be numeric.");
  }
  return normalizeSource({
    kind: "steamcmd",
    homepage,
    repository,
    imageRegistries: [registry],
    upstreamId: normalizedAppId,
  });
}

export function ociDescriptor({
  homepage,
  repository,
  registry = "docker.io",
  upstreamId,
}) {
  return normalizeSource({
    kind: "oci",
    homepage,
    repository,
    imageRegistries: [registry],
    upstreamId,
  });
}

export function dauvaDescriptor({
  homepage,
  repository,
  registry = "ghcr.io",
  upstreamId,
}) {
  return normalizeSource({
    kind: "dauva",
    homepage,
    repository,
    imageRegistries: [registry],
    upstreamId,
  });
}

function requireHttps(value, field) {
  const normalized = String(value ?? "").trim();
  if (!httpsUrlPattern.test(normalized)) {
    throw new Error(`Seed source ${field} must use HTTPS.`);
  }
  return normalized;
}
