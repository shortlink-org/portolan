import Checkout.World
import Oms.Scenarios

/-!
What holds in every world a checkout can reach, proved, and the traces the
model found before ledger.0004, ledger.0005 and ledger.0006, each pinned as it
ends now.

Every property is proved by one invariant that every action keeps. It says more
than the properties do, because that is what makes it survive a step: an
authorization OMS has not heard yet is still backed by a payment that was held,
a void or an `OrderCancelled` only ever follows a cancelled order, and nothing
is confirmed while ledger has yet to take its second look at the order.
-/

namespace Checkout

open Oms

/-! ## What OMS's step can and cannot do -/

theorem step_confirmed {o : Order} {m : Msg} (h : (o.step m).1.status = .confirmed) :
    o.status = .confirmed ∨ (o.status = .placed ∧ ∃ pid a, m = .authorized pid a) := by
  cases m <;> cases hs : o.status <;> simp_all [Order.step] <;> split at h <;> simp_all

theorem step_cancelled_emits {o : Order} {m : Msg} (hn : o.status ≠ .cancelled)
    (h : (o.step m).1.status = .cancelled) : (o.step m).2.count .cancelled > 0 := by
  cases m <;> cases hs : o.status <;> simp_all [Order.step] <;> split at h <;> simp_all

theorem step_confirmed_emitted {o : Order} {m : Msg} (h : (o.step m).2.count .confirmed > 0) :
    ∃ pid a, m = .authorized pid a := by
  cases m <;> cases hs : o.status <;> simp_all [Order.step] <;> split at h <;> simp_all

theorem step_cancelled_after {o : Order} {m : Msg} (h : o.status = .cancelled) :
    (o.step m).1.status = .cancelled := by
  simp [Order.cancelled_stays h m, h]

theorem step_cancelled_emitted {o : Order} {m : Msg} (h : (o.step m).2.count .cancelled > 0) :
    (o.step m).1.status = .cancelled := by
  rcases Order.step_cancels_once o m with h0 | ⟨_, hs⟩
  · omega
  · exact hs

/-! ## The invariant -/

structure Inv (w : World) : Prop where
  /-- A confirmed order has its money held or captured. -/
  confirmed : w.order.status = .confirmed →
    w.payment = some .authorized ∨ w.payment = some .captured
  /-- A `PaymentAuthorized` on the bus is backed by a payment that was held. -/
  authorizedFacts : w.authorizedFacts > 0 → grantedOpt w.payment = true
  /-- So is a held answer on its way back over the RPC. -/
  answeredHeld : w.rpc = .answered true → grantedOpt w.payment = true
  /-- The gateway is asked only while there is no payment on record. -/
  checked : w.rpc = .checked → w.payment = none
  /-- A hold is given back only for a cancelled order. -/
  voided : w.payment = some .voided → w.order.status = .cancelled
  /-- `OrderCancelled` is only said of a cancelled order. -/
  cancelledFacts : w.cancelledFacts > 0 → w.order.status = .cancelled
  /-- Ledger never stores a pending payment. -/
  notPending : w.payment ≠ some .pending
  /-- Money is captured only for a shipment delivery has made. -/
  capturedShipment : w.payment = some .captured → w.shipment ≠ none
  /-- Captured money has released its shipment, or a fact that will is still on its way:
  `PaymentCaptured`, or `OrderConfirmed` whose capture will say it (ledger.0004). -/
  capturedReleases : w.payment = some .captured →
    w.shipment = some .planned ∨ w.capturedFacts > 0 ∨ w.confirmedFacts > 0
  /-- A recorded hold waiting for ledger's second look is backed by a payment that was held. -/
  savedGranted : w.rpc = .saved → grantedOpt w.payment = true
  /-- A hold stands only beside an order that stands, or with something still to give it back:
  `OrderCancelled` on its way, or ledger's second look at the order (ledger.0005). -/
  holdReleased : w.payment = some .authorized →
    w.order.status ≠ .cancelled ∨ w.cancelledFacts > 0 ∨ w.rpc = .saved
  /-- Nothing is confirmed, or heard as authorized, while ledger has yet to take its second look. -/
  savedQuiet : w.rpc = .saved → w.authorizedFacts = 0 ∧ w.confirmedFacts = 0
  /-- No order is confirmed before there is a payment. -/
  noneUnconfirmed : w.payment = none → w.confirmedFacts = 0
  /-- A capture beside a cancelled order has been sent back, or `OrderCancelled` is still on its
  way to ledger to send it back (ledger.0006). -/
  refundDue : w.payment = some .captured → w.order.status = .cancelled →
    w.refunded = true ∨ w.cancelledFacts > 0

