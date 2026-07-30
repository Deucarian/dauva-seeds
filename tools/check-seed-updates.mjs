import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  readJson,
  readManifestDirectory,
  repositoryRoot,
} from "./registry-lib.mjs";
import {
  createUpdateReport,
  dockerDigestResolver,
  fixtureDigestResolver,
} from "./update-lib.mjs";

const fixturePath = optionValue("--fixture");
const outputPath = path.resolve(
  optionValue("--output") ??
    path.join(repositoryRoot, "dist", "update-report.json"),
);
const seedEntries = await readManifestDirectory("registry/seeds");
const resolver = fixturePath
  ? fixtureDigestResolver(await readJson(path.resolve(fixturePath)))
  : dockerDigestResolver;
const report = await createUpdateReport(seedEntries, resolver);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (report.updatesAvailable === 0) {
  console.log("All tracked Seed images are current.");
} else {
  console.log(
    `${report.updatesAvailable} component update(s) affect ${report.seedsWithUpdates} Seed(s):`,
  );
  for (const seed of report.seeds) {
    const components = seed.components
      .filter((component) => component.updateAvailable)
      .map((component) => component.id)
      .join(", ");
    console.log(`- ${seed.id} ${seed.currentVersion}: ${components}`);
  }
}
console.log(`Wrote ${outputPath}.`);

if (
  process.argv.includes("--fail-on-updates") &&
  report.updatesAvailable > 0
) {
  process.exitCode = 2;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

