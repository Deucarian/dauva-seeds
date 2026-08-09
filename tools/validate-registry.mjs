import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  calculateProofContractDigest,
  canonicalJson,
  readJson,
  readManifestDirectory,
  releasedVersion,
  repositoryRoot,
  proofReleasesVersion,
  sha256,
} from "./registry-lib.mjs";
import {
  apiStatementDigest,
  proofApiDomain,
  proofLeafDomain,
  verifyAttestation,
} from "./proof-crypto.mjs";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
addFormats(ajv);

const podSchema = await readJson(
  path.join(repositoryRoot, "schemas", "pod-v1.schema.json"),
);
const seedSchema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-v1.schema.json"),
);
const proofV1Schema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-proof-v1.schema.json"),
);
const proofPlanSchema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-proof-plan-v1.schema.json"),
);
const proofV2Schema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-proof-v2.schema.json"),
);
const releaseBundleSchema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-release-bundle-v1.schema.json"),
);
const verificationRootsSchema = await readJson(
  path.join(
    repositoryRoot,
    "schemas",
    "seed-studio-verification-roots-v1.schema.json",
  ),
);
const verificationRoots = await readJson(
  path.join(repositoryRoot, "trust", "seed-studio-verification-roots.json"),
);
const validatePod = ajv.compile(podSchema);
const validateSeed = ajv.compile(seedSchema);
const validateProofV1 = ajv.compile(proofV1Schema);
const validateProofPlan = ajv.compile(proofPlanSchema);
const validateProofV2 = ajv.compile(proofV2Schema);
const validateReleaseBundle = ajv.compile(releaseBundleSchema);
const validateVerificationRoots = ajv.compile(verificationRootsSchema);
void validateProofPlan;
void validateReleaseBundle;
const podFiles = await readManifestDirectory("registry/pods");
const seedFiles = await readManifestDirectory("registry/seeds");
const releaseFiles = await readManifestDirectory("registry/history", {
  allowMissing: true,
});
const proofFiles = await readManifestDirectory("proofs");
const errors = [];

validateSchema(
  {
    name: "trust/seed-studio-verification-roots.json",
    value: verificationRoots,
  },
  validateVerificationRoots,
  "verification roots",
  false,
);
validateVerificationRootKeys(verificationRoots);

for (const entry of podFiles) {
  validateSchema(entry, validatePod, "Pod");
}
for (const entry of seedFiles) {
  validateSchema(entry, validateSeed, "Seed");
}
for (const entry of releaseFiles) {
  validateSchema(entry, validateSeed, "historical Seed", false);
  if (`${entry.value.id}@${entry.value.version}.json` !== entry.name) {
    errors.push(
      `${entry.name}: historical filename must match ${entry.value.id}@${entry.value.version}.json.`,
    );
  }
  if (entry.value.status !== "stable") {
    errors.push(`${entry.name}: only stable Seeds may enter release history.`);
  }
}
for (const entry of proofFiles) {
  const validator =
    entry.value.schemaVersion === "dauva.dev/seed-proof/v2"
      ? validateProofV2
      : validateProofV1;
  validateSchema(entry, validator, "Seed proof", false);
}

validateUniqueIds(podFiles, "Pod");
validateUniqueIds(seedFiles, "Seed");
validateUniqueReleaseIds(releaseFiles);

const podIds = new Set(podFiles.map((entry) => entry.value.id));
for (const entry of seedFiles) {
  validateSeedPolicy(entry, podIds);
}
for (const entry of releaseFiles) {
  validateSeedPolicy(entry, podIds);
}
validatePodMembership(podFiles, seedFiles);
validateProofPolicy(proofFiles, seedFiles, verificationRoots);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${podFiles.length} Pods, ${seedFiles.length} Seeds, ${releaseFiles.length} historical releases, and ${proofFiles.length} legacy proof receipt${proofFiles.length === 1 ? "" : "s"} without policy violations.`,
  );
}

function validateSchema(entry, validator, kind, enforceIdFileName = true) {
  if (!validator(entry.value)) {
    for (const error of validator.errors ?? []) {
      errors.push(
        `${entry.name}: ${kind} schema ${error.instancePath || "/"} ${error.message}`,
      );
    }
  }
  if (enforceIdFileName && `${entry.value.id}.json` !== entry.name) {
    errors.push(
      `${entry.name}: filename must match the manifest id (${entry.value.id}.json).`,
    );
  }
}

function validateUniqueIds(entries, kind) {
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.value.id)) {
      errors.push(`${entry.name}: duplicate ${kind} id '${entry.value.id}'.`);
    }
    seen.add(entry.value.id);
  }
}

function validateUniqueReleaseIds(entries) {
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.value.id}@${entry.value.version}`;
    if (seen.has(key)) {
      errors.push(`${entry.name}: duplicate historical Seed '${key}'.`);
    }
    seen.add(key);
  }
}

