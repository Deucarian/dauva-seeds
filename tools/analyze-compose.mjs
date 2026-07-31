import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createComposeAnalysis } from "./creator-lib.mjs";
import {
  readJson,
  readManifestDirectory,
  repositoryRoot,
} from "./registry-lib.mjs";

const referenceSeedId = optionValue("--reference-seed");
const seeds = referenceSeedId
  ? await readManifestDirectory("registry/seeds")
  : [];
const referenceSeed = referenceSeedId
  ? seeds.find((entry) => entry.value.id === referenceSeedId)?.value
  : null;
if (referenceSeedId && !referenceSeed) {
  throw new Error(`Reference Seed '${referenceSeedId}' does not exist.`);
}
const compose = JSON.parse(await readStandardInput());
const analysis = createComposeAnalysis({ compose, referenceSeed });
const schema = await readJson(
  path.join(
    repositoryRoot,
    "schemas",
    "seed-creator-analysis-v1.schema.json",
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(analysis)) {
  throw new Error(
    `Generated analysis is invalid:\n${(validate.errors ?? [])
      .map(
        (error) =>
          `- ${error.instancePath || "/"} ${error.message}`,
      )
      .join("\n")}`,
  );
}
process.stdout.write(`${JSON.stringify(analysis)}\n`);
process.stderr.write(
  `Sanitized ${analysis.components.length} Compose component(s); no values or host paths were emitted.\n`,
);

function optionValue(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return !value || value.startsWith("--") ? undefined : value;
}

async function readStandardInput() {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    value += chunk;
  }
  if (value.trim() === "") {
    throw new Error("Resolved Docker Compose JSON is required on standard input.");
  }
  return value;
}
