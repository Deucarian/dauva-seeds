import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { identity, manifestResult, publishRuntime } from './publish-runtime.mjs';

const digest = 'sha256:' + 'd'.repeat(64);
const release = identity('1.0.1', 'a'.repeat(40), 'b'.repeat(40));
function fixture() {
  const refs = new Map();
  const calls = { build: 0, verify: 0, promote: 0, events: [] };
  const registry = {
    async read(ref) { return refs.get(ref) ?? null; },
    async requirePublic(ref, expected) { assert.equal(refs.get(ref), expected); },
  };
  const actions = {
    async build(value) { calls.build++; refs.set(value.candidate, digest); },
    async verify(value) { calls.verify++; assert.equal(value, digest); },
    async promote(value, version) { calls.promote++; refs.set(version, value); },
  };
  return { refs, calls, registry, actions, run: () => publishRuntime(release, registry, actions, e => calls.events.push(e)) };
}

test('publication checks the exact image before immutable version assignment and resumes it', async () => {
  const f = fixture();
  assert.equal(await f.run(), digest);
  assert.equal(await f.run(), digest);
  assert.equal(f.calls.build, 1);
  assert.equal(f.calls.promote, 1);
  assert.equal(f.calls.events[0].resourceId, release.resourceId);
  assert.equal(f.calls.events.at(-1).resumed, true);
  assert.equal(f.calls.events.at(-1).formalSeedProof, false);
});

for (const seconds of [10, 20, 100]) {
  for (const stage of ['build', 'promote']) {
    test(`${seconds}-second lost ${stage} response resumes its accepted reference without duplication`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 8, 7) });
      const f = fixture();
      const action = f.actions[stage];
      let first = true;
      f.actions[stage] = async (...args) => {
        await action(...args);
        if (first) {
          first = false;
          await new Promise((_, reject) => setTimeout(() => reject(new Error('lost_accepted_response')), seconds * 1000));
        }
      };
      const pending = assert.rejects(f.run());
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.calls.events.at(-1).state, 'accepted');
      t.mock.timers.tick(seconds * 1000);
      await pending;
      assert.equal(f.calls.events.at(-1).state, 'needs-attention');
      assert.equal(f.calls.events.at(-1).outcomeUnknown, true);
      assert.equal(await f.run(), digest);
      assert.equal(f.calls.build, 1);
      assert.equal(f.calls.promote, 1);
      assert.equal(f.calls.events.at(-1).resourceId, release.resourceId);
    });
  }
}

test('unknown registry observation cannot become absence or start a second build', async () => {
  const f = fixture();
  f.registry.read = async () => { throw new Error('observation_timeout'); };
  await assert.rejects(f.run());
  assert.equal(f.calls.build, 0);
  assert.equal(f.calls.promote, 0);
});

test('a private package retains the candidate and publishes no version until visibility is verified', async () => {
  const f = fixture();
  const check = f.registry.requirePublic;
  f.registry.requirePublic = async () => { throw new Error('anonymous_access_unavailable'); };
  await assert.rejects(f.run());
  assert.equal(f.refs.get(release.candidate), digest);
  assert.equal(f.refs.has(release.version), false);
  f.registry.requirePublic = check;
  await f.run();
  assert.equal(f.calls.build, 1);
  assert.equal(f.calls.promote, 1);
});

test('source conflict never overwrites an existing semantic version', async () => {
  const f = fixture();
  f.refs.set(release.version, digest);
  f.actions.verify = async () => { throw new Error('published_version_source_conflict'); };
  await assert.rejects(f.run());
  assert.equal(f.calls.build, 0);
  assert.equal(f.calls.promote, 0);
  assert.equal(f.refs.get(release.version), digest);
});

test('runtime fixture failure never publishes the semantic version', async () => {
  const f = fixture();
  f.actions.verify = async () => { throw new Error('fixture_failed'); };
  await assert.rejects(f.run());
  assert.equal(f.calls.promote, 0);
});

test('only authoritative not-found is absence; transport/auth failures and wrong hashes reject', () => {
  const missing = Buffer.from(JSON.stringify({ errors: [{ code: 'MANIFEST_UNKNOWN' }] }));
  assert.equal(manifestResult(404, missing), null);
  for (const status of [401, 403, 408, 429, 500, 502, 504]) assert.throws(() => manifestResult(status, missing));
  assert.throws(() => manifestResult(404, Buffer.from('{"errors":[]}')));
  const body = Buffer.from('{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[]}');
  const hash = 'sha256:' + createHash('sha256').update(body).digest('hex');
  assert.equal(manifestResult(200, body, hash), hash);
  assert.throws(() => manifestResult(200, body, digest));
});

test('publication identity cannot select another repository or mutable source', () => {
  assert.throws(() => identity('latest', 'a'.repeat(40), 'b'.repeat(40)));
  assert.throws(() => identity('1.0.1', 'main', 'b'.repeat(40)));
  assert.throws(() => identity('01.0.1', 'a'.repeat(40), 'b'.repeat(40)));
  assert.equal(release.resourceId, 'ghcr.io/deucarian/dauva-project-zomboid-runtime:1.0.1');
});
