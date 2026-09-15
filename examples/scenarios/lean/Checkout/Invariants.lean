import Checkout.World
import Oms.Scenarios

/-!
What holds in every world a checkout can reach, proved, and what does not,
shown by a trace.

The two properties that hold are proved by one invariant that every action
keeps. It says more than the properties do, because that is what makes it
survive a step: an authorization OMS has not heard yet is still backed by a
payment that was held, and a void or an `OrderCancelled` only ever follows a
cancelled order.
-/

namespace Checkout

open Oms

/-! ## What OMS's step can and cannot do -/

theorem step_confirmed {o : Order} {m : Msg} (h : (o.step m).1.status = .confirmed) :
    o.status = .confirmed ∨ (o.status = .placed ∧ ∃ pid a, m = .authorized pid a) := by
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

theorem granted_cases {p : Option PayStatus} (h : grantedOpt p = true) :
    p = some .authorized ∨ p = some .captured ∨ p = some .voided := by
  rcases p with _ | p
  · simp [grantedOpt] at h
  · cases p <;> simp_all [grantedOpt, PayStatus.granted]

/-- OMS handling a message keeps the invariant, as long as an authorization it hears is backed. -/
theorem inv_oms {w : World} {m : Msg} (hw : Inv w)
    (hm : ∀ pid a, m = .authorized pid a → grantedOpt w.payment = true) : Inv (w.oms m) where
  confirmed := by
    intro h
    simp only [World.oms] at h ⊢
    rcases step_confirmed h with hc | ⟨hp, pid, a, rfl⟩
    · exact hw.confirmed hc
    · rcases granted_cases (hm pid a rfl) with hA | hC | hV
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

theorem answer_backed {w : World} {held : Bool}
    (h : held = true → grantedOpt w.payment = true) :
    ∀ pid a, w.answer held = .authorized pid a → grantedOpt w.payment = true := by
  intro pid a ha
  cases held
  · simp [World.answer] at ha
  · exact h rfl

/-- Takes the invariant apart into its fields, rebuilds it for the world after an action, and
lets `simp_all` and `omega` settle each field against the old ones. -/
macro "inv_fields" hw:ident : tactic => `(tactic| (
  obtain ⟨h₁, h₂, h₃, h₄, h₅, h₆, h₇, h₈, h₉⟩ := $hw
  refine ⟨?_, ?_, ?_, ?_, ?_, ?_, ?_, ?_, ?_⟩ <;>
    simp_all [World.said, World.taken, World.replied, grantedOpt, PayStatus.granted] <;>
    omega))

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
  | hold published =>
    simp only [World.act]; split
    · rename_i hr
      have := hw.checked hr
      cases published <;> inv_fields hw
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
        (answer_backed fun h => hw.answeredHeld (by simp [hr, h]))
      exact { ho with
        answeredHeld := by simp
        checked := by simp }
    · exact hw
  | lose =>
    simp only [World.act]; split
    · inv_fields hw
    · exact hw
  | deliverAuthorized keep =>
    simp only [World.act]; split
    · rename_i hf
      have ho := inv_oms (m := w.answer true) hw
        (answer_backed fun _ => hw.authorizedFacts hf)
      exact { ho with
        authorizedFacts := fun _ => by
          simpa [World.oms] using hw.authorizedFacts hf }
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
    · split
      · inv_fields hw
      · split
        · cases published <;> inv_fields hw
        · split
          · cases published <;> inv_fields hw
          · inv_fields hw
    · exact hw
  | deliverCaptured keep =>
    simp only [World.act]; split
    · have := hw.capturedShipment
      have := hw.capturedReleases
      split <;>
        (cases hsh : w.shipment with
          | none => inv_fields hw
          | some ship => cases ship <;> inv_fields hw)
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

/-! ## What does not hold -/

/-- The checkout every finding starts from: the one order OMS's scenarios place. -/
def start : World := World.fresh Oms.Scenarios.start

theorem start_reachable : Reachable start := .fresh _ rfl

theorem run_reachable {w : World} (h : Reachable w) (as : List Action) : Reachable (w.run as) := by
  induction as generalizing w with
  | nil => exact h
  | cons a as ih => exact ih (.act a h)

/-- Cancellation racing authorization: ledger finds the order standing, the customer
cancels, `OrderCancelled` reaches ledger while there is nothing to void, and then the
gateway holds. Everything is delivered, and the money stays held for a cancelled order. -/
def holdOnCancelled : List Action :=
  [.request, .check true, .cancel, .deliverCancelled false, .hold true, .reply,
   .deliverAuthorized false]

theorem hold_left_on_cancelled_order :
    Reachable (start.run holdOnCancelled) ∧ (start.run holdOnCancelled).quiet ∧
      (start.run holdOnCancelled).order.status = .cancelled ∧
      (start.run holdOnCancelled).payment = some .authorized :=
  ⟨run_reachable start_reachable _, by decide, by decide, by decide⟩

/-- Cancellation after capture: the order is confirmed, the customer cancels, delivery
captures on the `OrderConfirmed` it already had, the void that follows finds nothing held,
and `PaymentCaptured` releases the shipment. Everything is delivered: a cancelled order has
been charged, and its goods are on their way. -/
def chargeOnCancelled : List Action :=
  [.request, .check true, .hold true, .reply, .cancel, .deliverAuthorized false,
   .deliverConfirmed false true, .deliverCancelled false, .deliverCaptured false]

theorem charge_left_on_cancelled_order :
    Reachable (start.run chargeOnCancelled) ∧ (start.run chargeOnCancelled).quiet ∧
      (start.run chargeOnCancelled).order.status = .cancelled ∧
      (start.run chargeOnCancelled).payment = some .captured ∧
      (start.run chargeOnCancelled).shipment = some .planned :=
  ⟨run_reachable start_reachable _, by decide, by decide, by decide, by decide⟩

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
  [.request, .check true, .hold true, .reply, .deliverAuthorized false,
   .deliverConfirmed true false, .deliverConfirmed false true, .deliverCaptured false]

theorem lost_capture_is_said_again :
    Reachable (start.run lostCapture) ∧ (start.run lostCapture).quiet ∧
      (start.run lostCapture).payment = some .captured ∧
      (start.run lostCapture).shipment = some .planned :=
  ⟨run_reachable start_reachable _, by decide, by decide, by decide⟩

end Checkout
