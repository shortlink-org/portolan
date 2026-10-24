# Automate sdd workflow

*Generated from the portolan catalog. Do not edit by hand.*

- **ID:** `automate-sdd-workflow`
- **Format:** openspec
- **Lifecycle:** implementing
- **Source:** `openspec/changes/automate-sdd-workflow/proposal.md`
- **Checklist:** 15 / 21

> Checklist progress is author intent. It is not proof that code, runtime behavior, or the architecture catalog conforms to this specification.

## Activity

| Event | Evidence | Summary | Source |
| --- | --- | --- | --- |
| `spec.lifecycle` | Author intent | Lifecycle is implementing | `openspec/changes/automate-sdd-workflow/proposal.md` |
| `task.completed` | Author intent | 1.1 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:5` |
| `task.completed` | Author intent | 1.2 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:6` |
| `task.completed` | Author intent | 1.3 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:7` |
| `task.completed` | Author intent | 2.1 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:11` |
| `task.completed` | Author intent | 2.2 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:12` |
| `task.completed` | Author intent | 2.3 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:13` |
| `task.completed` | Author intent | 3.1 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:17` |
| `task.completed` | Author intent | 3.2 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:18` |
| `task.completed` | Author intent | 3.3 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:19` |
| `task.completed` | Author intent | 4.1 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:23` |
| `task.completed` | Author intent | 4.2 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:24` |
| `task.completed` | Author intent | 4.3 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:25` |
| `task.completed` | Author intent | 5.1 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:29` |
| `task.completed` | Author intent | 5.2 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:30` |
| `task.completed` | Author intent | 5.3 is marked complete | `openspec/changes/automate-sdd-workflow/tasks.md:31` |

## Proposal

*Source: `openspec/changes/automate-sdd-workflow/proposal.md`*

# Proposal

## Why

Portolan can already read normalized OpenSpec changes, but users still have to connect the extractor manually, and a specification remains an isolated screen without history, automatically derived impact, or shared navigation. SDD should become useful as soon as a standard directory appears in a repository, without `portolan.yaml`, hand-authored catalog IDs, or additional configuration.

## What Changes

- Detect supported SDD layouts automatically and connect the built-in extractor with safe defaults.
- Show the Git history of a change and its artifacts without writing provenance into the generated fragment.
- Identify affected components from changed paths and known repository and service path boundaries.
- Turn only exact textual references—catalog IDs, file paths, `path:line`, URLs, and known identifiers—into verifiable links.
- Build a deterministic activity feed from Git, specification diffs, checklists, and automatically derived impact.
- Include changes, requirements, and scenarios in global search, the command palette, breadcrumbs, and backlinks.

## Capabilities

### New Capabilities

- `automatic-sdd-workflow`: zero-config discovery, history, exact links, path impact, activity feed, search and navigation for supported SDD artifacts.

### Modified Capabilities

None. Existing extractor, catalog merge, architecture evidence, and branch draft semantics are extended without changing their current contracts.

## Impact

- **Local discovery/setup:** a standard `openspec/` layout becomes a high-confidence detection and creates an SDD extraction step automatically.
- **Catalog host:** Git history and branch diff remain external enrichment so identical source files continue to produce byte-identical fragments.
- **Catalog model:** SDD links, path impact, and activity are derived facts; author lifecycle and implementation evidence remain separate dimensions.
- **UI:** `/specs`, global search, the command palette, breadcrumbs, Changes, and backlinks gain SDD entries.
- **Safety:** free-form text is not used for semantic matching. Ambiguous names remain plain text or unresolved exact references.
- **Out of scope:** editing OpenSpec from Portolan, changing task checkboxes automatically, generating requirements with an LLM, Spec Kit or Kiro adapters, and claiming runtime conformance from path co-change alone.

## Design

*Source: `openspec/changes/automate-sdd-workflow/design.md`*

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

## Requirements

### Standard OpenSpec layouts are connected automatically

*Source: `openspec/changes/automate-sdd-workflow/specs/automatic-sdd-workflow/spec.md:5`*

Portolan SHALL detect a project containing `openspec/changes/<change>/.openspec.yaml` and SHALL include its normalized SDD fragment without requiring plugin options or a manually authored extraction step. An explicit SDD step for the same project SHALL take precedence and SHALL run only once.

