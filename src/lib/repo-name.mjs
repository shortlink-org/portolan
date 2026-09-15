// A repository's name, the one way every reader compares two of them.
//
// A service says where it lives however its manifest or go.mod said it: a
// forge URL, `github.com/acme/shop`, or what git accepts over ssh. A pin says
// it the way fetch-git wrote it. The page, the build and the work-items
// verifier all ask whether two of those are one repository, and one spelling
// they reduce to is what keeps them from answering differently.

/**
 * A repository as `host/owner/name`, however it was spelled: a forge URL, a
 * go.mod path, `ssh://git@host:22/owner/name.git`, or the scp form
 * `git@host:owner/name.git`. Lower case, no `.git`, no trailing slash.
 *
 * @param {string} repo
 * @returns {string}
 */
export function bare(repo) {
  return String(repo ?? "")
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/^([^/:]+):\d+\//, "$1/")
    .replace(/^([^/:]+):(?!\/)/, "$1/")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .toLowerCase();
}

/**
 * The pin of the repository `repo` names, when something fetched it.
 *
 * @template {{repo: string}} Pin
 * @param {string} repo
 * @param {readonly Pin[]} pins
 * @returns {Pin | undefined}
 */
export function pinFor(repo, pins) {
  if (!repo) return undefined;
  const wanted = bare(repo);
  return pins.find((pin) => bare(pin.repo) === wanted);
}
