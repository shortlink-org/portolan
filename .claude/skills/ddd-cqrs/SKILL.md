---
name: ddd-cqrs
description: Separate commands from queries in a service built in layers — a use case is one or the other, a query answers with a read DTO and never the aggregate, and the read side grows from the aggregate's table to a view to an event-fed projection only as a question demands it. Use when adding a query, when a screen needs a shape the aggregate does not have, when a service needs another service's facts to answer, when deciding between a cache, a view and a projection, or when a projector is being written, in any language.
---

# Commands and queries

A use case is a command or a query. That one sentence is all of CQRS this
set of skills asks for; the rest is what follows from it when a question
outgrows the table the aggregate lives in.

## Rules

**A use case is a command or a query, never both.** A command changes one
aggregate by default and answers with what the caller needs to go on. A query changes
nothing and answers the question it was asked. The package name says which:
a verb for a command (`login`, `plan_route`, `issue_quote`), `get_`, `list_`
or `track_` for a query.

**A query writes nothing and publishes nothing.** No write unit of
work, no outbox, no event: reading is not a fact anybody reacts to. A reader may use a read-only transaction when its consistency contract needs
a stable snapshot. A read
that must leave a record (an audited disclosure, a "seen" mark) is a
command that also answers, and is named as one.

**A query answers with a read DTO, never the aggregate root.** The root
exists to run commands. Handed out, it invites a caller to run one on a copy
nobody will save, and it carries a version into a place where the version
means nothing. The output holds what the caller needs and nothing they could
build on by mistake ([ddd-use-case](../ddd-use-case/SKILL.md)).
`examples/auth/internal/user/application/get` is the shape. Check the actual target's result types before reporting a violation;
examples in other contexts may have evolved.

**The repository keeps the reads the commands need.** `ByID`, `ByToken`,
`ByUserID` exist because a decision loads through them. A read that only a
screen needs is not added to the domain's port: it is a `Reader` declared
in the query's own package, satisfied by an adapter at assembly, exactly as
a use case declares any other port it alone needs.

**The cheapest form that answers, and no cheaper.** Four forms, in the
order to try them:

| The question | Form | What the store holds |
|---|---|---|
| one aggregate, by its id | the repository's read, mapped to the DTO in the query | the aggregate's table |
| a set, a join, a count, and the table is fresh enough | a `Reader` port in the query package; a SQL reader adapter, optionally over a `CREATE VIEW` | tables, a view |
| an answer that is expensive, or asked far more often than it changes | a materialized view, refreshed by the command's adapter after its write or on a schedule | `CREATE MATERIALIZED VIEW`, drawn as one that can be stale |
| a shape assembled from events, across aggregates or across services | a projection table kept by a projector | a table with role `projection` |

Moving down the table buys a shape or a speed and pays in freshness. The
query's README says which form it is and what "now" means for its answer.

**A projection is built from events and from nothing else.** A documented retained log, or consistent snapshot plus its versioned suffix,
rebuilds the rows and checkpoints. Name retention and bootstrap procedures;
a cleaned outbox does not promise complete history. A projector never
reads another aggregate's table to fill a column: what it needs must be provided by the
public integration contract. Evolve that payload with an explicit schema
compatibility plan; do not expose private domain fields or query peer tables
to complete it. Schema versions are independent of stream positions.

**A projector is an adapter, not a policy.** Both subscribe to the bus. A
policy carries a decision and calls a use case; a projector carries none
and writes rows ([ddd-policy](../ddd-policy/SKILL.md)). It lives in
infrastructure, implements the bus's handler type, handles integration-event records under the ordered stream contract,
including explicit no-ops for known irrelevant positions. It calls no use case and no repository.

**A projector advances each stream strictly by version + 1.** Follow the
stream envelope and checkpoint contract in
[ddd-domain-event](../ddd-domain-event/SKILL.md). Apply only `lastVersion + 1`;
acknowledge versions already committed without repeating effects; park/recover
ahead-of-sequence records without applying them or advancing the checkpoint.
No occurred-at fallback and no jump to the latest version. This rule covers
both snapshot events and deltas.

Update the projection and its per-consumer, per-stream checkpoint in one local
transaction. Lock or compare-and-swap the checkpoint so concurrent deliveries
cannot apply twice. Multi-stream projections keep independent checkpoints;
versions from different aggregates are not comparable. An explicit supported
no-op advances the stream; unknown required types/schema versions stop it for
compatibility handling instead of silently losing a position.

**A projection runs after the commit, never inside it.** The projector
hangs off the bus behind the outbox, so the rows trail the aggregate by
the relay's lag. Whoever just ran a command reads their own write from the
command's answer, or through the first form; never from a projection.
"Read your own write" is not a promise a projection can keep.

**Freshness is written down.** A projection exposes processing time separately from business occurred-at
and the versions/checkpoints it reflects; a materialized view is drawn by the
catalog as one that can be stale; the query's README says so under
Answers. A reader who does not know an answer can be stale will build on it
as if it could not.

**The only copy of another service's facts is a projection.** A service
that needs the order's address to print a route subscribes to the order's
events and keeps the column, marked `-- from:` in its migration so the
catalog draws the lineage. It does not call the peer at query time to fill
a row, and nothing in the service writes to the copy on its own. The
storefront keeps no copy at all (`bff.0002`): a composition layer has no
store to keep one in, and a cache in front of a peer is not one either.

**A cache is not a read model.** A cache decorator answers the same port,
faster, and can be removed without anything above it noticing
([ddd-adapters](../ddd-adapters/SKILL.md), `auth.0008`). A projection
answers a different question and cannot be removed without removing the
query. Adding a cache changes no use case; adding a projection adds one.

**A command never reads a projection.** A decision is taken on the
aggregate, loaded through its repository, inside the unit of work. A
projection is a copy taken before the transaction began, the same reason
the cache is bypassed there ([ddd-unit-of-work](../ddd-unit-of-work/SKILL.md)).

## Placing the pieces

| Piece | Layer | Where |
|---|---|---|
| query use case | application | `<module>/application/<get_x>/`, beside commands; input/result types and README owned by the slice; verify extraction against the target layout |
| `Reader` port | application | `port.go` in the query's package |
| SQL reader | infrastructure | one package per reader, named after the query it serves |
| projector | infrastructure | one package per projection: the handler, the upsert, and the projection's migrations numbered from 1 |
| view, materialized view | infrastructure | a migration in the package of the aggregate whose tables it reads |
| subscription of projector to bus | assembly | beside the policy subscriptions, and nowhere else |

## The README of a query

The four sections every use case has ([ddd-use-case](../ddd-use-case/SKILL.md)),
and under **Answers** one more row: how fresh the answer is. "As of the
last commit", "as of the last refresh, at most a minute behind", or "as of
the last event projected; the row says when".

## Checklist

- Package is a command or a query; the name says which.
- A query holds no write unit of work, no publisher, no clock it does not read from.
- A query returns a slice-owned read DTO/result; never the root.
- A screen-only read is a `Reader` in the query package, not a repository method.
- The form is the cheapest that answers; the README names it and states freshness.
- Projection: retained history or snapshot plus suffix; integration records only; atomic rows/checkpoint and strict version + 1 per stream.
- Duplicates do nothing; gaps and unknown required records are recovered before advancing; subscriptions are wired in assembly.
- No command reads a projection; no projection is refreshed inside a command's transaction.
- Copies of foreign facts are projections with `-- from:` on the column; the storefront keeps none.

Language-specific: [references/go.md](references/go.md). How the catalog
draws the read side: [references/catalog.md](references/catalog.md).