#### Standard OpenSpec repository is discovered

- **WHEN** project discovery scans a repository with at least one standard OpenSpec change
- **THEN** SDD is selected with the project root as input and no redundant default options

#### Explicit configuration already exists

- **WHEN** the manifest already contains an SDD extraction step for the project
- **THEN** Portolan uses that step and does not add or run an implicit duplicate

### Specification history comes from Git

*Source: `openspec/changes/automate-sdd-workflow/specs/automatic-sdd-workflow/spec.md:16`*

Portolan SHALL derive first and latest change metadata for a specification and its source artifacts from repository history without writing that metadata into the extracted fragment.

#### Full history is available

- **WHEN** a specification source path has committed history
- **THEN** its page shows the first commit, latest commit, author and date with links to the exact source revision when repository information is available

#### History is unavailable

- **WHEN** the checkout is shallow, uncommitted-only or not a Git repository
- **THEN** the specification remains available and history is shown as unavailable with the reason

### Changed paths produce explainable impact

*Source: `openspec/changes/automate-sdd-workflow/specs/automatic-sdd-workflow/spec.md:27`*

Portolan SHALL relate branch changes to catalog components using repository identity and the longest exact owning path. The relation SHALL be presented as change impact and SHALL NOT be presented as implementation or conformance evidence.

#### Changed file belongs to one service

- **WHEN** a changed repository-relative file is under exactly one known service path
- **THEN** the specification activity links that service and explains the matching path

#### Changed file has no unique owner

- **WHEN** no service path matches or multiple owners remain equally specific
- **THEN** impact stays at repository level and Portolan does not choose a service

### Only exact textual references become links

*Source: `openspec/changes/automate-sdd-workflow/specs/automatic-sdd-workflow/spec.md:38`*

Portolan SHALL recognize web URLs, repository-relative paths with optional lines, exact catalog IDs, and same-change requirement or task IDs. Portolan SHALL preserve unresolved exact references and SHALL NOT link ordinary prose by semantic similarity.

#### Exact catalog ID resolves

- **WHEN** a specification artifact contains an exact ID present in the merged catalog
- **THEN** the rendered text links to that entity's canonical Portolan route

#### Similar display name is ambiguous

- **WHEN** prose contains a name that resembles one or more catalog entities but is not an exact identifier
- **THEN** the text remains prose and no relationship is created

#### Source path includes a line

- **WHEN** an artifact mentions a repository-relative `path:line` that exists inside the project root
- **THEN** the rendered link opens that exact source location

### Activity is deterministic and shared

*Source: `openspec/changes/automate-sdd-workflow/specs/automatic-sdd-workflow/spec.md:53`*

Portolan SHALL build one activity stream from Git history, spec diffs, lifecycle transitions, task transitions and path impact. The same normalized events SHALL feed the specification page, Changes presentation and generated summaries.

#### Several event kinds have the same timestamp

- **WHEN** activity events cannot be ordered by time alone
- **THEN** Portolan orders them deterministically by kind and stable key

#### A branch changes requirements and tasks

- **WHEN** the compared branch adds a requirement and completes a task
- **THEN** both events appear in the activity feed and Changes view with links to their source sections

### Specifications participate in global navigation

*Source: `openspec/changes/automate-sdd-workflow/specs/automatic-sdd-workflow/spec.md:64`*

Portolan SHALL index changes, requirements and scenarios for global search and command palette navigation. Results SHALL retain their SDD kind and SHALL navigate to a stable route or section anchor.

#### Requirement is found by title or ID

- **WHEN** a reader searches for an exact requirement ID or words from its title
- **THEN** the result is labeled as a requirement and opens that requirement on its specification page

#### Removed requirement exists only in a branch diff

- **WHEN** a requirement exists on the comparison base but not in the current catalog
- **THEN** it remains visible in Changes but is not added to the current global search index

### Automatic conclusions preserve evidence boundaries

*Source: `openspec/changes/automate-sdd-workflow/specs/automatic-sdd-workflow/spec.md:75`*

Portolan SHALL label author intent, changed-with impact, declared architecture, test evidence and runtime observation as separate states. Task completion, co-change and exact links SHALL NOT independently produce verified conformance.

#### Every task is checked

