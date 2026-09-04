# Cancel order

Cancels an order that has not been dispatched, and says so with
`OrderCancelled`. Cancelling twice is not an error: the second call finds a
cancelled order and changes nothing.
