import path from "node:path";

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const pinnedImagePattern =
  /^(?<registry>[a-z0-9.-]+(?::[0-9]+)?)\/[^@\s]+@sha256:[a-f0-9]{64}$/;
const forbiddenPropertyPattern =
  /^(?:hostPath|bindSource|sourcePath|secretValue|passwordValue|privileged|dockerSocket|hostNetwork|pidMode)$/i;
const secretNamePattern =
  /(?:PASSWORD|PASSWD|TOKEN|SECRET|API_KEY|PRIVATE_KEY|CREDENTIAL)/i;

export function createCreatorProposal({
  analysis,
  answers,
  referenceSeed,
  referencePod,
}) {
  assertSafeAnalysis(analysis);
  if (referenceSeed) {
    return reconstructProposal({
      analysis,
      referenceSeed,
      referencePod,
    });
  }
  if (analysis.existingSeed) {
    return {
      pod: null,
      seed: null,
      report: createReport({
        analysis,
        mode: "recognition",
        unresolved: [],
        differences: [],
        readyForProof: analysis.existingSeed.canAdopt,
      }),
      proofPlan: null,
    };
  }
  return guidedProposal(analysis, answers);
}

function reconstructProposal({ analysis, referenceSeed, referencePod }) {
  if (
    analysis.existingSeed?.seedId !== referenceSeed.id ||
    analysis.existingSeed?.seedVersion !== referenceSeed.version
  ) {
    throw new Error(
      "The reconstruction reference does not match the Seed recognized by the Leaf.",
    );
  }
  const differences = compareObservedContract(analysis, referenceSeed);
  const seed = structuredClone(referenceSeed);
  seed.version = "0.1.0";
  seed.status = "draft";
  delete seed.proof;
  delete seed.manifestDigest;
  const pod = referencePod ? structuredClone(referencePod) : null;
  if (pod) {
    pod.status = "draft";
  }
  const unresolved = differences.map((difference) => difference.message);
  return {
    pod,
    seed,
    report: createReport({
      analysis,
      mode: "reconstruction",
      unresolved,
      differences,
      readyForProof: differences.length === 0,
      reference: {
        seedId: referenceSeed.id,
        seedVersion: referenceSeed.version,
        seedManifestDigest: analysis.existingSeed.seedManifestDigest,
      },
    }),
    proofPlan: createProofPlan(seed, differences.length === 0),
  };
}