- **WHEN** a specification has a complete checklist but no runtime observation
- **THEN** lifecycle may be complete while conformance remains unverified

#### Code and specification changed together

- **WHEN** Git shows a code path and specification artifact in the same commit
- **THEN** Portolan records related change impact without claiming that the requirement is implemented

## Tasks

- [x] `1.1` Add high-confidence OpenSpec detection to local project discovery using `.openspec.yaml` markers and cover standard, empty and malformed layouts. — `openspec/changes/automate-sdd-workflow/tasks.md:5`
- [x] `1.2` Add an automatically selected `sdd` extraction plan with project-root input and omitted default options; ensure an explicit step suppresses the implicit duplicate. — `openspec/changes/automate-sdd-workflow/tasks.md:6`
- [x] `1.3` Run discovery and extraction against Portolan's own change and the read-only Gavel project fixture. — `openspec/changes/automate-sdd-workflow/tasks.md:7`
- [x] `2.1` Define a derived specification-history model that references source artifacts without adding Git metadata to `specs[]`. — `openspec/changes/automate-sdd-workflow/tasks.md:11`
- [x] `2.2` Reuse the host history reader to resolve first/latest commit, author, date and uncommitted state for change artifacts, including unavailable reasons. — `openspec/changes/automate-sdd-workflow/tasks.md:12`
- [x] `2.3` Extend branch catalog diff with requirement, scenario, task and lifecycle changes using stable identifiers. — `openspec/changes/automate-sdd-workflow/tasks.md:13`
- [x] `3.1` Derive changed repository paths for the active comparison using the existing branch draft/history pipeline. — `openspec/changes/automate-sdd-workflow/tasks.md:17`
- [x] `3.2` Resolve each path to the longest unique repository/service owner and preserve repository-level ambiguous or unmatched results. — `openspec/changes/automate-sdd-workflow/tasks.md:18`
- [x] `3.3` Present impact as `changed with` on specification and Changes pages without promoting it to implementation evidence. — `openspec/changes/automate-sdd-workflow/tasks.md:19`
- [x] `4.1` Implement a parser for exact catalog IDs, repository paths, `path:line`, URLs and same-change requirement/task identifiers. — `openspec/changes/automate-sdd-workflow/tasks.md:23`
- [x] `4.2` Resolve parsed references through canonical routes and source-link rules; retain unresolved exact references for diagnostics. — `openspec/changes/automate-sdd-workflow/tasks.md:24`
- [x] `4.3` Render exact links in proposal, design, requirements, scenarios and tasks while proving that similar display names remain plain text. — `openspec/changes/automate-sdd-workflow/tasks.md:25`
- [x] `5.1` Define stable activity events for Git commits, spec diffs, lifecycle transitions, task transitions and path impact. — `openspec/changes/automate-sdd-workflow/tasks.md:29`
- [x] `5.2` Build a deterministic projector shared by the specification detail page, Changes page and generated Markdown/LLM summaries. — `openspec/changes/automate-sdd-workflow/tasks.md:30`
- [x] `5.3` Add the activity timeline to `/specs/:id` with source and architecture links plus explicit evidence labels. — `openspec/changes/automate-sdd-workflow/tasks.md:31`
- [ ] `6.1` Add changes, requirements and scenarios to the global palette/search index with stable IDs and section anchors. — `openspec/changes/automate-sdd-workflow/tasks.md:35`
- [ ] `6.2` Add exact requirement/scenario anchors, breadcrumb labels and backlinks without indexing entities removed from the current catalog. — `openspec/changes/automate-sdd-workflow/tasks.md:36`
- [ ] `6.3` Verify keyboard navigation and responsive rendering for list, detail, activity and search results. — `openspec/changes/automate-sdd-workflow/tasks.md:37`
- [ ] `7.1` Run focused extractor, discovery, history, diff, link-resolution, search and UI tests. — `openspec/changes/automate-sdd-workflow/tasks.md:41`
- [ ] `7.2` Run `npm run typecheck`, schema generation/check, catalog generation and the required rendered UI verification with cache busting. — `openspec/changes/automate-sdd-workflow/tasks.md:42`
- [ ] `7.3` Confirm the external Gavel tree is unchanged and document which results are source intent, derived impact and independent evidence. — `openspec/changes/automate-sdd-workflow/tasks.md:43`
