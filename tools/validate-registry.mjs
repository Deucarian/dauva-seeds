import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  readJson,
  readManifestDirectory,
  repositoryRoot,
} from "./registry-lib.mjs";

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
const proofSchema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-proof-v1.schema.json"),
);
const validatePod = ajv.compile(podSchema);
const validateSeed = ajv.compile(seedSchema);
const validateProof = ajv.compile(proofSchema);
const podFiles = await readManifestDirectory("registry/pods");
const seedFiles = await readManifestDirectory("registry/seeds");
const releaseFiles = await readManifestDirectory("registry/history", {
  allowMissing: true,
});
const proofFiles = await readManifestDirectory("proofs");
const errors = [];

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
  validateSchema(entry, validateProof, "Seed proof", false);
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
validateProofPolicy(proofFiles, seedFiles);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${podFiles.length} Pods, ${seedFiles.length} Seeds, ${releaseFiles.length} historical releases, and ${proofFiles.length} proof receipt${proofFiles.length === 1 ? "" : "s"} without policy violations.`,
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
  if (primaryPorts.length > 1) {
    errors.push(`${entry.name}: at most one primary public port is allowed.`);
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
    for (const dependency of component.dependsOn) {
      if (!componentIds.has(dependency) || dependency === component.id) {
        errors.push(
          `${entry.name}: ${component.id} has invalid dependency '${dependency}'.`,
        );
      }
    }
  }

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

function validateProofPolicy(proofs, seeds) {
  const seedById = new Map(seeds.map((entry) => [entry.value.id, entry.value]));
  const proofKeys = new Set();

  for (const entry of proofs) {
    const proof = entry.value;
    const proofKey = `${proof.seedId}@${proof.seedVersion}`;
    if (proofKeys.has(proofKey)) {
      errors.push(`${entry.name}: duplicate proof receipt for '${proofKey}'.`);
    }
    proofKeys.add(proofKey);

    if (!seedById.has(proof.seedId)) {
      errors.push(`${entry.name}: Seed '${proof.seedId}' does not exist.`);
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
