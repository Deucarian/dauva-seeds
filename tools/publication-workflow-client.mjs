#!/usr/bin/env node
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "./registry-lib.mjs";
import {
  createPublicationClaimRequest,
  publicationClaimIdempotencyKey,
} from "./publication-claim-contract.mjs";

const origins = {
  develop: "https://develop.jorishoef.nl",
  production: "https://jorishoef.nl",
};
const audiences = {
  develop: "dauva-seed-publication-develop-v1",
  production: "dauva-seed-publication-production-v1",
};
const repositoryId = 1311366821;
const repository = "Deucarian/dauva-seeds";
const deploymentWorkflowRef =
  "Deucarian/dauva-seeds/.github/workflows/_seed-registry-deploy.yml@refs/heads/main";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...argumentsList] = process.argv.slice(2);
  try {
    if (command === "claim") await claim(parseOptions(argumentsList));
    else if (command === "event") await event(parseOptions(argumentsList));
    else if (command === "deployment") await deployment(parseOptions(argumentsList));
    else throw new TypeError("Use claim, event, or deployment.");
  } catch (error) {
    process.stderr.write(`Seed publication workflow refused: ${safeMessage(error)}\n`);
    process.exitCode = 1;
  }
}

async function claim(options) {
  const context = workflowContext(options);
  const attemptToken = requiredSecret("DAUVA_SEED_PUBLICATION_ATTEMPT_TOKEN");
  mask(attemptToken);
  const request = createPublicationClaimRequest({
    publicationAttempt: integer(options.get("publication-attempt"), "publication-attempt", 1, 1000),
    attemptToken,
    runId: context.runId,
    runAttempt: context.runAttempt,
  });
  const idempotencyKey = publicationClaimIdempotencyKey({
    publicationId: context.publicationId,
    ...request,
  });
  const oidc = await oidcToken(context.environment);
  const claimResponse = await apiJson(
    context.origin,
    `/api/internal/seed-publications/${context.publicationId}/claim`,
    oidc,
    { method: "POST", idempotencyKey, body: request },
  );
  if (
    claimResponse.schemaVersion !== "dauva.dev/seed-publication-claim/v1" ||
    claimResponse.publicationId !== context.publicationId ||
    claimResponse.publicationAttempt !== request.publicationAttempt ||
    claimResponse.environment !== context.environment ||
    claimResponse.targetRef !== context.targetRef ||
    !isDigest(claimResponse.archiveDigest)
  ) {
    throw new Error("The claim response does not match this workflow.");
  }
  const expectedStatement = `/api/internal/seed-publications/${context.publicationId}/statement`;
  const expectedBundle = `/api/internal/seed-publications/${context.publicationId}/bundle`;
  if (claimResponse.statementPath !== expectedStatement || claimResponse.bundlePath !== expectedBundle)
    throw new Error("The claim returned crossed material paths.");
  const outputDirectory = path.resolve(options.get("output-directory") ?? process.env.RUNNER_TEMP ?? ".");
  await mkdir(outputDirectory, { recursive: true });
  const statementPath = path.join(outputDirectory, `${context.publicationId}.statement.json`);
  const archivePath = path.join(outputDirectory, `${context.publicationId}.release.zip`);
  const statement = await apiBytes(context.origin, expectedStatement, oidc);
  const archive = await apiBytes(context.origin, expectedBundle, oidc, 314_572_800);
  if (digest(archive) !== claimResponse.archiveDigest)
    throw new Error("The immutable publication archive digest does not match its claim.");
  JSON.parse(statement.toString("utf8"));
  await writeFile(statementPath, statement, { mode: 0o600 });
  await writeFile(archivePath, archive, { mode: 0o600 });
  await outputs({
    "statement-path": statementPath,
    "archive-path": archivePath,
    "archive-digest": claimResponse.archiveDigest,
    "target-ref": claimResponse.targetRef,
  });
  process.stdout.write("The exact durable publication attempt is claimed and its materials are verified.\n");
}

async function event(options) {
  const context = workflowContext(options);
  const phase = required(options, "phase");
  const outcome = required(options, "outcome");
  const code = required(options, "code");
  const externalEventId = required(options, "external-event-id");
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(externalEventId)) throw new TypeError("external-event-id is invalid.");
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(code)) throw new TypeError("code is invalid.");
  const body = { externalEventId, phase, outcome, code, parameters: {} };
  const key = `seed-event.v1:${hash(`${context.publicationId}\n${canonicalJson(body)}`)}`;
  await apiJson(
    context.origin,
    `/api/internal/seed-publications/${context.publicationId}/events`,
    await oidcToken(context.environment),
    { method: "POST", idempotencyKey: key, body, expectedStatus: 202 },
  );
  process.stdout.write(`Recorded publication phase ${phase}.\n`);
}

async function deployment(options) {
  const context = workflowContext(options);
  const commitSha = commit(required(options, "commit-sha"), "commit-sha");
  const previousCommitSha = commit(required(options, "previous-commit-sha"), "previous-commit-sha");
  const healthPath = path.resolve(required(options, "health"));
  const health = JSON.parse(await readFile(healthPath, "utf8"));
  if (
    health?.schemaVersion !== "dauva.dev/seed-registry-health/v1" ||
    health.ready !== true ||
    health.apiCommitSha !== commitSha ||
    health.registryCommitSha !== commitSha ||
    !isDigest(health.registryDigest) ||
    !isDigest(health.registryFileDigest)
  ) {
    throw new Error("The live Registry health does not prove the merged commit.");
  }
  const deployedAtUtc = timestamp(required(options, "deployed-at"));
  const verifiedAtUtc = timestamp(required(options, "verified-at"));
  const receipt = createDeploymentReceipt({
    context,
    commitSha,
    previousCommitSha,
    health,
    deployedAtUtc,
    verifiedAtUtc,
  });
  const idempotencyKey = `seed-deployment.v1:${hash(canonicalJson(receipt))}`;
  await apiJson(
    context.origin,
    "/api/internal/seed-registry-deployments",
    await oidcToken(context.environment),
    { method: "POST", idempotencyKey, body: receipt, expectedStatus: 202 },
  );
  process.stdout.write("The exact Registry deployment receipt is durably recorded.\n");
}

