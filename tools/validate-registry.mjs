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
const validatePod = ajv.compile(podSchema);
const validateSeed = ajv.compile(seedSchema);
const podFiles = await readManifestDirectory("registry/pods");
const seedFiles = await readManifestDirectory("registry/seeds");
const errors = [];

for (const entry of podFiles) {
  validateSchema(entry, validatePod, "Pod");
}
for (const entry of seedFiles) {
  validateSchema(entry, validateSeed, "Seed");
}

validateUniqueIds(podFiles, "Pod");
validateUniqueIds(seedFiles, "Seed");

const podIds = new Set(podFiles.map((entry) => entry.value.id));
for (const entry of seedFiles) {
  validateSeedPolicy(entry, podIds);
}
validatePodMembership(podFiles, seedFiles);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${podFiles.length} Pods and ${seedFiles.length} Seeds without policy violations.`,
  );
}

function validateSchema(entry, validator, kind) {
  if (!validator(entry.value)) {
    for (const error of validator.errors ?? []) {
      errors.push(
        `${entry.name}: ${kind} schema ${error.instancePath || "/"} ${error.message}`,
      );
    }
  }
  if (`${entry.value.id}.json` !== entry.name) {
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

function validatePodMembership(pods, seeds) {
  const seedCountByPod = new Map(pods.map((entry) => [entry.value.id, 0]));
  for (const entry of seeds) {
    if (seedCountByPod.has(entry.value.podId)) {
      seedCountByPod.set(
        entry.value.podId,
        seedCountByPod.get(entry.value.podId) + 1,
      );
    }
  }

  for (const [podId, seedCount] of seedCountByPod) {
    if (seedCount < 2) {
      errors.push(
        `${podId}.json: every Pod must contain at least two related Seeds.`,
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

  const forbiddenKeys = findForbiddenKeys(seed);
  for (const keyPath of forbiddenKeys) {
    errors.push(`${entry.name}: forbidden host/runtime property '${keyPath}'.`);
  }

  void portIds;
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
