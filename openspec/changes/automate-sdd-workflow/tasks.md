# Tasks

## 1. Zero-config SDD discovery

- [x] 1.1 Add high-confidence OpenSpec detection to local project discovery using `.openspec.yaml` markers and cover standard, empty and malformed layouts.
- [x] 1.2 Add an automatically selected `sdd` extraction plan with project-root input and omitted default options; ensure an explicit step suppresses the implicit duplicate.
- [x] 1.3 Run discovery and extraction against Portolan's own change and the read-only Gavel project fixture.

## 2. Git history and branch model

- [x] 2.1 Define a derived specification-history model that references source artifacts without adding Git metadata to `specs[]`.
- [x] 2.2 Reuse the host history reader to resolve first/latest commit, author, date and uncommitted state for change artifacts, including unavailable reasons.
- [x] 2.3 Extend branch catalog diff with requirement, scenario, task and lifecycle changes using stable identifiers.

## 3. Automatic path impact

- [x] 3.1 Derive changed repository paths for the active comparison using the existing branch draft/history pipeline.
- [x] 3.2 Resolve each path to the longest unique repository/service owner and preserve repository-level ambiguous or unmatched results.
- [x] 3.3 Present impact as `changed with` on specification and Changes pages without promoting it to implementation evidence.

## 4. Exact links

- [x] 4.1 Implement a parser for exact catalog IDs, repository paths, `path:line`, URLs and same-change requirement/task identifiers.
- [x] 4.2 Resolve parsed references through canonical routes and source-link rules; retain unresolved exact references for diagnostics.
- [x] 4.3 Render exact links in proposal, design, requirements, scenarios and tasks while proving that similar display names remain plain text.

## 5. Activity feed

- [ ] 5.1 Define stable activity events for Git commits, spec diffs, lifecycle transitions, task transitions and path impact.
- [ ] 5.2 Build a deterministic projector shared by the specification detail page, Changes page and generated Markdown/LLM summaries.
- [ ] 5.3 Add the activity timeline to `/specs/:id` with source and architecture links plus explicit evidence labels.

## 6. Search and navigation

- [ ] 6.1 Add changes, requirements and scenarios to the global palette/search index with stable IDs and section anchors.
- [ ] 6.2 Add exact requirement/scenario anchors, breadcrumb labels and backlinks without indexing entities removed from the current catalog.
- [ ] 6.3 Verify keyboard navigation and responsive rendering for list, detail, activity and search results.

## 7. Integrated verification

- [ ] 7.1 Run focused extractor, discovery, history, diff, link-resolution, search and UI tests.
- [ ] 7.2 Run `npm run typecheck`, schema generation/check, catalog generation and the required rendered UI verification with cache busting.
- [ ] 7.3 Confirm the external Gavel tree is unchanged and document which results are source intent, derived impact and independent evidence.
