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

export function compiledRegistry(pods, seeds) {
  const compiledSeeds = seeds
    .map((seed) => ({
      ...seed,
      manifestDigest: sha256(canonicalJson(seed)),
    }))
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
  };
  return {
    ...content,
    registryDigest: sha256(canonicalJson(content)),
  };
}
