import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { readJson, canonicalJson, repositoryRoot } from "./registry-lib.mjs";
import {
  createPublicationClaimRequest,
  derivePublicationAttemptToken,
  publicationAttemptTokenDomain,
  publicationAttemptTokenKeyId,
  publicationClaimCorrelation,
  publicationClaimDomain,
  publicationClaimIdempotencyKey,
  publicationAttemptTokenHash,
} from "./publication-claim-contract.mjs";

const vectors = await readJson(
  path.join(
    repositoryRoot,
    "test-vectors",
    "seed-studio-publication-claim-v1.json",
  ),
);

test("attempt token PRF matches the frozen restart-safe vector", () => {
  const derivation = vectors.tokenDerivation;
  const key = Buffer.from(derivation.testKey, "base64url");
  assert.equal(derivation.domain, publicationAttemptTokenDomain);
  assert.equal(publicationAttemptTokenKeyId(key), derivation.keyId);
  assert.equal(canonicalJson(derivation.context), derivation.canonicalContext);

  const input = {
    ...derivation.context,
    attemptTokenKey: key,
  };
  const first = derivePublicationAttemptToken(input);
  const afterRestart = derivePublicationAttemptToken(input);
  assert.equal(first, derivation.attemptToken);
  assert.equal(afterRestart, first);
  assert.equal(publicationAttemptTokenHash(first), derivation.attemptTokenHash);
  assert.equal(vectors.durableAttempt.attemptTokenKeyId, derivation.keyId);
  assert.equal(
    vectors.durableAttempt.attemptTokenHash,
    derivation.attemptTokenHash,
  );
  assert.equal("attemptToken" in vectors.durableAttempt, false);
});

test("attempt token PRF separates attempts, environments, and keys", () => {
  const derivation = vectors.tokenDerivation;
  const key = Buffer.from(derivation.testKey, "base64url");
  const current = derivePublicationAttemptToken({
    ...derivation.context,
    attemptTokenKey: key,
  });
  for (const changed of [
    { ...derivation.context, publicationAttempt: 1, attemptTokenKey: key },
    { ...derivation.context, environment: "production", attemptTokenKey: key },
    {
      ...derivation.context,
      attemptTokenKey: Buffer.from(key.map((value) => value ^ 0xff)),
    },
  ]) {
    assert.notEqual(derivePublicationAttemptToken(changed), current);
  }
});

test("publication claim correlation matches the frozen byte-exact vector", () => {
  assert.equal(vectors.domain, publicationClaimDomain);
  const input = {
    publicationId: vectors.publicationId,
    ...vectors.claims.current.request,
  };
  assert.equal(
    canonicalJson(publicationClaimCorrelation(input)),
    vectors.claims.current.canonicalCorrelation,
  );
  assert.equal(
    publicationClaimIdempotencyKey(input),
    vectors.claims.current.idempotencyKey,
  );
  assert.equal(vectors.claims.current.idempotencyKey.length, 90);
  assert.equal(
    vectors.claims.current.idempotencyKey.includes(input.attemptToken),
    false,
  );
  assert.equal(
    publicationAttemptTokenHash(input.attemptToken),
    vectors.durableAttempt.attemptTokenHash,
  );
});

test("exact replays are stable while delayed and mismatched attempts are distinct", () => {
  const idempotencyKey = (claim) =>
    publicationClaimIdempotencyKey({
      publicationId: vectors.publicationId,
      ...claim.request,
    });

  assert.equal(
    idempotencyKey(vectors.claims.exactReplay),
    vectors.claims.current.idempotencyKey,
  );
  assert.equal(
    idempotencyKey(vectors.claims.delayedPreviousAttempt),
    vectors.claims.delayedPreviousAttempt.idempotencyKey,
  );
  assert.notEqual(
    vectors.claims.delayedPreviousAttempt.idempotencyKey,
    vectors.claims.current.idempotencyKey,
  );
  assert.equal(
    idempotencyKey(vectors.claims.wrongTokenForCurrentAttempt),
    vectors.claims.wrongTokenForCurrentAttempt.idempotencyKey,
  );
  assert.notEqual(
    vectors.claims.wrongTokenForCurrentAttempt.idempotencyKey,
    vectors.claims.current.idempotencyKey,
  );
});

test("publication claim correlation rejects malformed identities and tokens", () => {
  const valid = vectors.claims.current.request;
  for (const invalid of [
    { ...valid, publicationAttempt: 0 },
    { ...valid, publicationAttempt: 1001 },
    { ...valid, runId: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, runAttempt: 0 },
    { ...valid, attemptToken: `${valid.attemptToken}=` },
    { ...valid, attemptToken: valid.attemptToken.slice(1) },
    { ...valid, attemptToken: `${valid.attemptToken.slice(0, -1)}B` },
  ]) {
    assert.throws(() => createPublicationClaimRequest(invalid), TypeError);
  }

  assert.throws(
    () =>
      publicationClaimCorrelation({
        publicationId: vectors.publicationId.toUpperCase(),
        ...valid,
      }),
    /canonical lowercase UUID/,
  );

  const derivation = vectors.tokenDerivation;
  const key = Buffer.from(derivation.testKey, "base64url");
  for (const invalid of [
    { ...derivation.context, environment: "acceptance", attemptTokenKey: key },
    { ...derivation.context, publicationAttempt: 0, attemptTokenKey: key },
    {
      ...derivation.context,
      publicationId: vectors.publicationId.toUpperCase(),
      attemptTokenKey: key,
    },
    { ...derivation.context, attemptTokenKey: key.subarray(0, 31) },
  ]) {
    assert.throws(() => derivePublicationAttemptToken(invalid), TypeError);
  }
});

test("workflow CLI emits only the safe derived idempotency key", () => {
  const request = vectors.claims.current.request;
  const output = execFileSync(
    process.execPath,
    [
      path.join(repositoryRoot, "tools", "publication-claim-contract.mjs"),
      "--publication-id",
      vectors.publicationId,
      "--publication-attempt",
      String(request.publicationAttempt),
      "--run-id",
      String(request.runId),
      "--run-attempt",
      String(request.runAttempt),
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DAUVA_SEED_PUBLICATION_ATTEMPT_TOKEN: request.attemptToken,
      },
    },
  );
  assert.equal(output.includes(vectors.claims.current.idempotencyKey), true);
  assert.equal(output.includes(request.attemptToken), false);
});
