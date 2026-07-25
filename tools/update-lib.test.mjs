import assert from "node:assert/strict";
import test from "node:test";
import {
  createUpdateReport,
  fixtureDigestResolver,
  nextCandidateVersion,
  parsePinnedImage,
  parseUpdateReference,
  prepareCandidate,
  stableVersion,
} from "./update-lib.mjs";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;

test("parses pinned images and mutable update references", () => {
  assert.deepEqual(parsePinnedImage(`docker.io/example/server@${digestA}`), {
    repository: "docker.io/example/server",
    digest: digestA,
  });
  assert.deepEqual(parseUpdateReference("docker.io/example/server:stable"), {
    repository: "docker.io/example/server",
    tag: "stable",
  });
});

test("increments candidates without replacing a stable Seed in place", () => {
  assert.equal(nextCandidateVersion("1.2.3"), "1.2.4-rc.1");
  assert.equal(nextCandidateVersion("1.2.4-rc.1"), "1.2.4-rc.2");
  assert.equal(stableVersion("1.2.4-rc.2"), "1.2.4");
});

test("reports each changed component and reuses a shared resolution", async () => {
  let resolutions = 0;
  const reference = "docker.io/example/server:stable";
  const resolve = async (candidate) => {
    resolutions += 1;
    return fixtureDigestResolver({ [reference]: digestB })(candidate);
  };
  const component = (id) => ({
    id,
    image: `docker.io/example/server@${digestA}`,
    imageUpdate: { reference },
  });
  const report = await createUpdateReport(
    [
      {
        value: {
          id: "example-a",
          version: "1.0.0",
          status: "stable",
          components: [component("server")],
        },
      },
      {
        value: {
          id: "example-b",
          version: "1.0.0",
          status: "stable",
          components: [component("server")],
        },
      },
    ],
    resolve,
  );

  assert.equal(report.updatesAvailable, 2);
  assert.equal(report.seedsWithUpdates, 2);
  assert.equal(resolutions, 1);
  assert.equal(report.seeds[0].components[0].availableImage, `docker.io/example/server@${digestB}`);
});

test("prepares a patch release candidate from a fresh report", () => {
  const currentImage = `docker.io/example/server@${digestA}`;
  const availableImage = `docker.io/example/server@${digestB}`;
  const current = {
    id: "example",
    version: "2.3.4",
    status: "stable",
    components: [{ id: "server", image: currentImage }],
  };
  const result = prepareCandidate(current, {
    id: "example",
    currentVersion: "2.3.4",
    currentStatus: "stable",
    components: [
      {
        id: "server",
        currentImage,
        availableImage,
        updateAvailable: true,
      },
    ],
  });

  assert.equal(result.seed.version, "2.3.5-rc.1");
  assert.equal(result.seed.status, "candidate");
  assert.equal(result.seed.components[0].image, availableImage);
  assert.deepEqual(result.updatedComponents, ["server"]);
  assert.equal(current.components[0].image, currentImage);
});
