// This is coverage metadata, not a real-game qualification receipt. Exact
// runtime-image qualification still belongs to the authenticated proof flow.
export function nativeSettingsContractIssues(contract, seeds) {
  const errors = [];
  const issue = (message) => errors.push(`Native game settings: ${message}`);
  if (contract?.schemaVersion !== "dauva.dev/native-game-settings-contract/v1" ||
      contract?.leafCapability !== "native-game-settings-v1" ||
      !Array.isArray(contract?.profiles) || contract.profiles.length === 0) {
    issue("a versioned, non-empty native-game-settings-v1 contract is required.");
    return errors;
  }
  const mappings = new Map();
  const profiles = new Set();
  const images = new Set();
  for (const profile of contract.profiles) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile?.id ?? "") || profiles.has(profile.id)) {
      issue("profile identities must be valid and unique.");
    }
    profiles.add(profile?.id);
    if (!Array.isArray(profile?.images) || !profile.images.length ||
        !Array.isArray(profile?.seeds) || !profile.seeds.length) {
      issue(`${profile?.id}: non-empty image and Seed mappings are required.`);
      continue;
    }
    for (const image of profile.images) {
      if (typeof image !== "string" || !/^[a-z0-9.-]+\.[a-z]+\/[a-z0-9._/-]+$/.test(image) || images.has(image)) {
        issue(`${profile.id}: use a unique, fully qualified image repository without a tag or digest.`);
      }
      images.add(image);
    }
    for (const id of profile.seeds) {
      if (typeof id !== "string" || mappings.has(id)) issue("each Seed must map to exactly one settings profile.");
      mappings.set(id, profile);
    }
  }
  const knownSeeds = new Set(seeds.map((seed) => seed.id));
  for (const id of mappings.keys()) {
    if (!knownSeeds.has(id)) issue(`${id}: mapping does not refer to a current Seed.`);
  }
  for (const seed of seeds) {
    const profile = mappings.get(seed.id);
    if (!profile) {
      issue(`${seed.id}: add a tested Leaf settings integration and its contract mapping; see docs/game-settings-integration.md.`);
      continue;
    }
    const primary = (seed.components ?? []).filter((component) => component.role === "primary");
    if (primary.length !== 1 || primary[0].id !== "server") {
      issue(`${seed.id}: native settings require one primary component with identity server.`);
      continue;
    }
    const repository = primary[0].image?.split("@")[0].replace(/:[^/]+$/, "");
    if (!profile.images.includes(repository)) issue(`${seed.id}: primary image has no matching trusted settings profile.`);
  }
  return errors;
}
