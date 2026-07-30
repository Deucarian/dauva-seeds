import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { readJson, repositoryRoot } from "./registry-lib.mjs";
import {
  nextPatchVersion,
  prepareCandidate,
} from "./update-lib.mjs";

const reportPath = path.resolve(
  optionValue("--report") ??
    path.join(repositoryRoot, "dist", "update-report.json"),
);
const proofPlanPath = path.resolve(
  optionValue("--proof-plan") ??
    path.join(repositoryRoot, "dist", "candidate-proof-plan.json"),
);
const onlySeed = optionValue("--seed");
const report = await readJson(reportPath);

if (report.schemaVersion !== "dauva.dev/seed-update-report/v1") {
  throw new Error(`Unsupported update report '${report.schemaVersion}'.`);
}

const plans = [];
for (const update of report.seeds) {
  if (onlySeed && update.id !== onlySeed) {
    continue;
  }
  const manifestPath = path.join(
    repositoryRoot,
    "registry",
    "seeds",
    `${update.id}.json`,
  );
  const currentSeed = await readJson(manifestPath);
  const { seed, updatedComponents } = prepareCandidate(currentSeed, update);
  if (updatedComponents.length === 0) {
    continue;
  }
  const historyDirectory = path.join(repositoryRoot, "registry", "history");
  const historyPath = path.join(
    historyDirectory,
    `${currentSeed.id}@${currentSeed.version}.json`,
  );
  await mkdir(historyDirectory, { recursive: true });
  let existingHistory;
  try {
    existingHistory = await readFile(historyPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const renderedHistory = `${JSON.stringify(currentSeed, null, 2)}\n`;
  if (existingHistory != null && existingHistory !== renderedHistory) {
    throw new Error(
      `Historical release '${currentSeed.id}@${currentSeed.version}' is immutable.`,
    );
  }
  if (existingHistory == null) {
    await writeFile(historyPath, renderedHistory, "utf8");
  }
  await writeFile(manifestPath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  plans.push({
    seedId: seed.id,
    candidateVersion: seed.version,
    updatedComponents,
    requiredChecks: [
      "images-pinned",
      "healthy",
      "ports",
      "backup-if-supported",
      ...(seed.capabilities.update
        ? [
            "runtime-version",
            "managed-update",
            "rollback",
          ]
        : []),
      "graceful-stop",
      "restart",
      "persistence",
      "cleanup",
    ],
    agreements: seed.inputs
      .filter((input) => input.type === "agreement")
      .map((input) => ({
        key: input.key,
        url: input.url,
        revision: input.revision,
        acceptanceRequired: true,
      })),
  });
}

if (onlySeed && plans.length === 0) {
  throw new Error(`No available update found for Seed '${onlySeed}'.`);
}

if (plans.length > 0) {
  const packagePath = path.join(repositoryRoot, "package.json");
  const lockPath = path.join(repositoryRoot, "package-lock.json");
  const packageDocument = await readJson(packagePath);
  const lockDocument = await readJson(lockPath);
  const releaseVersion = nextPatchVersion(packageDocument.version);
  packageDocument.version = releaseVersion;
  lockDocument.version = releaseVersion;
  lockDocument.packages[""].version = releaseVersion;
  await writeFile(
    packagePath,
    `${JSON.stringify(packageDocument, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    lockPath,
    `${JSON.stringify(lockDocument, null, 2)}\n`,
    "utf8",
  );
}

await mkdir(path.dirname(proofPlanPath), { recursive: true });
await writeFile(
  proofPlanPath,
  `${JSON.stringify(
    {
      schemaVersion: "dauva.dev/seed-proof-plan/v1",
      candidates: plans,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`Prepared ${plans.length} Seed candidate(s).`);
console.log(`Wrote proof plan ${proofPlanPath}.`);

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}
