import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  calculateProofContractDigest,
  canonicalJson,
  compiledRegistry,
  readJson,
  repositoryRoot,
  sha256,
} from "./registry-lib.mjs";
import {
  dauvaDescriptor,
  linuxGsmDescriptor,
  ociDescriptor,
  sourceRuntimeDefaults,
  steamCmdDescriptor,
} from "./source-adapters.mjs";

export const creatorEngineVersion = "0.12.0";
export const creatorPolicyVersion = "1.0.0";

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const pinnedImagePattern =
  /^(?<registry>[a-z0-9.-]+(?::[0-9]+)?)\/[^@\s]+@sha256:[a-f0-9]{64}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const podSchema = await readJson(
  path.join(repositoryRoot, "schemas", "pod-v1.schema.json"),
);
const seedSchema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-v1.schema.json"),
);
const proofPlanSchema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-proof-plan-v1.schema.json"),
);
const proofBundleSchema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-proof-bundle-v1.schema.json"),
);
const proofV2Schema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-proof-v2.schema.json"),
);
const validatePodSchema = ajv.compile(podSchema);
const validateSeedSchema = ajv.compile(seedSchema);
const validateProofPlanSchema = ajv.compile(proofPlanSchema);
const validateProofBundleSchema = ajv.compile(proofBundleSchema);
const validateProofV2Schema = ajv.compile(proofV2Schema);

export function validateProofReceipt(receipt) {
  assertSchema(validateProofV2Schema, receipt, "proof-v2 receipt");
  return { valid: true };
}

