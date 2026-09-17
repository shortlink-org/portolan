# Portolan roadmap

Open ideas and known problems of Portolan. A ticket is removed from the
roadmap when it lands.

## Statuses

- **open** — the problem is confirmed, there is no solution yet.
- **investigate** — the symptom is confirmed, but a solution model has to be
  chosen first.
- **source quality** — Portolan correctly reports a defect in the source
  project; the diagnostic can be improved or an explicit configuration added.

## P2 — extraction quality and UX

### PORTOLAN-21. Show feature branches in the main catalog as drafts

**Status:** open

A feature branch that changes a project is shown in the catalog next to main,
in the pages a reader already uses (portolan.0019).

- **Generate in dev.** `portolan dev` lists the branches of a project, checks
  out the branch tip and its `git merge-base` with main as worktrees, runs the
  project's extract steps in both, and compares the two catalogs by entity.
- **Save beside main.** One draft file per project and branch holds the base
  and branch version of every entity the branch added, changed or removed, the
  LikeC4 views of the flows it touched, and the branch, tip and base. A static
  site shows saved drafts; only `portolan dev` makes or deletes them.
- **Branches page.** Every saved draft of every project, with its changes,
  compare and delete. Stale, failed and gone branches are reported there.
- **Compare page.** The entities one branch changed, grouped by kind, each
  opening on the branch's version.
- **In the catalog.** A draft is off until the reader ticks it. The version on
  screen is in the address (`?v=<branch>`). Flow, event, aggregate and service
  pages read the branch's version of their entity and mark what differs on
  their own rows; an entity only the branch has opens on the same page. The
  context map, dependency graph, lists, sidebar and search mark drafts too.
- **Conflicts.** An entity main changed since the base, and the branch changed
  too, shows both versions. An entity two branches change says so.

Plan:

1. Draft file format and the entity diff: pure functions over base, branch and
   main catalogs, with tests. Flow steps get ids that survive an insertion.
2. Demo branches pushed to origin with real changes to the examples:
   `demo/auth-passkeys`, `demo/cart-coupons`, `demo/session-audit`.
3. Generation in dev: worktrees, per-project extract, `likec4 gen`, saving and
   deleting drafts through the local API.
4. The UI from the mock reads saved drafts; the mock data and its workarounds
   go.
5. Drafts of the demo branches saved in main and checked on the static site.

Steps 1-5 are done. Open: where the canvas is positioned when a reader moves
between versions.

### PORTOLAN-23. Drafts for an estate whose services live elsewhere

**Status:** open

A project vendored from another repository (`fetch-git`) has no branches in the
workspace, so it could not be drafted at all. It is drafted from a clone of its
own repository instead (portolan.0029): the project names a `clone`, dev lists
that repository's branches, and each side of the draft is the vendored snapshot
written at the branch's tip and at its merge-base.

Open:

- The branches page lists one branch per project. A task that touches several
  services is several drafts sharing a name and nothing else; they are not
  grouped, ticked or compared together.
- A branch that moved on the forge but not in the clone is reported fresh. Dev
  never fetches: what is on this machine is what is drafted.
- `clone` is a path that is true on one machine, committed in the manifest. A
  teammate without that checkout is told the clone is missing.

