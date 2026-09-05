# org.0003 — Ownership is read from CODEOWNERS, never typed and never resolved

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-05
- **Scope:** org
- **Source:** `data/adr/0003-ownership-is-read-from-codeowners.md`

### Context and Problem Statement

"Who do I ask about this service?" is the question a catalog is opened for, and
until now the estate had no answer to it. `owner` on a flow, a store or a
module means the bounded context that holds it — a grouping, not a team — so a
reader who found the page they wanted still had to go and ask somebody where to
ask.

Every repository in the estate already answers it. Review rules are a file the
forge enforces: GitHub, GitLab and Gitea all read `CODEOWNERS` from the root,
from `.github/` and from `docs/`, and a team that owns a directory is a team
that gets the pull request. The answer exists; it was simply not in the catalog.

### Decision Drivers

- The answer must not be typed twice. A copy in the manifest is a copy that
  goes stale while the file the forge enforces moves on, and the stale one is
  the one on the page.
- It must work without a credential. The estate's documentation is built in CI,
  in forks, and offline; a step that needs a token is a step that fails for the
  contributor who most needs the page.
- It must not turn a red build into a question about a third party being up.

### Considered Options

1. **Read the file.** A step reads `CODEOWNERS` and matches its rules against
   the paths the catalog already holds.
2. **Ask the forge.** Call the API for a repository's teams and their members,
   and record people.
3. **Write owners in the manifest**, service by service.

### Decision Outcome

Chosen option: **read the file**, and record the handles it names — nothing
more.

A handle is what the file says and what a reviewer types into a request. It is
also all that can be known without a credential: turning `@acme/oms-team` into
the four people currently in it is option 2, which needs a token, answers
differently tomorrow, and puts a page nobody can rebuild behind somebody else's
outage. The catalog records `@acme/oms-team` and stops there.

Option 3 was rejected for the reason the whole estate is extracted rather than
authored: a fact typed in a second place is a fact that will disagree with the
first.

The step is a verifier rather than an extractor, because a rule is a path and
only the merged catalog knows where each service is. It earns the name twice
over: a service no rule matches, and a rule that matches no service, are both
reported — the second being the failure a `CODEOWNERS` file has and can never
report about itself, a team believing it owns something that is not there.

#### Consequences

- Good: ownership costs nothing to maintain. The file is already correct,
  because the forge enforces it on every pull request.
- Good: forge-agnostic. The same file means the same thing on three forges, and
  nothing here talks to any of them.
- Good: a rule that owns nothing is now visible, which it never was.
- Bad: a handle is opaque. The page cannot say who is in a team, and a reader
  who needs the people has to open the forge.
- Bad: GitLab's sections change whose rule wins, and the file is read the
  flatter way GitHub means. A file that uses them is warned about rather than
  half-understood in silence.
- Bad: an estate that keeps no `CODEOWNERS` gets no owners, and there is
  nothing to fall back on. That is the honest answer — ownership that is
  nowhere written down is ownership the estate cannot report.
