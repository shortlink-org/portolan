# portolan.0029 — A branch of a vendored service is drafted from a clone of its own repository

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-17
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0029-a-branch-of-a-vendored-service-is-drafted-from-a-clone-of-its-own-repository.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0029-a-branch-of-a-vendored-service-is-drafted-from-a-clone-of-its-own-repository.md)
- **Committed:** Victor Login, 2026-09-17 (`6191dd2`)

### Context and Problem Statement

A draft is generated from two worktrees of the workspace (portolan.0019): the
branch's tip and its merge-base with main. That holds for an estate whose
services live in the repository the catalog is built from, and for no other.

An estate whose services live in repositories of their own vendors them: a
`fetch-git` step writes a pinned snapshot of each service under
`vendor/repos/<owner>/<name>`, and the workspace holds text, not history. The
branches a reader wants to see are branches of `aviacore`, not of the catalog,
and the workspace has none of them. The feature that shows a branch beside main
is therefore unavailable exactly where an estate is largest: many repositories,
one catalog, one task touching several services at once.

Two facts make this more than a missing switch. A task spans repositories, so a
branch name is the only thing its drafts share, and two projects may be on a
branch of the same name that share nothing else. And the branch under review is
often not where the manifest points: it may be unpushed, or pushed to a remote
the manifest does not name, while the manifest names the repository the catalog
cites in its source links.

### Decision Drivers

- The comparison must stay the one portolan.0019 makes; only where the two
  sides come from may differ.
- A draft must be generatable without a forge token and without the branch
  being pushed anywhere.
- A source link in a draft must open the branch's commit on the forge the
  manifest names, not a path on somebody's laptop.
- A build, a check and a published site must need none of this: a clone is a
  fact about one machine.

### Considered Options

- Fetch the branch from the forge with the `fetch-git` step, pinning it to the
  branch tip.
- Make the catalog's own repository carry a branch per service branch.
- Read the branch out of a clone of the service's repository on this machine.

### Decision Outcome

Chosen: read it out of a clone.

A project may name a `clone`: a checkout of its `repository` on this machine,
relative to the workspace. `portolan dev` lists that project's branches there,
against that repository's own main, and offers only the branches whose changed
paths the snapshot takes.

Generating a draft of such a branch puts the service's tree where the snapshot
sits. Both sides are worktrees of the workspace at its current commit; what
differs between them is the vendored copy, written at the branch's tip on one
side and at its merge-base on the other, by the manifest's own `fetch-git`
step with the commit replaced and the tree read out of the clone instead of
fetched. The pin beside the copy keeps naming the repository the manifest
names, with the commit of that side, so the draft's source links open the
branch's commit on the forge. Everything after that - the extract steps, the
entity comparison, the views, the saved file - is portolan.0019 unchanged.

A clone is read, never written and never fetched into: what is on this machine
is what is drafted. A clone that is not there is reported on the branches page,
project by project, and the other projects are still drafted.

#### Consequences

- Good: an estate of many repositories gets branch drafts, and a task that
  touches four services is four drafts of one branch name.
- Good: a branch that was never pushed, or one pushed to a remote the manifest
  does not name, is drafted like any other.
- Good: nothing about a build changes; `clone` is read by `portolan dev` alone,
  and a published site never sees it.
- Bad: the draft is only as current as the clone. A branch that moved on the
  forge but not on this machine is drafted at the commit the clone has, and
  reported as fresh.
- Bad: a manifest now carries a path that is true on one machine. It is
  committed like everything else, and a teammate without that checkout is told
  the clone is missing rather than being shown a draft.
- Neutral: the workspace side of a vendored draft is its current commit, not a
  branch of the catalog. A change to the catalog's own extract steps is
  therefore in both sides of the comparison, which is what makes the service's
  commit the only difference.
