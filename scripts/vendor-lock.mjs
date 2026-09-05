// The commit a vendored copy is of.
//
// `stampFor` dates a fragment from the last commit that touched the directory
// it was read from, which is the right answer for code that lives here and the
// wrong one for code that does not. A service fetched out of another
// repository is stamped, without this, with the commit that VENDORED it: the
// estate then reports the service as fresh because somebody re-ran the fetch,
// and as unchanged when its own repository moved.
//
// The right answer is already on disk. `fetch-git` writes `git.lock.json`
// beside each copy, naming the commit it fetched, and a copy re-fetched at the
// same commit does not move it. Reading it here keeps the rule the host has
// always kept - the host works out the stamp, never the plugin - while making
// the subject of the stamp the code rather than the vendoring.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The file `fetch-git` writes beside every copy. Its name is that plugin's. */
export const LOCK = "git.lock.json";

/**
 * The commit `root` is a copy of, or null when it is not a copy of anything.
 *
 * Walks up from the directory the extractor was pointed at, because the lock
 * sits at the root of the repository's copy and the step reads a service some
 * way inside it: `vendor/repos/acme/shop/services/oms` is stamped by the lock
 * three levels above it. It stops at the repository root, so a run in a tree
 * with no vendored copies reads nothing and answers null.
 *
 * A lock naming other than exactly one repository is not one of these - the
 * fetcher writes one per directory - and is left to the fetcher to complain
 * about, which it does with the path and the count. Nothing here fails a run:
 * the caller has a git history to fall back on, and a stamp is not worth
 * refusing to describe an estate over.
 */
export function vendoredCommit(root, read = readFileSync) {
  for (let at = root; at && at !== "." && at !== "/"; at = dirname(at)) {
    let raw;
    try {
      raw = read(join(at, LOCK), "utf8");
    } catch {
      continue; // No lock here; the copy's root may still be above.
    }

    try {
      const lock = JSON.parse(raw);
      const [only, ...rest] = lock.repos ?? [];
      if (only?.commit && rest.length === 0) return only.commit;
    } catch {
      // Unreadable, which the fetcher reports against the copy itself.
    }

    return null;
  }

  return null;
}
