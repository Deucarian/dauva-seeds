import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readJson, repositoryRoot } from "./registry-lib.mjs";

const pod = await readJson(
  path.join(repositoryRoot, "registry", "pods", "vrising.json"),
);
const pve = await readJson(
  path.join(repositoryRoot, "registry", "seeds", "vrising-pve.json"),
);
const pvp = await readJson(
  path.join(repositoryRoot, "registry", "seeds", "vrising-pvp.json"),
);
const runtimeRoot = path.join(repositoryRoot, "runtime", "vrising");

function input(seed, key) {
  return seed.inputs.find((candidate) => candidate.key === key);
}

function secret(seed, key) {
  return seed.secrets.find((candidate) => candidate.key === key);
}

function normalizedVariant(seed) {
  const normalized = structuredClone(seed);
  normalized.id = "vrising-variant";
  normalized.metadata = { variantCopy: true };
  normalized.components[0].environment.VR_PRESET = "StandardVariant";
  return normalized;
}

function assertLocalized(text, context) {
  for (const language of ["en", "nl", "de"]) {
    assert.equal(typeof text?.[language], "string", `${context}.${language}`);
    assert.notEqual(text[language].trim(), "", `${context}.${language}`);
  }
}

test("V Rising Pod recommends private PvE while both recipes stay candidates", () => {
  assert.equal(pod.status, "candidate");
  assert.equal(pod.recommendedSeedId, "vrising-pve");
  assert.equal(pve.status, "candidate");
  assert.equal(pvp.status, "candidate");
  assert.match(pve.metadata.title.en, /PvE/);
  assert.match(pvp.metadata.title.en, /PvP/);
  assert.match(pvp.metadata.description.en, /Not the recommended default/);
});

test("PvE and PvP differ only by identity, copy, and the official preset", () => {
  assert.deepEqual(normalizedVariant(pve), normalizedVariant(pvp));
  assert.equal(pve.components[0].environment.VR_PRESET, "StandardPvE");
  assert.equal(pvp.components[0].environment.VR_PRESET, "StandardPvP");
});

test("V Rising runtime, ports, persistence, and managed update are bounded", () => {
  const expectedImage = pve.components[0].image;
  assert.match(
    expectedImage,
    /^ghcr\.io\/deucarian\/dauva-vrising-runtime@sha256:[a-f0-9]{64}$/,
  );
  assert.doesNotMatch(expectedImage, /sha256:0{64}$/);
  assert.equal(pvp.components[0].image, expectedImage);
  assert.deepEqual(
    pve.ports.map(({ id, protocols, containerPortMode, environment }) => ({
      id,
      protocols,
      containerPortMode,
      environment,
    })),
    [
      {
        id: "game",
        protocols: ["udp"],
        containerPortMode: "allocated",
        environment: "VR_GAME_PORT",
      },
      {
        id: "query",
        protocols: ["udp"],
        containerPortMode: "allocated",
        environment: "VR_QUERY_PORT",
      },
    ],
  );
  assert.deepEqual(
    pve.volumes.map(({ id, role }) => ({ id, role })),
    [
      { id: "install", role: "data" },
      { id: "persistent-data", role: "save" },
    ],
  );
  assert.equal(pve.runtimeVersion.path, "steamapps/appmanifest_1829350.acf");
  assert.equal(pve.updatePolicy.appId, "1829350");
  assert.equal(pve.updatePolicy.branch, "public");
  assert.equal(pve.updatePolicy.installDirectory, "/vrising/server");
  assert.equal(pve.updatePolicy.requiresBackup, true);
  assert.equal(pve.updatePolicy.rollback, true);
  assert.equal(pve.components[0].environment.UPDATE_ON_BOOT, "false");
  assert.equal(pve.components[0].environment.SKIPUPDATE, "true");
});

test("private defaults and protected values do not embed a personal identifier", () => {
  assert.equal(input(pve, "public-listing").defaultValue, "false");
  assert.equal(input(pve, "difficulty").defaultValue, "normal");
  assert.equal(input(pve, "max-players").defaultValue, "10");
  assert.equal(input(pve, "password-protected").defaultValue, "false");
  assert.equal(secret(pve, "initial-administrators").required, true);
  assert.equal(secret(pve, "join-password").required, false);
  assert.equal(
    pve.components[0].secretEnvironment["initial-administrators"],
    "DAUVA_VRISING_INITIAL_ADMINS",
  );
  assert.equal(
    pve.components[0].secretEnvironment["join-password"],
    "VR_PASSWORD",
  );
  assert.doesNotMatch(JSON.stringify([pve, pvp]), /7656119[0-9]{10}/);
});

test("V Rising copy and agreement fields are complete and safe", () => {
  for (const [name, seed] of [["pve", pve], ["pvp", pvp]]) {
    assertLocalized(seed.metadata.title, `${name}.title`);
    assertLocalized(seed.metadata.description, `${name}.description`);
    for (const field of [...seed.inputs, ...seed.secrets]) {
      assertLocalized(field.label, `${name}.${field.key}.label`);
      assertLocalized(field.help, `${name}.${field.key}.help`);
    }
    for (const preset of seed.resources.presets) {
      assertLocalized(preset.title, `${name}.${preset.id}.title`);
      assertLocalized(preset.description, `${name}.${preset.id}.description`);
    }
  }

  const agreement = input(pve, "accept-steam-agreement");
  assert.equal(agreement.type, "agreement");
  assert.equal(agreement.required, true);
  assert.equal(agreement.defaultValue, "false");
  assert.equal(
    agreement.url,
    "https://store.steampowered.com/subscriber_agreement/",
  );
  assert.equal(pve.resources.presets[0].cpuPercent, 300);
  assert.equal(pve.components[0].runtimeEnvironment.serverName, "VR_NAME");
});

test("runtime scripts use a fixed atomic admin target and a real health signal", async () => {
  const [dockerfile, entrypoint, reconciler, healthcheck] = await Promise.all(
    ["Dockerfile", "dauva-entrypoint.sh", "reconcile-admins.sh", "healthcheck.sh"]
      .map((name) => readFile(path.join(runtimeRoot, name), "utf8")),
  );
  assert.match(
    dockerfile,
    /zkoesters\/vrising-server@sha256:5d39d8a859eb92f1d8dac4f1e35acd3ac1b003f7f93d46e1e22d38d3a6373f58/,
  );
  assert.match(dockerfile, /^HEALTHCHECK /m);
  assert.match(entrypoint, /exec \/vrising\/scripts\/init\.sh/);
  assert.match(entrypoint, /Maximum players must be from 1 through 128/);
  assert.match(reconciler, /\/vrising\/data/);
  assert.match(
    reconciler,
    /readonly settings_root="\$\{data_root\}\/Settings"/,
  );
  assert.match(
    reconciler,
    /readonly admin_file="\$\{settings_root\}\/adminlist\.txt"/,
  );
  assert.match(reconciler, /mktemp/);
  assert.match(reconciler, /mv -f --/);
  assert.doesNotMatch(reconciler, /\beval\b/);
  assert.doesNotMatch(reconciler, /printf[^\n]*(supplied|steam_id|label)/);
  assert.match(healthcheck, /\/proc\/\[0-9\]\*\/cmdline/);
  assert.match(
    healthcheck,
    /\[Server\] Startup Completed - Disabling Scene Loading Systems/,
  );
});