export function createDeploymentReceipt({
  context,
  commitSha,
  previousCommitSha,
  health,
  deployedAtUtc,
  verifiedAtUtc,
}) {
  const deploymentPayload = {
    deploymentId: deterministicUuid(
      `${context.publicationId}\n${commitSha}\n${context.runId}\n${context.runAttempt}`,
    ),
    publicationId: context.publicationId,
    environment: context.environment,
    repositoryId,
    repository,
    targetRef: context.targetRef,
    commitSha,
    previousCommitSha,
    registryDigest: health.registryDigest,
    registryFileDigest: health.registryFileDigest,
    workflowRunId: context.runId,
    workflowRunAttempt: context.runAttempt,
    jobWorkflowRef: deploymentWorkflowRef,
    deployedAtUtc,
    verifiedAtUtc,
    health: {
      apiCommitSha: health.apiCommitSha,
      apiRegistryDigest: health.registryDigest,
    },
  };
  return {
    schemaVersion: "dauva.dev/seed-registry-deployment-receipt/v1",
    deploymentPayload,
    deploymentDigest: digest(Buffer.from(canonicalJson(deploymentPayload), "utf8")),
  };
}

function workflowContext(options) {
  const environment = required(options, "environment");
  const origin = origins[environment];
  if (!origin) throw new TypeError("environment must be develop or production.");
  const publicationId = required(options, "publication-id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(publicationId))
    throw new TypeError("publication-id must be a canonical UUID.");
  return {
    environment,
    origin,
    publicationId,
    targetRef: environment === "develop" ? "refs/heads/develop" : "refs/heads/main",
    runId: integer(process.env.GITHUB_RUN_ID, "GITHUB_RUN_ID", 1, Number.MAX_SAFE_INTEGER),
    runAttempt: integer(process.env.GITHUB_RUN_ATTEMPT, "GITHUB_RUN_ATTEMPT", 1, 1000),
  };
}

async function oidcToken(environment) {
  const requestUrl = requiredSecret("ACTIONS_ID_TOKEN_REQUEST_URL");
  const requestToken = requiredSecret("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
  const url = new URL(requestUrl);
  if (url.protocol !== "https:") throw new Error("The GitHub OIDC request URL must use HTTPS.");
  url.searchParams.set("audience", audiences[environment]);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub OIDC refused the request (${response.status}).`);
  const value = (await response.json())?.value;
  if (typeof value !== "string" || value.length < 100 || value.length > 8192)
    throw new Error("GitHub OIDC returned an invalid token.");
  mask(value);
  return value;
}

async function apiJson(origin, route, token, options = {}) {
  const response = await apiFetch(origin, route, token, options);
  if (response.status === 204 || response.status === 202) return {};
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("The API JSON response is too large.");
  return JSON.parse(text);
}

async function apiBytes(origin, route, token, limit = 2_000_000) {
  const response = await apiFetch(origin, route, token, {});
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > limit) throw new Error("The API material size is invalid.");
  return bytes;
}

async function apiFetch(origin, route, token, options) {
  if (!route.startsWith("/api/internal/")) throw new Error("An internal API route was crossed.");
  const headers = { Authorization: `Bearer ${token}` };
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${origin}${route}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : canonicalJson(options.body),
    signal: AbortSignal.timeout(30_000),
  });
  const expected = options.expectedStatus ?? 200;
  if (response.status !== expected) throw new Error(`The internal API refused the request (${response.status}).`);
  return response;
}

async function outputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(
    process.env.GITHUB_OUTPUT,
    Object.entries(values).map(([name, value]) => `${name}=${value}\n`).join(""),
    "utf8",
  );
}

function parseOptions(list) {
  if (list.length % 2 !== 0) throw new TypeError("Options must be exact --name value pairs.");
  const result = new Map();
  for (let index = 0; index < list.length; index += 2) {
    const flag = list[index];
    if (!/^--[a-z][a-z-]*$/.test(flag ?? "") || result.has(flag.slice(2)))
      throw new TypeError("Options contain an invalid or duplicate name.");
    result.set(flag.slice(2), list[index + 1]);
  }
  return result;
}

function required(options, name) {
  const value = options.get(name);
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} is required.`);
  return value;
}

function requiredSecret(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function integer(value, name, minimum, maximum) {
  if (!/^[1-9][0-9]*$/.test(value ?? "")) throw new TypeError(`${name} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new TypeError(`${name} is outside its allowed range.`);
  return parsed;
}

function commit(value, name) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw new TypeError(`${name} is invalid.`);
  return value;
}

function timestamp(value) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value) ||
      Number.isNaN(Date.parse(value))) throw new TypeError("A canonical millisecond UTC timestamp is required.");
  return value;
}

function isDigest(value) {
  return /^sha256:[a-f0-9]{64}$/.test(value ?? "");
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function hash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function deterministicUuid(value) {
  const bytes = createHash("sha256").update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mask(value) {
  process.stdout.write(`::add-mask::${value}\n`);
}

function safeMessage(error) {
  const value = String(error?.message ?? "unknown error").replace(/[\r\n\x00-\x1f\x7f]/g, " ");
  return value.slice(0, 240);
}
