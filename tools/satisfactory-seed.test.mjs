import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  canonicalJson,
  repositoryRoot,
  sha256,
} from "./registry-lib.mjs";

const readJson = async (...segments) =>
  JSON.parse(
    await readFile(path.join(repositoryRoot, ...segments), "utf8"),
  );

test("Satisfactory Stable has one version-independent managed recipe", async () => {
  const seed = await readJson("registry", "seeds", "satisfactory.json");
  const seedFiles = await readdir(path.join(repositoryRoot, "registry", "seeds"));

  assert.equal(seed.version, "1.0.1-rc.1");
  assert.equal(seed.status, "candidate");
  assert.equal(seed.metadata.title.en, "Satisfactory Stable");
  assert.equal(
    seedFiles.some((name) => /^satisfactory-1[.-]2/i.test(name)),
    false,
  );

  assert.deepEqual(seed.source, {
    kind: "steamcmd",
    homepage: "https://www.satisfactorygame.com/",
    repository: "https://github.com/wolveix/satisfactory-server",
    imageRegistries: ["docker.io"],
    upstreamId: "1690800",
  });
  assert.deepEqual(seed.runtimeVersion, {
    strategy: "steam-app-manifest",
    componentId: "server",
    volumeId: "config",
    path: "gamefiles/steamapps/appmanifest_1690800.acf",
    channel: "stable",
  });

  const component = seed.components.find(({ id }) => id === "server");
  assert.match(
    component.image,
    /^docker\.io\/wolveix\/satisfactory-server@sha256:[a-f0-9]{64}$/,
  );
  assert.equal(component.environment.STEAMBETA, "false");
  assert.equal(component.environment.SKIPUPDATE, "true");

  assert.deepEqual(seed.capabilities, {
    backup: true,
    restore: true,
    update: true,
    console: false,
  });
  assert.deepEqual(seed.updatePolicy, {
    discovery: "steamcmd",
    automaticCheck: true,
    automaticInstall: false,
    requiresBackup: true,
    rollback: true,
    strategy: "steamcmd",
    componentId: "server",
    volumeId: "config",
    installDirectory: "/config/gamefiles",
    appId: "1690800",
    branch: "public",
    validate: true,
  });
});

test("Satisfactory ports allocate one internal and public number 1:1", async () => {
  const seed = await readJson("registry", "seeds", "satisfactory.json");
  const game = seed.ports.find(({ id }) => id === "game");
  const messaging = seed.ports.find(({ id }) => id === "messaging");

  assert.deepEqual(
    {
      fallback: game.containerPort,
      mode: game.containerPortMode,
      protocols: game.protocols,
      shared: game.sharedHostPort,
      environment: game.environment,
    },
    {
      fallback: 7777,
      mode: "allocated",
      protocols: ["tcp", "udp"],
      shared: true,
      environment: "SERVERGAMEPORT",
    },
  );
  assert.deepEqual(
    {
      fallback: messaging.containerPort,
      mode: messaging.containerPortMode,
      protocols: messaging.protocols,
      shared: messaging.sharedHostPort,
      environment: messaging.environment,
    },
    {
      fallback: 8888,
      mode: "allocated",
      protocols: ["tcp"],
      shared: true,
      environment: "SERVERMESSAGINGPORT",
    },
  );
});

test("Satisfactory 1.0.0 remains an immutable historical recipe", async () => {
  const archived = await readJson(
    "registry",
    "history",
    "satisfactory@1.0.0.json",
  );

  assert.equal(archived.id, "satisfactory");
  assert.equal(archived.version, "1.0.0");
  assert.equal(archived.status, "stable");
  assert.equal(archived.components[0].environment.SKIPUPDATE, "false");
  assert.equal(archived.runtimeVersion, undefined);
  assert.equal(archived.capabilities.update, false);
  assert.equal(
    sha256(canonicalJson(archived)),
    "sha256:5281035469f673818a789032776ca91aa1ea27d98b1d7e6a2b01e3e41b7a34b3",
  );
});

test("managed-update promotion has an explicit unpassed proof plan", async () => {
  const plan = await readJson(
    "proofs",
    "plans",
    "satisfactory-1.0.1-rc.1.json",
  );

  assert.equal(plan.seedId, "satisfactory");
  assert.equal(plan.candidateVersion, "1.0.1-rc.1");
  assert.equal(plan.result, "not-run");
  assert.match(plan.baselineEvidence.limitation, /not a managed-update/i);
  assert.deepEqual(
    plan.requiredChecks.filter((check) =>
      ["runtime-version", "managed-update", "rollback"].includes(check),
    ),
    ["runtime-version", "managed-update", "rollback"],
  );
});

test("managed Steam updates cannot omit ownership or escape storage", async () => {
  const schema = await readJson("schemas", "seed-v1.schema.json");
  const seed = await readJson("registry", "seeds", "satisfactory.json");
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  assert.equal(validate(seed), true);

  const incomplete = structuredClone(seed);
  delete incomplete.updatePolicy.appId;
  assert.equal(validate(incomplete), false);

  const escaping = structuredClone(seed);
  escaping.runtimeVersion.path = "../host/appmanifest_1690800.acf";
  assert.equal(validate(escaping), false);
});
