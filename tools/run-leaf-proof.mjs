import { mkdir, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import process from "node:process";
import { readJson, repositoryRoot } from "./registry-lib.mjs";

const seedId = requiredOption("--seed");
const seed = await readJson(
  path.join(repositoryRoot, "registry", "seeds", `${seedId}.json`),
);
const leafUrl = (
  optionValue("--leaf-url") ??
  process.env.DAUVA_LEAF_URL ??
  ""
).replace(/\/+$/, "");
const token = process.env.DAUVA_LEAF_TOKEN ?? "";
if (!leafUrl.startsWith("https://") && !leafUrl.startsWith("http://127.0.0.1")) {
  throw new Error("DAUVA_LEAF_URL must use HTTPS or loopback HTTP.");
}
if (token.length < 32) {
  throw new Error("DAUVA_LEAF_TOKEN must contain at least 32 characters.");
}
if (process.env.DAUVA_PROOF_ACCEPT_AGREEMENTS !== "true") {
  throw new Error(
    "Set DAUVA_PROOF_ACCEPT_AGREEMENTS=true after reviewing every Seed agreement.",
  );
}

const options = Object.fromEntries(
  seed.inputs.map((input) => [
    input.key,
    input.type === "agreement" ? "true" : input.defaultValue ?? "",
  ]),
);
for (const secret of seed.secrets.filter(
  (candidate) => candidate.source === "admin",
)) {
  const environmentName = `DAUVA_PROOF_SECRET_${secret.key
    .replaceAll("-", "_")
    .toUpperCase()}`;
  const value = process.env[environmentName];
  if (!value) {
    throw new Error(`Set ${environmentName} for this disposable proof.`);
  }
  options[secret.key] = value;
}

const maxWaitSeconds = Number(optionValue("--max-wait") ?? 1800);
const backupWaitSeconds = Number(optionValue("--backup-wait") ?? 0);
const response = await postJson(
  `${leafUrl}/v1/proofs`,
  {
    seedId,
    resourcePresetId:
      optionValue("--preset") ?? seed.resources.defaultPresetId,
    options,
    maxWaitSeconds,
    backupWaitSeconds,
  },
  token,
  (maxWaitSeconds + backupWaitSeconds + 600) * 1000,
);
const result = JSON.parse(response.body);
if (response.statusCode < 200 ||
    response.statusCode >= 300 ||
    result.succeeded !== true ||
    !result.receipt) {
  throw new Error(
    result.message ?? `Leaf proof failed with HTTP ${response.statusCode}.`,
  );
}
delete result.receipt.receiptDigest;
const output = path.resolve(
  optionValue("--output") ??
    path.join(
      repositoryRoot,
      "proofs",
      `${seed.id}-${seed.version}.json`,
    ),
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result.receipt, null, 2)}\n`, "utf8");
console.log(result.message);
console.log(`Wrote ${output}.`);

function postJson(url, value, bearerToken, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(value);
    const request = (
      target.protocol === "https:" ? httpsRequest : httpRequest
    )(
      target,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearerToken}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks = [];
        let receivedBytes = 0;
        response.on("data", (chunk) => {
          receivedBytes += chunk.length;
          if (receivedBytes > 2 * 1024 * 1024) {
            request.destroy(new Error("Leaf proof response exceeded 2 MB."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Leaf proof request timed out."));
    });
    request.on("error", reject);
    request.end(body);
  });
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
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}