function validatePodMembership(pods, seeds) {
  const seedCountByPod = new Map(pods.map((entry) => [entry.value.id, 0]));
  const seedIdsByPod = new Map(
    pods.map((entry) => [entry.value.id, new Set()]),
  );
  for (const entry of seeds) {
    if (seedCountByPod.has(entry.value.podId)) {
      seedCountByPod.set(
        entry.value.podId,
        seedCountByPod.get(entry.value.podId) + 1,
      );
      seedIdsByPod.get(entry.value.podId).add(entry.value.id);
    }
  }

  for (const entry of pods) {
    const podId = entry.value.id;
    const seedCount = seedCountByPod.get(podId);
    if (seedCount < 2) {
      errors.push(
        `${podId}.json: every Pod must contain at least two related Seeds.`,
      );
    }
    if (!entry.value.recommendedSeedId) {
      errors.push(`${podId}.json: every Pod must recommend one Seed.`);
    } else if (!seedIdsByPod.get(podId).has(entry.value.recommendedSeedId)) {
      errors.push(
        `${podId}.json: recommended Seed '${entry.value.recommendedSeedId}' does not belong to this Pod.`,
      );
    }
  }
}

function validateSeedPolicy(entry, podIds) {
  const seed = entry.value;
  if (!podIds.has(seed.podId)) {
    errors.push(`${entry.name}: Pod '${seed.podId}' does not exist.`);
  }

  const componentIds = uniqueIds(
    entry.name,
    "component",
    seed.components,
  );
  const volumeIds = uniqueIds(entry.name, "volume", seed.volumes);
  const portIds = uniqueIds(entry.name, "port", seed.ports);
  const inputIds = uniqueIds(entry.name, "input", seed.inputs, "key");
  const secretIds = uniqueIds(entry.name, "secret", seed.secrets, "key");
  uniqueIds(entry.name, "resource preset", seed.resources.presets);

  const primaryComponents = seed.components.filter(
    (component) => component.role === "primary",
  );
  if (primaryComponents.length !== 1) {
    errors.push(`${entry.name}: exactly one primary component is required.`);
  }

  const primaryPorts = seed.ports.filter((port) => port.primary);
  if (primaryPorts.length !== 1) {
    errors.push(`${entry.name}: exactly one primary public port is required.`);
  }
  if (primaryPorts.some((port) => port.exposure !== "public")) {
    errors.push(`${entry.name}: the primary port must be public.`);
  }

  for (const component of seed.components) {
    if (!component.image.includes("@sha256:")) {
      errors.push(`${entry.name}: ${component.id} image is not pinned by digest.`);
    }
    const pinnedRepository = component.image.split("@", 1)[0];
    const imageRegistry = pinnedRepository.slice(
      0,
      pinnedRepository.indexOf("/"),
    );
    if (!seed.source.imageRegistries.includes(imageRegistry)) {
      errors.push(
        `${entry.name}: ${component.id} uses registry '${imageRegistry}' outside source.imageRegistries.`,
      );
    }
    const updateRepository = component.imageUpdate.reference.slice(
      0,
      component.imageUpdate.reference.lastIndexOf(":"),
    );
    if (pinnedRepository !== updateRepository) {
      errors.push(
        `${entry.name}: ${component.id} update reference must use repository '${pinnedRepository}'.`,
      );
    }
    for (const name of Object.keys(component.environment)) {
      if (/(?:PASSWORD|PASSWD|TOKEN|SECRET|API_KEY|PRIVATE_KEY)/i.test(name)) {
        errors.push(
          `${entry.name}: ${component.id} fixed environment '${name}' looks secret; use secretEnvironment.`,
        );
      }
    }
    for (const optionKey of Object.keys(component.optionEnvironment)) {
      if (!inputIds.has(optionKey)) {
        errors.push(
          `${entry.name}: ${component.id} maps unknown input '${optionKey}'.`,
        );
      }
    }
    for (const agreementKey of Object.keys(component.agreementEnvironment)) {
      const input = seed.inputs.find((candidate) => candidate.key === agreementKey);
      if (!input || input.type !== "agreement") {
        errors.push(
          `${entry.name}: ${component.id} maps unknown agreement '${agreementKey}'.`,
        );
      }
    }
    for (const secretKey of Object.keys(component.secretEnvironment)) {
      if (!secretIds.has(secretKey)) {
        errors.push(
          `${entry.name}: ${component.id} maps unknown secret '${secretKey}'.`,
        );
      }
    }
    for (const mount of component.volumeMounts) {
      if (!volumeIds.has(mount.volumeId)) {
        errors.push(
          `${entry.name}: ${component.id} mounts unknown volume '${mount.volumeId}'.`,
        );
      }
      if (mount.target === "/var/run/docker.sock") {
        errors.push(`${entry.name}: Docker socket mounts are forbidden.`);
      }
    }
    const mountVolumes = new Set();
    const mountTargets = new Set();
    for (const mount of component.volumeMounts) {
      if (mountVolumes.has(mount.volumeId)) {
        errors.push(
          `${entry.name}: ${component.id} mounts volume '${mount.volumeId}' more than once.`,
        );
      }
      if (mountTargets.has(mount.target)) {
        errors.push(
          `${entry.name}: ${component.id} uses mount target '${mount.target}' more than once.`,
        );
      }
      mountVolumes.add(mount.volumeId);
      mountTargets.add(mount.target);
    }
    const environmentDestinations = [
      ...Object.keys(component.environment),
      ...Object.values(component.optionEnvironment),
      ...Object.values(component.agreementEnvironment).map(
        (mapping) => mapping.name,
      ),
      ...Object.values(component.secretEnvironment),
      ...Object.values(component.runtimeEnvironment),
    ];
    for (const destination of duplicateValues(environmentDestinations)) {
      errors.push(
        `${entry.name}: ${component.id} environment destination '${destination}' has multiple sources.`,
      );
    }
    for (const dependency of component.dependsOn) {
      if (!componentIds.has(dependency) || dependency === component.id) {
        errors.push(
          `${entry.name}: ${component.id} has invalid dependency '${dependency}'.`,
        );
      }
    }
  }

  validateDependencyGraph(entry.name, seed.components);

  for (const port of seed.ports) {
    if (!componentIds.has(port.componentId)) {
      errors.push(
        `${entry.name}: port '${port.id}' references unknown component '${port.componentId}'.`,
      );
    }
    if (
      port.containerPortMode === "allocated" &&
      port.exposure !== "public"
    ) {
      errors.push(
        `${entry.name}: private port '${port.id}' cannot use an allocated container port.`,
      );
    }
  }

  for (const secret of seed.secrets) {
    const mapped = seed.components.some((component) =>
      Object.hasOwn(component.secretEnvironment, secret.key),
    );
    if (!mapped) {
      errors.push(`${entry.name}: secret '${secret.key}' is never consumed.`);
    }
    if (
      secret.source === "admin" &&
      secret.minLength != null &&
      secret.maxLength != null &&
      secret.minLength > secret.maxLength
    ) {
      errors.push(
        `${entry.name}: secret '${secret.key}' has minLength greater than maxLength.`,
      );
    }
  }

  for (const volume of seed.volumes) {
    const mounted = seed.components.some((component) =>
      component.volumeMounts.some((mount) => mount.volumeId === volume.id),
    );
    if (!mounted) {
      errors.push(`${entry.name}: volume '${volume.id}' is never mounted.`);
    }
  }

  for (const componentId of [
    ...seed.lifecycle.startOrder,
    ...seed.lifecycle.stopOrder,
  ]) {
    if (!componentIds.has(componentId)) {
      errors.push(
        `${entry.name}: lifecycle references unknown component '${componentId}'.`,
      );
    }
  }
  if (new Set(seed.lifecycle.startOrder).size !== componentIds.size) {
    errors.push(`${entry.name}: startOrder must include every component once.`);
  }
  if (new Set(seed.lifecycle.stopOrder).size !== componentIds.size) {
    errors.push(`${entry.name}: stopOrder must include every component once.`);
  }
  validateLifecycleDependencyOrder(entry.name, seed);

  if (!seed.resources.presets.some(
    (preset) => preset.id === seed.resources.defaultPresetId,
  )) {
    errors.push(`${entry.name}: default resource preset does not exist.`);
  }

  for (const input of seed.inputs) {
    if (input.type === "agreement") {
      if (input.defaultValue !== "false") {
        errors.push(`${entry.name}: agreements must default to false.`);
      }
      if (!input.required) {
        errors.push(`${entry.name}: declared agreements must be required.`);
      }
    }
    const mapped = seed.components.some((component) =>
      Object.hasOwn(component.optionEnvironment, input.key),
    );
    if (input.type !== "agreement" && !mapped) {
      errors.push(`${entry.name}: input '${input.key}' is never consumed.`);
    }
  }

  if (seed.proofPolicy.expiresAfterDays < 14) {
    errors.push(
      `${entry.name}: proofPolicy.expiresAfterDays must be at least 14 for release readiness.`,
    );
  }

  if (seed.trust.mutableRuntimeImagesAllowed !== false) {
    errors.push(`${entry.name}: mutable runtime images are forbidden.`);
  }
  if (seed.updatePolicy.automaticInstall !== false) {
    errors.push(`${entry.name}: unattended Seed installation is forbidden.`);
  }
  if (
    seed.updatePolicy.requiresBackup &&
    !seed.capabilities.backup
  ) {
    errors.push(
      `${entry.name}: update requires a backup but the Seed has no backup capability.`,
    );
  }
  if (seed.capabilities.update) {
    if (
      !seed.compatibility.leafCapabilities.includes(
        "managed-game-updates-v1",
      )
    ) {
      errors.push(
        `${entry.name}: managed updates require Leaf capability 'managed-game-updates-v1'.`,
      );
    }
    if (!seed.runtimeVersion) {
      errors.push(
        `${entry.name}: managed updates require a runtime version detector.`,
      );
    }
    if (!seed.capabilities.backup || !seed.capabilities.restore) {
      errors.push(
        `${entry.name}: managed updates require backup and restore capabilities.`,
      );
    }
    if (!seed.updatePolicy.requiresBackup || !seed.updatePolicy.rollback) {
      errors.push(
        `${entry.name}: managed updates must require a backup and rollback.`,
      );
    }
    if (!seed.updatePolicy.strategy) {
      errors.push(
        `${entry.name}: managed updates require a trusted update strategy.`,
      );
    }
    for (const requiredCheck of [
      "runtime-version",
      "managed-update",
      "rollback",
    ]) {
      if (!seed.proofPolicy.requiredChecks.includes(requiredCheck)) {
        errors.push(
          `${entry.name}: managed updates require proof check '${requiredCheck}'.`,
        );
      }
    }
  } else if (seed.updatePolicy.strategy) {
    errors.push(
      `${entry.name}: an update strategy requires the update capability.`,
    );
  }
  validateRuntimeVersionContract(entry, componentIds, volumeIds);
  validateManagedUpdateContract(entry, componentIds, volumeIds);
  if (seed.capabilities.console !== Boolean(seed.console)) {
    errors.push(
      `${entry.name}: console capability and console contract must be enabled together.`,
    );
  }
  if (seed.console) {
    const consolePort = seed.ports.find(
      (port) => port.id === seed.console.portId,
    );
    if (!componentIds.has(seed.console.componentId)) {
      errors.push(
        `${entry.name}: console references unknown component '${seed.console.componentId}'.`,
      );
    }
    if (
      !consolePort ||
      consolePort.componentId !== seed.console.componentId ||
      consolePort.purpose !== "rcon" ||
      consolePort.exposure !== "private" ||
      !consolePort.protocols.includes("tcp")
    ) {
      errors.push(
        `${entry.name}: console must reference a private TCP RCON port on its component.`,
      );
    }
    if (!secretIds.has(seed.console.secretKey)) {
      errors.push(
        `${entry.name}: console references unknown secret '${seed.console.secretKey}'.`,
      );
    }
  }

  const forbiddenKeys = findForbiddenKeys(seed);
  for (const keyPath of forbiddenKeys) {
    errors.push(`${entry.name}: forbidden host/runtime property '${keyPath}'.`);
  }

  void portIds;
}