export function createSeedDraft({
  id,
  podId = id,
  kind,
  homepage,
  repository = homepage,
  image,
  updateReference,
  upstreamId,
  reviewedAt,
}) {
  requireId(id, "id");
  requireId(podId, "podId");
  requireHttpsUrl(homepage, "homepage");
  requireHttpsUrl(repository, "repository");
  const imageMatch = pinnedImagePattern.exec(image ?? "");
  if (!imageMatch?.groups?.registry) {
    throw new Error("image must be an OCI reference pinned by sha256 digest.");
  }
  if (typeof updateReference !== "string" || updateReference.includes("@")) {
    throw new Error("updateReference must be a mutable OCI discovery tag.");
  }
  const source = createSourceDescriptor({
    kind,
    homepage,
    repository,
    registry: imageMatch.groups.registry,
    upstreamId,
  });
  const defaults = sourceRuntimeDefaults(source, { reviewedAt });
  const localized = (value) => ({ en: value, nl: value, de: value });
  return {
    schemaVersion: "dauva.dev/seed/v1",
    id,
    version: "0.1.0",
    status: "draft",
    podId,
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
}

export function canonicalDocument(value) {
  const json = canonicalJson(value);
  return {
    json,
    digest: sha256(json),
  };
}

export function validateWorkspace({
  pod,
  seeds,
  basePods = [],
  baseSeeds = [],
  proofs = [],
  profile = "authoring",
  validationTime,
  meaningfulVariantSeedIds = [],
}) {
  if (
    ![
      "authoring",
      "freeze",
      "proof-admission",
      "export",
      "runtime-availability",
    ].includes(profile)
  ) {
    throw new Error(`Unknown validation profile '${profile}'.`);
  }
  const issues = [];
  const podValid = collectSchemaIssues(
    validatePodSchema,
    pod,
    "/pod",
    "pod.schema",
    issues,
  );
  const validSeeds = new Set();
  for (let index = 0; index < seeds.length; index += 1) {
    if (
      collectSchemaIssues(
        validateSeedSchema,
        seeds[index],
        `/seeds/${index}`,
        "seed.schema",
        issues,
      )
    ) {
      validSeeds.add(seeds[index]);
    }
  }
  const proposalIds = new Set();
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    if (typeof seed?.id !== "string") continue;
    if (proposalIds.has(seed.id)) {
      issues.push(issue("seed.id.duplicate", `/seeds/${index}/id`, { id: seed.id }));
    }
    proposalIds.add(seed.id);
  }
  if (podValid) {
    const overlaySeeds = new Map(baseSeeds.map((seed) => [seed.id, seed]));
    for (const seed of seeds) {
      if (validSeeds.has(seed)) overlaySeeds.set(seed.id, seed);
    }
    const related = [...overlaySeeds.values()].filter(
      (seed) => seed.podId === pod.id && seed.status !== "withered",
    );
    if (related.length < 2) {
      issues.push(
        issue("pod.variants.minimum", "/pod/id", {
          podId: pod.id,
          count: related.length,
        }),
      );
    }
    if (!related.some((seed) => seed.id === pod.recommendedSeedId)) {
      issues.push(
        issue("pod.recommendation.member", "/pod/recommendedSeedId", {
          seedId: pod.recommendedSeedId,
        }),
      );
    }
    for (let index = 0; index < seeds.length; index += 1) {
      const seed = seeds[index];
      if (validSeeds.has(seed) && seed.podId !== pod.id) {
        issues.push(
          issue("seed.pod.mismatch", `/seeds/${index}/podId`, {
            seedId: seed.id,
            podId: pod.id,
          }),
        );
      }
    }
    const isNewPod = !basePods.some((candidate) => candidate.id === pod.id);
    if (isNewPod && profile !== "authoring") {
      const approved = new Set(meaningfulVariantSeedIds);
      const approvedRelated = related.filter((seed) => approved.has(seed.id));
      if (approvedRelated.length < 2) {
        issues.push(
          issue("pod.variants.meaningful-review", "/pod/id", {
            podId: pod.id,
            count: approvedRelated.length,
          }),
        );
      }
    }
  }

  if (["export", "runtime-availability"].includes(profile)) {
    requireTimestamp(validationTime, "validationTime");
    const overlayPods = new Map(basePods.map((item) => [item.id, item]));
    if (podValid) overlayPods.set(pod.id, pod);
    const overlaySeeds = new Map(baseSeeds.map((item) => [item.id, item]));
    for (const seed of seeds) {
      if (validSeeds.has(seed)) overlaySeeds.set(seed.id, seed);
    }
    const compiled = compiledRegistry(
      [...overlayPods.values()],
      [...overlaySeeds.values()],
      proofs,
    );
    const minimumExpiry =
      Date.parse(validationTime) + (profile === "export" ? 7 * 24 * 60 * 60 * 1000 : 0);
    for (const seed of seeds.filter((item) => validSeeds.has(item))) {
      const proof = compiled.seeds.find((item) => item.id === seed.id)?.proof;
      if (proof?.state !== "proven" || proof.binding !== "exact") {
        issues.push(
          issue("seed.proof.exact-required", `/seeds/${seeds.indexOf(seed)}`, {
            seedId: seed.id,
          }),
        );
        continue;
      }
      for (const architecture of proof.architectures) {
        if (Date.parse(architecture.expiresAt) < minimumExpiry) {
          issues.push(
            issue("seed.proof.freshness", `/seeds/${seeds.indexOf(seed)}`, {
              seedId: seed.id,
              architecture: architecture.architecture,
              expiresAt: architecture.expiresAt,
            }),
          );
        }
      }
    }
  }
  return {
    profile,
    valid: !issues.some((candidate) => candidate.severity === "error"),
    issues,
  };
}

export function createProofBundle({
  seed,
  pod,
  baseRegistryDigest,
  transitiveInputs = [],
}) {
  requireDigest(baseRegistryDigest, "baseRegistryDigest");
  assertSchema(validateSeedSchema, seed, "Seed");
  assertSchema(validatePodSchema, pod, "Pod");
  if (seed.podId !== pod.id) {
    throw new Error(`Seed '${seed.id}' does not belong to Pod '${pod.id}'.`);
  }
  const orderedInputs = [...transitiveInputs].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  for (const input of orderedInputs) {
    requireId(input.id, "transitive input id");
    requireDigest(input.digest, `transitive input '${input.id}' digest`);
  }
  const bundle = {
    schemaVersion: "dauva.dev/seed-proof-bundle/v1",
    baseRegistryDigest,
    podManifest: pod,
    seedManifest: seed,
    transitiveInputs: orderedInputs,
  };
  assertSchema(validateProofBundleSchema, bundle, "proof bundle");
  return {
    bundle,
    proofBundleDigest: sha256(canonicalJson(bundle)),
  };
}

