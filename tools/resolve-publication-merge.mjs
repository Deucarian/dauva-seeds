#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

const markerPattern = /<!-- dauva-seed-publication:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}) -->/g;

export function resolvePublicationMerge(event, pullRequests) {
  if (
    event?.repository?.id !== 1311366821 ||
    event?.repository?.full_name !== "Deucarian/dauva-seeds" ||
    !/^[a-f0-9]{40}$/.test(event?.after ?? "") ||
    !/^[a-f0-9]{40}$/.test(event?.before ?? "") ||
    !["refs/heads/develop", "refs/heads/main"].includes(event?.ref)
  ) {
    throw new TypeError("The push identity is not an exact Seed Registry target.");
  }
  const base = event.ref.slice("refs/heads/".length);
  const environment = base === "develop" ? "develop" : "production";
  const matches = pullRequests.flatMap((pull) => {
    const markers = [...String(pull?.body ?? "").matchAll(markerPattern)];
    if (markers.length === 0) return [];
    if (
      markers.length !== 1 ||
      pull?.merged_at == null ||
      pull?.merge_commit_sha !== event.after ||
      pull?.base?.ref !== base ||
      !new RegExp(`^automation/seed-publication/${environment}/[a-f0-9]{16}$`).test(pull?.head?.ref ?? "")
    ) {
      throw new TypeError("A publication marker is attached to a crossed or ambiguous merge.");
    }
    return [{
      publicationId: markers[0][1],
      commitSha: event.after,
      previousCommitSha: event.before,
      targetRef: event.ref,
      pullRequestNumber: pull.number,
    }];
  });
  if (matches.length > 1) throw new TypeError("Multiple publication merges claim the same target commit.");
  return matches[0] ?? null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const event = JSON.parse(await readFile(requiredEnvironment("GITHUB_EVENT_PATH"), "utf8"));
    const pullRequests = JSON.parse(await readFile(requiredEnvironment("DAUVA_PULL_REQUESTS_PATH"), "utf8"));
    const result = resolvePublicationMerge(event, pullRequests);
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(
        process.env.GITHUB_OUTPUT,
        result
          ? `publication-id=${result.publicationId}\ncommit-sha=${result.commitSha}\nprevious-commit-sha=${result.previousCommitSha}\ntarget-ref=${result.targetRef}\n`
          : "publication-id=\n",
        "utf8",
      );
    }
    process.stdout.write(result ? "A single exact Seed publication merge was found.\n" : "No Seed publication merge was found.\n");
  } catch (error) {
    process.stderr.write(`Seed publication merge refused: ${String(error?.message ?? "unknown").slice(0, 240)}\n`);
    process.exitCode = 1;
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new TypeError(`${name} is required.`);
  return value;
}
