# Work items: implementation plan and UI

Portolan connects a task to the architecture it explains. One task can affect
several flows, steps, services and decisions; each of those can change in many
tasks. Task identity includes the tracker instance so two servers' RT-101s do
not collide. Work items and links are optional catalog collections.

## First delivery

1. Add the shared catalog contract, Go mirror, merge, validation and profile
   scoping for work items and evidence-bearing links.
2. Ship `work-items`, a host verifier. Read bounded local Git history, recognize
   configured YouTrack project keys, and join changed paths to source files
   and service directories. Keep each commit's repository, SHA, subject,
   author, date and matching paths. Explicit links can be authored as catalog
   fragments, including tasks without a commit.
3. Show the first two task chips and a `+N` overflow control beside flow
   evidence. Clicking opens an accessible, scrollable popover with task links,
   optional task metadata, commits and an explanation of the association.
   Reuse it in step details, service pages and ADR pages. Empty collections
   consume no space. Keyboard focus, Escape and narrow screens must work.
4. Verify extraction against a real temporary Git repository; check merge,
   validation and profile isolation; generate presentations and inspect the
   actual rendered chips and expanded popover in a dedicated example fixture.

File history is evidence that a commit touched the source file, not proof that
it implemented the flow or changed the selected line. The UI calls this
`source file changed`; a directory match is `service directory changed`.
Explicit links say `declared link`. Commit subjects never become task titles.
No association changes a flow step's execution confidence.

## Configuration

The built-in verifier uses the existing pipeline instead of introducing a
second top-level integration configuration:

```json
{
  "verify": [{
    "plugin": "work-items",
    "in": ".",
    "out": "portolan",
    "options": {
      "trackers": [{
        "id": "team",
        "provider": "youtrack",
        "baseUrl": "https://youtrack.example.com",
        "projects": ["RT"]
      }],
      "maxCommits": 500,
      "out": "work-items.json"
    }
  }]
}
```

Include the output in `sources` and the relevant catalog profile's sources.
`in` is the Git checkout; `repository` can override its origin's web URL.
Run one verifier per checkout. Source paths are resolved from each catalog
service's `path`, with its repository checked before any automatic match.
Vendored copies without their own Git history must not inherit the enclosing
checkout's commits. Shallow and bounded histories are reported as incomplete.
Unconfigured project keys produce no links. No network or credentials are
needed to generate issue links. YouTrack's direct issue navigation is described
in [JetBrains documentation](https://www.jetbrains.com/help/youtrack/cloud/issue-navigation.html).

Explicit fragments contain `workItems` and `workItemLinks` alongside the usual
empty `contexts`, `defs`, `flows` and `adrs`. A work item has `id`, `tracker`,
`provider`, `key`, `url`, and optional `title`, `status`, `assignee`, `updatedAt`.
A link names `workItem`, `target`, `basis` and `commits`. A step target includes
both the flow ID and the local step ID. Full examples live in the UI fixture
at `src/testing/fixtures/work-items.json`; its data is fictional and never
included in the default catalog.

## Following deliveries

- Optional YouTrack API enrichment: allowlisted fields, explicit refresh time,
  server-side credentials, cached snapshots and clear unavailable/stale states.
  A private task's details must not silently enter a public catalog.
- More precise associations from changed hunks and symbol history, plus
  explicit metadata in authored `.flow.md` files and PR references.
- Reverse navigation from task to affected entities; Changes grouped by task;
  event, RPC and store surfaces; opt-in task highlighting on diagrams.
- Additional tracker adapters sharing the same work-item model.

The first delivery is useful without these extensions. Branch names alone
cannot establish which existing entities changed; blame only describes the
last surviving edit, not the full development history.