export function createProofPlan({
  seed,
  baseRegistryDigest,
  proofBundleDigest,
  revisionId,
  planId,
  architecture,
  fixtures = {},
  deadlineSeconds = 3600,
  engineVersion = creatorEngineVersion,
  policyVersion = creatorPolicyVersion,
}) {
  assertSchema(validateSeedSchema, seed, "Seed");
  requireUuid(revisionId, "revisionId");
  requireUuid(planId, "planId");
  requireDigest(baseRegistryDigest, "baseRegistryDigest");
  requireDigest(proofBundleDigest, "proofBundleDigest");
  if (!seed.compatibility.architectures.includes(architecture)) {
    throw new Error(
      `Architecture '${architecture}' is not declared by Seed '${seed.id}'.`,
    );
  }
  const publicPortIds = seed.ports
    .filter((port) => port.exposure === "public")
    .map((port) => port.id);
  if (publicPortIds.length === 0) {
    throw new Error(`Seed '${seed.id}' must declare a public proof port.`);
  }
  const persistentVolume = seed.volumes.find((volume) =>
    ["save", "data", "config"].includes(volume.role),
  );
  if (!persistentVolume) {
    throw new Error(`Seed '${seed.id}' has no proofable persistent volume.`);
  }
  const checks = [
    { kind: "images-pinned" },
    { kind: "healthy", stabilitySeconds: 20 },
    { kind: "ports", portIds: publicPortIds },
    { kind: "graceful-stop" },
    { kind: "stopped-remains-stopped" },
    { kind: "restart" },
    {
      kind: "persistence",
      volumeId: persistentVolume.id,
      fixtureId: requireFixture(fixtures, "persistence", seed),
    },
    { kind: "cleanup" },
  ];
  for (const capability of ["backup", "restore", "console", "update"]) {
    if (seed.capabilities[capability]) {
      checks.splice(checks.length - 1, 0, {
        kind: capability,
        fixtureId: requireFixture(fixtures, capability, seed),
      });
    }
  }
  const plan = {
    schemaVersion: "dauva.dev/seed-proof-plan/v1",
    planId,
    revisionId,
    seedId: seed.id,
    seedVersion: seed.version,
    architecture,
    manifestDigest: sha256(canonicalJson(seed)),
    proofContractDigest: calculateProofContractDigest(seed),
    baseRegistryDigest,
    proofBundleDigest,
    policyVersion,
    engineVersion,
    deadlineSeconds,
    checks,
  };
  assertSchema(validateProofPlanSchema, plan, "proof plan");
  return {
    plan,
    proofPlanDigest: sha256(canonicalJson(plan)),
  };
}

export function deriveGovernedProofFixtures(seed) {
  assertSchema(validateSeedSchema, seed, "Seed");
  const fixtures = {
    persistence: `${seed.id}-persistence`,
  };
  for (const capability of ["backup", "restore", "console", "update"]) {
    if (seed.capabilities[capability]) {
      fixtures[capability] = `${seed.id}-${capability}`;
    }
  }
  for (const [kind, fixtureId] of Object.entries(fixtures)) {
    if (!idPattern.test(fixtureId) || fixtureId.length > 120) {
      throw new Error(
        `Engine-owned ${kind} fixture id for Seed '${seed.id}' is invalid.`,
      );
    }
  }
  return fixtures;
}

