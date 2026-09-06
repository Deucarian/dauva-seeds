import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { readJson, readManifestDirectory, repositoryRoot } from "./registry-lib.mjs";
import { nativeSettingsContractIssues } from "./native-settings-contract.mjs";

const leafPath = process.argv[2];
if (!leafPath || process.argv.length !== 3) {
  throw new Error("Usage: npm run settings:check-leaf -- <trusted dauva-leaf checkout path>");
}
const contractPath = path.join(repositoryRoot, "contracts/native-game-settings-v1.json");
const contract = await readJson(contractPath);
const seeds = (await readManifestDirectory("registry/seeds")).map((entry) => entry.value);
const errors = nativeSettingsContractIssues(contract, seeds);
if (errors.length) throw new Error(errors.join("\n"));
// This intentionally uses a local reviewed checkout: no network credentials,
// implicit installation, runtime changes, shell interpolation or live games.
const list = spawnSync(process.env.DAUVA_GO_EXECUTABLE || "go", ["test", "-list", "^TestSeedRegistrySettingsContract$", "./internal/gamesettings"], {
  cwd: path.resolve(leafPath), encoding: "utf8", shell: false,
});
if (list.error) throw list.error;
if (list.status !== 0 || !list.stdout.split(/\r?\n/).includes("TestSeedRegistrySettingsContract")) {
  throw new Error("The selected Leaf checkout has no runnable Seed Registry settings contract test. Use the compatible reviewed Leaf source.");
}
const result = spawnSync(process.env.DAUVA_GO_EXECUTABLE || "go", ["test", "-count=1", "./internal/gamesettings"], {
  cwd: path.resolve(leafPath), stdio: "inherit", shell: false,
  env: {...process.env, DAUVA_SETTINGS_CONTRACT: contractPath},
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
