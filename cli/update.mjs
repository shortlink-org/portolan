const PACKAGE_NAME = "@shortlink-org/portolan";
const LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME.replace("/", "%2F")}/latest`;

/**
 * Check the npm dist-tag once and return a newer release when one exists.
 * A registry outage must never keep the local development server from starting.
 */
export async function checkForUpdate(currentVersion, {
  fetchImpl = globalThis.fetch,
  timeout = 1_500,
} = {}) {
  try {
    const response = await fetchImpl(LATEST_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) return null;

    const latestVersion = (await response.json())?.version;
    return isNewer(latestVersion, currentVersion) ? latestVersion : null;
  } catch {
    // Starting the local catalog is useful offline too. The next dev process
    // gets another chance to check rather than persisting a failed attempt.
    return null;
  }
}

export function isNewer(candidate, current) {
  const next = semver(candidate);
  const installed = semver(current);
  if (!next || !installed) return false;

  for (let index = 0; index < 3; index += 1) {
    if (next.core[index] !== installed.core[index]) return next.core[index] > installed.core[index];
  }
  return comparePrerelease(next.prerelease, installed.prerelease) > 0;
}

function semver(value) {
  if (typeof value !== "string") return null;
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  if (!match) return null;
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split(".") ?? [],
  };
}

function comparePrerelease(left, right) {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) return 0;
    return left.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;
    const leftNumber = /^\d+$/.test(left[index]);
    const rightNumber = /^\d+$/.test(right[index]);
    if (leftNumber && rightNumber) return Number(left[index]) > Number(right[index]) ? 1 : -1;
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}