function validateRuntimeVersionContract(entry, componentIds, volumeIds) {
  const seed = entry.value;
  const detector = seed.runtimeVersion;
  if (!detector) {
    return;
  }
  if (!componentIds.has(detector.componentId)) {
    errors.push(
      `${entry.name}: runtime version detector references unknown component '${detector.componentId}'.`,
    );
    return;
  }
  if (!volumeIds.has(detector.volumeId)) {
    errors.push(
      `${entry.name}: runtime version detector references unknown volume '${detector.volumeId}'.`,
    );
    return;
  }
  const component = seed.components.find(
    (candidate) => candidate.id === detector.componentId,
  );
  if (!component.volumeMounts.some(
    (mount) => mount.volumeId === detector.volumeId,
  )) {
    errors.push(
      `${entry.name}: runtime version detector volume '${detector.volumeId}' is not mounted by '${detector.componentId}'.`,
    );
  }
  if (detector.strategy === "steam-app-manifest") {
    if (seed.source.kind !== "steamcmd" || !seed.source.upstreamId) {
      errors.push(
        `${entry.name}: Steam manifest detection requires a SteamCMD source with an upstream app id.`,
      );
    } else if (
      !detector.path.endsWith(
        `appmanifest_${seed.source.upstreamId}.acf`,
      )
    ) {
      errors.push(
        `${entry.name}: Steam manifest path must identify app '${seed.source.upstreamId}'.`,
      );
    }
  }
}

