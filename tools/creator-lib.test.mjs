import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createCreatorProposal } from "./creator-lib.mjs";
import { readJson, repositoryRoot } from "./registry-lib.mjs";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validatePod = ajv.compile(
  await readJson(path.join(repositoryRoot, "schemas", "pod-v1.schema.json")),
);
const validateSeed = ajv.compile(
  await readJson(path.join(repositoryRoot, "schemas", "seed-v1.schema.json")),
);
const validateAnalysis = ajv.compile(
  await readJson(
    path.join(
      repositoryRoot,
      "schemas",
      "seed-creator-analysis-v1.schema.json",
    ),
  ),
);
const validateCreatorRequest = ajv.compile(
  await readJson(
    path.join(
      repositoryRoot,
      "schemas",
      "seed-creator-request-v1.schema.json",
    ),
  ),
);

test("recognition never creates a duplicate Pod or Seed", () => {
  const analysis = exampleAnalysis({
    existingSeed: {
      seedId: "example",
      seedVersion: "1.0.0",
      seedManifestDigest: `sha256:${"a".repeat(64)}`,
      podId: "example",
      canAdopt: true,
      checks: [],
    },
    recommendedAction: "adopt-existing",
  });

  const proposal = createCreatorProposal({ analysis });

  assert.equal(proposal.pod, null);
  assert.equal(proposal.seed, null);
  assert.equal(proposal.report.mode, "recognition");
  assert.equal(proposal.report.readyForProof, true);
});

test("reconstruction detects drift without modifying the reference", () => {
  const analysis = exampleAnalysis({
    existingSeed: {
      seedId: "example",
      seedVersion: "1.0.0",
      seedManifestDigest: `sha256:${"b".repeat(64)}`,
      podId: "example",
      canAdopt: true,
      checks: [],
    },
    recommendedAction: "adopt-existing",
  });
  const referenceSeed = exampleSeed();
  const proposal = createCreatorProposal({
    analysis,
    referenceSeed,
    referencePod: {
      schemaVersion: "dauva.dev/pod/v1",
      id: "example",
      status: "stable",
      recommendedSeedId: "example",
      metadata: {
        title: localized("Example"),
        description: localized("Example"),
        icon: "server",
      },
    },
  });

  assert.equal(proposal.report.readyForProof, true);
  assert.deepEqual(proposal.report.differences, []);
  assert.equal(proposal.seed.status, "draft");
  assert.equal(proposal.seed.version, "0.1.0");
  assert.equal(referenceSeed.status, "stable");
  assert.equal(referenceSeed.version, "1.0.0");
});

test("guided creation excludes secret values and host paths", () => {
  const analysis = exampleAnalysis({
    existingSeed: null,
    recommendedAction: "create-draft",
    components: [
      {
        id: "server",
        role: "primary",
        image: {
          reference: "docker.io/example/server:latest",
          localImageId: `sha256:${"c".repeat(64)}`,
          immutable: false,
        },
        environment: [
          { key: "SERVER_PASSWORD", classification: "secret" },
        ],
        mounts: [
          { target: "/data", sourceKind: "bind", readOnly: false },
        ],
      },
    ],
  });
  const answers = {
    schemaVersion: "dauva.dev/seed-creator-request/v1",
    id: "example",
    podId: "example",
    title: "Example",
    description: "Example Server.",
    icon: "server",
    genres: ["multiplayer"],
    reviewedAt: "2026-07-31",
    source: {
      kind: "oci",
      homepage: "https://example.com/",
      repository: "https://example.com/runtime",
      imageRegistries: ["docker.io"],
    },
    images: {
      server: {
        pinned: `docker.io/example/server@sha256:${"d".repeat(64)}`,
        updateReference: "docker.io/example/server:latest",
      },
    },
    environment: {
      server: {
        SERVER_PASSWORD: {
          classification: "secret",
          key: "server-password",
          label: "Server password",
        },
      },
    },
    resources: {
      memoryMb: 2048,
      diskMb: 10240,
      cpuPercent: 100,
    },
    storage: {
      estimatedDownloadMb: 1000,
      estimatedInstallMb: 3000,
      estimatedMutableMb: 5000,
    },
    relatedSeedCount: 2,
  };

  const proposal = createCreatorProposal({ analysis, answers });
  const rendered = JSON.stringify(proposal);

  assert.equal(
    validateAnalysis(analysis),
    true,
    JSON.stringify(validateAnalysis.errors),
  );
  assert.equal(
    validateCreatorRequest(answers),
    true,
    JSON.stringify(validateCreatorRequest.errors),
  );
  assert.equal(proposal.seed.secrets[0].key, "server-password");
  assert.equal(
    proposal.seed.components[0].secretEnvironment["server-password"],
    "SERVER_PASSWORD",
  );
  assert.equal(rendered.includes("C:\\\\"), false);
  assert.equal(rendered.includes("forbidden-secret-material"), false);
  assert.equal(proposal.report.safety.hostPathsExcluded, true);
  assert.equal(
    validatePod(proposal.pod),
    true,
    JSON.stringify(validatePod.errors),
  );
  assert.equal(
    validateSeed(proposal.seed),
    true,
    JSON.stringify(validateSeed.errors),
  );
});

