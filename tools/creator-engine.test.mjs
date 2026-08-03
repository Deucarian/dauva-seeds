import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalDocument,
  createGuidedDraft,
  createSeedDraft,
  expectedStableVersion,
  freezeSeedRevision,
  prepareSeedForFreeze,
  validateWorkspace,
} from "./creator-engine.mjs";
import {
  canonicalJson,
  readJson,
  readManifestDirectory,
  repositoryRoot,
} from "./registry-lib.mjs";
import path from "node:path";

const digest = `sha256:${"a".repeat(64)}`;
const revisionId = "123e4567-e89b-42d3-a456-426614174000";
const revisionGroupId = "223e4567-e89b-42d3-a456-426614174001";
const planId = "323e4567-e89b-42d3-a456-426614174002";

test("Creator draft generation is deterministic for every source adapter", () => {
  const common = {
    id: "example",
    podId: "example-pod",
    homepage: "https://example.com/game",
    repository: "https://github.com/example/server",
    image: `docker.io/example/server@${digest}`,
    updateReference: "docker.io/example/server:stable",
  };
  for (const [kind, upstreamId] of [
    ["oci", "example"],
    ["steamcmd", "12345"],
    ["linuxgsm", "example"],
    ["dauva", "example"],
  ]) {
    const first = createSeedDraft({ ...common, kind, upstreamId });
    const second = createSeedDraft({ ...common, kind, upstreamId });
    assert.deepEqual(first, second);
    assert.equal(first.source.kind, kind);
    assert.deepEqual(first.trust, {});
    assert.equal(first.status, "draft");
  }
});

test("guided existing-Pod generation clones the recommended stable Seed deterministically", async () => {
  const basePods = (await readManifestDirectory("registry/pods")).map(
    (entry) => entry.value,
  );
  const baseSeeds = (await readManifestDirectory("registry/seeds")).map(
    (entry) => entry.value,
  );
  const starter = {
    kind: "existing_pod_variant",
    podId: "minecraft",
    seedId: "minecraft-guided",
    displayName: "Minecraft Guided",
  };
  const before = canonicalJson({ basePods, baseSeeds });
  const first = createGuidedDraft({ starter, basePods, baseSeeds });
  const second = createGuidedDraft({ starter, basePods, baseSeeds });

  assert.deepEqual(first, second);
  assert.equal(canonicalJson({ basePods, baseSeeds }), before);
  const pod = JSON.parse(first.document.podJson);
  const seed = JSON.parse(first.document.seeds[0].json);
  const sourcePod = basePods.find((candidate) => candidate.id === "minecraft");
  const template = baseSeeds.find(
    (candidate) => candidate.id === sourcePod.recommendedSeedId,
  );
  assert.equal(first.document.podJson, canonicalJson(sourcePod));
  assert.equal(first.document.seeds[0].clientKey, "minecraft-guided");
  assert.equal(seed.id, "minecraft-guided");
  assert.equal(seed.podId, "minecraft");
  assert.equal(seed.version, "1.0.0-rc.1");
  assert.equal(seed.status, "draft");
  assert.deepEqual(seed.metadata.title, {
    en: "Minecraft Guided",
    nl: "Minecraft Guided",
    de: "Minecraft Guided",
  });
  assert.deepEqual(seed.components, template.components);
  assert.deepEqual(seed.source, template.source);
  assert.deepEqual(seed.trust, template.trust);
  assert.equal("proof" in seed, false);
  assert.equal("approvals" in seed, false);
  assert.equal(pod.recommendedSeedId, "minecraft-paper");
});

test("guided existing-Pod generation enforces stable membership, new identity, and exact shape", async () => {
  const basePods = (await readManifestDirectory("registry/pods")).map(
    (entry) => entry.value,
  );
  const baseSeeds = (await readManifestDirectory("registry/seeds")).map(
    (entry) => entry.value,
  );
  const common = {
    kind: "existing_pod_variant",
    podId: "minecraft",
    seedId: "minecraft-guided",
    displayName: "Minecraft Guided",
  };

  assert.throws(
    () =>
      createGuidedDraft({
        starter: { ...common, templateSeedId: "valheim" },
        basePods,
        baseSeeds,
      }),
    /does not belong to Pod 'minecraft'/,
  );
  assert.throws(
    () =>
      createGuidedDraft({
        starter: { ...common, seedId: "minecraft-paper" },
        basePods,
        baseSeeds,
      }),
    /already exists/,
  );
  assert.throws(
    () =>
      createGuidedDraft({
        starter: { ...common, reviewedAt: "2026-08-03" },
        basePods,
        baseSeeds,
      }),
    /invalid shape/,
  );
  const explicitNullTemplate = createGuidedDraft({
    starter: { ...common, templateSeedId: null },
    basePods,
    baseSeeds,
  });
  assert.equal(
    JSON.parse(explicitNullTemplate.document.seeds[0].json).id,
    "minecraft-guided",
  );
  assert.throws(
    () =>
      createGuidedDraft({
        starter: { ...common, displayName: " Minecraft Guided" },
        basePods,
        baseSeeds,
      }),
    /visible characters/,
  );
});

