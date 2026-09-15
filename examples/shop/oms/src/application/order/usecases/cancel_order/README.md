# Cancel order

Cancels an order that has not been dispatched, and says so with
`OrderCancelled`. Cancelling twice is not an error: the second call finds a
cancelled order and changes nothing.

A declined payment cancels through the same operation (oms.0007), naming the
payment id and ledger's reason. That cancellation applies only to a placed
order whose id is the payment id: a mismatch is refused, and a confirmed order
stays confirmed.
