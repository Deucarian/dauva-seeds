import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { repositoryRoot } from "./registry-lib.mjs";
import {
  dauvaDescriptor,
  linuxGsmDescriptor,
  ociDescriptor,
  sourceRuntimeDefaults,
  steamCmdDescriptor,
} from "./source-adapters.mjs";

const id = requiredOption("--id");
const kind = requiredOption("--kind");
const homepage = requiredOption("--homepage");
const repository = optionValue("--repository") ?? homepage;
const image = requiredOption("--image");
const updateReference = requiredOption("--update-reference");
const upstreamId = optionValue("--upstream-id");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
  throw new Error("--id must be a Dauva identifier.");
}
const pinnedImage =
  /^(?<registry>[a-z0-9.-]+(?::[0-9]+)?)\/[^@\s]+@sha256:[a-f0-9]{64}$/;
const imageMatch = pinnedImage.exec(image);
if (!imageMatch?.groups?.registry) {
  throw new Error("--image must be an OCI reference pinned by sha256 digest.");
}
const source =
  kind === "linuxgsm"
    ? linuxGsmDescriptor({
        gameId: requiredValue(upstreamId, "--upstream-id"),
        homepage,
        repository,
        registry: imageMatch.groups.registry,
      })
    : kind === "steamcmd"
      ? steamCmdDescriptor({
          appId: requiredValue(upstreamId, "--upstream-id"),
          homepage,
          repository,
          registry: imageMatch.groups.registry,
        })
      : kind === "oci"
        ? ociDescriptor({
            homepage,
            repository,
            registry: imageMatch.groups.registry,
            upstreamId,
          })
        : kind === "dauva"
          ? dauvaDescriptor({
              homepage,
              repository,
              registry: imageMatch.groups.registry,
              upstreamId,
            })
          : null;
if (!source) {
  throw new Error("--kind must be oci, steamcmd, linuxgsm, or dauva.");
}
const defaults = sourceRuntimeDefaults(source);

const localized = (value) => ({ en: value, nl: value, de: value });
const seed = {
  schemaVersion: "dauva.dev/seed/v1",
  id,
  version: "0.1.0",
  status: "draft",
  podId: id,
  genres: ["multiplayer"],
  metadata: {
    title: localized(id),
    description: localized(`Draft ${id} Server Seed.`),
    icon: "server",
  },
  ...defaults,
  compatibility: {
    operatingSystems: ["linux"],
    architectures: ["amd64"],
    leafCapabilities: [
      "dynamic-ports",
      "oci",
      "persistent-storage",
      "resource-limits",
    ],
  },
  components: [
    {
      id: "server",
      role: "primary",
      image,
      imageUpdate: { reference: updateReference },
      environment: {},
      optionEnvironment: {},
      agreementEnvironment: {},
      secretEnvironment: {},
      runtimeEnvironment: {},
      volumeMounts: [
        { volumeId: "data", target: "/data", readOnly: false },
      ],
      dependsOn: [],
      health: { source: "running", startupGraceSeconds: 600 },
    },
  ],
  volumes: [
    { id: "data", role: "data", retention: "delete-with-server" },
  ],
  ports: [],
  resources: {
    defaultPresetId: "balanced",
    presets: [
      {
        id: "balanced",
        title: localized("Balanced"),
        description: localized("Review resources before proofing."),
        memoryMb: 4096,
        diskMb: 20480,
        cpuPercent: 200,
      },
    ],
  },
  storage: {
    class: "bulk",
    backupClass: "backup",
    estimatedDownloadMb: 0,
    estimatedInstallMb: 0,
    estimatedMutableMb: 0,
    backupPolicy: "recommended",
  },
  inputs: [],
  secrets: [],
  lifecycle: {
    startOrder: ["server"],
    stopOrder: ["server"],
    stopTimeoutSeconds: 60,
  },
  capabilities: {
    backup: false,
    restore: false,
    update: false,
    console: false,
  },
  proofPolicy: {
    requiredChecks: [
      "images-pinned",
      "healthy",
      "ports",
      "backup-if-supported",
      "graceful-stop",
      "restart",
      "persistence",
      "cleanup",
    ],
    expiresAfterDays: 90,
  },
};

const output = path.join(repositoryRoot, "registry", "seeds", `${id}.json`);
await writeFile(output, `${JSON.stringify(seed, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
console.log(`Created draft Seed ${output}. Complete its ports, inputs, storage, and Pod before proofing.`);

function requiredOption(name) {
  const value = optionValue(name);
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

function requiredValue(value, optionName) {
  if (!value) {
    throw new Error(`${optionName} is required for ${kind}.`);
  }
  return value;
}
