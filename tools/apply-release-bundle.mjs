#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import {
  applyVerifiedRelease,
  recoverInterruptedApply,
  verifyReleaseApplication,
} from "./release-apply-lib.mjs";

const options = parseArguments(process.argv.slice(2));

try {
  if (options.recoverOnly) {
    const result = await recoverInterruptedApply({
      repositoryPath: options.repository,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (options.verifyOnly) {
    const result = await verifyReleaseApplication(options);
    process.stdout.write(
      `${JSON.stringify({
        verified: true,
        publicationId: result.statement.publicationPayload.publicationId,
        exportDigest: result.archive.envelope.exportDigest,
        targetRef: result.targetRef,
      })}\n`,
    );
  } else {
    const result = await applyVerifiedRelease(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) {
  process.stderr.write(`Release apply refused: ${error?.message ?? "unknown error"}\n`);
  process.exitCode = 1;
}

function parseArguments(argumentsList) {
  const values = new Map();
  let verifyOnly = false;
  let recoverOnly = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--verify-only") {
      verifyOnly = true;
      continue;
    }
    if (argument === "--recover-only") {
      recoverOnly = true;
      continue;
    }
    if (!argument.startsWith("--")) usage(`Unexpected argument '${argument}'.`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) usage(`Missing value for '${argument}'.`);
    if (values.has(argument)) usage(`Duplicate argument '${argument}'.`);
    values.set(argument, value);
    index += 1;
  }
  if (verifyOnly && recoverOnly) usage("Choose either verify-only or recover-only.");
  const repository = path.resolve(values.get("--repository") ?? process.cwd());
  if (recoverOnly) {
    rejectUnknown(values, new Set(["--repository"]));
    return { repository, recoverOnly };
  }
  const archive = values.get("--archive");
  const statement = values.get("--statement");
  const environment = values.get("--environment");
  const validationTime = values.get("--validation-time");
  if (!archive || !statement || !environment || !validationTime) {
    usage(
      "--archive, --statement, --environment, and --validation-time are required.",
    );
  }
  rejectUnknown(
    values,
    new Set([
      "--archive",
      "--statement",
      "--repository",
      "--environment",
      "--validation-time",
      "--verification-roots",
    ]),
  );
  return {
    archivePath: path.resolve(archive),
    statementPath: path.resolve(statement),
    repositoryPath: repository,
    environment,
    validationTime,
    verificationRootsPath: values.has("--verification-roots")
      ? path.resolve(values.get("--verification-roots"))
      : undefined,
    verifyOnly,
  };
}

function rejectUnknown(values, allowed) {
  const unknown = [...values.keys()].find((key) => !allowed.has(key));
  if (unknown) usage(`Unknown option '${unknown}'.`);
}

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(
    "Usage: npm run release:apply -- --archive <zip> --statement <json> " +
      "--repository <worktree> --environment <develop|production> " +
      "--validation-time <UTC timestamp> [--verification-roots <json>] " +
      "[--verify-only]\n" +
      "Recovery: npm run release:apply -- --repository <worktree> --recover-only\n",
  );
  process.exit(2);
}
