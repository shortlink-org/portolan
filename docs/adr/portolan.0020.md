# portolan.0020 — Task links are read from the history, never written into a fragment

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-15
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0020-task-links-are-read-from-the-history-never-written-into-a-fragment.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0020-task-links-are-read-from-the-history-never-written-into-a-fragment.md)

### Context and Problem Statement

The work-items verifier connects a task to what it changed: a commit whose
message names `SHO-7` touched a flow's source file, so the flow shows `SHO-7`,
and the task's card lists that commit, its subject, author, date and paths.
The verifier wrote those links into a fragment under `portolan-work-items/`,
and the fragment was committed like any other.

That is the record portolan.0010 took out of fragments, under another name. A
link names the commits that mention the task, and a file cannot name the
commit it lands in. A commit that changes a flow for `SHO-7` and carries the
regenerated catalog, as portolan.0010 asks, adds itself to the links the moment
it is made: `gen --check` is red on the commit that regenerated everything. A
second commit catches up only if its message names no task; if it names one,
it links itself and the check never agrees. A rebase moves every hash and the
links go stale again. Every task landed so far needed a regeneration commit
that was careful not to say what it was for.

### Decision Drivers

- A commit that changes a source for a task, with the catalog regenerated in
  the same commit, passes `gen --check` (kept from portolan.0010).
- The reader sees the task on the flows, steps, services and decisions it
  changed, including for the commit just made.
- Catalog profiles keep choosing which estates show which verifier's links,
  with the configuration the settings page already writes.
- A plugin knows no clock and no repository for provenance (portolan.0002,
  portolan.0010); the work-items scan reads a repository by design, and stays
  the only code that does.

### Considered Options

1. **The history's.** Nothing is generated; whoever reads the catalog asks the
   history which commits name which tasks, as it asks when a source changed.
2. **Leave out the commits that touch the output.** A commit carrying its
   regenerated links would not link itself.
3. **Keep writing the fragment, and leave it out of `gen --check`.**

### Decision Outcome

Chosen option: **the history's**.

The verifier's `run` writes nothing, and a fragment written by an earlier
version is swept by the next generation. `scanWorkItems` does what `run` did:
it reads the checkout's history against the merged catalog and returns the
links as a fragment in memory. `scripts/work-items-history.mjs` calls it for
every work-items verifier the manifest declares, where the catalog is read:

- the site gets the links from the virtual module `virtual:portolan-work-items`,
  built at build time and re-read under the dev server when a source changes,
  the same as `virtual:portolan-provenance`;
- each verifier's links keep the path the settings page writes
  (`<out>/<file>`), and a catalog profile shows them when its sources match
  that path, as before;
- a full scan from the settings page is a reading without the commit limit
  for that verifier until the dev server stops, and runs no generation.

Option 2 drops exactly the commits that follow the rule: a commit that changes
a flow for a task and regenerates the catalog touches the output, so the task
would never be linked to the change it describes. Option 3 keeps a file that is
wrong on every commit that matters, and a check that looks away from it checks
nothing.

#### Consequences

- Good: a task's commit is one commit. `gen --check` is green on it, a rebase
  changes nothing on disk, and a regeneration commit may say what it is for.
- Good: the links are never older than the checkout; the commit just made shows
  after a dev server restart or the next change to a source.
- Bad: reading task links needs git and the whole catalog where the site is
  built. The build reads the history for provenance already, and the Pages
  workflow fetches the full history for it.
- Bad: the generator's outputs - the markdown pages, LikeC4, exports - carry no
  task links. None drew them.
- Neutral: explicit links authored as catalog fragments are unchanged; they
  name no commit, and stay files.
