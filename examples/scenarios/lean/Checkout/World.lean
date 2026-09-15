import Oms.Policy
import Checkout.Payment

/-!
One checkout across OMS, ledger and delivery: one order, the one payment whose
id is the order's id, the Authorize RPC between them, and the facts on the bus.

A world moves by one action at a time, and any enabled action may come next:
that is the whole of the concurrency model. Facts on the bus are counted, not
queued — every fact of one kind says the same thing about the same order — and
a fact may be delivered and kept, which is how at-least-once delivery repeats
it. An action that is not enabled leaves the world as it is.

Ledger saves and then publishes, with no outbox between (`NatsBus.publish`
throws after the row is written), so every fact ledger says carries a
`published` flag: `false` is the save that stayed and the fact that never left.
The throw reaches the caller: an Authorize whose event did not leave answers
with an error, and a Capture whose event did not leave leaves `OrderConfirmed`
to be delivered again.

What is not here: two Authorize calls for the same id running at once, a
gateway result lost before ledger saves it, refunds, and what delivery does
after it releases a shipment.
-/

namespace Checkout

open Oms

/-- How far ledger's Authorize has got for this order's payment. -/
inductive Rpc where
  | idle
  /-- OMS handled `OrderPlaced` and called Authorize. -/
  | requested
  /-- Ledger found no payment on record and the order still standing; the gateway is next. -/
  | checked
  /-- The hold is on record; ledger asks about the order again before it answers (ledger.0005). -/
  | saved
  /-- Ledger's answer is on its way back to OMS: `true` is held, `false` refused. -/
  | answered (held : Bool)
  deriving Repr, DecidableEq

/-- Delivery's shipment for the order, as far as payment is concerned. -/
inductive Ship where
  /-- Created from `OrderConfirmed`; waits for `PaymentCaptured`. -/
  | awaitingPayment
  /-- Released by `PaymentCaptured`. -/
  | planned
  deriving Repr, DecidableEq

structure World where
  order : Order
  payment : Option PayStatus
  rpc : Rpc
  /-- `PaymentAuthorized` facts on the bus to OMS. -/
  authorizedFacts : Nat
  /-- `PaymentDeclined` facts on the bus to OMS. -/
  declinedFacts : Nat
  /-- `OrderCancelled` facts on the bus to ledger. -/
  cancelledFacts : Nat
  /-- `OrderConfirmed` facts on the bus to delivery. -/
  confirmedFacts : Nat
  shipment : Option Ship
  /-- `PaymentCaptured` facts on the bus to delivery. -/
  capturedFacts : Nat

inductive Action where
  /-- `RequestPaymentOnOrderPlaced`: a placed order asks ledger to authorize. -/
  | request
  /-- `AuthorizePayment` up to the gateway: answer from the record, decline a cancelled order, or go on. -/
  | check (published : Bool)
  /-- The gateway holds the money, and ledger records the hold. -/
  | hold
  /-- Ledger asks about the order again: a cancelled one has the hold given back, a standing
  one hears `PaymentAuthorized` (ledger.0005). -/
  | recheck (published : Bool)
  /-- The gateway refuses. -/
  | refuse (published : Bool)
  /-- OMS applies the RPC's answer. -/
  | reply
  /-- The answer never arrives; `OrderPlaced` will be handled again. -/
  | lose
  /-- OMS applies `PaymentAuthorized`; `keep` leaves it on the bus to be delivered again. -/
  | deliverAuthorized (keep : Bool)
  /-- OMS applies `PaymentDeclined`. -/
  | deliverDeclined (keep : Bool)
  /-- The customer cancels over gRPC. -/
  | cancel
  /-- Ledger's `VoidPaymentOnOrderCancelled`. -/
  | deliverCancelled (keep : Bool)
  /-- Delivery's `create_shipment`: store the shipment, and while it waits ask ledger to capture. -/
  | deliverConfirmed (keep published : Bool)
  /-- Delivery's `release_shipment` on `PaymentCaptured`. -/
  | deliverCaptured (keep : Bool)
  deriving Repr, DecidableEq

namespace World

/-- A checkout that has just placed `o`. -/
def fresh (o : Order) : World :=
  { order := o, payment := none, rpc := .idle,
    authorizedFacts := 0, declinedFacts := 0, cancelledFacts := 0, confirmedFacts := 0,
    shipment := none, capturedFacts := 0 }

/-- OMS handles a message with the proved `Order.step`; what it emits goes on the bus. -/
def oms (w : World) (m : Msg) : World :=
  let r := w.order.step m
  { w with
    order := r.1
    cancelledFacts := w.cancelledFacts + r.2.count .cancelled
    confirmedFacts := w.confirmedFacts + r.2.count .confirmed }

/-- What ledger's answer is, to OMS: the authorization of this order's payment, or its decline. -/
def answer (w : World) (held : Bool) : Msg :=
  if held then .authorized w.order.id w.order.total else .declined w.order.id

