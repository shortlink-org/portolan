# Design

## Context

SDD in Portolan is a read-only control plane. Source artifacts belong to OpenSpec; Portolan extracts them, joins them to known facts, and exposes the provenance of every relationship. Zero-config means following standard conventions, not applying hidden heuristics.

## Goals

- Provide a useful SDD experience as soon as `openspec/` is added to a Git repository.
- Reuse the existing history, branch draft, catalog index, source-link, and command-palette mechanisms.
- Preserve strict boundaries between intent, related change, declared architecture, test evidence, and runtime observation.
- Make every automatically derived conclusion reproducible and explainable.

## Non-goals

- Do not infer conformance from task completion, co-commit history, or similar text.
- Do not guess an architecture entity from its display name.
- Do not write Git metadata into a source fragment.
- Do not modify OpenSpec files, task state, or archive layout.

## Decisions

### 1. Discovery follows a standard layout

Local discovery considers SDD present only when `openspec/changes/<change>/.openspec.yaml` exists. The detection is selected automatically and creates an `sdd` step with the project root as input; the `root` option is omitted when the standard name is used. An empty directory or a Markdown file with a similar name does not count as SDD.

CLI generation outside setup also gains a convention-based implicit step when the manifest does not already contain SDD output for the same project root. An explicit step always takes precedence and prevents duplicate extraction.

### 2. Git history is derived beside the fragment

The extractor remains a deterministic tree → fragment function. The host reads history for the source paths of the change, proposal, design, requirements, and tasks, then provides the UI with derived records: first commit, latest commit, author, date, and current uncommitted state. Shallow or absent history produces an explicit unavailable state, not invented dates.

### 3. Path impact is ownership, not conformance

For the selected branch/range the host obtains changed paths. A path affects a service only when it is inside that service's repository and declared `path`; the longest matching service path wins. Contract, deployment and documentation paths use their existing catalog owners. Shared or ambiguous paths remain repository-level impact.

The UI labels this relation `changed with`, never `implements`. It can support prioritization and navigation but cannot satisfy a requirement.

### 4. Text links require exact syntax

The linker recognizes:

- absolute web URLs;
- repository-relative file paths, optionally with `:line`;
- exact catalog IDs resolved through the catalog index;
- exact route-safe slugs only when the entity kind is stated by the source syntax;
- requirement/task identifiers defined inside the same change.

Unresolved exact references are retained and surfaced as problems. Ordinary prose and display-name similarity are never converted into links.

### 5. One derived activity model feeds every presentation

Activity events are normalized from Git commits, spec diffs, lifecycle transitions, task state transitions and path impact. Each event carries stable key, timestamp when known, source, kind and links. Stable ordering is timestamp descending, then kind and key. The `/specs/:id` feed, `/changes`, Markdown output and summaries consume the same model.

### 6. Search indexes intent as intent

Palette/search entries are added for change, requirement and scenario. Results retain their kind and route to the exact change section. Search ranking may use title, ID and exact source text, but must not manufacture relationships. Breadcrumbs and backlinks use the same stable anchors.

## Data flow

1. Discovery identifies a standard SDD root.
2. `extract-sdd` emits normalized author intent.
3. Merge and validation establish unique change, requirement and task identities.
4. Host-side Git enrichment derives history, branch diff and changed paths.
5. Exact-link resolution and ownership matching join intent to known catalog facts.
6. Activity, search and navigation project those derived facts without mutating the source model.

## Failure modes

- Missing Git history: specifications remain readable; history states why it is unavailable.
- Duplicate explicit/implicit step: the explicit step is used once.
- Ambiguous service ownership: impact stays at repository level and names the ambiguity.
- Broken exact reference: source text remains visible and Problems links back to its location.
- Removed requirement: branch diff retains the removed side without adding it to the current search index.

## Rollout

Implement vertically: discovery first, then history/impact, exact links, shared activity, and finally search/navigation. Each slice is tested against this repository's own OpenSpec change and the external Gavel fixture without modifying Gavel.
