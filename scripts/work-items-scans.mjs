// Which work-items verifiers a reader asked to read without their commit
// limit, for this process (portolan.0020).
//
// Kept apart from work-items-history.mjs on purpose: the local API imports
// this, and `portolan init` loads the local API straight from the published
// package, where Node strips no TypeScript. The history reader loads the
// catalog, and with it the app's .ts modules; only Vite may import it.

const targets = new Set();
const listeners = new Set();

/**
 * Asks for the verifier `target` names to be read without its commit limit,
 * from now until the process ends, and tells every reader to read again.
 *
 * @param {string} target  as the work-items plugin's `fullScanTarget` spells it
 */
export function requestWorkItemsFullScan(target) {
  targets.add(target);
  for (const listener of listeners) listener();
}

/** @returns {string[]} */
export function workItemsFullScans() {
  return [...targets];
}

/**
 * @param {() => void} listener
 * @returns {() => void}  removes the listener
 */
export function onWorkItemsFullScan(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