function guidedProposal(analysis, answers) {
  validateAnswers(answers);
  const unresolved = [...analysis.reviewQuestions];
  const environmentReview = [];
  const volumesById = new Map();
  const components = analysis.components.map((component) => {
    const componentAnswers = answers.environment?.[component.id] ?? {};
    const imageAnswer = answers.images?.[component.id];
    const pinnedImage =
      imageAnswer?.pinned ??
      (component.image.immutable ? component.image.reference : null);
    if (!pinnedImagePattern.test(pinnedImage ?? "")) {
      unresolved.push(
        `Pin component '${component.id}' to a trusted OCI manifest digest.`,
      );
    }
    const updateReference = imageAnswer?.updateReference;
    if (!updateReference) {
      unresolved.push(
        `Choose the reviewed mutable update reference for component '${component.id}'.`,
      );
    }
    const pinnedRegistry = pinnedImagePattern.exec(pinnedImage ?? "")?.groups
      ?.registry;
    if (
      pinnedRegistry &&
      !answers.source.imageRegistries.includes(pinnedRegistry)
    ) {
      unresolved.push(
        `Add reviewed registry '${pinnedRegistry}' to source.imageRegistries or choose another image.`,
      );
    }
    if (
      pinnedImage &&
      updateReference &&
      imageRepository(pinnedImage) !== imageRepository(updateReference)
    ) {
      unresolved.push(
        `Component '${component.id}' must use the same repository for its pinned image and update reference.`,
      );
    }

    const environment = {};
    const optionEnvironment = {};
    const agreementEnvironment = {};
    const secretEnvironment = {};
    const runtimeEnvironment = {};
    for (const observed of component.environment) {
      const decision = componentAnswers[observed.key];
      if (!decision) {
        environmentReview.push({
          componentId: component.id,
          environmentKey: observed.key,
          observedClassification: observed.classification,
          decision: "unresolved",
        });
        unresolved.push(
          `Classify environment key '${component.id}.${observed.key}'.`,
        );
        continue;
      }
      applyEnvironmentDecision({
        componentId: component.id,
        environmentName: observed.key,
        decision,
        environment,
        optionEnvironment,
        agreementEnvironment,
        secretEnvironment,
        runtimeEnvironment,
        unresolved,
        environmentReview,
      });
    }

    const volumeMounts = component.mounts.map((mount, index) => {
      const explicitVolumeId =
        answers.volumeIds?.[component.id]?.[mount.target];
      const volumeId = explicitVolumeId
        ? normalizeId(explicitVolumeId, "data")
        : uniqueVolumeId(
            deriveVolumeId(mount.target, index),
            volumesById,
          );
      if (!volumesById.has(volumeId)) {
        const role = inferVolumeRole(mount.target);
        volumesById.set(volumeId, {
          id: volumeId,
          role,
          retention:
            role === "cache" ? "disposable" : "delete-with-server",
        });
      }
      return {
        volumeId,
        target: mount.target,
        readOnly: mount.readOnly,
      };
    });
    return {
      id: component.id,
      role: component.role === "primary" ? "primary" : "sidecar",
      image: pinnedImage ?? component.image.reference,
      imageUpdate: {
        reference:
          updateReference ?? mutableReference(component.image.reference),
      },
      environment,
      optionEnvironment,
      agreementEnvironment,
      secretEnvironment,
      runtimeEnvironment,
      volumeMounts,
      dependsOn: [],
      health: {
        source: "running",
        startupGraceSeconds: 600,
      },
    };
  });

  const inputs = collectInputDefinitions(answers.environment);
  const secrets = collectSecretDefinitions(answers.environment);
  const ports = groupPorts(analysis.ports);
  if (ports.length === 0) {
    unresolved.push("Confirm at least one reachable game or query port.");
  }
  const primaryComponent =
    components.find((component) => component.role === "primary") ??
    components[0];
  if (!primaryComponent) {
    unresolved.push("Identify exactly one primary runtime component.");
  }
  const volumes = [...volumesById.values()];
  const localized = (value) => ({ en: value, nl: value, de: value });
  const pod = {
    schemaVersion: "dauva.dev/pod/v1",
    id: answers.podId,
    status: "draft",
    recommendedSeedId: answers.id,
    metadata: {
      title: localized(answers.title),
      description: localized(answers.podDescription ?? answers.description),
      icon: answers.icon,
    },
  };
  const componentIds = components.map((component) => component.id);
  const seed = {
    schemaVersion: "dauva.dev/seed/v1",
    id: answers.id,
    version: "0.1.0",
    status: "draft",
    podId: answers.podId,
    genres: answers.genres,
    metadata: {
      title: localized(answers.title),
      description: localized(answers.description),
      icon: answers.icon,
    },
    source: answers.source,
    trust: {
      level: "curated",
      reviewedAt: answers.reviewedAt,
      mutableRuntimeImagesAllowed: false,
    },
    compatibility: {
      operatingSystems: ["linux"],
      architectures: answers.architectures ?? ["amd64"],
      leafCapabilities: [
        "dynamic-ports",
        "oci",
        "persistent-storage",
        "resource-limits",
      ],
    },
    components,
    volumes,
    ports,
    resources: {
      defaultPresetId: "balanced",
      presets: [
        {
          id: "balanced",
          title: localized("Balanced"),
          description: localized(
            "Review and prove these starting resources before promotion.",
          ),
          memoryMb: answers.resources.memoryMb,
          diskMb: answers.resources.diskMb,
          cpuPercent: answers.resources.cpuPercent,
        },
      ],
    },
    storage: {
      class: answers.storage.class ?? "bulk",
      backupClass: answers.storage.backupClass ?? "backup",
      estimatedDownloadMb: answers.storage.estimatedDownloadMb,
      estimatedInstallMb: answers.storage.estimatedInstallMb,
      estimatedMutableMb: answers.storage.estimatedMutableMb,
      backupPolicy: answers.storage.backupPolicy ?? "recommended",
    },
    inputs,
    secrets,
    lifecycle: {
      startOrder: componentIds,
      stopOrder: [...componentIds].reverse(),
      stopTimeoutSeconds: answers.stopTimeoutSeconds ?? 120,
    },
    capabilities: {
      backup: false,
      restore: false,
      update: false,
      console: false,
    },
    updatePolicy: {
      discovery: "oci-tag",
      automaticCheck: true,
      automaticInstall: false,
      requiresBackup: false,
      rollback: true,
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
  if (components.filter((component) => component.role === "primary").length !== 1) {
    unresolved.push("The proposal must contain exactly one primary component.");
  }
  if (answers.relatedSeedCount == null || answers.relatedSeedCount < 2) {
    unresolved.push(
      "Define at least one related Seed variant before publishing a new Pod.",
    );
  }
  return {
    pod,
    seed,
    report: {
      ...createReport({
        analysis,
        mode: "guided-draft",
        unresolved,
        differences: [],
        readyForProof: unresolved.length === 0,
      }),
      environmentReview,
    },
    proofPlan: createProofPlan(seed, unresolved.length === 0),
  };
}

function applyEnvironmentDecision({
  componentId,
  environmentName,
  decision,
  environment,
  optionEnvironment,
  agreementEnvironment,
  secretEnvironment,
  runtimeEnvironment,
  unresolved,
  environmentReview,
}) {
  const classification = decision.classification;
  if (
    classification === "constant" &&
    secretNamePattern.test(environmentName)
  ) {
    throw new Error(
      `Environment key '${componentId}.${environmentName}' looks secret and cannot become a fixed constant.`,
    );
  }
  if (classification === "constant") {
    if (typeof decision.value !== "string") {
      unresolved.push(
        `Provide the reviewed constant for '${componentId}.${environmentName}'.`,
      );
    } else {
      environment[environmentName] = decision.value;
    }
  } else if (classification === "setting") {
    requireDecisionKey(componentId, environmentName, decision);
    optionEnvironment[decision.key] = environmentName;
  } else if (classification === "secret") {
    requireDecisionKey(componentId, environmentName, decision);
    secretEnvironment[decision.key] = environmentName;
  } else if (classification === "agreement") {
    requireDecisionKey(componentId, environmentName, decision);
    agreementEnvironment[decision.key] = {
      name: environmentName,
      acceptedValue: decision.acceptedValue,
    };
  } else if (classification === "runtime") {
    requireDecisionKey(componentId, environmentName, decision);
    runtimeEnvironment[decision.key] = environmentName;
  } else if (classification !== "ignore") {
    throw new Error(
      `Unsupported environment classification '${classification}'.`,
    );
  }
  environmentReview.push({
    componentId,
    environmentKey: environmentName,
    observedClassification: decision.observedClassification ?? "review",
    decision: classification,
  });
}

function requireDecisionKey(componentId, environmentName, decision) {
  if (!idPattern.test(decision.key ?? "")) {
    throw new Error(
      `Environment decision '${componentId}.${environmentName}' requires a Dauva key.`,
    );
  }
}

function collectInputDefinitions(environmentByComponent = {}) {
  const definitions = new Map();
  for (const decisions of Object.values(environmentByComponent)) {
    for (const decision of Object.values(decisions)) {
      if (decision.classification === "setting") {
        definitions.set(decision.key, {
          key: decision.key,
          type: decision.type ?? "string",
          label: localized(decision.label ?? humanize(decision.key)),
          help: localized(decision.help ?? `Configure ${humanize(decision.key)}.`),
          required: decision.required ?? false,
          defaultValue: decision.defaultValue ?? "",
          ...(decision.minLength == null
            ? {}
            : { minLength: decision.minLength }),
          ...(decision.maxLength == null
            ? {}
            : { maxLength: decision.maxLength }),
        });
      }
      if (decision.classification === "agreement") {
        if (!decision.url || !decision.acceptedValue) {
          throw new Error(
            `Agreement '${decision.key}' requires an official URL and acceptedValue.`,
          );
        }
        definitions.set(decision.key, {
          key: decision.key,
          type: "agreement",
          label: localized(decision.label ?? humanize(decision.key)),
          help: localized(
            decision.help ??
              `I have read and accept ${humanize(decision.key)}.`,
          ),
          required: true,
          defaultValue: "false",
          url: decision.url,
          revision: decision.revision ?? "official-current",
        });
      }
    }
  }
  return [...definitions.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function collectSecretDefinitions(environmentByComponent = {}) {
  const definitions = new Map();
  for (const decisions of Object.values(environmentByComponent)) {
    for (const decision of Object.values(decisions)) {
      if (decision.classification !== "secret") {
        continue;
      }
      definitions.set(decision.key, {
        key: decision.key,
        source: "admin",
        label: localized(decision.label ?? humanize(decision.key)),
        help: localized(
          decision.help ??
            "Entered by the admin and never embedded in the Seed.",
        ),
        minLength: decision.minLength ?? 1,
        maxLength: decision.maxLength ?? 256,
      });
    }
  }
  return [...definitions.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function groupPorts(observedPorts) {
  const grouped = new Map();
  for (const port of observedPorts) {
    const key = `${port.componentId}:${port.containerPort}`;
    const current = grouped.get(key) ?? {
      id: normalizeId(
        `${port.componentId}-${port.containerPort}`,
        `port-${port.containerPort}`,
      ),
      componentId: port.componentId,
      containerPort: port.containerPort,
      containerPortMode: "fixed",
      protocols: [],
      exposure: "public",
      purpose: "game",
      primary: false,
      sharedHostPort: true,
    };
    if (!current.protocols.includes(port.protocol)) {
      current.protocols.push(port.protocol);
    }
    grouped.set(key, current);
  }
  const ports = [...grouped.values()].sort(
    (left, right) => left.containerPort - right.containerPort,
  );
  if (ports[0]) {
    ports[0].primary = true;
  }
  return ports;
}

function compareObservedContract(analysis, referenceSeed) {
  const differences = [];
  const expectedComponents = new Map(
    referenceSeed.components.map((component) => [component.id, component]),
  );
  const observedComponents = new Map(
    analysis.components.map((component) => [component.id, component]),
  );
  for (const expected of referenceSeed.components) {
    if (!observedComponents.has(expected.id)) {
      differences.push({
        key: "component-not-observed",
        message: `Reference component '${expected.id}' was not observed on the source.`,
      });
    }
  }
  for (const observed of analysis.components) {
    const expected = expectedComponents.get(observed.id);
    if (!expected) {
      differences.push({
        key: "component-missing",
        message: `Observed component '${observed.id}' is absent from the reference Seed.`,
      });
      continue;
    }
    if (
      imageRepository(observed.image.reference) !==
      imageRepository(expected.image)
    ) {
      differences.push({
        key: "image-repository",
        message: `Component '${observed.id}' uses a different image repository.`,
      });
    }
    const expectedTargets = new Set(
      expected.volumeMounts.map((mount) => mount.target),
    );
    const observedTargets = new Set(
      observed.mounts.map((mount) => mount.target),
    );
    for (const target of expectedTargets) {
      if (!observedTargets.has(target)) {
        differences.push({
          key: "mount-not-observed",
          message: `Reference mount '${observed.id}:${target}' was not observed on the source.`,
        });
      }
    }
    for (const mount of observed.mounts) {
      if (!expectedTargets.has(mount.target)) {
        differences.push({
          key: "mount-target",
          message: `Observed mount '${observed.id}:${mount.target}' is absent from the reference Seed.`,
        });
      }
    }
    const expectedEnvironment = new Set([
      ...Object.keys(expected.environment),
      ...Object.values(expected.optionEnvironment),
      ...Object.values(expected.agreementEnvironment).map(
        (mapping) => mapping.name,
      ),
      ...Object.values(expected.secretEnvironment),
      ...Object.values(expected.runtimeEnvironment),
    ]);
    const observedEnvironment = new Set(
      observed.environment.map((item) => item.key),
    );
    for (const name of expectedEnvironment) {
      if (!observedEnvironment.has(name)) {
        differences.push({
          key: "environment-not-observed",
          message: `Reference environment key '${observed.id}.${name}' was not observed on the source.`,
        });
      }
    }
  }
  const expectedPorts = new Set(
    referenceSeed.ports.flatMap((port) =>
      port.protocols.map(
        (protocol) =>
          `${port.componentId}:${port.containerPort}/${protocol}`,
      ),
    ),
  );
  for (const port of analysis.ports) {
    const key = `${port.componentId}:${port.containerPort}/${port.protocol}`;
    if (!expectedPorts.has(key)) {
      differences.push({
        key: "port",
        message: `Observed port '${key}' is absent from the reference Seed.`,
      });
    }
  }
  const observedPorts = new Set(
    analysis.ports.map(
      (port) =>
        `${port.componentId}:${port.containerPort}/${port.protocol}`,
    ),
  );
  for (const key of expectedPorts) {
    if (!observedPorts.has(key)) {
      differences.push({
        key: "port-not-observed",
        message: `Reference port '${key}' was not observed on the source.`,
      });
    }
  }
  return differences;
}

function createReport({
  analysis,
  mode,
  unresolved,
  differences,
  readyForProof,
  reference,
}) {
  return {
    schemaVersion: "dauva.dev/seed-creator-review/v1",
    candidateId: analysis.candidateId,
    candidateName: analysis.candidateName,
    sourceKind: analysis.sourceKind,
    mode,
    recommendedAction: analysis.recommendedAction,
    existingSeed: analysis.existingSeed ?? null,
    reference: reference ?? null,
    safety: {
      hostPathsExcluded: true,
      secretValuesExcluded: true,
      privilegedRuntimeForbidden: true,
      dockerSocketForbidden: true,
      mutableImagesForbiddenAtProof: true,
      agreementsRequireExplicitAcceptance: true,
    },
    differences,
    unresolved: [...new Set(unresolved)],
    readyForProof,
    generatedAtUtc: new Date().toISOString(),
  };
}

function createProofPlan(seed, ready) {
  return {
    schemaVersion: "dauva.dev/seed-creator-proof-plan/v1",
    seedId: seed.id,
    seedVersion: seed.version,
    ready,
    disposableLeafRequired: true,
    checks: seed.proofPolicy.requiredChecks,
    promotion: [
      "Review every source, agreement, setting, secret, port, volume, and resource.",
      "Commit the draft through the Registry review workflow.",
      "Run the complete disposable Leaf proof.",
      "Promote only the exact proved manifest digest.",
    ],
  };
}

function validateAnswers(answers) {
  if (!answers || answers.schemaVersion !== "dauva.dev/seed-creator-request/v1") {
    throw new Error(
      "Guided creation requires a dauva.dev/seed-creator-request/v1 answers document.",
    );
  }
  for (const key of ["id", "podId"]) {
    if (!idPattern.test(answers[key] ?? "")) {
      throw new Error(`${key} must be a Dauva identifier.`);
    }
  }
  for (const key of ["title", "description", "icon", "reviewedAt"]) {
    if (typeof answers[key] !== "string" || answers[key].trim() === "") {
      throw new Error(`${key} is required.`);
    }
  }
  if (!Array.isArray(answers.genres) || answers.genres.length === 0) {
    throw new Error("At least one genre is required.");
  }
  if (!answers.source?.homepage || !answers.source?.repository) {
    throw new Error("The official homepage and trusted runtime source are required.");
  }
  if (!answers.resources || !answers.storage) {
    throw new Error("Resource and storage estimates are required.");
  }
  assertNoForbiddenProperties(answers);
}

function assertSafeAnalysis(analysis) {
  if (analysis?.schemaVersion !== "dauva.dev/seed-creator-analysis/v1") {
    throw new Error("Unsupported Seed Creator analysis.");
  }
  assertNoForbiddenProperties(analysis);
  for (const component of analysis.components ?? []) {
    for (const environment of component.environment ?? []) {
      if (Object.hasOwn(environment, "value")) {
        throw new Error(
          `Analysis leaked a value for '${component.id}.${environment.key}'.`,
        );
      }
    }
    for (const mount of component.mounts ?? []) {
      if (!mount.target?.startsWith("/")) {
        throw new Error("Creator mounts may only expose container targets.");
      }
    }
  }
}

function assertNoForbiddenProperties(value, currentPath = "") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoForbiddenProperties(entry, `${currentPath}[${index}]`),
    );
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const keyPath = currentPath ? `${currentPath}.${key}` : key;
    if (forbiddenPropertyPattern.test(key)) {
      throw new Error(`Forbidden Creator property '${keyPath}'.`);
    }
    assertNoForbiddenProperties(nested, keyPath);
  }
}

function uniqueVolumeId(candidate, volumesById) {
  let id = normalizeId(candidate, "data");
  let suffix = 2;
  const base = id;
  while (volumesById.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function deriveVolumeId(target, index) {
  const last = path.posix.basename(target);
  return normalizeId(last, index === 0 ? "data" : `data-${index + 1}`);
}

function inferVolumeRole(target) {
  return /(?:cache|steamcmd|dedicated|serverfiles|game)$/i.test(target)
    ? "cache"
    : "data";
}

function normalizeId(value, fallback) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return idPattern.test(normalized) ? normalized : fallback;
}

function mutableReference(image) {
  return image.includes("@") ? image.slice(0, image.indexOf("@")) + ":latest" : image;
}

function imageRepository(image) {
  const withoutDigest = image.split("@", 1)[0];
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  return lastColon > lastSlash
    ? withoutDigest.slice(0, lastColon)
    : withoutDigest;
}

function localized(value) {
  return { en: value, nl: value, de: value };
}

function humanize(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