theorem inv_fresh {o : Order} (h : o.status = .placed) : Inv (World.fresh o) where
  confirmed := by simp [World.fresh, h]
  authorizedFacts := by simp [World.fresh]
  answeredHeld := by simp [World.fresh]
  checked := by simp [World.fresh]
  voided := by simp [World.fresh]
  cancelledFacts := by simp [World.fresh]
  notPending := by simp [World.fresh]
  capturedShipment := by simp [World.fresh]
  capturedReleases := by simp [World.fresh]
  savedGranted := by simp [World.fresh]
  holdReleased := by simp [World.fresh, h]
  savedQuiet := by simp [World.fresh]
  noneUnconfirmed := by simp [World.fresh]
  refundDue := by simp [World.fresh, h]

theorem granted_cases {p : Option PayStatus} (h : grantedOpt p = true) :
    p = some .authorized ∨ p = some .captured ∨ p = some .voided := by
  rcases p with _ | p
  · simp [grantedOpt] at h
  · cases p <;> simp_all [grantedOpt, PayStatus.granted]

/-- OMS handling a message keeps the invariant, as long as an authorization it hears is backed. -/
theorem inv_oms {w : World} {m : Msg} (hw : Inv w)
    (hm : ∀ pid a, m = .authorized pid a → grantedOpt w.payment = true ∧ w.rpc ≠ .saved) :
    Inv (w.oms m) where
  confirmed := by
    intro h
    simp only [World.oms] at h ⊢
    rcases step_confirmed h with hc | ⟨hp, pid, a, rfl⟩
    · exact hw.confirmed hc
    · rcases granted_cases (hm pid a rfl).1 with hA | hC | hV
      · exact .inl hA
      · exact .inr hC
      · have := hw.voided hV
        simp_all
  authorizedFacts := by simpa [World.oms] using hw.authorizedFacts
  answeredHeld := by simpa [World.oms] using hw.answeredHeld
  checked := by simpa [World.oms] using hw.checked
  voided := by
    intro h
    simp only [World.oms] at h ⊢
    exact step_cancelled_after (hw.voided h)
  cancelledFacts := by
    intro h
    simp only [World.oms] at h ⊢
    by_cases hc : (w.order.step m).2.count .cancelled > 0
    · exact step_cancelled_emitted hc
    · exact step_cancelled_after (hw.cancelledFacts (by omega))
  notPending := by simpa [World.oms] using hw.notPending
  capturedShipment := by simpa [World.oms] using hw.capturedShipment
  capturedReleases := by
    intro h
    simp only [World.oms] at h ⊢
    rcases hw.capturedReleases h with hs | hf | hf
    · exact .inl hs
    · exact .inr (.inl hf)
    · exact .inr (.inr (by omega))
  savedGranted := by simpa [World.oms] using hw.savedGranted
  holdReleased := by
    intro hA
    simp only [World.oms] at hA ⊢
    by_cases hn : w.order.status = .cancelled
    · rcases hw.holdReleased hA with hc | hf | hr
      · exact absurd hn hc
      · exact .inr (.inl (by omega))
      · exact .inr (.inr hr)
    · by_cases hc : (w.order.step m).1.status = .cancelled
      · have := step_cancelled_emits hn hc
        exact .inr (.inl (by omega))
      · exact .inl hc
  savedQuiet := by
    intro hr
    simp only [World.oms] at hr ⊢
    obtain ⟨ha, hc⟩ := hw.savedQuiet hr
    refine ⟨ha, ?_⟩
    by_cases he : (w.order.step m).2.count .confirmed > 0
    · obtain ⟨pid, a, rfl⟩ := step_confirmed_emitted he
      exact absurd hr (hm pid a rfl).2
    · omega
  noneUnconfirmed := by
    intro hn
    simp only [World.oms] at hn ⊢
    have := hw.noneUnconfirmed hn
    by_cases he : (w.order.step m).2.count .confirmed > 0
    · obtain ⟨pid, a, rfl⟩ := step_confirmed_emitted he
      have := (hm pid a rfl).1
      simp [hn, grantedOpt] at this
    · omega
  refundDue := by
    intro hC hc
    simp only [World.oms] at hC hc ⊢
    by_cases hn : w.order.status = .cancelled
    · rcases hw.refundDue hC hn with hr | hf
      · exact .inl hr
      · exact .inr (by omega)
    · exact .inr (by have := step_cancelled_emits hn hc; omega)

