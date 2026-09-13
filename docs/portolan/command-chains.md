# Command consequences

On an aggregate's Commands list, expand **Then what** to follow a command's
possible event consequences. Each invocation and publication links to the
flow step that records it. Events link to their contracts, and consumers to
their services.

The command heading summarizes unique known events and downstream services
(excluding the command's own service). Missing evidence or a traversal limit
marks that count as partial; no linked publications reads **consequences
unknown**, not zero consequences. The entry-point row names the linked
HTTP/gRPC contract or the recorded event/schedule/internal trigger and links
to the invocation and its source. A handler source is shown beside the command
when the extractor provides one.

The link icon beside a command copies a URL with its `#command-…` anchor,
preserving the catalog profile. Opening that URL expands the command's
consequences. Initially only the nearest effects are shown; individual branches
can be expanded, with controls to expand all, collapse branches, or show only
gaps and unresolved links with their ancestry.

A command starts a chain only when a flow explicitly names its operation in
a `call` step, or names one of its provided `exposedBy` methods in an incoming
`rpc` step. The destination must identify the owning service; participant
`entityRef` aliases are supported. A matching label alone is insufficient.

An outbound RPC may follow a unique source-backed server flow whose opening
actor-to-service step carries the exact same method ref. Multiple candidate
server flows remain unjoined. The Rust extractor records fully qualified
gRPC method refs from the implemented proto and operation refs on the use-case
calls it resolves, including event-policy calls.

The tree shows subsequent publications by that service in the same flow,
then follows the existing event-consumer chains. Source conditions, loops
and parallel branches are labelled. Sibling alternatives and parallel
branches are excluded when the invocation is inside another branch. A
matching response ends the invocation's publication window when the flow
records one. These are possibilities recorded in flows, not proof that a
particular execution took every path or published every event.
Terminal branches do not continue into steps after their enclosing alternative.

Missing invocations and missing linked publications are stated explicitly.
Statuses retain the evidence of their source steps and consumer entries.
Cycles, repeated event subtrees, depth limits and the shared 200-row budget
are marked where traversal stops. Merely consuming an event does not establish
that a particular command handler ran; the tree makes no such inference.
