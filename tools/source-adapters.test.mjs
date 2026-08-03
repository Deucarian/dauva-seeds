import test from "node:test";
import assert from "node:assert/strict";
import {
  dauvaDescriptor,
  linuxGsmDescriptor,
  ociDescriptor,
  sourceRuntimeDefaults,
  steamCmdDescriptor,
} from "./source-adapters.mjs";

test("LinuxGSM adapter produces source and update defaults without asserting trust", () => {
  const source = linuxGsmDescriptor({
    gameId: "terraria",
    homepage: "https://terraria.org/",
  });
  const defaults = sourceRuntimeDefaults(source);
  assert.equal(defaults.source.kind, "linuxgsm");
  assert.equal(defaults.source.upstreamId, "terraria");
  assert.equal(defaults.updatePolicy.discovery, "steamcmd");
  assert.equal(defaults.updatePolicy.automaticInstall, false);
  assert.equal("trust" in defaults, false);
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

test("OCI and Dauva adapters retain source ownership without assigning trust", () => {
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
  assert.equal("trust" in sourceRuntimeDefaults(oci), false);
  assert.equal(dauva.kind, "dauva");
  assert.equal("trust" in sourceRuntimeDefaults(dauva), false);
});

test("source defaults never invent review metadata", () => {
  const source = ociDescriptor({
    homepage: "https://example.com/game",
    repository: "https://github.com/example/game-server",
  });
  const defaults = sourceRuntimeDefaults(source);
  assert.equal("trust" in defaults, false);
  assert.equal("reviewedAt" in defaults, false);
});