theorem answer_backed {w : World} {held : Bool}
    (h : held = true → grantedOpt w.payment = true ∧ w.rpc ≠ .saved) :
    ∀ pid a, w.answer held = .authorized pid a → grantedOpt w.payment = true ∧ w.rpc ≠ .saved := by
  intro pid a ha
  cases held
  · simp [World.answer] at ha
  · exact h rfl

/-- Takes the invariant apart into its fields, rebuilds it for the world after an action, and
lets `simp_all` and `omega` settle each field against the old ones. -/
macro "inv_fields" hw:ident : tactic => `(tactic| (
  obtain ⟨h₁, h₂, h₃, h₄, h₅, h₆, h₇, h₈, h₉, h₁₀, h₁₁, h₁₂, h₁₃, h₁₄⟩ := $hw
  refine ⟨?_, ?_, ?_, ?_, ?_, ?_, ?_, ?_, ?_, ?_, ?_, ?_, ?_, ?_⟩ <;>
    simp_all [World.said, World.taken, World.replied, grantedOpt, PayStatus.granted] <;>
    omega))

set_option maxHeartbeats 1000000 in
/-- Every action keeps the invariant. -/
theorem inv_act {w : World} (hw : Inv w) (a : Action) : Inv (w.act a) := by
  cases a with
  | request =>
    simp only [World.act]; split
    · inv_fields hw
    · exact hw
  | check published =>
    simp only [World.act]; split
    · split
      · rename_i p hp
        have := hw.notPending
        cases p <;> inv_fields hw
      · split
        · cases published <;> inv_fields hw
        · inv_fields hw
    · exact hw
  | hold =>
    simp only [World.act]; split
    · rename_i hr
      have := hw.checked hr
      inv_fields hw
    · exact hw
  | recheck published =>
    simp only [World.act]; split
    · rename_i hr
      have := hw.savedGranted hr
      split
      · split <;> inv_fields hw
      · cases published <;> inv_fields hw
    · exact hw
  | refuse published =>
    simp only [World.act]; split
    · rename_i hr
      have := hw.checked hr
      have := hw.confirmed
      cases published <;> inv_fields hw
    · exact hw
  | reply =>
    simp only [World.act]; split
    · rename_i held hr
      have ho := inv_oms (m := w.answer held) hw
        (answer_backed fun h => ⟨hw.answeredHeld (by simp [hr, h]), by simp [hr]⟩)
      exact { ho with
        answeredHeld := by simp
        checked := by simp
        savedGranted := by simp
        savedQuiet := by simp
        holdReleased := by
          intro hA
          rcases ho.holdReleased hA with hc | hf | hs
          · exact .inl hc
          · exact .inr (.inl hf)
          · simp [World.oms, hr] at hs }
    · exact hw
  | lose =>
    simp only [World.act]; split
    · inv_fields hw
    · exact hw
  | deliverAuthorized keep =>
    simp only [World.act]; split
    · rename_i hf
      have ho := inv_oms (m := w.answer true) hw
        (answer_backed fun _ => ⟨hw.authorizedFacts hf, fun hs => by
          have := (hw.savedQuiet hs).1; omega⟩)
      exact { ho with
        authorizedFacts := fun _ => by
          simpa [World.oms] using hw.authorizedFacts hf
        savedQuiet := fun hs => by
          simp only [World.oms] at hs
          have := (hw.savedQuiet hs).1
          omega }
    · exact hw
  | deliverDeclined keep =>
    simp only [World.act]; split
    · have ho := inv_oms (m := w.answer false) hw
        (answer_backed fun h => by simp at h)
      exact { ho with authorizedFacts := by simpa [World.oms] using hw.authorizedFacts }
    · exact hw
  | cancel =>
    simp only [World.act]
    exact inv_oms hw (by simp)
  | deliverCancelled keep =>
    simp only [World.act]; split
    · rename_i hf
      have := hw.cancelledFacts hf
      split <;> inv_fields hw
    · exact hw
  | deliverConfirmed keep published =>
    simp only [World.act]; split
    · rename_i hf
      split
      · inv_fields hw
      · split
        · rename_i _ hA
          -- a hold is captured only where a cancellation would still reach it
          have hR : w.order.status = .cancelled → w.cancelledFacts > 0 := by
            intro hc
            rcases hw.holdReleased hA with hn | hc' | hs
            · exact absurd hc hn
            · exact hc'
            · have := (hw.savedQuiet hs).2; omega
          cases published <;> inv_fields hw
        · split
          · cases published <;> inv_fields hw
          · inv_fields hw
    · exact hw
  | deliverCaptured keep =>
    simp only [World.act]; split
    · refine { hw with capturedShipment := ?_, capturedReleases := ?_ }
      · intro hC
        have := hw.capturedShipment hC
        split <;> simp_all
      · intro hC
        have := hw.capturedShipment hC
        rcases hsh : w.shipment with _ | _ | _ <;> simp_all
    · exact hw

theorem inv_reachable {w : World} (h : Reachable w) : Inv w := by
  induction h with
  | fresh o ho => exact inv_fresh ho
  | act a _ ih => exact inv_act ih a

/-! ## What holds -/

/-- In every reachable world, a confirmed order has its money held or captured:
OMS never confirms on an authorization ledger did not make. -/
theorem confirmed_is_paid {w : World} (h : Reachable w) (hc : w.order.status = .confirmed) :
    w.payment = some .authorized ∨ w.payment = some .captured :=
  (inv_reachable h).confirmed hc

/-- In every reachable world, a declined payment never stands beside a confirmed order. -/
theorem declined_is_not_confirmed {w : World} (h : Reachable w) (hd : w.payment = some .declined) :
    w.order.status ≠ .confirmed := by
  intro hc
  rcases confirmed_is_paid h hc with hA | hC <;> simp_all

/-! ## The traces the fixes were found by -/

/-- The checkout every finding starts from: the one order OMS's scenarios place. -/
def start : World := World.fresh Oms.Scenarios.start

theorem start_reachable : Reachable start := .fresh _ rfl

theorem run_reachable {w : World} (h : Reachable w) (as : List Action) : Reachable (w.run as) := by
  induction as generalizing w with
  | nil => exact h
  | cons a as ih => exact ih (.act a h)

/-! ## What ledger.0006 fixed -/

/-- Once everything is delivered, a cancelled order whose money was captured has had it sent
back. A customer may cancel until the parcel moves, and the money moves before that; ledger
now answers `OrderCancelled` for a captured payment with a refund (ledger.0006). -/
theorem cancelled_charge_is_refunded {w : World} (h : Reachable w) (hq : w.quiet)
    (hc : w.order.status = .cancelled) (hp : w.payment = some .captured) : w.refunded = true := by
  obtain ⟨_, _, _, hcan, _, _⟩ := hq
  rcases (inv_reachable h).refundDue hp hc with hr | hf
  · exact hr
  · omega

/-- The trace that used to leave a cancelled order charged: the order is confirmed, the customer
cancels, delivery captures on the `OrderConfirmed` it already had, and the void that follows
finds nothing held. `OrderCancelled` now sends the capture back. -/
def chargeOnCancelled : List Action :=
  [.request, .check true, .hold, .recheck true, .reply, .cancel, .deliverAuthorized false,
   .deliverConfirmed false true, .deliverCancelled false, .deliverCaptured false]

theorem charge_on_cancelled_order_is_sent_back :
    Reachable (start.run chargeOnCancelled) ∧ (start.run chargeOnCancelled).quiet ∧
      (start.run chargeOnCancelled).order.status = .cancelled ∧
      (start.run chargeOnCancelled).payment = some .captured ∧
      (start.run chargeOnCancelled).refunded = true :=
  ⟨run_reachable start_reachable _, by decide, by decide, by decide, by decide⟩

/-! ## What ledger.0005 fixed -/

/-- Once everything is delivered, a cancelled order holds no money. A cancellation that
reached ledger while the gateway was holding found nothing to give back; ledger now records
the hold and asks about the order again, and a cancellation from the save on finds the
payment itself (ledger.0005). -/
theorem cancelled_holds_nothing {w : World} (h : Reachable w) (hq : w.quiet)
    (hc : w.order.status = .cancelled) : w.payment ≠ some .authorized := by
  intro hA
  obtain ⟨hr, _, _, hcan, _, _⟩ := hq
  rcases (inv_reachable h).holdReleased hA with hn | hf | hs
  · exact hn hc
  · omega
  · simp [hr] at hs

/-- The trace that used to leave the hold on a cancelled order: ledger finds the order
standing, the customer cancels, `OrderCancelled` reaches ledger while there is nothing to
void, and the gateway holds. Asked again after the save, the order is cancelled, and the hold
is given back. -/
def cancelRacingHold : List Action :=
  [.request, .check true, .cancel, .deliverCancelled false, .hold, .recheck true, .reply]

theorem cancel_racing_hold_gives_it_back :
    Reachable (start.run cancelRacingHold) ∧ (start.run cancelRacingHold).quiet ∧
      (start.run cancelRacingHold).order.status = .cancelled ∧
      (start.run cancelRacingHold).payment = some .voided :=
  ⟨run_reachable start_reachable _, by decide, by decide, by decide⟩

/-! ## What ledger.0004 fixed -/

/-- Once everything is delivered, captured money has released its shipment. A capture
whose `PaymentCaptured` did not leave fails, delivery asks again, and the repeated capture
says it again (ledger.0004), so no reachable world leaves the shipment waiting. -/
theorem captured_releases_shipment {w : World} (h : Reachable w) (hq : w.quiet)
    (hc : w.payment = some .captured) : w.shipment = some .planned := by
  obtain ⟨_, _, _, _, hconf, hcapt⟩ := hq
  rcases (inv_reachable h).capturedReleases hc with hs | hf | hf
  · exact hs
  · omega
  · omega

/-- The trace that used to leave the shipment waiting: the capture's event does not leave,
delivery keeps `OrderConfirmed` and asks again, and this time the repeated capture says
`PaymentCaptured`, which releases the shipment. -/
def lostCapture : List Action :=
  [.request, .check true, .hold, .recheck true, .reply, .deliverAuthorized false,
   .deliverConfirmed true false, .deliverConfirmed false true, .deliverCaptured false]

theorem lost_capture_is_said_again :
    Reachable (start.run lostCapture) ∧ (start.run lostCapture).quiet ∧
      (start.run lostCapture).payment = some .captured ∧
      (start.run lostCapture).shipment = some .planned :=
  ⟨run_reachable start_reachable _, by decide, by decide, by decide⟩

end Checkout
