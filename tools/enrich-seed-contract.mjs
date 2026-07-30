import { writeFile } from "node:fs/promises";
import { readManifestDirectory } from "./registry-lib.mjs";

const reviewedAt = "2026-07-26";
const requiredChecks = [
  "images-pinned",
  "healthy",
  "ports",
  "backup-if-supported",
  "graceful-stop",
  "restart",
  "persistence",
  "cleanup",
];

const metadataByPod = {
  "core-keeper": {
    homepage: "https://corekeepergame.com/",
    repository: "https://hub.docker.com/r/escaping/core-keeper-dedicated",
    download: 1200,
    install: 5000,
    mutable: 8192,
  },
  enshrouded: {
    homepage: "https://enshrouded.com/",
    repository: "https://hub.docker.com/r/mornedhels/enshrouded-server",
    download: 9000,
    install: 18000,
    mutable: 12288,
  },
  factorio: {
    homepage: "https://www.factorio.com/",
    repository: "https://github.com/factoriotools/factorio-docker",
    download: 500,
    install: 2048,
    mutable: 10240,
  },
  minecraft: {
    homepage: "https://www.minecraft.net/",
    repository: "https://github.com/itzg/docker-minecraft-server",
    download: 800,
    install: 3072,
    mutable: 12288,
  },
  satisfactory: {
    homepage: "https://www.satisfactorygame.com/",
    repository: "https://github.com/wolveix/satisfactory-server",
    download: 15000,
    install: 26000,
    mutable: 12288,
  },
  valheim: {
    homepage: "https://www.valheimgame.com/",
    repository: "https://github.com/lloesche/valheim-server-docker",
    download: 2200,
    install: 5000,
    mutable: 10240,
  },
};

for (const entry of await readManifestDirectory("registry/seeds")) {
  const seed = entry.value;
  const metadata = metadataByPod[seed.podId];
  if (!metadata) {
    throw new Error(`No enrichment metadata for Pod '${seed.podId}'.`);
  }
  const imageRegistries = [
    ...new Set(
      seed.components.map((component) =>
        component.image.slice(0, component.image.indexOf("/")),
      ),
    ),
  ].sort();
  seed.source = {
    kind: "oci",
    homepage: metadata.homepage,
    repository: metadata.repository,
    imageRegistries,
  };
  seed.trust = {
    level: "curated",
    reviewedAt,
    mutableRuntimeImagesAllowed: false,
  };
  seed.compatibility.leafCapabilities = [
    "oci",
    "persistent-storage",
    "dynamic-ports",
    "resource-limits",
    ...(seed.components.length > 1 ? ["multi-component"] : []),
    ...(seed.ports.filter((port) => port.exposure === "public").length > 1
      ? ["multi-port"]
      : []),
  ].sort();
  seed.storage = {
    class: "bulk",
    backupClass: "backup",
    estimatedDownloadMb: metadata.download,
    estimatedInstallMb: metadata.install,
    estimatedMutableMb: metadata.mutable,
    backupPolicy: seed.capabilities.backup ? "recommended" : "optional",
  };
  seed.updatePolicy = {
    discovery: "oci-tag",
    automaticCheck: true,
    automaticInstall: false,
    requiresBackup: seed.capabilities.backup,
    rollback: true,
  };
  seed.proofPolicy = {
    requiredChecks,
    expiresAfterDays: 90,
  };
  await writeFile(entry.path, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
}

console.log("Enriched every Seed with source, trust, Leaf, storage, update, and proof policy.");