export function freezeSeedRevision({
  seed,
  pod,
  baseRegistryDigest,
  revisionId,
  revisionGroupId,
  planId,
  architecture,
  fixtures = deriveGovernedProofFixtures(seed),
  frozenAt,
  authorId,
  semanticImpact,
  transitiveInputs = [],
}) {
  requireUuid(revisionGroupId, "revisionGroupId");
  requireTimestamp(frozenAt, "frozenAt");
  if (!idPattern.test(authorId ?? "")) {
    throw new Error("authorId must use the safe internal identifier form.");
  }
  if (!["patch", "minor", "major", "reproof"].includes(semanticImpact)) {
    throw new Error("semanticImpact must be patch, minor, major, or reproof.");
  }
  const { bundle, proofBundleDigest } = createProofBundle({
    seed,
    pod,
    baseRegistryDigest,
    transitiveInputs,
  });
  const { plan, proofPlanDigest } = createProofPlan({
    seed,
    baseRegistryDigest,
    proofBundleDigest,
    revisionId,
    planId,
    architecture,
    fixtures,
  });
  const revisionPayload = {
    schemaVersion: "dauva.dev/seed-studio-revision/v1",
    revisionId,
    revisionGroupId,
    baseRegistryDigest,
    seedManifest: seed,
    podManifest: pod,
    manifestDigest: plan.manifestDigest,
    proofContractDigest: plan.proofContractDigest,
    proofBundleDigest,
    proofPlanDigest,
    architecture,
    semanticImpact,
    authorId,
    frozenAt,
  };
  return {
    revision: {
      ...revisionPayload,
      revisionDigest: sha256(canonicalJson(revisionPayload)),
    },
    proofBundle: bundle,
    proofPlan: plan,
  };
}

function createSourceDescriptor({
  kind,
  homepage,
  repository,
  registry,
  upstreamId,
}) {
  if (kind === "linuxgsm") {
    return linuxGsmDescriptor({
      gameId: requireText(upstreamId, "upstreamId"),
      homepage,
      repository,
      registry,
    });
  }
  if (kind === "steamcmd") {
    return steamCmdDescriptor({
      appId: requireText(upstreamId, "upstreamId"),
      homepage,
      repository,
      registry,
    });
  }
  if (kind === "oci") {
    return ociDescriptor({ homepage, repository, registry, upstreamId });
  }
  if (kind === "dauva") {
    return dauvaDescriptor({ homepage, repository, registry, upstreamId });
  }
  throw new Error("kind must be oci, steamcmd, linuxgsm, or dauva.");
}

function assertSchema(validator, value, label) {
  if (validator(value)) return;
  const details = (validator.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
  throw new Error(`${label} is not canonical: ${details}`);
}

function collectSchemaIssues(validator, value, prefix, codePrefix, issues) {
  if (validator(value)) return true;
  for (const error of validator.errors ?? []) {
    issues.push(
      issue(
        `${codePrefix}.${String(error.keyword).replaceAll("_", "-")}`,
        `${prefix}${error.instancePath || ""}`,
        {
          message: error.message ?? "invalid",
        },
      ),
    );
  }
  return false;
}

function issue(code, jsonPointer, parameters = {}, severity = "error") {
  return {
    code,
    severity,
    jsonPointer,
    parameters: Object.entries(parameters)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, value]) => ({ name, value: String(value) })),
  };
}

function requireId(value, label) {
  if (!idPattern.test(value ?? "")) {
    throw new Error(`${label} must be a Dauva identifier.`);
  }
  return value;
}

function requireUuid(value, label) {
  if (!uuidPattern.test(value ?? "")) {
    throw new Error(`${label} must be a lowercase UUID.`);
  }
  return value;
}

function requireDigest(value, label) {
  if (!digestPattern.test(value ?? "")) {
    throw new Error(`${label} must use lowercase sha256:<64 hex>.`);
  }
  return value;
}

function requireHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must be an HTTPS URL.`);
  }
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function requireFixture(fixtures, capability, seed) {
  const fixture = fixtures?.[capability];
  if (!idPattern.test(fixture ?? "")) {
    throw new Error(
      `Seed '${seed.id}' requires a governed '${capability}' fixture.`,
    );
  }
  return fixture;
}

function requireTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !/^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${label} must be a millisecond UTC timestamp.`);
  }
  return value;
}