function validateManagedUpdateContract(entry, componentIds, volumeIds) {
  const seed = entry.value;
  const policy = seed.updatePolicy;
  if (!policy.strategy) {
    return;
  }
  if (!componentIds.has(policy.componentId)) {
    errors.push(
      `${entry.name}: update strategy references unknown component '${policy.componentId}'.`,
    );
    return;
  }
  if (!volumeIds.has(policy.volumeId)) {
    errors.push(
      `${entry.name}: update strategy references unknown volume '${policy.volumeId}'.`,
    );
    return;
  }
  const component = seed.components.find(
    (candidate) => candidate.id === policy.componentId,
  );
  const mount = component.volumeMounts.find(
    (candidate) => candidate.volumeId === policy.volumeId,
  );
  if (!mount) {
    errors.push(
      `${entry.name}: update volume '${policy.volumeId}' is not mounted by '${policy.componentId}'.`,
    );
  } else if (
    policy.installDirectory !== mount.target &&
    !policy.installDirectory.startsWith(`${mount.target}/`)
  ) {
    errors.push(
      `${entry.name}: update install directory must stay inside the declared '${policy.volumeId}' mount.`,
    );
  }
  if (policy.strategy === "steamcmd") {
    if (!isBoundedAbsoluteContainerPath(policy.executable)) {
      errors.push(
        `${entry.name}: SteamCMD executable must be a bounded absolute container path.`,
      );
    }
    if (!isBoundedAbsoluteContainerPath(policy.homeDirectory)) {
      errors.push(
        `${entry.name}: SteamCMD home directory must be a bounded absolute container path.`,
      );
    }
    const userMatch =
      typeof policy.user === "string"
        ? policy.user.match(/^([1-9][0-9]*):([1-9][0-9]*)$/)
        : null;
    if (
      !userMatch ||
      BigInt(userMatch[1]) > 2147483647n ||
      BigInt(userMatch[2]) > 2147483647n
    ) {
      errors.push(
        `${entry.name}: SteamCMD update user must be an unprivileged numeric uid:gid.`,
      );
    }
    if (
      seed.source.kind !== "steamcmd" ||
      seed.source.upstreamId !== policy.appId
    ) {
      errors.push(
        `${entry.name}: SteamCMD update app id must match the Seed source.`,
      );
    }
    if (component.environment.SKIPUPDATE !== "true") {
      errors.push(
        `${entry.name}: managed SteamCMD updates require silent restart updates to be disabled.`,
      );
    }
    if (
      seed.runtimeVersion?.componentId !== policy.componentId ||
      seed.runtimeVersion?.volumeId !== policy.volumeId
    ) {
      errors.push(
        `${entry.name}: managed update and runtime version contracts must use the same component and volume.`,
      );
    }
    const expectedBranch =
      seed.runtimeVersion?.channel === "experimental"
        ? "experimental"
        : "public";
    if (policy.branch !== expectedBranch) {
      errors.push(
        `${entry.name}: SteamCMD branch '${policy.branch}' does not match runtime channel '${seed.runtimeVersion?.channel}'.`,
      );
    }
  }
}

