import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const candidateBranch = "automation/seed-image-updates";
const allowedChanges = [
  { pattern: /^dist\/registry\.json$/u, statuses: new Set(["M"]) },
  { pattern: /^package\.json$/u, statuses: new Set(["M"]) },
  { pattern: /^package-lock\.json$/u, statuses: new Set(["M"]) },
  {
    pattern: /^registry\/history\/[a-z0-9][a-z0-9-]*@[0-9A-Za-z.-]+\.json$/u,
    statuses: new Set(["A"]),
  },
  {
    pattern: /^registry\/seeds\/[a-z0-9][a-z0-9-]*\.json$/u,
    statuses: new Set(["M"]),
  },
];

export function classifyValidationProfile({
  event,
  changes = [],
  basePackage,
  candidatePackage,
  baseLock,
  candidateLock,
}) {
  const pullRequest = event?.pull_request;
  if (!pullRequest) {
    return { profile: "full", reason: "not-a-pull-request" };
  }

  const isUpdateBranch =
    pullRequest.base?.ref === "main" &&
    pullRequest.head?.ref === candidateBranch &&
    pullRequest.head?.repo?.full_name === event.repository?.full_name;
  if (!isUpdateBranch) {
    return { profile: "full", reason: "ordinary-pull-request" };
  }

  // A generated candidate may use the reduced profile only while GitHub itself
  // prevents merge. Marking it ready for review restores the complete stable
  // fixture suite and therefore the proof/promotion gate.
  if (pullRequest.draft !== true) {
    return { profile: "full", reason: "candidate-is-reviewable" };
  }

  if (changes.length === 0) {
    return { profile: "blocked", reason: "candidate-has-no-changes" };
  }
  const invalidChanges = changes.filter(({ status, filePath }) => {
    const rule = allowedChanges.find(({ pattern }) => pattern.test(filePath));
    return !rule || !rule.statuses.has(status);
  });
  if (invalidChanges.length > 0) {
    return {
      profile: "blocked",
      reason: "candidate-change-outside-allowlist",
      invalidChanges,
    };
  }

  for (const requiredPath of [
    "dist/registry.json",
    "package.json",
    "package-lock.json",
  ]) {
    if (!changes.some(({ filePath }) => filePath === requiredPath)) {
      return {
        profile: "blocked",
        reason: `candidate-missing-${requiredPath.replaceAll("/", "-")}`,
      };
    }
  }
  if (!changes.some(({ filePath }) => filePath.startsWith("registry/seeds/"))) {
    return { profile: "blocked", reason: "candidate-missing-seed" };
  }
  if (!changes.some(({ filePath }) => filePath.startsWith("registry/history/"))) {
    return { profile: "blocked", reason: "candidate-missing-history" };
  }

  const packageResult = validateVersionOnlyPackageChange({
    basePackage,
    candidatePackage,
    baseLock,
    candidateLock,
  });
  if (!packageResult.valid) {
    return { profile: "blocked", reason: packageResult.reason };
  }

  return {
    profile: "candidate",
    reason: "draft-generated-candidate",
    baseVersion: basePackage.version,
    candidateVersion: candidatePackage.version,
  };
}

export function parseNameStatus(text) {
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const fields = line.split("\t");
      if (fields.length !== 2 || !/^[AMD]$/u.test(fields[0])) {
        return { status: "invalid", filePath: line };
      }
      return { status: fields[0], filePath: fields[1].replaceAll("\\", "/") };
    });
}

function validateVersionOnlyPackageChange({
  basePackage,
  candidatePackage,
  baseLock,
  candidateLock,
}) {
  if (![basePackage, candidatePackage, baseLock, candidateLock].every(Boolean)) {
    return { valid: false, reason: "candidate-package-documents-missing" };
  }
  if (!isNextPatch(basePackage.version, candidatePackage.version)) {
    return { valid: false, reason: "candidate-version-is-not-next-patch" };
  }
  if (
    candidateLock.version !== candidatePackage.version ||
    candidateLock.packages?.[""]?.version !== candidatePackage.version
  ) {
    return { valid: false, reason: "candidate-lock-version-mismatch" };
  }

  const basePackageWithoutVersion = structuredClone(basePackage);
  const candidatePackageWithoutVersion = structuredClone(candidatePackage);
  delete basePackageWithoutVersion.version;
  delete candidatePackageWithoutVersion.version;
  if (!deepEqual(basePackageWithoutVersion, candidatePackageWithoutVersion)) {
    return { valid: false, reason: "candidate-package-change-is-not-version-only" };
  }

  const baseLockWithoutVersions = structuredClone(baseLock);
  const candidateLockWithoutVersions = structuredClone(candidateLock);
  delete baseLockWithoutVersions.version;
  delete candidateLockWithoutVersions.version;
  if (baseLockWithoutVersions.packages?.[""]) {
    delete baseLockWithoutVersions.packages[""].version;
  }
  if (candidateLockWithoutVersions.packages?.[""]) {
    delete candidateLockWithoutVersions.packages[""].version;
  }
  if (!deepEqual(baseLockWithoutVersions, candidateLockWithoutVersions)) {
    return { valid: false, reason: "candidate-lock-change-is-not-version-only" };
  }
  return { valid: true };
}

function isNextPatch(from, to) {
  const fromMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(from ?? "");
  const toMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(to ?? "");
  return (
    fromMatch != null &&
    toMatch != null &&
    fromMatch[1] === toMatch[1] &&
    fromMatch[2] === toMatch[2] &&
    Number(toMatch[3]) === Number(fromMatch[3]) + 1
  );
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function runCli() {
  const eventPath = optionValue("--event");
  const changesPath = optionValue("--changes");
  const baseRepository = optionValue("--base-repository");
  const candidateRepository = optionValue("--candidate-repository");
  const outputPath = optionValue("--github-output");
  if (!eventPath || !changesPath || !baseRepository || !candidateRepository) {
    throw new Error(
      "--event, --changes, --base-repository, and --candidate-repository are required.",
    );
  }
  const [event, changesText, basePackage, candidatePackage, baseLock, candidateLock] =
    await Promise.all([
      readJson(eventPath),
      readFile(changesPath, "utf8"),
      readJson(path.join(baseRepository, "package.json")),
      readJson(path.join(candidateRepository, "package.json")),
      readJson(path.join(baseRepository, "package-lock.json")),
      readJson(path.join(candidateRepository, "package-lock.json")),
    ]);
  const result = classifyValidationProfile({
    event,
    changes: parseNameStatus(changesText),
    basePackage,
    candidatePackage,
    baseLock,
    candidateLock,
  });
  if (outputPath) {
    await writeFile(
      outputPath,
      `profile=${result.profile}\nreason=${result.reason}\n`,
      { flag: "a" },
    );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.profile === "blocked") process.exitCode = 1;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
