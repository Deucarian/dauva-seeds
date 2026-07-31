import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createCreatorProposal } from "./creator-lib.mjs";
import {
  readJson,
  readManifestDirectory,
  repositoryRoot,
} from "./registry-lib.mjs";

const analysisPath = requiredOption("--analysis");
const answersPath = optionValue("--answers");
const referenceSeedId = optionValue("--reference-seed");
if (answersPath && referenceSeedId) {
  throw new Error("Use either --answers or --reference-seed, not both.");
}

const analysis = await readJson(path.resolve(analysisPath));
const schema = await readJson(
  path.join(
    repositoryRoot,
    "schemas",
    "seed-creator-analysis-v1.schema.json",
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateAnalysis = ajv.compile(schema);
if (!validateAnalysis(analysis)) {
  throw new Error(
    `Leaf analysis is invalid:\n${(validateAnalysis.errors ?? [])
      .map(
        (error) =>
          `- ${error.instancePath || "/"} ${error.message}`,
      )
      .join("\n")}`,
  );
}

const answers = answersPath
  ? await readJson(path.resolve(answersPath))
  : undefined;
if (answers) {
  const answersSchema = await readJson(
    path.join(
      repositoryRoot,
      "schemas",
      "seed-creator-request-v1.schema.json",
    ),
  );
  const validateAnswers = ajv.compile(answersSchema);
  if (!validateAnswers(answers)) {
    throw new Error(
      `Creator answers are invalid:\n${(validateAnswers.errors ?? [])
        .map(
          (error) =>
            `- ${error.instancePath || "/"} ${error.message}`,
        )
        .join("\n")}`,
    );
  }
}
const seeds = await readManifestDirectory("registry/seeds");
const pods = await readManifestDirectory("registry/pods");
const referenceSeed = referenceSeedId
  ? seeds.find((entry) => entry.value.id === referenceSeedId)?.value
  : undefined;
if (referenceSeedId && !referenceSeed) {
  throw new Error(`Reference Seed '${referenceSeedId}' does not exist.`);
}
const referencePod = referenceSeed
  ? pods.find((entry) => entry.value.id === referenceSeed.podId)?.value
  : undefined;
const proposal = createCreatorProposal({
  analysis,
  answers,
  referenceSeed,
  referencePod,
});
const outputDirectory = path.resolve(
  optionValue("--output") ??
    path.join(
      repositoryRoot,
      "dist",
      "creator",
      safeDirectoryName(analysis.candidateName),
    ),
);
await mkdir(outputDirectory, { recursive: true });
await writeJson("review.json", proposal.report);
if (proposal.pod) {
  await writeJson("pod.json", proposal.pod);
}
if (proposal.seed) {
  await writeJson("seed.json", proposal.seed);
}
if (proposal.proofPlan) {
  await writeJson("proof-plan.json", proposal.proofPlan);
}

console.log(
  proposal.seed
    ? `Created a reviewed ${proposal.report.mode} proposal in ${outputDirectory}.`
    : `Recognized ${proposal.report.existingSeed.seedId} ${proposal.report.existingSeed.seedVersion}; no duplicate Pod or Seed was created.`,
);
if (proposal.report.unresolved.length > 0) {
  console.log(
    `${proposal.report.unresolved.length} review item(s) remain before proofing.`,
  );
}

async function writeJson(name, value) {
  await writeFile(
    path.join(outputDirectory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

function requiredOption(name) {
  const value = optionValue(name);
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return !value || value.startsWith("--") ? undefined : value;
}

function safeDirectoryName(value) {
  return (
    String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "proposal"
  );
}
