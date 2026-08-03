import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalDocument,
  createSeedDraft,
  freezeSeedRevision,
  validateWorkspace,
} from "./creator-engine.mjs";
import {
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
    reviewedAt: "2026-08-03",
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
    assert.equal(first.trust.reviewedAt, "2026-08-03");
    assert.equal(first.status, "draft");
  }
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

test("freeze refuses hidden clocks, unsupported architecture, and missing fixtures", async () => {
  assert.throws(
    () =>
      createSeedDraft({
        id: "example",
        kind: "oci",
        homepage: "https://example.com/game",
        image: `docker.io/example/server@${digest}`,
        updateReference: "docker.io/example/server:stable",
      }),
    /review date/,
  );

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

test("new Pod freeze requires two reviewer-attested meaningful variants", () => {
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
      reviewedAt: "2026-08-03",
    });
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
  assert.equal(accepted.valid, true, JSON.stringify(accepted.issues));
});
