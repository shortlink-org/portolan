# portolan.0010 — Provenance is read from the history, never written into a fragment

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-10
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0010-provenance-is-read-from-the-history-never-written-into-a-fragment.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0010-provenance-is-read-from-the-history-never-written-into-a-fragment.md)
- **Committed:** Victor Login, 2026-09-10 (`edb37fc`)
- **Supersedes:** [portolan.0002](portolan.0002.md)

### Context and Problem Statement

portolan.0002 had the host stamp every fragment with the last commit to touch
its input root, and that commit's date, so that a committed fragment was
reproducible and dated. Two things followed that were not wanted.

The stamp moved with every commit to the root, whether or not a fact changed:
a dependency bump under a service re-stamped its seven fragments, and
portolan's own fragments, rooted at the repository, moved with every commit
at all. And every generated page carried the merge's summary of those stamps -
`6 sources`, the oldest date - so one moved stamp rewrote every page. After a
run of focused fixes, `npm run gen` changed about 200 tracked files; 166 of
171 pages differed only in that line; and `gen --check` was red on the very
commit that had regenerated everything, because that commit had moved the
stamp again.

Underneath is a limit no stamp written into a file escapes: it cannot name
the commit the file lands in. Regenerated before the commit it is the parent;
regenerated after, it needs a second commit to catch up. Either way the
record of when a fact changed sits one commit away from the change.

### Decision Drivers

- Regenerating from the same sources must change no byte - from a fresh
  checkout or over an existing one.
- A change to one fact must change the fragment that carries it and the pages
  that show it, and nothing else.
- Provenance must stay exact: when a fact last changed, and in which commit.
- A plugin must know no clock and no repository (kept from portolan.0002).
- `gen --check` must say why an artifact is out of date.

### Considered Options

1. **Provenance is the history's.** Nothing is written into a fragment;
   whoever reads the catalog asks git when each source file last changed.
2. **Keep the stamp in the fragment, but keep the old one while the content
   stands.**
3. **Stamp from a hash of the input tree** instead of from a commit.
4. **Record the commit of the last generation in one file** and diff the
   inputs against it.

### Decision Outcome

Chosen option: **provenance is the history's**.

A fragment is content and nothing else. The request carries no `commit` and
no `generatedAt`; a plugin that used to copy them writes nothing in their
place. When the catalog is read - by `gen`, by the LikeC4 generator, by the
architecture diff, by the site as Vite builds it - the host asks the history
when each source file last changed (`scripts/history.mjs`, one `git log` per
checkout, cached for the process) and hands that to the merge as the source's
stamp. A file with uncommitted changes is `uncommitted` and dated by its
mtime; a file outside any repository is the same. A generated page carries
only the sentence that says it is generated; when it was generated, and from
what, is the page's own history.

`gen --check` explains drift with the same history. The commit that last
touched a step's output is when the output was last generated, and `git diff`
from there over the step's inputs - its root and the manifest, less the
output directories inside the root - lists what moved. When nothing did, the
plugin did. Beside that, every file that differs names the first path or line
where it does.

| | same sources, same bytes | fresh = incremental | says when | needs git to read |
|---|---|---|---|---|
| the history's | yes | yes | the commit the change landed in | yes |
| stamp kept while content stands | yes | no | the parent, or a second commit | no |
| hash of the input tree | yes | yes | never | no |
| recorded last-generation commit | yes | no | the parent | no |

Option 2 makes a stamp that depends on what was on disk before: a fresh
regeneration and an incremental one disagree, and neither names its own
commit. Option 3 dates nothing, and at the granularity of a root it is the
commit again under another name. Option 4 records what the history already
holds - the commit that last touched the output IS the last generation - and
a commit recorded before the commit it lands in is the parent, the same
off-by-one portolan.0002 had.

#### Consequences

- Good: `npm run gen` after unrelated commits is a no-op. A regenerated
  catalog lands in the same commit as the change that moved it, and
  `--check` is green on that commit.
- Good: two extractors on one root are dated separately, each by its own
  fragment's history.
- Good: `PORTOLAN_GENERATED_AT`, the vendored-copy stamp and the refusal of
  shallow clones leave the host; `stampFor` and `vendor-lock.mjs` are gone.
- Bad: reading provenance needs git where the catalog is read. The site gets
  it from a Vite plugin at build time. A shallow checkout dates everything by
  the one commit it has and says so once; the Pages workflow fetches the full
  history.
- Bad: a fragment from before this decision still carries a stamp. The merge
  takes the history's when it has one and the file's otherwise, so a copy
  vendored from an older portolan is dated by the fetch that brought it in -
  which is what freshness means to the estate that vendored it; the pin says
  which upstream commit that was.
- Neutral: the dev server re-reads provenance when a source changes, not when
  a commit is made; a commit shows after a restart.
