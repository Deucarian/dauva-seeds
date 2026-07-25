import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { readJson, repositoryRoot } from "./registry-lib.mjs";
import { stableVersion } from "./update-lib.mjs";

const seedId = requiredOption("--seed");
const proofPath = path.resolve(requiredOption("--proof"));
const manifestPath = path.join(
  repositoryRoot,
  "registry",
  "seeds",
  `${seedId}.json`,
);
const seed = await readJson(manifestPath);
const proof = await readJson(proofPath);

if (seed.status !== "candidate") {
  throw new Error(`${seed.id} is not a candidate.`);
}
if (
  proof.schemaVersion !== "dauva.dev/seed-proof/v1" ||
  proof.result !== "passed" ||
  proof.seedId !== seed.id ||
  proof.seedVersion !== seed.version
) {
  throw new Error(`Proof receipt does not match ${seed.id} ${seed.version}.`);
}
if (
  Object.values(proof.checks).some((passed) => passed !== true)
) {
  throw new Error(`Proof receipt contains an incomplete lifecycle check.`);
}
for (const agreement of seed.inputs.filter(
  (input) => input.type === "agreement",
)) {
  const accepted = proof.agreements.some(
    (candidate) =>
      candidate.key === agreement.key &&
      candidate.url === agreement.url &&
      candidate.revision === agreement.revision &&
      candidate.accepted === true,
  );
  if (!accepted) {
    throw new Error(
      `Proof receipt has no matching acceptance for '${agreement.key}'.`,
    );
  }
}

seed.version = stableVersion(seed.version);
seed.status = "stable";
await writeFile(manifestPath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
console.log(`Promoted ${seed.id} to stable ${seed.version}.`);

function requiredOption(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

