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
import { proofCheckPolicyIssues } from "./proof-check-policy.mjs";

export const creatorEngineVersion = "0.14.0";
export const creatorPolicyVersion = "1.1.0";

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

export function validateProofReceipt(receipt, seed = null) {
  assertSchema(validateProofV2Schema, receipt, "proof-v2 receipt");
  if (seed) {
    const issues = proofCheckPolicyIssues(seed, receipt.receiptPayload.checks);
    if (issues.length > 0) {
      throw new Error(`Proof-v2 receipt does not satisfy the Seed proof policy: ${issues.join("; ")}.`);
    }
  }
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
  const defaults = sourceRuntimeDefaults(source);
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
    trust: {},
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

export function createGuidedDraft({ starter, basePods = [], baseSeeds = [] }) {
  if (starter === null || typeof starter !== "object" || Array.isArray(starter)) {
    throw new Error("starter must be an object.");
  }
  if (starter.kind === "existing_pod_variant") {
    requireExactKeys(
      starter,
      ["displayName", "kind", "podId", "seedId"],
      ["templateSeedId"],
      "existing Pod starter",
    );
    const podId = requireId(starter.podId, "podId");
    const seedId = requireId(starter.seedId, "seedId");
    const displayName = requireDisplayName(starter.displayName, "displayName");
    if (baseSeeds.some((seed) => seed.id === seedId)) {
      throw new Error(`Seed '${seedId}' already exists in the base Registry.`);
    }
    const pod = basePods.find((candidate) => candidate.id === podId);
    if (!pod || pod.status !== "stable") {
      throw new Error(`Stable Pod '${podId}' does not exist in the base Registry.`);
    }
    const templateSeedId =
      Object.hasOwn(starter, "templateSeedId") && starter.templateSeedId !== null
      ? starter.templateSeedId
      : pod.recommendedSeedId;
    requireId(templateSeedId, "templateSeedId");
    const template = baseSeeds.find(
      (candidate) => candidate.id === templateSeedId,
    );
    if (
      !template ||
      template.status !== "stable" ||
      template.podId !== pod.id
    ) {
      throw new Error(
        `Stable template Seed '${templateSeedId}' does not belong to Pod '${pod.id}'.`,
      );
    }

    const seed = structuredClone(template);
    seed.id = seedId;
    seed.podId = pod.id;
    seed.version = "1.0.0-rc.1";
    seed.status = "draft";
    seed.metadata.title = localizedCopy(displayName);
    return workingDocument(pod, [seed]);
  }

  if (starter.kind === "new_pod") {
    requireExactKeys(
      starter,
      ["kind", "podDisplayName", "podId", "seedDisplayName", "seedId"],
      [],
      "new Pod starter",
    );
    const podId = requireId(starter.podId, "podId");
    const seedId = requireId(starter.seedId, "seedId");
    const podDisplayName = requireDisplayName(
      starter.podDisplayName,
      "podDisplayName",
    );
    const seedDisplayName = requireDisplayName(
      starter.seedDisplayName,
      "seedDisplayName",
    );
    if (basePods.some((pod) => pod.id === podId)) {
      throw new Error(`Pod '${podId}' already exists in the base Registry.`);
    }
    if (baseSeeds.some((seed) => seed.id === seedId)) {
      throw new Error(`Seed '${seedId}' already exists in the base Registry.`);
    }
    const pod = {
      schemaVersion: "dauva.dev/pod/v1",
      id: podId,
      status: "draft",
      metadata: {
        title: localizedCopy(podDisplayName),
        description: emptyLocalizedText(),
        icon: "server",
      },
    };
    return workingDocument(pod, [
      createIncompleteSeedDraft({
        id: seedId,
        podId,
        displayName: seedDisplayName,
      }),
    ]);
  }

  throw new Error(
    "starter.kind must be existing_pod_variant or new_pod.",
  );
}

function createIncompleteSeedDraft({ id, podId, displayName }) {
  return {
    schemaVersion: "dauva.dev/seed/v1",
    id,
    version: "1.0.0-rc.1",
    status: "draft",
    podId,
    genres: ["multiplayer"],
    metadata: {
      title: localizedCopy(displayName),
      description: emptyLocalizedText(),
      icon: "server",
    },
    source: {},
    trust: {},
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
        image: "",
        imageUpdate: { reference: "" },
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
          title: {
            en: "Balanced",
            nl: "Gebalanceerd",
            de: "Ausgewogen",
          },
          description: {
            en: "Review resources before proofing.",
            nl: "Controleer de resources voordat je de Seed test.",
            de: "Prüfe die Ressourcen vor dem Seed-Test.",
          },
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
    updatePolicy: {
      discovery: "manual",
      automaticCheck: false,
      automaticInstall: false,
      requiresBackup: false,
      rollback: false,
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

function workingDocument(pod, seeds) {
  return {
    document: {
      podJson: canonicalJson(pod),
      seeds: seeds
        .map((seed) => ({
          clientKey: seed.id,
          json: canonicalJson(seed),
        }))
        .sort((left, right) =>
          left.clientKey < right.clientKey
            ? -1
            : left.clientKey > right.clientKey
              ? 1
              : 0,
        ),
    },
  };
}

function localizedCopy(value) {
  return { en: value, nl: value, de: value };
}

function emptyLocalizedText() {
  return { en: "", nl: "", de: "" };
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
  semanticImpact = null,
  candidateNumber = 1,
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
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    if (!validSeeds.has(seed)) continue;
    const baseSeed = baseSeeds.find((candidate) => candidate.id === seed.id);
    if (
      seed.trust.level === "official" &&
      (!baseSeed || canonicalJson(baseSeed) !== canonicalJson(seed))
    ) {
      issues.push(
        issue(
          "seed.trust.official-source-unconfigured",
          `/seeds/${index}/trust/level`,
          { seedId: seed.id },
        ),
      );
    }
    if (profile !== "authoring") {
      collectReleaseVersionIssues({
        seed,
        baseSeed,
        semanticImpact,
        candidateNumber,
        allowEditableVersion: profile === "freeze",
        jsonPointer: `/seeds/${index}`,
        issues,
      });
    }
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
      } else if (!hasMeaningfulVariantPair(approvedRelated)) {
        issues.push(
          issue("pod.variants.meaningful-difference", "/pod/id", {
            podId: pod.id,
            seedIds: approvedRelated.map((seed) => seed.id).sort().join(","),
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

export function prepareSeedForFreeze({
  seed,
  baseSeed,
  semanticImpact,
  candidateNumber,
}) {
  const issues = [];
  collectReleaseVersionIssues({
    seed,
    baseSeed,
    semanticImpact,
    candidateNumber,
    allowEditableVersion: true,
    jsonPointer: "/seed",
    issues,
  });
  if (issues.length > 0) {
    throw new Error(
      `Seed release policy failed: ${issues.map((item) => item.code).join(", ")}.`,
    );
  }
  if (semanticImpact === "reproof") return structuredClone(seed);
  const stableVersion = expectedStableVersion(
    baseSeed?.version ?? null,
    semanticImpact,
  );
  return {
    ...structuredClone(seed),
    version: `${stableVersion}-rc.${candidateNumber}`,
    status: "candidate",
  };
}

export function expectedStableVersion(baseVersion, semanticImpact) {
  if (baseVersion === null) return "1.0.0";
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(
    baseVersion ?? "",
  );
  if (!match) {
    throw new Error("The base Seed version is not stable semantic versioning.");
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (semanticImpact === "patch") return `${major}.${minor}.${patch + 1}`;
  if (semanticImpact === "minor") return `${major}.${minor + 1}.0`;
  if (semanticImpact === "major") return `${major + 1}.0.0`;
  if (semanticImpact === "reproof") return baseVersion;
  throw new Error("semanticImpact must be patch, minor, major, or reproof.");
}

function collectReleaseVersionIssues({
  seed,
  baseSeed,
  semanticImpact,
  candidateNumber,
  allowEditableVersion = false,
  jsonPointer,
  issues,
}) {
  if (!Number.isSafeInteger(candidateNumber) || candidateNumber < 1) {
    throw new Error("candidateNumber must be a positive integer.");
  }
  if (semanticImpact === null) {
    if (!baseSeed && seed.version !== `1.0.0-rc.${candidateNumber}`) {
      issues.push(
        issue("seed.version.new-candidate", `${jsonPointer}/version`, {
          seedId: seed.id,
          expected: `1.0.0-rc.${candidateNumber}`,
        }),
      );
    }
    return;
  }
  if (!["patch", "minor", "major", "reproof"].includes(semanticImpact)) {
    throw new Error("semanticImpact must be patch, minor, major, or reproof.");
  }
  if (semanticImpact === "reproof") {
    if (!baseSeed || canonicalJson(baseSeed) !== canonicalJson(seed)) {
      issues.push(
        issue("seed.version.reproof-exact", jsonPointer, { seedId: seed.id }),
      );
    }
    return;
  }
  const stableVersion = expectedStableVersion(
    baseSeed?.version ?? null,
    semanticImpact,
  );
  const expectedCandidate = `${stableVersion}-rc.${candidateNumber}`;
  if (!allowEditableVersion && seed.version !== expectedCandidate) {
    issues.push(
      issue("seed.version.candidate-target", `${jsonPointer}/version`, {
        seedId: seed.id,
        expected: expectedCandidate,
        semanticImpact,
      }),
    );
  }
}

function hasMeaningfulVariantPair(seeds) {
  const projections = seeds.map((seed) => meaningfulVariantProjection(seed));
  for (let left = 0; left < projections.length; left += 1) {
    for (let right = left + 1; right < projections.length; right += 1) {
      if (canonicalJson(projections[left]) !== canonicalJson(projections[right])) {
        return true;
      }
    }
  }
  return false;
}

function meaningfulVariantProjection(seed) {
  const componentRoles = new Map(
    seed.components.map((component) => [component.id, component.role]),
  );
  const volumeRoles = new Map(
    seed.volumes.map((volume) => [volume.id, volume.role]),
  );
  const sorted = (values) =>
    values
      .map((value) => structuredClone(value))
      .sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      );
  const components = sorted(
    seed.components.map((component) => ({
      role: component.role,
      image: component.image,
      imageUpdate: component.imageUpdate,
      environment: component.environment,
      optionEnvironment: component.optionEnvironment,
      agreementEnvironment: component.agreementEnvironment,
      secretEnvironment: component.secretEnvironment,
      runtimeEnvironment: component.runtimeEnvironment,
      volumeMounts: sorted(
        component.volumeMounts.map((mount) => ({
          volumeRole: volumeRoles.get(mount.volumeId) ?? "unknown",
          target: mount.target,
          readOnly: mount.readOnly,
        })),
      ),
      dependsOnRoles: component.dependsOn
        .map((id) => componentRoles.get(id) ?? "unknown")
        .sort(),
      health: component.health,
    })),
  );
  const gameplayInputs = sorted(
    seed.inputs.map((input) => {
      const value = structuredClone(input);
      delete value.label;
      delete value.help;
      if (Array.isArray(value.options)) {
        value.options = value.options.map((option) => {
          if (option === null || typeof option !== "object") return option;
          const normalized = structuredClone(option);
          delete normalized.label;
          return normalized;
        });
      }
      return value;
    }),
  );
  const storage = structuredClone(seed.storage);
  delete storage.estimatedDownloadMb;
  delete storage.estimatedInstallMb;
  delete storage.estimatedMutableMb;
  return {
    runtimeSource: {
      source: seed.source,
      images: components.map((component) => ({
        role: component.role,
        image: component.image,
        imageUpdate: component.imageUpdate,
      })),
    },
    gameplaySettings: {
      inputs: gameplayInputs,
      environments: components.map((component) => ({
        role: component.role,
        environment: component.environment,
        optionEnvironment: component.optionEnvironment,
        agreementEnvironment: component.agreementEnvironment,
        secretEnvironment: component.secretEnvironment,
        runtimeEnvironment: component.runtimeEnvironment,
      })),
    },
    components: components.map((component) => ({
      role: component.role,
      dependsOnRoles: component.dependsOnRoles,
      health: component.health,
    })),
    lifecycle: seed.lifecycle,
    storage: {
      policy: storage,
      volumes: sorted(
        seed.volumes.map((volume) => ({
          role: volume.role,
          retention: volume.retention,
        })),
      ),
      mounts: components.map((component) => ({
        role: component.role,
        volumeMounts: component.volumeMounts,
      })),
    },
    networking: sorted(
      seed.ports.map((port) => ({
        componentRole: componentRoles.get(port.componentId) ?? "unknown",
        containerPort: port.containerPort,
        containerPortMode: port.containerPortMode,
        protocols: [...port.protocols].sort(),
        exposure: port.exposure,
        purpose: port.purpose,
        primary: port.primary,
        sharedHostPort: port.sharedHostPort,
      })),
    ),
    supportedCapabilities: {
      capabilities: seed.capabilities,
      compatibility: seed.compatibility,
      console: seed.console ?? null,
      updatePolicy: seed.updatePolicy,
    },
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
  const plannedKinds = new Set(checks.map((check) => check.kind));
  for (const requiredCheck of seed.proofPolicy.requiredChecks) {
    if (plannedKinds.has(requiredCheck)) continue;
    checks.splice(checks.length - 1, 0, { kind: requiredCheck });
    plannedKinds.add(requiredCheck);
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
  if (!isDauvaId(value)) {
    throw new Error(
      `${label} must be a 2 through 80 character Dauva identifier.`,
    );
  }
  return value;
}

function isDauvaId(value) {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length <= 80 &&
    idPattern.test(value)
  );
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

function requireDisplayName(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be text.`);
  }
  const normalized = value.trim();
  if (
    value !== normalized ||
    value.length > 120 ||
    normalized.length === 0 ||
    normalized.length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(
      `${label} must contain 1 through 120 visible characters.`,
    );
  }
  return normalized;
}

function requireExactKeys(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unexpected = keys.filter((key) => !allowed.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(`${label} has an invalid shape.`);
  }
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
