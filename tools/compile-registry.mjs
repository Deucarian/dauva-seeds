import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  compiledRegistry,
  readManifestDirectory,
  repositoryRoot,
} from "./registry-lib.mjs";

const podFiles = await readManifestDirectory("registry/pods");
const seedFiles = await readManifestDirectory("registry/seeds");
const proofFiles = await readManifestDirectory("proofs");
const registry = compiledRegistry(
  podFiles.map((entry) => entry.value),
  seedFiles.map((entry) => entry.value),
  proofFiles.map((entry) => entry.value),
);
const rendered = `${JSON.stringify(registry, null, 2)}\n`;
const outputPath = path.join(repositoryRoot, "dist", "registry.json");

if (process.argv.includes("--check")) {
  let existing = "";
  try {
    existing = await readFile(outputPath, "utf8");
  } catch {
    console.error("dist/registry.json is missing; run npm run compile.");
    process.exitCode = 1;
  }
  if (existing && existing !== rendered) {
    console.error("dist/registry.json is stale; run npm run compile.");
    process.exitCode = 1;
  }
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, rendered, "utf8");
  console.log(
    `Compiled ${registry.pods.length} Pods, ${registry.seeds.length} Seeds, and ${registry.proofs.length} proof receipts to dist/registry.json (${registry.registryDigest}).`,
  );
}
