# portolan.0019 — A branch draft is generated in dev, compared from its merge-base and saved beside main

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-15
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0019-a-branch-draft-is-generated-in-dev-compared-from-its-merge-base-and-saved-beside-main.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0019-a-branch-draft-is-generated-in-dev-compared-from-its-merge-base-and-saved-beside-main.md)
- **Committed:** Victor Login, 2026-09-15 (`e183e55`)
- **Revised:** Victor Login, 2026-09-15 (`af83021`)

### Context and Problem Statement

A catalog built from main shows the estate as it is. A feature branch that adds
a flow, an event or a call to another system is invisible until it merges, and
the review of what it does to the architecture happens in a diff of source
files rather than in the catalog a reader already knows.

Showing a branch next to main raises three questions the catalog cannot answer
by itself: which catalog the branch has, what the branch changed as opposed to
what main changed since the branch was cut, and where that answer lives so a
published static site can show it without a server.

### Decision Drivers

- The reader compares a branch with main in the pages they already use, not on
  a separate page with its own vocabulary.
- A change main made after the branch was cut must not be shown as the
  branch's change.
- A published catalog is static; nothing can generate on the reader's request.
- A branch is regenerated with the extractors of the checkout that generates
  it, so a draft never needs a plugin build per branch.
- One repository holds many projects, and a branch is reviewed per project.

### Considered Options

- Compare the branch's committed fragments with main in the browser, loading
  them from the forge at runtime.
- Generate the branch in CI and read the result from a pipeline artifact.
- Generate the branch in `portolan dev` against its merge-base and save the
  result as a file in the repository.

### Decision Outcome

Chosen: generate in `portolan dev` and save the draft beside main.

A draft is one file per project and branch. `portolan dev` resolves the
branch's tip and `git merge-base` with main, checks both out as detached
worktrees, runs the project's extract steps in each, and compares the two
catalogs entity by entity. What the branch did - added, changed, removed - is
written with the base version and the branch version of every entity it
touched, together with the branch, its tip and the base. The LikeC4 views of
the flows the branch touched are generated in the branch worktree and saved in
the same file, so the site renders them with the renderer it already has.

The site overlays a saved draft on the catalog it is built from. An entity main
changed since the draft's base, and the branch changed too, is a conflict and
shows both versions. A draft is shown only when the reader ticks it, and the
version on screen is part of the address (`?v=<branch>`). Every page reads the
branch's version of its entity in the catalog's own shape and marks what
differs on the rows it already has; a page of its own is used only where there
is nothing in main to lay the branch over.

A draft stays until someone deletes it. The site does not track whether the
branch merged or still exists; `portolan dev` reports a branch that moved past
the saved tip, that failed to regenerate, or that is gone.

#### Consequences

- Good: the branch is read in the flow, event, aggregate and service pages the
  reader already knows, including on a static site.
- Good: the merge-base keeps main's own progress out of the branch's changes,
  and makes a conflict with main something that can be shown.
- Good: no forge token, CI minutes or artifact download stands between a reader
  and a draft.
- Bad: a draft is as fresh as its last generation; nothing refreshes it when
  the branch moves.
- Bad: a draft generated with the current extractors does not show a change the
  branch makes to an extractor itself.
- Bad: saved drafts are files in the repository and have to be deleted by hand.
- Neutral: flow steps at the base and on the branch are paired by what they
  do - their ends, kind and call - rather than by their positional ids, so a
  step inserted near the top reads as one added step rather than a renumbered
  flow. Extractors keep their ids as they are.
