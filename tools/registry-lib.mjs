import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(toolDirectory, "..");

export async function readJson(filePath) {
  return parseJsonStrict(await readFile(filePath, "utf8"), filePath);
}

export function parseJsonStrict(text, source = "JSON input") {
  assertNoDuplicateJsonKeys(text, source);
  return JSON.parse(text);
}

export async function readManifestDirectory(
  relativeDirectory,
  { allowMissing = false } = {},
) {
  const directory = path.join(repositoryRoot, relativeDirectory);
  let directoryEntries;
  try {
    directoryEntries = await readdir(directory);
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const names = directoryEntries
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));
  return Promise.all(
    names.map(async (name) => ({
      name,
      path: path.join(directory, name),
      value: await readJson(path.join(directory, name)),
    })),
  );
}

export function canonicalJson(value) {
  return canonicalJsonValue(value, new Set());
}

export function normalizeTextLineEndings(value) {
  return value.replace(/\r\n?/g, "\n");
}

function canonicalJsonValue(value, ancestors) {
  if (Array.isArray(value)) {
    assertNotCircular(value, ancestors);
    const rendered = `[${value
      .map((item) => canonicalJsonValue(item, ancestors))
      .join(",")}]`;
    ancestors.delete(value);
    return rendered;
  }
  if (value !== null && typeof value === "object") {
    assertNotCircular(value, ancestors);
    const symbolKeys = Object.getOwnPropertySymbols(value);
    if (symbolKeys.length > 0) {
      throw new TypeError("Canonical JSON does not support symbol keys.");
    }
    const keys = Object.keys(value).sort(compareUnicodeCodeUnits);
    const rendered = `{${keys
      .map((key) => {
        assertWellFormedUnicode(key);
        return `${JSON.stringify(key)}:${canonicalJsonValue(value[key], ancestors)}`;
      })
      .join(",")}}`;
    ancestors.delete(value);
    return rendered;
  }
  if (typeof value === "string") {
    assertWellFormedUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON requires finite numbers.");
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError("Canonical JSON requires safe integers.");
    }
    return JSON.stringify(value);
  }
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value}.`);
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function calculateRegistryDigest(registry) {
  if (registry === null || typeof registry !== "object" || Array.isArray(registry)) {
    throw new TypeError("Registry must be a JSON object.");
  }
  const { registryDigest: ignoredDigest, ...content } = registry;
  void ignoredDigest;
  return sha256(canonicalJson(content));
}

export function verifyRegistryDigest(registry) {
  return (
    typeof registry?.registryDigest === "string" &&
    registry.registryDigest === calculateRegistryDigest(registry)
  );
}

export function assertRegistryDigest(registry) {
  const actual = calculateRegistryDigest(registry);
  if (registry?.registryDigest !== actual) {
    throw new Error(
      `Registry digest mismatch: expected '${registry?.registryDigest ?? "missing"}', calculated '${actual}'.`,
    );
  }
  return actual;
}

export function compiledRegistry(pods, seeds, proofs = [], releases = []) {
  const compiledProofs = proofs
    .map((proof) =>
      proof.schemaVersion === "dauva.dev/seed-proof/v2"
        ? proof
        : {
            ...proof,
            receiptDigest: sha256(canonicalJson(proof)),
          },
    )
    .sort((left, right) =>
      compareUnicodeCodeUnits(
        proofSortKey(left),
        proofSortKey(right),
      ),
    );
  const compileSeed = (seed, includeProof) => {
      const manifestDigest = sha256(canonicalJson(seed));
      const matchingV2Proofs = compiledProofs
        .filter(
          (proof) =>
            includeProof &&
            proof.schemaVersion === "dauva.dev/seed-proof/v2" &&
            proof.receiptPayload.seed.id === seed.id &&
            proofReleasesVersion(
              proof.receiptPayload.seed.testedVersion,
              seed.version,
            ) &&
            proof.receiptPayload.seed.intendedStableVersion ===
              releasedVersion(seed.version) &&
            proof.receiptPayload.result === "passed",
        )
        .sort(compareProofNewestFirst);
      const architectures = seed.compatibility?.architectures ?? ["amd64"];
      const proofByArchitecture = architectures.map((architecture) => ({
        architecture,
        proof: matchingV2Proofs.find(
          (proof) => proof.receiptPayload.runner.architecture === architecture,
        ),
      }));
      const hasCompleteV2Proof =
        proofByArchitecture.length > 0 &&
        proofByArchitecture.every(({ proof }) => proof != null);
      const missingArchitectures = proofByArchitecture
        .filter(({ proof }) => proof == null)
        .map(({ architecture }) => architecture);
      const matchingLegacyProofs = compiledProofs
        .filter(
          (proof) =>
            includeProof &&
            proof.schemaVersion === "dauva.dev/seed-proof/v1" &&
            proof.seedId === seed.id &&
            proofReleasesVersion(proof.seedVersion, seed.version) &&
            proof.result === "passed",
        )
        .sort((left, right) =>
          compareUnicodeCodeUnits(right.provedAt, left.provedAt),
        );
      const legacyProof = matchingLegacyProofs[0];
      return {
        ...seed,
        manifestDigest,
        proof: hasCompleteV2Proof
          ? {
              state: "proven",
              schemaVersion: "dauva.dev/seed-proof/v2",
              binding: "exact",
              architectures: proofByArchitecture.map(
                ({ architecture, proof }) => ({
                  architecture,
                  proofId: proof.receiptPayload.proofId,
                  completedAt: proof.receiptPayload.completedAt,
                  expiresAt: proof.receiptPayload.expiresAt,
                  leafId: proof.receiptPayload.runner.leafId,
                  provedVersion: proof.receiptPayload.seed.testedVersion,
                  receiptDigest: proof.receiptDigest,
                }),
              ),
            }
          : legacyProof
            ? {
                state: "legacy",
                schemaVersion: legacyProof.schemaVersion,
                binding: "legacy-unverified",
                provedAt: legacyProof.provedAt,
                expiresAt: seed.proofPolicy?.expiresAfterDays
                  ? new Date(
                      Date.parse(legacyProof.provedAt) +
                        seed.proofPolicy.expiresAfterDays * 24 * 60 * 60 * 1000,
                    ).toISOString()
                  : undefined,
                leaf: legacyProof.leaf,
                provedVersion: legacyProof.seedVersion,
                receiptDigest: legacyProof.receiptDigest,
                missingArchitectures,
              }
            : {
                state: seed.status === "withered" ? "withered" : "unproven",
                missingArchitectures,
              },
      };
    };
  const compiledSeeds = seeds
    .map((seed) => compileSeed(seed, true))
    .sort((left, right) => compareUnicodeCodeUnits(left.id, right.id));
  const compiledReleases = releases
    .map((seed) => compileSeed(seed, false))
    .sort((left, right) =>
      compareUnicodeCodeUnits(
        `${left.id}@${left.version}`,
        `${right.id}@${right.version}`,
      ),
    );
  const compiledPods = [...pods].sort((left, right) =>
    compareUnicodeCodeUnits(left.id, right.id),
  );
  const content = {
    schemaVersion: "dauva.dev/registry/v1",
    source: {
      repository: "Deucarian/dauva-seeds",
    },
    pods: compiledPods,
    seeds: compiledSeeds,
    releases: compiledReleases,
    proofs: compiledProofs,
    sources: [
      ...new Map(
        compiledSeeds.map((seed) => [
          `${seed.source.kind}:${seed.source.repository}`,
          seed.source,
        ]),
      ).values(),
    ].sort((left, right) =>
      compareUnicodeCodeUnits(
        `${left.kind}:${left.repository}`,
        `${right.kind}:${right.repository}`,
      ),
    ),
  };
  return {
    ...content,
    registryDigest: sha256(canonicalJson(content)),
  };
}

export function proofReleasesVersion(proofVersion, seedVersion) {
  if (proofVersion === seedVersion) {
    return true;
  }
  const releaseCandidate = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-rc\.[1-9][0-9]*$/;
  if (!releaseCandidate.test(proofVersion)) {
    return false;
  }
  return proofVersion.replace(/-rc\.[1-9][0-9]*$/, "") === seedVersion;
}

export function seedReleasesForProof(
  seedId,
  proofVersion,
  currentSeeds,
  historicalReleases = [],
) {
  return [...currentSeeds, ...historicalReleases].filter(
    (seed) =>
      seed.id === seedId && proofReleasesVersion(proofVersion, seed.version),
  );
}

export function releasedVersion(version) {
  return version.replace(/-rc\.[1-9][0-9]*$/, "");
}

export function proofContract(seed) {
  return {
    schemaVersion: seed.schemaVersion,
    id: seed.id,
    podId: seed.podId,
    source: seed.source,
    trust: seed.trust,
    compatibility: seed.compatibility,
    components: seed.components,
    volumes: seed.volumes,
    ports: seed.ports,
    resources: seed.resources,
    storage: seed.storage,
    inputs: seed.inputs,
    secrets: seed.secrets,
    lifecycle: seed.lifecycle,
    capabilities: seed.capabilities,
    console: seed.console ?? null,
    updatePolicy: seed.updatePolicy,
    proofPolicy: seed.proofPolicy,
  };
}

export function calculateProofContractDigest(seed) {
  return sha256(canonicalJson(proofContract(seed)));
}

export function compareUnicodeCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertNotCircular(value, ancestors) {
  if (ancestors.has(value)) {
    throw new TypeError("Canonical JSON does not support circular values.");
  }
  ancestors.add(value);
}

function assertWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("Canonical JSON requires well-formed Unicode strings.");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("Canonical JSON requires well-formed Unicode strings.");
    }
  }
}

function assertNoDuplicateJsonKeys(text, source) {
  let index = 0;

  const fail = (message) => {
    throw new SyntaxError(`${source}: ${message} at offset ${index}.`);
  };
  const skipWhitespace = () => {
    while (/[\t\n\r ]/.test(text[index] ?? "")) index += 1;
  };
  const expect = (character) => {
    if (text[index] !== character) fail(`expected '${character}'`);
    index += 1;
  };
  const parseString = () => {
    const start = index;
    expect('"');
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index));
      }
      if (character === "\\") {
        index += 1;
        const escape = text[index];
        if (escape === "u") {
          const digits = text.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(digits)) fail("invalid Unicode escape");
          index += 5;
          continue;
        }
        if (!['"', "\\", "/", "b", "f", "n", "r", "t"].includes(escape)) {
          fail("invalid string escape");
        }
        index += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) fail("unescaped control character");
      index += 1;
    }
    fail("unterminated string");
  };
  const parseNumber = () => {
    const match = text.slice(index).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) fail("invalid value");
    index += match[0].length;
  };
  const parseLiteral = (literal) => {
    if (text.slice(index, index + literal.length) !== literal) {
      fail(`expected '${literal}'`);
    }
    index += literal.length;
  };
  const parseArray = () => {
    expect("[");
    skipWhitespace();
    if (text[index] === "]") {
      index += 1;
      return;
    }
    while (true) {
      parseValue();
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      expect(",");
      skipWhitespace();
    }
  };
  const parseObject = () => {
    expect("{");
    skipWhitespace();
    const keys = new Set();
    if (text[index] === "}") {
      index += 1;
      return;
    }
    while (true) {
      if (text[index] !== '"') fail("object member name must be a string");
      const key = parseString();
      if (keys.has(key)) {
        fail(`duplicate object member '${key}'`);
      }
      keys.add(key);
      skipWhitespace();
      expect(":");
      parseValue();
      skipWhitespace();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      expect(",");
      skipWhitespace();
    }
  };
  const parseValue = () => {
    skipWhitespace();
    const character = text[index];
    if (character === "{") parseObject();
    else if (character === "[") parseArray();
    else if (character === '"') parseString();
    else if (character === "t") parseLiteral("true");
    else if (character === "f") parseLiteral("false");
    else if (character === "n") parseLiteral("null");
    else parseNumber();
  };

  parseValue();
  skipWhitespace();
  if (index !== text.length) fail("unexpected trailing content");
}

function proofSortKey(proof) {
  if (proof.schemaVersion === "dauva.dev/seed-proof/v2") {
    const payload = proof.receiptPayload;
    return [
      payload.seed.id,
      payload.seed.testedVersion,
      payload.runner.architecture,
      payload.completedAt,
      payload.proofId,
    ].join("@");
  }
  return `${proof.seedId}@${proof.seedVersion}@legacy@${proof.provedAt}`;
}

function compareProofNewestFirst(left, right) {
  const completed = compareUnicodeCodeUnits(
    right.receiptPayload.completedAt,
    left.receiptPayload.completedAt,
  );
  if (completed !== 0) return completed;
  return compareUnicodeCodeUnits(
    right.receiptPayload.proofId,
    left.receiptPayload.proofId,
  );
}