function isBoundedAbsoluteContainerPath(value) {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length <= 512 &&
    /^\/(?!.*\.\.)[A-Za-z0-9._/-]+$/.test(value)
  );
}

function validateProofPolicy(proofs, seeds, roots) {
  const seedById = new Map(seeds.map((entry) => [entry.value.id, entry.value]));
  const legacyProofKeys = new Set();
  const proofIds = new Set();

  for (const entry of proofs) {
    const proof = entry.value;
    if (proof.schemaVersion === "dauva.dev/seed-proof/v2") {
      validateProofV2Policy(entry, seedById, roots, proofIds);
      continue;
    }
    const proofKey = `${proof.seedId}@${proof.seedVersion}`;
    if (legacyProofKeys.has(proofKey)) {
      errors.push(`${entry.name}: duplicate proof receipt for '${proofKey}'.`);
    }
    legacyProofKeys.add(proofKey);

    if (!seedById.has(proof.seedId)) {
      errors.push(`${entry.name}: Seed '${proof.seedId}' does not exist.`);
    } else if (
      !proofReleasesVersion(
        proof.seedVersion,
        seedById.get(proof.seedId).version,
      )
    ) {
      errors.push(
        `${entry.name}: proof version '${proof.seedVersion}' does not release current Seed '${proof.seedId}@${seedById.get(proof.seedId).version}'.`,
      );
    }
    if (`${proof.seedId}-${proof.seedVersion}.json` !== entry.name) {
      errors.push(
        `${entry.name}: proof filename must identify '${proof.seedId}-${proof.seedVersion}.json'.`,
      );
    }
    const seed = seedById.get(proof.seedId);
    if (
      seed?.capabilities.update &&
      proofReleasesSeedVersion(proof.seedVersion, seed.version)
    ) {
      for (const check of [
        "runtimeVersion",
        "managedUpdate",
        "rollback",
      ]) {
        if (proof.checks[check] !== true) {
          errors.push(
            `${entry.name}: update-capable Seed proof must pass '${check}'.`,
          );
        }
      }
    }
  }
}

