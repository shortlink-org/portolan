# Command consequences

On an aggregate's Commands list, expand **Then what** to follow a command's
possible event consequences. Each invocation and publication links to the
flow step that records it. Events link to their contracts, and consumers to
their services.

A command starts a chain only when a flow explicitly names its operation in
a `call` step, or names one of its provided `exposedBy` methods in an incoming
`rpc` step. The destination must identify the owning service; participant
`entityRef` aliases are supported. A matching label alone is insufficient.

The tree shows subsequent publications by that service in the same flow,
then follows the existing event-consumer chains. Source conditions, loops
and parallel branches are labelled. Sibling alternatives and parallel
branches are excluded when the invocation is inside another branch. A
matching response ends the invocation's publication window when the flow
records one. These are possibilities recorded in flows, not proof that a
particular execution took every path or published every event.

Missing invocations and missing linked publications are stated explicitly.
Statuses retain the evidence of their source steps and consumer entries.
Cycles, repeated event subtrees, depth limits and the shared 200-row budget
are marked where traversal stops. Merely consuming an event does not establish
that a particular command handler ran; the tree makes no such inference.