test("guided new-Pod generation creates a safe editable draft without invented provenance", async () => {
  const basePods = (await readManifestDirectory("registry/pods")).map(
    (entry) => entry.value,
  );
  const baseSeeds = (await readManifestDirectory("registry/seeds")).map(
    (entry) => entry.value,
  );
  const input = {
    starter: {
      kind: "new_pod",
      podId: "example-game",
      podDisplayName: "Example Game",
      seedId: "example-game-vanilla",
      seedDisplayName: "Example Game Vanilla",
    },
    basePods,
    baseSeeds,
  };
  const first = createGuidedDraft(input);
  const second = createGuidedDraft(input);

  assert.deepEqual(first, second);
  const pod = JSON.parse(first.document.podJson);
  const seed = JSON.parse(first.document.seeds[0].json);
  assert.deepEqual(pod, {
    schemaVersion: "dauva.dev/pod/v1",
    id: "example-game",
    status: "draft",
    metadata: {
      title: {
        en: "Example Game",
        nl: "Example Game",
        de: "Example Game",
      },
      description: { en: "", nl: "", de: "" },
      icon: "server",
    },
  });
  assert.equal(first.document.seeds[0].clientKey, "example-game-vanilla");
  assert.deepEqual(seed.source, {});
  assert.deepEqual(seed.trust, {});
  assert.equal(seed.version, "1.0.0-rc.1");
  assert.equal(seed.components[0].role, "primary");
  assert.equal(seed.components[0].image, "");
  assert.equal(seed.components[0].imageUpdate.reference, "");
  assert.deepEqual(seed.components[0].environment, {});
  assert.deepEqual(seed.components[0].optionEnvironment, {});
  assert.deepEqual(seed.components[0].agreementEnvironment, {});
  assert.deepEqual(seed.components[0].secretEnvironment, {});
  assert.deepEqual(seed.components[0].runtimeEnvironment, {});
  assert.equal(seed.updatePolicy.discovery, "manual");
  assert.equal(seed.updatePolicy.automaticCheck, false);
  assert.equal(first.document.seeds[0].json.includes("https://"), false);
  assert.equal(first.document.seeds[0].json.includes("sha256:"), false);
  assert.equal(first.document.seeds[0].json.includes("reviewedAt"), false);

  const authoring = validateWorkspace({
    pod,
    seeds: [seed],
    basePods,
    baseSeeds,
    profile: "authoring",
  });
  assert.equal(authoring.valid, false);
  assert.equal(authoring.issues.length > 0, true);
});

test("all current Pods and Seeds round-trip through canonical bytes without loss", async () => {
  const entries = [
    ...(await readManifestDirectory("registry/pods")),
    ...(await readManifestDirectory("registry/seeds")),
  ];
  assert.equal(entries.length, 27);
  for (const entry of entries) {
    const canonical = canonicalDocument(entry.value);
    assert.deepEqual(JSON.parse(canonical.json), entry.value, entry.name);
    assert.match(canonical.digest, /^sha256:[a-f0-9]{64}$/);
  }
});

