import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { ed25519KeyId } from "./proof-crypto.mjs";

const repositoryId = 1311366821;
const repositoryName = "Deucarian/dauva-seeds";
const environmentTargets = {
  develop: {
    ref: "refs/heads/develop",
    branch: "develop",
    apiOrigin: "https://develop.jorishoef.nl",
  },
  production: {
    ref: "refs/heads/main",
    branch: "main",
    apiOrigin: "https://jorishoef.nl",
  },
};

export function inspectPublicationPreconditions({
  phase,
  environment,
  targetRef,
  apiOrigin,
  activation,
  repository,
  protection,
  verificationRoots,
}) {
  const issues = [];
  const target = environmentTargets[environment];
  if (!target) issues.push("environment.invalid");
  if (target && targetRef !== target.ref) issues.push("target-ref.crossed");
  if (target && apiOrigin !== target.apiOrigin) issues.push("api-origin.crossed");
  if (activation !== "enabled-v1") issues.push("activation.not-enabled");
  if (
    repository?.id !== repositoryId ||
    repository?.full_name !== repositoryName ||
    repository?.archived !== false ||
    repository?.disabled !== false
  ) {
    issues.push("repository.identity-or-state-invalid");
  }

  if (!protection || protection.status === 403 || protection.status === 404) {
    issues.push("branch-protection.unavailable");
  } else {
    const reviews = protection.required_pull_request_reviews;
    const checks = protection.required_status_checks;
    if (
      !reviews ||
      reviews.required_approving_review_count < 1 ||
      reviews.dismiss_stale_reviews !== true
    ) {
      issues.push("branch-protection.reviews-incomplete");
    }
    const checkNames = new Set([
      ...(checks?.contexts ?? []),
      ...(checks?.checks ?? []).map((check) => check.context),
    ]);
    if (!checks || checks.strict !== true || !checkNames.has("validate")) {
      issues.push("branch-protection.validation-check-missing");
    }
    if (protection.enforce_admins?.enabled !== true) {
      issues.push("branch-protection.admin-bypass-enabled");
    }
    if (protection.required_conversation_resolution?.enabled !== true) {
      issues.push("branch-protection.conversation-resolution-missing");
    }
    if (protection.allow_force_pushes?.enabled !== false) {
      issues.push("branch-protection.force-push-enabled");
    }
    if (protection.allow_deletions?.enabled !== false) {
      issues.push("branch-protection.deletion-enabled");
    }
  }

  const activeKeys = (verificationRoots?.keys ?? []).filter((key) => {
    if (key.status !== "active" || key.revokedAt !== null) return false;
    try {
      const publicKey = Buffer.from(key.publicKey, "base64url");
      return publicKey.length === 32 && ed25519KeyId(publicKey) === key.keyId;
    } catch {
      return false;
    }
  });
  const requiredSubjects = target
    ? [`env:${environment}`, "repo:deucarian.dauva-seeds", `target:${target.branch}`]
    : [];
  if (
    !activeKeys.some(
      (key) =>
        key.purpose === "studio_export" &&
        requiredSubjects.every((subject) => key.subjects?.includes(subject)),
    )
  ) {
    issues.push("trust.studio-export-root-missing");
  }
  if (
    !activeKeys.some(
      (key) => key.purpose === "proof_api" && key.subjects?.includes(`env:${environment}`),
    )
  ) {
    issues.push("trust.proof-api-root-missing");
  }
  if (
    !activeKeys.some(
      (key) =>
        key.purpose === "proof_leaf" &&
        key.subjects?.includes(`env:${environment}`) &&
        key.subjects.some((subject) => subject.startsWith("leaf:")),
    )
  ) {
    issues.push("trust.proof-leaf-root-missing");
  }

  // Phase 1 is intentionally incapable of applying or publishing, even if an
  // administrator accidentally supplies every future activation setting.
  if (phase === "foundation") issues.push("phase1.non-activating");
  else if (phase !== "activation") issues.push("phase.invalid");

  return {
    ready: issues.length === 0,
    environment,
    targetRef,
    issues,
  };
}

async function runCli() {
  const repository = await readJson(optionValue("--repository"));
  const protection = await readJson(optionValue("--protection"));
  const verificationRoots = await readJson(optionValue("--verification-roots"));
  const result = inspectPublicationPreconditions({
    phase: optionValue("--phase"),
    environment: optionValue("--environment"),
    targetRef: optionValue("--target-ref"),
    apiOrigin: optionValue("--api-origin"),
    activation: optionValue("--activation"),
    repository,
    protection,
    verificationRoots,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ready) process.exitCode = 1;
}

async function readJson(filePath) {
  if (!filePath) throw new Error("A required JSON path was not supplied.");
  return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
