import { canonicalJson, sha256 } from "./registry-lib.mjs";

export function candidateManifestDigest(seed) {
  return sha256(canonicalJson(seed));
}

export function assertPromotionProof(seed, proof) {
  if (seed.status !== "candidate") {
    throw new Error(`${seed.id} is not a candidate.`);
  }
  if (
    proof?.schemaVersion !== "dauva.dev/seed-proof/v1" ||
    proof.result !== "passed" ||
    proof.seedId !== seed.id ||
    proof.seedVersion !== seed.version
  ) {
    throw new Error(`Proof receipt does not match ${seed.id} ${seed.version}.`);
  }

  const expectedManifestDigest = candidateManifestDigest(seed);
  if (proof.evidence?.seedManifest !== expectedManifestDigest) {
    throw new Error(
      `Proof receipt is not bound to the exact ${seed.id} ${seed.version} candidate manifest.`,
    );
  }

  if (
    proof.checks === null ||
    typeof proof.checks !== "object" ||
    Object.values(proof.checks).some((passed) => passed !== true)
  ) {
    throw new Error(`Proof receipt contains an incomplete lifecycle check.`);
  }
  if (seed.capabilities.update) {
    for (const check of ["runtimeVersion", "managedUpdate", "rollback"]) {
      if (proof.checks[check] !== true) {
        throw new Error(
          `Proof receipt has no passing managed-update check '${check}'.`,
        );
      }
    }
  }

  if (!Array.isArray(proof.agreements)) {
    throw new Error(`Proof receipt contains no agreement evidence.`);
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
}
