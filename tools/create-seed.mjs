import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createSeedDraft } from "./creator-engine.mjs";
import { repositoryRoot } from "./registry-lib.mjs";

const id = requiredOption("--id");
const seed = createSeedDraft({
  id,
  podId: optionValue("--pod-id") ?? id,
  kind: requiredOption("--kind"),
  homepage: requiredOption("--homepage"),
  repository: optionValue("--repository"),
  image: requiredOption("--image"),
  updateReference: requiredOption("--update-reference"),
  upstreamId: optionValue("--upstream-id"),
  reviewedAt: requiredOption("--reviewed-at"),
});

const output = path.resolve(
  optionValue("--output") ??
    path.join(repositoryRoot, ".seed-studio", "drafts", id, "seed.json"),
);
for (const protectedDirectory of ["registry", "proofs", "dist"]) {
  const protectedPath = path.join(repositoryRoot, protectedDirectory);
  if (isInside(protectedPath, output)) {
    throw new Error(
      `Draft output must stay outside the canonical '${protectedDirectory}' directory.`,
    );
  }
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(seed, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
console.log(
  `Created private draft Seed ${output}. It is not part of the Registry; complete and validate it in the Seed Studio before freezing.`,
);

function requiredOption(name) {
  const value = optionValue(name);
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function isInside(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
