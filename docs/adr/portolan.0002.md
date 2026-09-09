# portolan.0002 — The host stamps a fragment from its input's last commit

*Generated from the portolan catalog · commit `5 sources` · at 2026-09-06T20:39:44+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-02
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0002-the-host-stamps-a-fragment-from-its-inputs-last-commit.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0002-the-host-stamps-a-fragment-from-its-inputs-last-commit.md)
- **Committed:** Victor Login, 2026-09-06 (`229c1fb`)

### Context and Problem Statement

A fragment says when it was read and at which commit, so the estate can be
dated and a source path can be a link. Who works that out?

The obvious answer is the extractor: read the clock, ask the repository for
its head. A clock makes a different fragment on every run, which cannot be
committed and cannot be checked. Version control in the plugin makes a plugin
that can never be sandboxed, and a plugin that reads its own output
directory's history stamps itself out of date on every run.

### Decision Drivers

- A committed fragment must be byte-identical across runs of the same source,
  so `--check` means something.
- A fragment must change exactly when its subject changes.
- A plugin must know no clock and no repository.
- A copy of another repository must be dated by the commit it is a copy of,
  not by when it was copied.

### Considered Options

1. **The host stamps from the last commit that touched the input root**,
   excluding the output directory when it sits inside that root.
2. **The extractor reads the clock and the repository** and writes what it
   found.
3. **No stamp; a content hash** — the fragment is dated by what it says.

### Decision Outcome

Chosen option: **the host stamps from the last commit that touched the input
root**.

| | reproducible | sandboxable | says when |
|---|---|---|---|
| host, from history | yes | yes | the last change to the subject |
| plugin, clock and repository | no | no | now |
| content hash | yes | yes | never |

What is given up is a stamp for a root that is the whole repository: every
commit anywhere moves it, so the fragment of a repository that describes
itself, portolan's own `portolan/project.json` included, is re-stamped after
every commit. That is accepted because it is true: every commit to the
repository is a commit to the component. A tree with no history is stamped
`uncommitted` with the wall clock, and `PORTOLAN_GENERATED_AT` pins that for
a build that must reproduce.

#### Consequences

- Good: `gen --check` is a real check; a fragment diffs only when its source
  does; a fetched repository is dated by the commit its lock names.
- Bad: a shallow clone cannot stamp, and the host refuses rather than guesses:
  fetch the full history first.
- Bad: two extractors on one root carry the same stamp even when only one's
  subject changed.
- Neutral: the stamp is the commit that last touched the directory, which is
  not the commit the code was built from.
