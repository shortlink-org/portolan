# Authoring flows

Use an authored `.flow.md` when source extraction cannot state the journey: a
design path, an incident reconstruction, or an integration scenario maintained
as documentation. Put one flow in one file and run it through `extract-flows`.

The catalog distinguishes four sources of knowledge:

- **authored** — a person declares the intended sequence;
- **extracted** — a plugin proves steps and triggers from source;
- **observed** — recordings raise steps to verified and add examples;
- **composed** — Portolan joins extracted fragments at evidence-backed seams.

## Minimal flow

```markdown
# Place order
owner: shop

The customer submits an order and OMS publishes the accepted fact.

## Steps
client -> shop.oms: rpc shop.v1.Orders/Place #place
shop.oms -> bus: event shop.oms.order.OrderPlaced #published
```

`owner` is the top-level context that files the flow. `source` and `slug` are
optional; they default to the `.flow.md` file and its filename.

An optional source-backed or authored execution root uses
`trigger: <kind> <confidence> ["label"]`, for example
`trigger: http high "POST /orders"`. Kinds are `http`, `callback`, `event`,
`message`, `job`, `startup`, `scheduled`, `manual`, and `unproven`; confidence
is `high`, `medium`, or `low`.

## Participants

Services written as `context.service`, plus `client` and `bus`, are inferred.
Declare every other lane in display order:

```markdown
## Participants
- customer: actor
- orders-db: store in shop ref shop.oms.pg "orders database"
- carrier: external ref delivery.carrier "carrier API"
```

The optional `ref` is a canonical Service, Store or External id. Use it whenever
the lane id is a readable alias; it powers entity links and backlinks.

## Steps

```text
from -> to: [call|rpc|event] label-or-ref [trailers]
```

The default kind is `call`. RPC and event refs use their catalog ids. Trailers
may appear in any order:

| Trailer | Meaning |
| --- | --- |
| `as "label"` | readable label without changing the ref |
| `[declared|verified|unresolved]` | trust level; default `declared` |
| `@file:line` | source or recording location |
| `via-store <id> <operation> [keyspace]` | canonical store access |
| `#stable-id` | stable deep-link id |

Store operations are `read`, `write`, `delete`, `exists`, `expire`, or `count`.
Give important steps explicit ids: generated numeric ids change when lines are
inserted before them.

Indented `> text` lines add a note to the preceding step.

## Frames

```markdown
alt accepted #decision
  shop.oms -> bus: event shop.oms.OrderAccepted
else rejected
  shop.oms -> client: call reject
  stop
end

par notify and reserve
  shop.oms -> bus: event shop.oms.OrderAccepted
and
  shop.oms -> shop.stock: rpc shop.v1.Stock/Reserve
end

loop until the outbox is empty
  shop.oms -> orders-db: read outbox via-store shop.oms.pg read outbox:*
end
```

Exactly one `alt` branch runs. `stop` must be the last item in a branch and
marks it terminal. `par` branches run independently. `loop` repeats its body.
Frames may nest.

## Complete executable example

The parser's golden fixture is
[`plugins/extract-flows/testdata/golden.flow.md`](../plugins/extract-flows/testdata/golden.flow.md).
It covers a terminal alternative, parallel and loop frames, RPC, events,
canonical store access, stable ids, and an intentionally unresolved external.
The extractor test parses that file directly, so documentation syntax cannot
drift from the implementation unnoticed.

## Failure behavior

Syntax errors fail extraction with file and line. Cross-file resolution happens
after every fragment is merged: a non-unresolved RPC/event ref, participant
`entityRef`, or store access must resolve in the selected catalog profile.

Authored syntax deliberately does not manufacture source-only evidence such as
`entrypoint`, `reaches`, asynchronous handoff provenance, HTTP response shapes,
or trace counts. Extractors and verifiers own those fields.
