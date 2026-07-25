import { spawnSync } from "node:child_process";

const digestPattern = /^sha256:[a-f0-9]{64}$/;

export function parsePinnedImage(image) {
  const separator = image.lastIndexOf("@");
  if (separator <= 0) {
    throw new Error(`Image '${image}' is not pinned by digest.`);
  }
  const repository = image.slice(0, separator);
  const digest = image.slice(separator + 1);
  if (!digestPattern.test(digest)) {
    throw new Error(`Image '${image}' has an invalid digest.`);
  }
  return { repository, digest };
}

export function parseUpdateReference(reference) {
  if (reference.includes("@")) {
    throw new Error(`Update reference '${reference}' must use a mutable tag.`);
  }
  const separator = reference.lastIndexOf(":");
  const lastSlash = reference.lastIndexOf("/");
  if (separator <= lastSlash || separator === reference.length - 1) {
    throw new Error(`Update reference '${reference}' must contain a tag.`);
  }
  return {
    repository: reference.slice(0, separator),
    tag: reference.slice(separator + 1),
  };
}

export function nextCandidateVersion(version) {
  const match = version.match(
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-rc\.(\d+))?$/,
  );
  if (!match) {
    throw new Error(
      `Version '${version}' must be plain semantic versioning or an rc prerelease.`,
    );
  }
  const [, major, minor, patch, releaseCandidate] = match;
  if (releaseCandidate != null) {
    return `${major}.${minor}.${patch}-rc.${Number(releaseCandidate) + 1}`;
  }
  return `${major}.${minor}.${Number(patch) + 1}-rc.1`;
}

export function stableVersion(version) {
  const match = version.match(
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-rc\.\d+$/,
  );
  if (!match) {
    throw new Error(`Version '${version}' is not a release candidate.`);
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function prepareCandidate(seed, update) {
  if (
    seed.id !== update.id ||
    seed.version !== update.currentVersion ||
    seed.status !== update.currentStatus
  ) {
    throw new Error(
      `${seed.id} changed after the report was generated; run updates:check again.`,
    );
  }

  const candidate = structuredClone(seed);
  const updatedComponents = [];
  for (const componentUpdate of update.components.filter(
    (component) => component.updateAvailable,
  )) {
    const component = candidate.components.find(
      (item) => item.id === componentUpdate.id,
    );
    if (!component || component.image !== componentUpdate.currentImage) {
      throw new Error(
        `${candidate.id}/${componentUpdate.id} changed after the report was generated.`,
      );
    }
    const currentRepository = parsePinnedImage(component.image).repository;
    const availableRepository = parsePinnedImage(
      componentUpdate.availableImage,
    ).repository;
    if (currentRepository !== availableRepository) {
      throw new Error(
        `${candidate.id}/${component.id} update attempts to change repositories.`,
      );
    }
    component.image = componentUpdate.availableImage;
    updatedComponents.push(component.id);
  }

  if (updatedComponents.length > 0) {
    candidate.version = nextCandidateVersion(candidate.version);
    candidate.status = "candidate";
  }
  return { seed: candidate, updatedComponents };
}

export async function createUpdateReport(seedEntries, resolveDigest) {
  const digestByReference = new Map();
  const reportSeeds = [];

  for (const entry of [...seedEntries].sort((left, right) =>
    left.value.id.localeCompare(right.value.id),
  )) {
    const seed = entry.value;
    if (seed.status === "draft") {
      continue;
    }
    const components = [];
    for (const component of seed.components) {
      const current = parsePinnedImage(component.image);
      const update = parseUpdateReference(component.imageUpdate.reference);
      if (current.repository !== update.repository) {
        throw new Error(
          `${seed.id}/${component.id} changes repository from '${current.repository}' to '${update.repository}'.`,
        );
      }
      let availableDigest = digestByReference.get(
        component.imageUpdate.reference,
      );
      if (!availableDigest) {
        availableDigest = await resolveDigest(
          component.imageUpdate.reference,
        );
        if (!digestPattern.test(availableDigest)) {
          throw new Error(
            `Resolver returned invalid digest '${availableDigest}' for '${component.imageUpdate.reference}'.`,
          );
        }
        digestByReference.set(
          component.imageUpdate.reference,
          availableDigest,
        );
      }
      components.push({
        id: component.id,
        reference: component.imageUpdate.reference,
        currentImage: component.image,
        availableImage: `${current.repository}@${availableDigest}`,
        updateAvailable: current.digest !== availableDigest,
      });
    }
    if (components.some((component) => component.updateAvailable)) {
      reportSeeds.push({
        id: seed.id,
        currentVersion: seed.version,
        currentStatus: seed.status,
        components,
      });
    }
  }

  return {
    schemaVersion: "dauva.dev/seed-update-report/v1",
    updatesAvailable: reportSeeds.reduce(
      (total, seed) =>
        total +
        seed.components.filter((component) => component.updateAvailable).length,
      0,
    ),
    seedsWithUpdates: reportSeeds.length,
    seeds: reportSeeds,
  };
}

export function dockerDigestResolver(reference) {
  const result = spawnSync(
    "docker",
    [
      "buildx",
      "imagetools",
      "inspect",
      reference,
      "--format",
      "{{json .Manifest}}",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.error) {
    throw new Error(
      `Could not inspect '${reference}': ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Could not inspect '${reference}': ${result.stderr.trim() || `exit ${result.status}`}`,
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `Docker returned invalid manifest JSON for '${reference}'.`,
    );
  }
  if (!digestPattern.test(manifest.digest)) {
    throw new Error(`Docker returned no OCI digest for '${reference}'.`);
  }
  return manifest.digest;
}

export function fixtureDigestResolver(fixture) {
  return async (reference) => {
    const digest = fixture[reference];
    if (!digest) {
      throw new Error(`Fixture has no digest for '${reference}'.`);
    }
    return digest;
  };
}
