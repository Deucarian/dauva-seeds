import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(toolDirectory, "..");

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function readManifestDirectory(relativeDirectory) {
  const directory = path.join(repositoryRoot, relativeDirectory);
  const names = (await readdir(directory))
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
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort((left, right) =>
      left.localeCompare(right),
    );
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function compiledRegistry(pods, seeds, proofs = []) {
  const compiledProofs = proofs
    .map((proof) => ({
      ...proof,
      receiptDigest: sha256(canonicalJson(proof)),
    }))
    .sort((left, right) =>
      `${left.seedId}@${left.seedVersion}`.localeCompare(
        `${right.seedId}@${right.seedVersion}`,
      ),
    );
  const compiledSeeds = seeds
    .map((seed) => {
      const matchingProofs = compiledProofs
        .filter(
          (proof) =>
            proof.seedId === seed.id &&
            proofReleasesVersion(proof.seedVersion, seed.version) &&
            proof.result === "passed",
        )
        .sort((left, right) => right.provedAt.localeCompare(left.provedAt));
      const currentProof = matchingProofs[0];
      const expiresAt =
        currentProof && seed.proofPolicy?.expiresAfterDays
          ? new Date(
              Date.parse(currentProof.provedAt) +
                seed.proofPolicy.expiresAfterDays * 24 * 60 * 60 * 1000,
            ).toISOString()
          : undefined;
      return {
        ...seed,
        manifestDigest: sha256(canonicalJson(seed)),
        proof: currentProof
          ? {
              state: "proven",
              provedAt: currentProof.provedAt,
              expiresAt,
              leaf: currentProof.leaf,
              provedVersion: currentProof.seedVersion,
              receiptDigest: currentProof.receiptDigest,
            }
          : {
              state: seed.status === "withered" ? "withered" : "unproven",
            },
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const compiledPods = [...pods].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const content = {
    schemaVersion: "dauva.dev/registry/v1",
    source: {
      repository: "Deucarian/dauva-seeds",
    },
    pods: compiledPods,
    seeds: compiledSeeds,
    proofs: compiledProofs,
    sources: [
      ...new Map(
        compiledSeeds.map((seed) => [
          `${seed.source.kind}:${seed.source.repository}`,
          seed.source,
        ]),
      ).values(),
    ].sort((left, right) =>
      `${left.kind}:${left.repository}`.localeCompare(
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
