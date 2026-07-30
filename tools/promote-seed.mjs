import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { readJson, repositoryRoot } from "./registry-lib.mjs";
import { assertPromotionProof } from "./promotion-lib.mjs";
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

assertPromotionProof(seed, proof);

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

