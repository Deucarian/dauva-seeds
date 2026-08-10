const mandatoryCheckStatuses = new Map(
  [
    "images-pinned",
    "healthy",
    "ports",
    "graceful-stop",
    "stopped-remains-stopped",
    "restart",
    "persistence",
    "cleanup",
  ].map((code) => [code, "passed"]),
);

const capabilityChecks = [
  ["backup", "backup"],
  ["restore", "restore"],
  ["console", "console"],
  ["update", "update"],
];

export function expectedProofCheckStatuses(seed) {
  const expected = new Map(mandatoryCheckStatuses);
  for (const [capability, code] of capabilityChecks) {
    expected.set(code, seed.capabilities[capability] ? "passed" : "not_applicable");
  }
  for (const code of seed.proofPolicy.requiredChecks) {
    expected.set(
      code,
      code === "backup-if-supported" && !seed.capabilities.backup
        ? "not_applicable"
        : "passed",
    );
  }
  return expected;
}

export function proofCheckPolicyIssues(seed, checks) {
  const issues = [];
  const byCode = new Map();
  for (const check of checks) {
    if (byCode.has(check.code)) {
      issues.push(`proof check '${check.code}' occurs more than once`);
    }
    byCode.set(check.code, check);
  }
  for (const [code, expectedStatus] of expectedProofCheckStatuses(seed)) {
    const check = byCode.get(code);
    if (!check) {
      issues.push(`required proof check '${code}' is missing`);
    } else if (check.status !== expectedStatus) {
      issues.push(`proof check '${code}' must be '${expectedStatus}'`);
    }
  }
  return issues;
}
