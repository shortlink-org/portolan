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

When a feature branch adds something main does not have yet (a flow, a step, a
service, an event), the reader should see it in the main catalog in its place,
marked `draft`, with the branch name and a link to the PR.

- Branch picker: one checkbox per feature branch, all off by default. The
  choice belongs to the reader and does not change the generated main catalog.
- A draft entity carries source evidence from its branch and disappears once
  the branch is merged or deleted.
- Conflict (one identifier changed both on main and in the branch): show both
  versions, the branch one marked `draft`.

Open questions: where the list of branches and PRs comes from (fetch-git, forge
API), where per-branch extraction is stored (a snapshot per branch), and how
"adds" is told apart from "changes".