test("a secret-looking environment key cannot become a constant", () => {
  const analysis = exampleAnalysis({
    existingSeed: null,
    recommendedAction: "create-draft",
    components: [
      {
        id: "server",
        role: "primary",
        image: {
          reference: `docker.io/example/server@sha256:${"e".repeat(64)}`,
          localImageId: null,
          immutable: true,
        },
        environment: [
          { key: "API_TOKEN", classification: "secret" },
        ],
        mounts: [],
      },
    ],
  });
  const answers = {
    schemaVersion: "dauva.dev/seed-creator-request/v1",
    id: "example",
    podId: "example",
    title: "Example",
    description: "Example",
    icon: "server",
    genres: ["multiplayer"],
    reviewedAt: "2026-07-31",
    source: {
      kind: "oci",
      homepage: "https://example.com/",
      repository: "https://example.com/runtime",
      imageRegistries: ["docker.io"],
    },
    images: {
      server: {
        updateReference: "docker.io/example/server:latest",
      },
    },
    environment: {
      server: {
        API_TOKEN: {
          classification: "constant",
          value: "forbidden",
        },
      },
    },
    resources: {
      memoryMb: 1024,
      diskMb: 1024,
      cpuPercent: 100,
    },
    storage: {
      estimatedDownloadMb: 1,
      estimatedInstallMb: 1,
      estimatedMutableMb: 1,
    },
    relatedSeedCount: 2,
  };

  assert.throws(
    () => createCreatorProposal({ analysis, answers }),
    /looks secret/,
  );
});

function exampleAnalysis(overrides = {}) {
  return {
    schemaVersion: "dauva.dev/seed-creator-analysis/v1",
    candidateId: "candidate",
    candidateName: "example-server",
    sourceKind: "docker-compose",
    runtimeState: "running",
    recommendedAction: "create-draft",
    existingSeed: null,
    components: [
      {
        id: "server",
        role: "primary",
        image: {
          reference: `docker.io/example/server@sha256:${"f".repeat(64)}`,
          localImageId: null,
          immutable: true,
        },
        environment: [],
        mounts: [
          { target: "/data", sourceKind: "volume", readOnly: false },
        ],
      },
    ],
    ports: [
      {
        componentId: "server",
        containerPort: 7777,
        publicPort: 7777,
        protocol: "udp",
      },
    ],
    data: [],
    suggestedOptions: {},
    reviewQuestions: [],
    warnings: [],
    observedAtUtc: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

function exampleSeed() {
  return {
    schemaVersion: "dauva.dev/seed/v1",
    id: "example",
    version: "1.0.0",
    status: "stable",
    podId: "example",
    genres: ["multiplayer"],
    metadata: {
      title: localized("Example"),
      description: localized("Example"),
      icon: "server",
    },
    source: {
      kind: "oci",
      homepage: "https://example.com/",
      repository: "https://example.com/runtime",
      imageRegistries: ["docker.io"],
    },
    trust: {
      level: "curated",
      reviewedAt: "2026-07-31",
      mutableRuntimeImagesAllowed: false,
    },
    compatibility: {
      operatingSystems: ["linux"],
      architectures: ["amd64"],
      leafCapabilities: ["oci"],
    },
    components: [
      {
        id: "server",
        role: "primary",
        image: `docker.io/example/server@sha256:${"f".repeat(64)}`,
        imageUpdate: { reference: "docker.io/example/server:latest" },
        environment: {},
        optionEnvironment: {},
        agreementEnvironment: {},
        secretEnvironment: {},
        runtimeEnvironment: {},
        volumeMounts: [
          { volumeId: "data", target: "/data", readOnly: false },
        ],
        dependsOn: [],
        health: { source: "running", startupGraceSeconds: 60 },
      },
    ],
    volumes: [
      { id: "data", role: "data", retention: "delete-with-server" },
    ],
    ports: [
      {
        id: "game",
        componentId: "server",
        containerPort: 7777,
        containerPortMode: "fixed",
        protocols: ["udp"],
        exposure: "public",
        purpose: "game",
        primary: true,
        sharedHostPort: true,
      },
    ],
    resources: {
      defaultPresetId: "balanced",
      presets: [],
    },
    storage: {},
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
    updatePolicy: {},
    proofPolicy: {
      requiredChecks: ["images-pinned"],
      expiresAfterDays: 90,
    },
  };
}

function localized(value) {
  return { en: value, nl: value, de: value };
}
