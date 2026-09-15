# portolan.0021 — An inferred HTTP verb links a call, at medium confidence

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-15
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0021-an-inferred-http-verb-links-a-call-at-medium-confidence.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0021-an-inferred-http-verb-links-a-call-at-medium-confidence.md)
- **Committed:** Victor Login, 2026-09-15 (`1a91a71`)

### Context and Problem Statement

A Django URLConf proves a path, and often nothing about the verb: a view
mounted as a plain function answers every verb Django routes to it.
`extract-django` reads the verb from what the code declares - decorators,
`http_method_names`, a branch on `request.method`, a project wrapper - and,
when none of those speaks, infers it from what the handler reads off the
request: `request.POST`, `request.FILES`, `request.body` or `request.read()`
mean POST, `request.GET` alone means GET.

The catalog had no way to say a verb was inferred. So the extractor kept the
inferred verb out of `provides` and left `http.method` empty there, carrying
it only in the OpenAPI export as `x-portolan-verb: inferred`. The merge
matches an outbound `http-client/<VERB> <path>` call against `provides` by
verb and path, and never against an empty verb, so a caller of such a route
stayed unresolved. On one real estate four routes were affected: two proxy
GETs and two upload POSTs.

### Decision Drivers

- A call that plainly reaches a route should link; an unresolved call on
  Problems that everyone knows the answer to trains readers to ignore it.
- A guess must not read as a declaration, on the route or on the link.
- The status vocabulary - verified, declared, unresolved - is read by the
  problem rules, the map and every chip; a fourth value costs all of them.
- A declared route, and every committed fragment, must read as it did.

### Considered Options

1. **The route carries the verb with its basis; the link keeps status
   `declared` and lowers its resolution confidence.**
2. **A new status, `inferred`,** on the call and the step.
3. **Keep the verb out of `provides`** and leave such calls unresolved.
4. **Write the verb into `provides` as if declared.**

### Decision Outcome

Chosen option: **1.**

An `HttpRoute` gains `methodBasis` - absent reads `declared`, `inferred` is a
verb no declaration names - and, for an inferred verb, `methodEvidence`: the
rule and where it was read, `{rule: "reads request.FILES", source:
"geo/views.py:64"}`. Validation refuses an inferred basis with no verb or no
evidence. The field is the same shape as `basis` elsewhere in the catalog:
who said so, with the default left unwritten.

The merge treats an inferred verb as a candidate like any other; an empty verb
still never is. A link made on one keeps status `declared`, because the route
it names is declared by the URLConf, and its `destination.resolution` carries
`confidence: medium` with the provider's `methodEvidence`. A link on a
declared verb writes no confidence, which reads `high`, and so every existing
resolution is unchanged. `confidence` uses the vocabulary a flow trigger and
a composition seam already use; `extract-django` already set its trigger to
`medium` for the same inference. When two fragments give the same method a
route on the same path, a declared verb replaces an inferred one, and either
replaces an empty one.

The page shows the lowered confidence and the reading in the step's HTTP
destination evidence, and a "verb inferred" mark beside the route on the
service's contract; generated Markdown says the same.

Option 2 was rejected because the uncertainty is in one part of one match, not
in whether the relationship is stated by source: the call site is read, the
route is mounted. A status would move every such edge out of the declared set
that the map and the problem rules count, for a fact the resolution can carry.
Option 3 left a known link unresolved. Option 4 made a guess indistinguishable
from a decorator.

A call that uses a different verb from the inferred one still does not link,
though Django would route it: the inference names the verb the handler is
written for, and a caller using another one is worth a look. A unique-suffix
match is also a heuristic and writes no confidence yet; it keeps saying so
through its basis.
