import test from "node:test";
import assert from "node:assert/strict";
import {
  dauvaDescriptor,
  linuxGsmDescriptor,
  ociDescriptor,
  sourceRuntimeDefaults,
  steamCmdDescriptor,
} from "./source-adapters.mjs";

test("LinuxGSM adapter produces a curated draft source without mutable images", () => {
  const source = linuxGsmDescriptor({
    gameId: "terraria",
    homepage: "https://terraria.org/",
  });
  const defaults = sourceRuntimeDefaults(source, { reviewedAt: "2026-08-03" });
  assert.equal(defaults.source.kind, "linuxgsm");
  assert.equal(defaults.source.upstreamId, "terraria");
  assert.equal(defaults.updatePolicy.discovery, "steamcmd");
  assert.equal(defaults.updatePolicy.automaticInstall, false);
  assert.equal(defaults.trust.mutableRuntimeImagesAllowed, false);
});

test("SteamCMD adapter requires a numeric app id", () => {
  assert.throws(
    () =>
      steamCmdDescriptor({
        appId: "not-an-id",
        homepage: "https://example.com/",
      }),
    /numeric/,
  );
});

test("OCI and Dauva adapters retain curated source ownership", () => {
  const oci = ociDescriptor({
    homepage: "https://example.com/game",
    repository: "https://github.com/example/game-server",
    registry: "ghcr.io",
  });
  const dauva = dauvaDescriptor({
    homepage: "https://dauva.dev/seeds/example",
    repository: "https://github.com/Deucarian/example",
  });

  assert.equal(oci.kind, "oci");
  assert.equal(
    sourceRuntimeDefaults(oci, { reviewedAt: "2026-08-03" }).trust.level,
    "community",
  );
  assert.equal(dauva.kind, "dauva");
  assert.equal(
    sourceRuntimeDefaults(dauva, { reviewedAt: "2026-08-03" }).trust.level,
    "verified",
  );
});

test("source defaults require an explicit review date", () => {
  const source = ociDescriptor({
    homepage: "https://example.com/game",
    repository: "https://github.com/example/game-server",
  });
  assert.throws(() => sourceRuntimeDefaults(source), /review date/);
});
