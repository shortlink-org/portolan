# Gateway webhook
owner: payments
source: services/ledger/test/integration/webhook_test.go

The gateway's side of the story, arriving after the fact. One signed callback,
four ways to read it: a replay to ignore, a capture to record, a charge with
no local payment to adopt, and a failure to pass on. The adopt branch is the
only repair for a checkout that timed out mid-authorization, and it is the one
branch no test covers.

## Participants
- psp-gateway: external "psp-gateway (external)"
- payments.ledger: service
- bus: broker
- shop.oms: service

## Steps
psp-gateway -> payments.ledger: rpc POST /webhooks/psp/v2 [verified] @webhook_test.go:38 #w1
  > HMAC-signed body. The gateway retries for three days with backoff until it
  > gets a 2xx, so every branch below has to tolerate being run twice.
payments.ledger -> payments.ledger: verifySignatureAndParse [verified] @internal/ledger/adapter/psp/webhook.go:44 #w2
  > A bad signature is answered 401 and never reaches the dedup table. The test
  > drives a tampered body for this.
alt event id already applied #alt-webhook
  payments.ledger -> payments.ledger: dropDuplicate [verified] @webhook_test.go:71 #w3
    > Dedup table keyed by the gateway's event id, rows kept 30 days. A replay
    > older than that would be applied again; nothing guards it.
else charge.succeeded, matching a local authorization
  payments.ledger -> payments.ledger: markCaptured [verified] @internal/ledger/app/webhook.go:96 #w4
  payments.ledger -> bus: event payments.ledger.payment.PaymentCaptured [verified] @webhook_test.go:104 #w5
else charge.succeeded, no local payment
  payments.ledger -> shop.oms: rpc shop.v1.Orders/GetOrder [verified] @internal/ledger/app/webhook.go:132 #w6
    > The order reference travels in the gateway's metadata. The ledger reads
    > the order back to decide whether the charge belongs to this estate at all.
  payments.ledger -> payments.ledger: adoptOrphanCharge @internal/ledger/app/webhook.go:151 #w7
    > Closes the gap left when the synchronous Authorize in checkout timed out
    > after the gateway had already charged. Read from the code; the integration
    > suite has no fixture for it, and it is the only path that keeps a customer
    > from being charged for an order the estate never opened.
  payments.ledger -> bus: event payments.ledger.payment.PaymentAuthorized @internal/ledger/app/webhook.go:168 #w8
    > Published late and out of order — consumers see the authorization after
    > the charge already settled.
else charge.failed
  payments.ledger -> bus: event payments.ledger.payment.PaymentDeclined [verified] @webhook_test.go:126 #w9
  bus -> shop.oms: event payments.ledger.payment.PaymentDeclined [verified] @webhook_test.go:131 #w10
end

payments.ledger -> psp-gateway: rpc ack 200 [verified] @webhook_test.go:142 #w11
  > Acked only after the branch above has committed. Anything else and the
  > gateway replays, which is what makes the dedup table load-bearing.
