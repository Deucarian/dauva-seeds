import { appendFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "./registry-lib.mjs";

export const publicationClaimDomain = "dauva.seed-publication-claim.v1";
export const publicationClaimIdempotencyPrefix =
  "seed-publication-claim.v1:";
export const publicationAttemptTokenDomain =
  "dauva.seed-publication-attempt-token.v1";

const publicationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const attemptTokenPattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

export function createPublicationClaimRequest({
  publicationAttempt,
  attemptToken,
  runId,
  runAttempt,
}) {
  requireInteger(publicationAttempt, "publicationAttempt", 1, 1000);
  requireAttemptToken(attemptToken);
  requireInteger(runId, "runId", 1, Number.MAX_SAFE_INTEGER);
  requireInteger(runAttempt, "runAttempt", 1, 1000);
  return { runId, runAttempt, publicationAttempt, attemptToken };
}

export function publicationClaimCorrelation({ publicationId, ...request }) {
  if (!publicationIdPattern.test(publicationId ?? "")) {
    throw new TypeError("publicationId must be a canonical lowercase UUID.");
  }
  return {
    publicationId,
    ...createPublicationClaimRequest(request),
  };
}

export function publicationClaimIdempotencyKey(input) {
  const correlation = publicationClaimCorrelation(input);
  const message = Buffer.concat([
    Buffer.from(publicationClaimDomain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalJson(correlation), "utf8"),
  ]);
  return `${publicationClaimIdempotencyPrefix}${createHash("sha256")
    .update(message)
    .digest("hex")}`;
}

export function publicationAttemptTokenHash(attemptToken) {
  requireAttemptToken(attemptToken);
  return `sha256:${createHash("sha256")
    .update(Buffer.from(attemptToken, "base64url"))
    .digest("hex")}`;
}

export function publicationAttemptTokenKeyId(attemptTokenKey) {
  const key = requireAttemptTokenKey(attemptTokenKey);
  return `sha256:${createHash("sha256").update(key).digest("hex")}`;
}

export function derivePublicationAttemptToken({
  environment,
  publicationAttempt,
  publicationId,
  attemptTokenKey,
}) {
  if (environment !== "develop" && environment !== "production") {
    throw new TypeError("environment must be develop or production.");
  }
  requireInteger(publicationAttempt, "publicationAttempt", 1, 1000);
  if (!publicationIdPattern.test(publicationId ?? "")) {
    throw new TypeError("publicationId must be a canonical lowercase UUID.");
  }
  const key = requireAttemptTokenKey(attemptTokenKey);
  const context = { environment, publicationAttempt, publicationId };
  const message = Buffer.concat([
    Buffer.from(publicationAttemptTokenDomain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalJson(context), "utf8"),
  ]);
  return createHmac("sha256", key).update(message).digest("base64url");
}

function requireAttemptToken(value) {
  if (!attemptTokenPattern.test(value ?? "")) {
    throw new TypeError(
      "attemptToken must be unpadded base64url encoding of exactly 32 random bytes.",
    );
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) {
    throw new TypeError(
      "attemptToken must be canonical unpadded base64url encoding of exactly 32 random bytes.",
    );
  }
}

function requireAttemptTokenKey(value) {
  const key = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value)
      : null;
  if (key?.length !== 32) {
    throw new TypeError(
      "Publication attempt-token PRF key must be exactly 32 bytes.",
    );
  }
  return key;
}

function requireInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${name} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const values = parseArguments(process.argv.slice(2));
  const attemptToken = process.env.DAUVA_SEED_PUBLICATION_ATTEMPT_TOKEN;
  const input = {
    publicationId: values.get("publication-id"),
    publicationAttempt: parseInteger(values.get("publication-attempt")),
    attemptToken,
    runId: parseInteger(values.get("run-id")),
    runAttempt: parseInteger(values.get("run-attempt")),
  };
  const idempotencyKey = publicationClaimIdempotencyKey(input);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `idempotency-key=${idempotencyKey}\n`,
      "utf8",
    );
  }
  process.stdout.write(
    `Publication attempt correlation is valid (${idempotencyKey}).\n`,
  );
}

function parseArguments(args) {
  const expected = new Set([
    "publication-id",
    "publication-attempt",
    "run-id",
    "run-attempt",
  ]);
  if (args.length !== expected.size * 2) {
    throw new TypeError("Publication claim requires exactly four arguments.");
  }
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    const name = flag?.slice(2);
    if (
      !flag?.startsWith("--") ||
      value === undefined ||
      !expected.has(name) ||
      values.has(name)
    ) {
      throw new TypeError(
        "Publication claim arguments must contain each approved --name value pair exactly once.",
      );
    }
    values.set(name, value);
  }
  return values;
}

function parseInteger(value) {
  if (!/^[1-9][0-9]*$/.test(value ?? "")) return Number.NaN;
  return Number(value);
}