/-- One more fact on the bus, if it left. -/
def said (n : Nat) (published : Bool) : Nat :=
  if published then n + 1 else n

/-- What Authorize answers once the payment is saved: the outcome, or an error when
the event did not leave, which OMS meets as a lost answer and asks again. -/
def replied (held published : Bool) : Rpc :=
  if published then .answered held else .idle

/-- One fact taken off the bus, unless it is kept to arrive again. -/
def taken (n : Nat) (keep : Bool) : Nat :=
  if keep then n else n - 1

def act (w : World) : Action → World
  | .request =>
    if w.rpc = .idle ∧ w.order.status = .placed then { w with rpc := .requested } else w
  | .check published =>
    if w.rpc = .requested then
      match w.payment with
      -- the same id asked again answers from the record
      | some p => { w with rpc := .answered (p == .authorized || p == .captured) }
      | none =>
        -- a cancelled order is declined without asking the gateway
        if w.order.status = .cancelled then
          { w with payment := some .declined, rpc := replied false published,
                   declinedFacts := said w.declinedFacts published }
        else { w with rpc := .checked }
    else w
  | .hold =>
    if w.rpc = .checked then { w with payment := some .authorized, rpc := .saved } else w
  | .recheck published =>
    if w.rpc = .saved then
      if w.order.status = .cancelled then
        { w with payment := if w.payment = some .authorized then some .voided else w.payment,
                 rpc := .answered false }
      else
        { w with rpc := replied true published,
                 authorizedFacts := said w.authorizedFacts published }
    else w
  | .refuse published =>
    if w.rpc = .checked then
      { w with payment := some .declined, rpc := replied false published,
               declinedFacts := said w.declinedFacts published }
    else w
  | .reply =>
    match w.rpc with
    | .answered held => { w.oms (w.answer held) with rpc := .idle }
    | _ => w
  | .lose =>
    match w.rpc with
    | .answered _ => { w with rpc := .idle }
    | _ => w
  | .deliverAuthorized keep =>
    if w.authorizedFacts > 0 then
      { w.oms (w.answer true) with authorizedFacts := taken w.authorizedFacts keep }
    else w
  | .deliverDeclined keep =>
    if w.declinedFacts > 0 then
      { w.oms (w.answer false) with declinedFacts := taken w.declinedFacts keep }
    else w
  | .cancel => w.oms .cancelRequested
  | .deliverCancelled keep =>
    if w.cancelledFacts > 0 then
      -- VoidPayment: only a hold is given back; anything else is "nothing released"
      { w with payment := if w.payment = some .authorized then some .voided else w.payment,
               cancelledFacts := taken w.cancelledFacts keep }
    else w
  | .deliverConfirmed keep published =>
    if w.confirmedFacts > 0 then
      if w.shipment = some .planned then
        -- a shipment already released is not asked about again
        { w with confirmedFacts := taken w.confirmedFacts keep }
      else if w.payment = some .authorized then
        -- CapturePayment moves the money and says so; if the saying fails, the call fails
        -- and OrderConfirmed stays to be delivered again
        { w with shipment := some .awaitingPayment, payment := some .captured,
                 capturedFacts := said w.capturedFacts published,
                 confirmedFacts := if published then taken w.confirmedFacts keep else w.confirmedFacts }
      else if w.payment = some .captured then
        -- already captured: nothing moves, and PaymentCaptured is said again (ledger.0004)
        { w with shipment := some .awaitingPayment,
                 capturedFacts := said w.capturedFacts published,
                 confirmedFacts := if published then taken w.confirmedFacts keep else w.confirmedFacts }
      else
        -- no payment, or one that cannot be captured: refused, and the shipment waits
        { w with shipment := some .awaitingPayment,
                 confirmedFacts := taken w.confirmedFacts keep }
    else w
  | .deliverCaptured keep =>
    if w.capturedFacts > 0 then
      { w with shipment := if w.shipment = some .awaitingPayment then some .planned else w.shipment,
               capturedFacts := taken w.capturedFacts keep }
    else w

def run (w : World) (as : List Action) : World :=
  as.foldl act w

/-- Nothing is in flight: no RPC, nothing on the bus. -/
def quiet (w : World) : Prop :=
  w.rpc = .idle ∧ w.authorizedFacts = 0 ∧ w.declinedFacts = 0 ∧
    w.cancelledFacts = 0 ∧ w.confirmedFacts = 0 ∧ w.capturedFacts = 0

instance (w : World) : Decidable w.quiet := by
  unfold quiet; exact inferInstance

end World

/-- Every world a checkout can reach from a freshly placed order. -/
inductive Reachable : World → Prop where
  | fresh (o : Order) (h : o.status = .placed) : Reachable (World.fresh o)
  | act {w : World} (a : Action) : Reachable w → Reachable (w.act a)

end Checkout