function validateProofV2Policy(entry, seedById, roots, proofIds) {
  const proof = entry.value;
  const payload = proof.receiptPayload;
  if (!payload?.seed || !payload?.runner || !payload?.proofId) return;
  const seed = seedById.get(payload.seed.id);
  const proofIdentity = payload.proofId;
  if (proofIds.has(proofIdentity)) {
    errors.push(`${entry.name}: duplicate proofId '${proofIdentity}'.`);
  }
  proofIds.add(proofIdentity);

  const expectedFileName = [
    payload.seed.id,
    payload.seed.testedVersion,
    payload.runner.architecture,
    `${payload.proofId}.json`,
  ].join("-");
  if (entry.name !== expectedFileName) {
    errors.push(
      `${entry.name}: proof-v2 filename must be '${expectedFileName}'.`,
    );
  }
  if (!seed) {
    errors.push(`${entry.name}: Seed '${payload.seed.id}' does not exist.`);
    return;
  }
  if (!proofReleasesVersion(payload.seed.testedVersion, seed.version)) {
    errors.push(
      `${entry.name}: tested version '${payload.seed.testedVersion}' does not release current Seed '${seed.id}@${seed.version}'.`,
    );
  }
  if (payload.seed.intendedStableVersion !== releasedVersion(seed.version)) {
    errors.push(
      `${entry.name}: intended stable version must be '${releasedVersion(seed.version)}'.`,
    );
  }
  if (!seed.compatibility.architectures.includes(payload.runner.architecture)) {
    errors.push(
      `${entry.name}: architecture '${payload.runner.architecture}' is not declared by Seed '${seed.id}'.`,
    );
  }

  const testedSeed = structuredClone(seed);
  testedSeed.version = payload.seed.testedVersion;
  if (payload.seed.testedVersion !== seed.version) testedSeed.status = "candidate";
  const expectedManifestDigest = sha256(canonicalJson(testedSeed));
  if (payload.seed.manifestDigest !== expectedManifestDigest) {
    errors.push(
      `${entry.name}: manifest digest does not match exact tested Seed bytes.`,
    );
  }
  const expectedProofContractDigest = calculateProofContractDigest(testedSeed);
  if (payload.seed.proofContractDigest !== expectedProofContractDigest) {
    errors.push(
      `${entry.name}: proof-contract digest does not match the tested Seed.`,
    );
  }
  const expectedReceiptDigest = sha256(canonicalJson(payload));
  if (proof.receiptDigest !== expectedReceiptDigest) {
    errors.push(`${entry.name}: receiptDigest does not match receiptPayload.`);
  }

  validateProofChecks(entry.name, seed, payload.checks ?? []);
  validateProofAgreements(entry.name, seed, payload.agreements ?? []);
  validateProofTimes(entry.name, seed, payload);
  validateProofSignatures(entry.name, proof, roots);
}