test("freezing a Seed is deterministic and binds runtime-relevant changes", async () => {
  const seed = await readJson(
    path.join(repositoryRoot, "registry", "seeds", "minecraft-paper.json"),
  );
  const pod = await readJson(
    path.join(repositoryRoot, "registry", "pods", "minecraft.json"),
  );
  const input = {
    seed,
    pod,
    baseRegistryDigest: `sha256:${"b".repeat(64)}`,
    revisionId,
    revisionGroupId,
    planId,
    architecture: "amd64",
    fixtures: {
      persistence: "minecraft-world-marker",
      backup: "minecraft-rcon-backup",
    },
    frozenAt: "2026-08-03T10:00:00.000Z",
    authorId: "admin-joris",
    semanticImpact: "reproof",
  };
  const first = freezeSeedRevision(input);
  const second = freezeSeedRevision(input);
  assert.deepEqual(first, second);
  assert.equal(first.proofPlan.seedId, "minecraft-paper");
  assert.equal(first.proofPlan.checks.some((check) => check.kind === "backup"), true);
  assert.match(first.revision.revisionDigest, /^sha256:[a-f0-9]{64}$/);

  const changedSeed = structuredClone(seed);
  changedSeed.lifecycle.stopTimeoutSeconds += 1;
  const changed = freezeSeedRevision({ ...input, seed: changedSeed });
  assert.notEqual(
    first.revision.proofContractDigest,
    changed.revision.proofContractDigest,
  );
  assert.notEqual(first.revision.revisionDigest, changed.revision.revisionDigest);
});

test("freeze refuses unsupported architecture and missing fixtures", async () => {
  const seed = await readJson(
    path.join(repositoryRoot, "registry", "seeds", "minecraft-paper.json"),
  );
  const pod = await readJson(
    path.join(repositoryRoot, "registry", "pods", "minecraft.json"),
  );
  assert.throws(
    () =>
      freezeSeedRevision({
        seed,
        pod,
        baseRegistryDigest: `sha256:${"b".repeat(64)}`,
        revisionId,
        revisionGroupId,
        planId,
        architecture: "arm64",
        fixtures: { persistence: "minecraft-world-marker" },
        frozenAt: "2026-08-03T10:00:00.000Z",
        authorId: "admin-joris",
        semanticImpact: "reproof",
      }),
    /not declared/,
  );
  assert.throws(
    () =>
      freezeSeedRevision({
        seed,
        pod,
        baseRegistryDigest: `sha256:${"b".repeat(64)}`,
        revisionId,
        revisionGroupId,
        planId,
        architecture: "amd64",
        fixtures: { persistence: "minecraft-world-marker" },
        frozenAt: "2026-08-03T10:00:00.000Z",
        authorId: "admin-joris",
        semanticImpact: "reproof",
      }),
    /backup.*fixture/,
  );
});

test("phase-aware workspace validation aggregates Pod variants and proof gates", async () => {
  const pods = (await readManifestDirectory("registry/pods")).map(
    (entry) => entry.value,
  );
  const seeds = (await readManifestDirectory("registry/seeds")).map(
    (entry) => entry.value,
  );
  const pod = pods.find((item) => item.id === "minecraft");
  const paper = seeds.find((item) => item.id === "minecraft-paper");
  const freeze = validateWorkspace({
    pod,
    seeds: [paper],
    basePods: pods,
    baseSeeds: seeds,
    profile: "freeze",
  });
  assert.equal(freeze.valid, true, JSON.stringify(freeze.issues));

  const exported = validateWorkspace({
    pod,
    seeds: [paper],
    basePods: pods,
    baseSeeds: seeds,
    profile: "export",
    validationTime: "2026-08-03T10:00:00.000Z",
    proofs: (await readManifestDirectory("proofs")).map((entry) => entry.value),
  });
  assert.equal(exported.valid, false);
  assert.equal(
    exported.issues.some((entry) => entry.code === "seed.proof.exact-required"),
    true,
  );
});

