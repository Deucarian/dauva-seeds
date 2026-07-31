import assert from "node:assert/strict";
import test from "node:test";
import { createComposeAnalysis, createCreatorProposal } from "./creator-lib.mjs";

test("Compose analysis strips values and host paths", () => {
  const referenceSeed = seed();
  const compose = {
    name: "example-server",
    services: {
      example: {
        image: "example/server:latest",
        environment: {
          SERVER_PASSWORD: "must-never-escape",
          WORLD_NAME: "private-world",
          PUID: "1000",
        },
        volumes: [
          {
            type: "bind",
            source: "C:\\private\\server",
            target: "/data",
          },
          {
            type: "bind",
            source: "C:\\private\\secret",
            target: "/run/secrets/server_password",
          },
        ],
        ports: [
          {
            target: 7777,
            published: "17777",
            protocol: "udp",
          },
        ],
      },
    },
  };

  const analysis = createComposeAnalysis({ compose, referenceSeed });
  const rendered = JSON.stringify(analysis);

  assert.equal(analysis.components[0].id, "server");
  assert.equal(analysis.components[0].image.reference, "docker.io/example/server:latest");
  assert.deepEqual(analysis.components[0].mounts, [
    { target: "/data", sourceKind: "bind", readOnly: false },
  ]);
  assert.deepEqual(
    analysis.components[0].environment.map((item) => [
      item.key,
      item.classification,
    ]),
    [
      ["PUID", "runtime"],
      ["SERVER_PASSWORD", "secret"],
      ["WORLD_NAME", "setting"],
    ],
  );
  assert.equal(rendered.includes("must-never-escape"), false);
  assert.equal(rendered.includes("private-world"), false);
  assert.equal(rendered.includes("C:\\\\private"), false);
  assert.equal(analysis.existingSeed.canAdopt, false);
});

test("matching Compose structure reconstructs a reviewable draft", () => {
  const referenceSeed = seed();
  const analysis = createComposeAnalysis({
    compose: {
      name: "example-server",
      services: {
        server: {
          image: "docker.io/example/server:latest",
          environment: {
            WORLD_NAME: "ignored",
            SERVER_PASSWORD: "ignored",
          },
          volumes: [
            { type: "volume", source: "example-data", target: "/data" },
          ],
          ports: [
            { target: 7777, published: "7777", protocol: "udp" },
          ],
        },
      },
    },
    referenceSeed,
  });

  const proposal = createCreatorProposal({
    analysis,
    referenceSeed,
    referencePod: pod(),
  });

  assert.equal(proposal.report.mode, "reconstruction");
  assert.equal(proposal.report.readyForProof, true);
  assert.deepEqual(proposal.report.differences, []);
  assert.equal(proposal.seed.status, "draft");
});

test("Compose reconstruction reports unreviewed environment keys", () => {
  const referenceSeed = seed();
  const analysis = createComposeAnalysis({
    compose: {
      name: "example-server",
      services: {
        server: {
          image: "docker.io/example/server:latest",
          environment: {
            WORLD_NAME: "ignored",
            SERVER_PASSWORD: "ignored",
            UNREVIEWED_FLAG: "ignored",
          },
          volumes: [
            { type: "volume", source: "example-data", target: "/data" },
          ],
          ports: [
            { target: 7777, published: "7777", protocol: "udp" },
          ],
        },
      },
    },
    referenceSeed,
  });

  const proposal = createCreatorProposal({
    analysis,
    referenceSeed,
    referencePod: pod(),
  });

  assert.equal(proposal.report.readyForProof, false);
  assert.deepEqual(proposal.report.differences, [
    {
      key: "environment",
      message:
        "Observed environment key 'server.UNREVIEWED_FLAG' is absent from the reference Seed.",
    },
  ]);
});

test("Compose analysis refuses privileged and Docker-socket recipes", () => {
  assert.throws(
    () =>
      createComposeAnalysis({
        compose: {
          services: {
            server: {
              image: "example/server:latest",
              privileged: true,
            },
          },
        },
      }),
    /privileged mode/,
  );
  assert.throws(
    () =>
      createComposeAnalysis({
        compose: {
          services: {
            server: {
              image: "example/server:latest",
              volumes: [
                {
                  type: "bind",
                  source: "/var/run/docker.sock",
                  target: "/var/run/docker.sock",
                },
              ],
            },
          },
        },
      }),
    /Docker socket/,
  );
});

function seed() {
  return {
    schemaVersion: "dauva.dev/seed/v1",
    id: "example",
    version: "1.0.0",
    status: "stable",
    podId: "example",
    components: [
      {
        id: "server",
        role: "primary",
        image: `docker.io/example/server@sha256:${"a".repeat(64)}`,
        environment: {},
        optionEnvironment: { "world-name": "WORLD_NAME" },
        agreementEnvironment: {},
        secretEnvironment: { "server-password": "SERVER_PASSWORD" },
        runtimeEnvironment: {},
        volumeMounts: [
          { volumeId: "data", target: "/data", readOnly: false },
        ],
      },
    ],
    volumes: [
      { id: "data", role: "data", retention: "delete-with-server" },
    ],
    ports: [
      {
        id: "game",
        componentId: "server",
        containerPort: 7777,
        protocols: ["udp"],
      },
    ],
    proofPolicy: { requiredChecks: ["images-pinned"] },
  };
}

function pod() {
  return {
    schemaVersion: "dauva.dev/pod/v1",
    id: "example",
    status: "stable",
    recommendedSeedId: "example",
    metadata: {
      title: { en: "Example", nl: "Example", de: "Example" },
      description: { en: "Example", nl: "Example", de: "Example" },
      icon: "server",
    },
  };
}