function validateProofChecks(fileName, seed, checks) {
  const byCode = new Map();
  for (const check of checks) {
    if (byCode.has(check.code)) {
      errors.push(`${fileName}: proof check '${check.code}' occurs more than once.`);
    }
    byCode.set(check.code, check);
  }
  const mandatory = [
    "images-pinned",
    "healthy",
    "ports",
    "graceful-stop",
    "stopped-remains-stopped",
    "restart",
    "persistence",
    "cleanup",
  ];
  for (const code of mandatory) {
    if (byCode.get(code)?.status !== "passed") {
      errors.push(`${fileName}: mandatory proof check '${code}' did not pass.`);
    }
  }
  for (const [capability, code] of [
    ["backup", "backup"],
    ["restore", "restore"],
    ["console", "console"],
    ["update", "update"],
  ]) {
    const expected = seed.capabilities[capability] ? "passed" : "not_applicable";
    if (byCode.get(code)?.status !== expected) {
      errors.push(
        `${fileName}: capability check '${code}' must be '${expected}'.`,
      );
    }
  }
}

function validateProofAgreements(fileName, seed, agreements) {
  const expected = seed.inputs.filter((input) => input.type === "agreement");
  const byKey = new Map(agreements.map((agreement) => [agreement.key, agreement]));
  if (byKey.size !== agreements.length) {
    errors.push(`${fileName}: agreement keys must be unique.`);
  }
  for (const input of expected) {
    const agreement = byKey.get(input.key);
    if (
      !agreement ||
      agreement.url !== input.url ||
      agreement.revision !== input.revision ||
      agreement.accepted !== true
    ) {
      errors.push(
        `${fileName}: agreement '${input.key}' is missing or does not match its exact URL/revision.`,
      );
    }
  }
  for (const agreement of agreements) {
    if (!expected.some((input) => input.key === agreement.key)) {
      errors.push(`${fileName}: unexpected agreement '${agreement.key}'.`);
    }
  }
}