test("new Pod freeze rejects cosmetic and resource-only clones, then accepts an attested proof-relevant delta", () => {
  const pod = {
    schemaVersion: "dauva.dev/pod/v1",
    id: "example",
    status: "candidate",
    metadata: {
      title: { en: "Example", nl: "Voorbeeld", de: "Beispiel" },
      description: {
        en: "Example game family.",
        nl: "Voorbeeldspelfamilie.",
        de: "Beispiel-Spielfamilie.",
      },
      icon: "server",
    },
    recommendedSeedId: "example-a",
  };
  const draft = (id) => {
    const value = createSeedDraft({
      id,
      podId: "example",
      kind: "oci",
      homepage: "https://example.com/game",
      repository: "https://github.com/example/server",
      image: `docker.io/example/server@${digest}`,
      updateReference: "docker.io/example/server:stable",
    });
    value.trust = {
      level: "community",
      reviewedAt: "2026-08-03",
      mutableRuntimeImagesAllowed: false,
    };
    value.version = "1.0.0-rc.1";
    value.status = "candidate";
    value.ports = [
      {
        id: "game",
        componentId: "server",
        containerPort: 25565,
        containerPortMode: "fixed",
        protocols: ["tcp"],
        exposure: "public",
        purpose: "game",
        primary: true,
        sharedHostPort: true,
      },
    ];
    return value;
  };
  const variants = [draft("example-a"), draft("example-b")];
  const blocked = validateWorkspace({
    pod,
    seeds: variants,
    profile: "freeze",
    meaningfulVariantSeedIds: ["example-a"],
  });
  assert.equal(blocked.valid, false);
  const accepted = validateWorkspace({
    pod,
    seeds: variants,
    profile: "freeze",
    meaningfulVariantSeedIds: ["example-a", "example-b"],
  });
  assert.equal(accepted.valid, false);
  assert.equal(
    accepted.issues.some(
      (entry) => entry.code === "pod.variants.meaningful-difference",
    ),
    true,
  );

  variants[1].resources.presets[0].memoryMb += 1024;
  const resourceOnly = validateWorkspace({
    pod,
    seeds: variants,
    profile: "freeze",
    meaningfulVariantSeedIds: ["example-a", "example-b"],
  });
  assert.equal(resourceOnly.valid, false);
  assert.equal(
    resourceOnly.issues.some(
      (entry) => entry.code === "pod.variants.meaningful-difference",
    ),
    true,
  );

  variants[1].components[0].environment.GAME_MODE = "hard";
  const meaningful = validateWorkspace({
    pod,
    seeds: variants,
    profile: "freeze",
    meaningfulVariantSeedIds: ["example-a", "example-b"],
  });
  assert.equal(meaningful.valid, true, JSON.stringify(meaningful.issues));
});

test("release policy derives immutable candidate versions from semantic impact", async () => {
  const stable = await readJson(
    path.join(repositoryRoot, "registry", "seeds", "minecraft-paper.json"),
  );
  assert.equal(expectedStableVersion(stable.version, "patch"), "1.0.1");
  assert.equal(expectedStableVersion(stable.version, "minor"), "1.1.0");
  assert.equal(expectedStableVersion(stable.version, "major"), "2.0.0");

  const sameVersion = { ...structuredClone(stable), status: "draft" };
  const derivedFromClone = prepareSeedForFreeze({
    seed: sameVersion,
    baseSeed: stable,
    semanticImpact: "patch",
    candidateNumber: 1,
  });
  assert.equal(derivedFromClone.version, "1.0.1-rc.1");
  assert.equal(derivedFromClone.status, "candidate");

  const candidate = {
    ...structuredClone(stable),
    version: "1.0.1-rc.1",
    status: "draft",
  };
  const frozen = prepareSeedForFreeze({
    seed: candidate,
    baseSeed: stable,
    semanticImpact: "patch",
    candidateNumber: 1,
  });
  assert.equal(frozen.version, "1.0.1-rc.1");
  assert.equal(frozen.status, "candidate");

  const superseded = prepareSeedForFreeze({
    seed: frozen,
    baseSeed: stable,
    semanticImpact: "patch",
    candidateNumber: 2,
  });
  assert.equal(superseded.version, "1.0.1-rc.2");
  const serverNormalized = prepareSeedForFreeze({
    seed: { ...frozen, version: "9.9.9-rc.99" },
    baseSeed: stable,
    semanticImpact: "patch",
    candidateNumber: 2,
  });
  assert.equal(serverNormalized.version, "1.0.1-rc.2");

  const changedImpact = prepareSeedForFreeze({
    seed: superseded,
    baseSeed: stable,
    semanticImpact: "minor",
    candidateNumber: 1,
  });
  assert.equal(changedImpact.version, "1.1.0-rc.1");
});

test("official trust fails closed for new or changed authoring without a configured owned identity", async () => {
  const pods = (await readManifestDirectory("registry/pods")).map(
    (entry) => entry.value,
  );
  const seeds = (await readManifestDirectory("registry/seeds")).map(
    (entry) => entry.value,
  );
  const pod = structuredClone(pods.find((item) => item.id === "minecraft"));
  const seed = structuredClone(seeds.find((item) => item.id === "minecraft-paper"));
  seed.trust.level = "official";
  const result = validateWorkspace({
    pod,
    seeds: [seed],
    basePods: pods,
    baseSeeds: seeds,
    profile: "authoring",
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.issues.some(
      (entry) => entry.code === "seed.trust.official-source-unconfigured",
    ),
    true,
  );
});
