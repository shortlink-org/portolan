# Work items: implementation plan and UI

Portolan connects a task to the architecture it explains. One task can affect
several flows, steps, services and decisions; each of those can change in many
tasks. Task identity includes the tracker instance so two servers' RT-101s do
not collide. Work items and links are optional catalog collections.

## First delivery

1. Add the shared catalog contract, Go mirror, merge, validation and profile
   scoping for work items and evidence-bearing links.
2. Ship `work-items`, a host verifier. Read bounded local Git history, recognize
   configured tracker references, and join changed paths to source files
   and service directories. Keep each commit's repository, SHA, subject,
   author, date and matching paths. Explicit links can be authored as catalog
   fragments, including tasks without a commit.
3. On a flow, keep task context in its own row: one task's key, title and
   status snapshot, followed by a `+N tasks` overflow control. A separate
   collapsed Evidence row summarizes the source and recordings; expanding it
   exposes grouped source actions, recordings and backlinks. Context pills
   belong with the flow title. Other pages retain two task chips plus overflow.
   Clicking a task opens an accessible, scrollable popover with task links,
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

### Settings UI

Settings → Integrations → Task trackers configures one verifier per Git
checkout, with several tracker instances supported in each verifier. The local
form saves to `portolan.json` through the localhost-only API, with a manifest
revision check. It never stores tracker configuration or tokens in localStorage.
`Save & rebuild` starts the normal generator and diagram refresh; saving only
configuration is also available. Failures are distinguished from a saved
configuration. Reload settings explicitly after a revision conflict.

Catalog scope is a compact multi-select. `Full scan` on a saved repository
runs the generator with a one-run override for that verifier; `Save & full
scan` first saves the form. Both ignore `maxCommits` for this invocation only.
Git history is read in pages against the HEAD commit pinned at scan start.
No fetch is performed: shallow repositories remain incomplete and report it.
Other verifiers retain their normal limits, and subsequent regular builds
use the saved limit again (so older links may disappear from their output).

The form accepts a provider, display name, stable tracker ID, HTTP(S) base address,
project prefixes, key format and task URL template. A live test uses exactly
the Git verifier's detector; it performs no network request and does not claim
that the task exists. Provider defaults are:

| Provider | Base address | Keys | Default URL |
| --- | --- | --- | --- |
| YouTrack | Instance, including optional context path | `RT-101` | `{baseUrl}/issue/{key}` |
| Jira | Instance, including optional context path | `RT-101` | `{baseUrl}/browse/{key}` |
| Linear | Workspace, e.g. `https://linear.app/team` | `RT-101` | `{baseUrl}/issue/{key}` |
| GitHub Issues | Repository, e.g. `https://github.com/owner/repo` | `#123`, `owner/repo#123` | `{baseUrl}/issues/{number}` |
| GitLab Issues | Project, including nested groups | `#123`, `group/subgroup/project#123` | `{baseUrl}/-/issues/{number}` |

GitHub/GitLab use `projects: []` and the fixed `#{number}` format. Only one
tracker per checkout may accept short references; set `matchBareNumbers: false`
on others to accept only qualified references to their configured project.
Qualified references normalize to the same `#123` key and are deduplicated.
GitLab `!123` merge requests are excluded. GitHub shares number references
between issues and pull requests, so this offline detector cannot verify the
resource type or existence. Self-hosted GitHub/GitLab addresses are supported.
The detector reads reference tokens, not full issue URLs.

URL/reference conventions: [Jira](https://support.atlassian.com/jira-align/kb/view-in-jira-links-fail-with-cannot-open-project-issue-with-characters-in-the-url-on-jira-align/),
[Linear](https://linear.app/developers/graphql),
[GitHub](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls),
[GitLab](https://docs.gitlab.com/user/markdown/).

Prefixed key formats allow 1–4 literal separator characters
from `- _ : # / .`; arbitrary regex is intentionally unsupported. Task links
encode the key and must stay on the configured tracker host.

Only known checkout roots inside the workspace are selectable. Nested source
directories cannot inherit their enclosing checkout's history. New verifiers
write under `portolan-work-items/`, with explicit source entries in the union
and selected catalog profiles. Existing manually scoped verifiers retain their
source setup. Removing all trackers retains a disabled verifier that overwrites
its fragment with empty work-item collections on the next generation, clearing
stale links without deleting files in the settings request.

Published catalogs show an allowlisted read-only configuration and offer a
copyable manifest snippet. Merge snippets into the existing manifest (do not
replace it) and include the output sources in the intended catalog profiles.
Titles, statuses and assignees still require the future API-enrichment step.

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
repository (the same convention as source links), with its service's repository
checked before any automatic match. Service directory links use `service.path`.
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

Run `node scripts/work-items-preview.mjs` to open the real flow and service
pages with this fixture. The dedicated server marks the UI as Demo and injects
the fixture in memory. It does not alter source catalogs or production builds.
Start at `http://127.0.0.1:5191/flows/gen?catalog=portolan`.

## Following deliveries

- Optional YouTrack API enrichment: allowlisted fields, explicit refresh time,
  server-side credentials, cached snapshots and clear unavailable/stale states.
  A private task's details must not silently enter a public catalog.
- More precise associations from changed hunks and symbol history, plus
  explicit metadata in authored `.flow.md` files and PR references.
- Reverse navigation from task to affected entities; Changes grouped by task;
  event, RPC and store surfaces; opt-in task highlighting on diagrams.
- API adapters for the supported trackers sharing the same work-item model.

The first delivery is useful without these extensions. Branch names alone
cannot establish which existing entities changed; blame only describes the
last surviving edit, not the full development history.

## First-delivery verification (2026-09-14)

- 19 focused Vitest checks passed: real temporary Git history, catalog
  validation and merging, profile isolation, and the plugin registry.
- TypeScript typecheck and the Go work-item round-trip test passed.
- `PORTOLAN_OFFLINE=1 npm run gen` and `npm run likec4:gen` completed.
  The generation run also reports existing unrelated flow-merge conflicts
  and extractor warnings; it completes successfully.
- The dedicated preview server was restarted after generation and the same
  flow URL reloaded with a cache-busting query. Visually inspected the actual
  flow diagram/header, expanded task/commit cards, step detail, service header
  and ADR header. Checked Enter/Escape, missing metadata, overflow, and a
  390 px viewport. Fixed chip truncation in the narrow step panel.

The rendered UI uses the labeled fictional fixture. Git extraction was tested
against temporary repositories, not a connected production YouTrack instance.
Real activation needs the estate's tracker URL and project prefixes. API
enrichment remains a following delivery.