function validateProofTimes(fileName, seed, payload) {
  const startedAt = Date.parse(payload.startedAt);
  const completedAt = Date.parse(payload.completedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (!(startedAt <= completedAt)) {
    errors.push(`${fileName}: completedAt precedes startedAt.`);
  }
  const expectedExpiry =
    completedAt + seed.proofPolicy.expiresAfterDays * 24 * 60 * 60 * 1000;
  if (expiresAt !== expectedExpiry) {
    errors.push(
      `${fileName}: expiresAt must equal completedAt plus ${seed.proofPolicy.expiresAfterDays} days.`,
    );
  }
}

function validateProofSignatures(fileName, proof, roots) {
  const leafKey = findActiveVerificationKey(
    roots,
    "proof_leaf",
    proof.leafAttestation?.keyId,
    proof.receiptPayload.runner.leafId,
  );
  if (!leafKey) {
    errors.push(`${fileName}: Leaf attestation key is unknown, revoked, or unbound.`);
    return;
  }
  if (proof.receiptPayload.runner.leafKeyId !== proof.leafAttestation.keyId) {
    errors.push(`${fileName}: runner leafKeyId does not match Leaf attestation.`);
  }
  if (
    !safeVerifyAttestation(
      proofLeafDomain,
      proof.receiptDigest,
      proof.leafAttestation,
      leafKey.publicKey,
    )
  ) {
    errors.push(`${fileName}: Leaf attestation signature is invalid.`);
  }

  const apiKey = findActiveVerificationKey(
    roots,
    "proof_api",
    proof.apiAttestation?.keyId,
  );
  if (!apiKey) {
    errors.push(`${fileName}: API attestation key is unknown or revoked.`);
    return;
  }
  const statementDigest = apiStatementDigest(
    proof.receiptDigest,
    proof.leafAttestation,
  );
  if (
    !safeVerifyAttestation(
      proofApiDomain,
      statementDigest,
      proof.apiAttestation,
      apiKey.publicKey,
    )
  ) {
    errors.push(`${fileName}: API attestation signature is invalid.`);
  }
}

function validateVerificationRootKeys(roots) {
  const keyIds = new Set();
  for (const key of roots.keys ?? []) {
    if (keyIds.has(key.keyId)) {
      errors.push(`verification roots: duplicate keyId '${key.keyId}'.`);
    }
    keyIds.add(key.keyId);
    try {
      const publicKey = Buffer.from(key.publicKey, "base64url");
      if (sha256(publicKey) !== key.keyId) {
        errors.push(`verification roots: keyId '${key.keyId}' does not match publicKey.`);
      }
    } catch {
      errors.push(`verification roots: public key '${key.keyId}' is invalid.`);
    }
    if (key.status === "active" && key.revokedAt !== null) {
      errors.push(`verification roots: active key '${key.keyId}' has revokedAt.`);
    }
    if (key.status === "revoked" && key.revokedAt === null) {
      errors.push(`verification roots: revoked key '${key.keyId}' lacks revokedAt.`);
    }
  }
}

function findActiveVerificationKey(roots, purpose, keyId, subject) {
  return (roots.keys ?? []).find(
    (key) =>
      key.purpose === purpose &&
      key.keyId === keyId &&
      key.status === "active" &&
      (subject == null || key.subjects.includes(subject)),
  );
}

function safeVerifyAttestation(domain, digest, attestation, publicKey) {
  try {
    return verifyAttestation({
      domain,
      digest,
      attestation,
      publicKey: Buffer.from(publicKey, "base64url"),
    });
  } catch {
    return false;
  }
}

function proofReleasesSeedVersion(proofVersion, seedVersion) {
  if (proofVersion === seedVersion) {
    return true;
  }
  return proofVersion.replace(/-rc\.[1-9][0-9]*$/, "") ===
    seedVersion.replace(/-rc\.[1-9][0-9]*$/, "");
}

function uniqueIds(fileName, kind, items, key = "id") {
  const ids = new Set();
  for (const item of items) {
    const id = item[key];
    if (ids.has(id)) {
      errors.push(`${fileName}: duplicate ${kind} id '${id}'.`);
    }
    ids.add(id);
  }
  return ids;
}

function findForbiddenKeys(value, currentPath = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findForbiddenKeys(item, `${currentPath}[${index}]`),
    );
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  const forbidden = [];
  for (const [key, nested] of Object.entries(value)) {
    const keyPath = currentPath ? `${currentPath}.${key}` : key;
    if (
      /^(?:hostPath|bindSource|privileged|dockerSocket|hostNetwork|pidMode)$/i.test(
        key,
      )
    ) {
      forbidden.push(keyPath);
    }
    forbidden.push(...findForbiddenKeys(nested, keyPath));
  }
  return forbidden;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function validateDependencyGraph(fileName, components) {
  const byId = new Map(components.map((component) => [component.id, component]));
  const visiting = new Set();
  const visited = new Set();

  const visit = (componentId, path) => {
    if (visiting.has(componentId)) {
      errors.push(
        `${fileName}: component dependency cycle '${[...path, componentId].join(" -> ")}'.`,
      );
      return;
    }
    if (visited.has(componentId)) return;
    const component = byId.get(componentId);
    if (!component) return;
    visiting.add(componentId);
    for (const dependency of component.dependsOn) {
      if (byId.has(dependency)) visit(dependency, [...path, componentId]);
    }
    visiting.delete(componentId);
    visited.add(componentId);
  };

  for (const component of components) visit(component.id, []);
}

function validateLifecycleDependencyOrder(fileName, seed) {
  const startIndex = new Map(
    seed.lifecycle.startOrder.map((componentId, index) => [componentId, index]),
  );
  const stopIndex = new Map(
    seed.lifecycle.stopOrder.map((componentId, index) => [componentId, index]),
  );
  for (const component of seed.components) {
    for (const dependency of component.dependsOn) {
      if (
        startIndex.has(component.id) &&
        startIndex.has(dependency) &&
        startIndex.get(dependency) > startIndex.get(component.id)
      ) {
        errors.push(
          `${fileName}: '${dependency}' must start before dependent '${component.id}'.`,
        );
      }
      if (
        stopIndex.has(component.id) &&
        stopIndex.has(dependency) &&
        stopIndex.get(component.id) > stopIndex.get(dependency)
      ) {
        errors.push(
          `${fileName}: dependent '${component.id}' must stop before '${dependency}'.`,
        );
      }
    }
  }
}
