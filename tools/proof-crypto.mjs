import {
  createPrivateKey,
  createPublicKey,
  sign as ed25519Sign,
  verify as ed25519Verify,
} from "node:crypto";
import { canonicalJson, sha256 } from "./registry-lib.mjs";

const ed25519PrivateKeyPrefix = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);
const ed25519PublicKeyPrefix = Buffer.from("302a300506032b6570032100", "hex");
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const signaturePattern = /^[A-Za-z0-9_-]{86}$/;

export const proofLeafDomain = "dauva.seed-proof.v2/leaf";
export const proofApiDomain = "dauva.seed-proof.v2/api";
export const releaseBundleDomain = "dauva.seed-release-bundle.v1";

export function digestCanonicalJson(value) {
  return sha256(canonicalJson(value));
}

export function domainSeparatedMessage(domain, digest) {
  if (typeof domain !== "string" || domain.length === 0 || domain.includes("\0")) {
    throw new TypeError("Signature domain must be a non-empty string without NUL.");
  }
  assertDigest(digest);
  return Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(digest, "utf8"),
  ]);
}

export function ed25519PrivateKeyFromSeed(seed) {
  const bytes = toBuffer(seed, "Ed25519 private seed");
  if (bytes.length !== 32) {
    throw new TypeError("Ed25519 private seed must contain exactly 32 bytes.");
  }
  return createPrivateKey({
    key: Buffer.concat([ed25519PrivateKeyPrefix, bytes]),
    format: "der",
    type: "pkcs8",
  });
}

export function ed25519PublicKeyFromRaw(publicKey) {
  const bytes = toBuffer(publicKey, "Ed25519 public key");
  if (bytes.length !== 32) {
    throw new TypeError("Ed25519 public key must contain exactly 32 bytes.");
  }
  return createPublicKey({
    key: Buffer.concat([ed25519PublicKeyPrefix, bytes]),
    format: "der",
    type: "spki",
  });
}

export function ed25519KeyId(publicKey) {
  const bytes = toBuffer(publicKey, "Ed25519 public key");
  if (bytes.length !== 32) {
    throw new TypeError("Ed25519 public key must contain exactly 32 bytes.");
  }
  return sha256(bytes);
}

export function createAttestation({ domain, digest, privateKey, publicKey }) {
  const publicBytes = toBuffer(publicKey, "Ed25519 public key");
  const signature = ed25519Sign(
    null,
    domainSeparatedMessage(domain, digest),
    privateKey,
  ).toString("base64url");
  if (!signaturePattern.test(signature)) {
    throw new Error("Ed25519 produced a non-canonical signature encoding.");
  }
  return {
    algorithm: "Ed25519",
    keyId: ed25519KeyId(publicBytes),
    signature,
  };
}

export function verifyAttestation({ domain, digest, attestation, publicKey }) {
  const publicBytes = toBuffer(publicKey, "Ed25519 public key");
  if (
    attestation?.algorithm !== "Ed25519" ||
    attestation?.keyId !== ed25519KeyId(publicBytes) ||
    !signaturePattern.test(attestation?.signature ?? "")
  ) {
    return false;
  }
  return ed25519Verify(
    null,
    domainSeparatedMessage(domain, digest),
    ed25519PublicKeyFromRaw(publicBytes),
    Buffer.from(attestation.signature, "base64url"),
  );
}

export function receiptDigest(receiptPayload) {
  return digestCanonicalJson(receiptPayload);
}

export function apiStatementDigest(receiptDigestValue, leafAttestation) {
  assertDigest(receiptDigestValue);
  return digestCanonicalJson({
    receiptDigest: receiptDigestValue,
    leafAttestation,
  });
}

export function exportDigest(bundlePayload) {
  return digestCanonicalJson(bundlePayload);
}

function assertDigest(value) {
  if (!digestPattern.test(value)) {
    throw new TypeError("Digest must use lowercase sha256:<64 hex> form.");
  }
}

function toBuffer(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new TypeError(`${label} must be bytes.`);
}
