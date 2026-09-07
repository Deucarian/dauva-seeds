import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const image = 'ghcr.io/deucarian/dauva-project-zomboid-runtime';
const repository = 'deucarian/dauva-project-zomboid-runtime';
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const accept = 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';

export function identity(version, revision, sourceTree) {
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) ||
      !/^[0-9a-f]{40}$/.test(revision) || !/^[0-9a-f]{40}$/.test(sourceTree)) throw new Error('invalid_release_identity');
  return { version, revision, sourceTree, resourceId: `${image}:${version}`, candidate: `candidate-${version}-${revision}` };
}

// The immutable source commit/candidate reference and version reference are the
// durable identities. An interrupted workflow resumes those references; it never
// blindly rebuilds or replaces an already accepted publication.
export async function publishRuntime(release, registry, actions, record = () => {}) {
  record({ state: 'accepted', ...release, formalSeedProof: false });
  try {
    let published = await registry.read(release.version);
    if (published) {
      await actions.verify(published, release);
      await registry.requirePublic(release.version, published);
      record({ state: 'completed', resourceId: release.resourceId, digest: published, resumed: true, formalSeedProof: false });
      return published;
    }
    let candidate = await registry.read(release.candidate);
    if (!candidate) {
      await actions.build(release);
      candidate = await registry.read(release.candidate);
      if (!candidate) throw new Error('build_outcome_unknown');
    }
    if (!digestPattern.test(candidate)) throw new Error('invalid_candidate_digest');
    await actions.verify(candidate, release);
    // New GHCR packages are private by default. Keep the version unpublished
    // until the exact tested candidate is anonymously accessible. A rerun reuses
    // that candidate after the package owner changes visibility.
    await registry.requirePublic(release.candidate, candidate);
    published = await registry.read(release.version);
    if (published) {
      await actions.verify(published, release);
    } else {
      await actions.promote(candidate, release.version);
      published = await registry.read(release.version);
      if (published !== candidate) throw new Error('publication_outcome_unknown');
    }
    await registry.requirePublic(release.version, published);
    record({ state: 'completed', resourceId: release.resourceId, digest: published, formalSeedProof: false });
    return published;
  } catch (error) {
    record({ state: 'needs-attention', resourceId: release.resourceId, candidate: release.candidate,
      outcomeUnknown: true, formalSeedProof: false });
    throw error;
  }
}

async function boundedResponse(url, headers) {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error('registry_response_too_large');
    chunks.push(chunk);
  }
  return { response, body: Buffer.concat(chunks) };
}

export function manifestResult(status, body, advertisedDigest) {
  const document = JSON.parse(body.toString('utf8'));
  if (status === 404 && Array.isArray(document.errors) && document.errors.length > 0 &&
      document.errors.every(error => ['MANIFEST_UNKNOWN', 'NAME_UNKNOWN'].includes(error.code))) return null;
  if (status !== 200) throw new Error('registry_observation_unavailable');
  const digest = 'sha256:' + createHash('sha256').update(body).digest('hex');
  if (!digestPattern.test(advertisedDigest ?? '') || advertisedDigest !== digest || document.schemaVersion !== 2 ||
      !accept.split(', ').includes(document.mediaType)) throw new Error('registry_manifest_binding_rejected');
  return digest;
}

async function registryToken(authorization) {
  const url = `https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:${authorization ? 'pull,push' : 'pull'}`;
  const { response, body } = await boundedResponse(url, authorization ? { Authorization: authorization } : {});
  if (response.status !== 200) throw new Error(authorization ? 'registry_auth_unavailable' : 'anonymous_access_unavailable');
  const token = JSON.parse(body.toString('utf8')).token;
  if (typeof token !== 'string' || token.length < 1 || token.length > 16384) throw new Error('registry_token_rejected');
  return token;
}

async function readManifest(reference, token) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(reference)) throw new Error('invalid_registry_reference');
  const { response, body } = await boundedResponse(`https://ghcr.io/v2/${repository}/manifests/${reference}`,
    { Authorization: `Bearer ${token}`, Accept: accept });
  return manifestResult(response.status, body, response.headers.get('docker-content-digest'));
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'Deucarian/dauva-seeds' ||
      process.env.GITHUB_REF !== 'refs/heads/main' || !['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) ||
      !process.env.GITHUB_TOKEN || !/^[a-zA-Z0-9_-]{1,80}(\[bot\])?$/.test(process.env.GITHUB_ACTOR ?? '')) throw new Error('unapproved_publication_context');
  const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
  const output = (command, args) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim();
  const revision = output('git', ['rev-parse', 'HEAD']);
  if (revision !== process.env.GITHUB_SHA) throw new Error('checkout_revision_mismatch');
  const release = identity(readFileSync('runtime/project-zomboid/VERSION', 'utf8').trim(), revision,
    output('git', ['rev-parse', 'HEAD:runtime/project-zomboid']));
  const authorization = 'Basic ' + Buffer.from(`${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}`).toString('base64');
  const token = await registryToken(authorization);
  const registry = {
    read: reference => readManifest(reference, token),
    async requirePublic(reference, expected) {
      const observed = await readManifest(reference, await registryToken());
      if (observed !== expected) throw new Error('anonymous_publication_not_confirmed');
    },
  };
  const actions = {
    async build(value) {
      run('docker', ['buildx', 'build', '--file', 'runtime/project-zomboid/Dockerfile', '--platform', 'linux/amd64',
        '--provenance=mode=max', '--sbom=true', '--label', `org.opencontainers.image.revision=${value.sourceTree}`,
        '--tag', `${image}:${value.candidate}`, '--push', 'runtime/project-zomboid']);
    },
    async verify(digest, value) {
      if (!digestPattern.test(digest)) throw new Error('invalid_published_digest');
      const exactImage = `${image}@${digest}`;
      run('docker', ['pull', exactImage]);
      const labels = JSON.parse(output('docker', ['image', 'inspect', '--format', '{{json .Config.Labels}}', exactImage]));
      if (labels['org.opencontainers.image.version'] !== value.version ||
          labels['org.opencontainers.image.revision'] !== value.sourceTree ||
          labels['org.opencontainers.image.source'] !== 'https://github.com/Deucarian/dauva-seeds') {
        throw new Error('published_version_source_conflict');
      }
      // Check the actual registry digest, never an independently rebuilt image.
      run('bash', ['runtime/project-zomboid/test-runtime.sh', exactImage]);
    },
    async promote(digest, version) {
      run('docker', ['buildx', 'imagetools', 'create', '--prefer-index=false', '--tag', `${image}:${version}`, `${image}@${digest}`]);
    },
  };
  await publishRuntime(release, registry, actions, entry => console.log(JSON.stringify(entry)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Never print fetch, registry or child-process objects carrying credentials.
    console.error('Runtime publication was not confirmed. Reconcile the same source/version references before resuming.');
    if (/^[a-z_]+$/.test(error.message)) console.error(error.message);
    process.exitCode = 1;
  });
}
