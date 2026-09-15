import Oms.Order

namespace Oms

/-- What reaches an order from outside: the ledger's answer or a customer's request. -/
inductive Msg where
  | authorized (paymentId : String) (amount : Money)  -- RPC answer or ledger.PaymentAuthorized
  | declined (paymentId : String)                     -- RPC answer or ledger.PaymentDeclined
  | cancelRequested                                   -- CancelOrder over gRPC
  deriving Repr

/-- What an order says happened, the events its outbox would carry. -/
inductive Event where
  | confirmed  -- OrderConfirmed
  | cancelled  -- OrderCancelled
  deriving Repr, DecidableEq

namespace Order

/-- One message applied to one order: the order after it, and the events it emitted. -/
def step (o : Order) : Msg → Order × List Event
  | .authorized pid amount =>
    if pid != o.id || amount != o.total then (o, [])
    else if o.status != .placed then (o, [])
    else ({ o with status := .confirmed }, [.confirmed])
  | .declined pid =>
    if pid != o.id then (o, [])
    else if o.status != .placed then (o, [])
    else ({ o with status := .cancelled }, [.cancelled])
  | .cancelRequested =>
    if o.status == .cancelled then (o, [])
    else ({ o with status := .cancelled }, [.cancelled])

/-- Messages applied in the order they arrived; the events are every step's, in order. -/
def run (o : Order) : List Msg → Order × List Event
  | [] => (o, [])
  | m :: ms =>
    let first := step o m
    let rest := run first.1 ms
    (rest.1, first.2 ++ rest.2)

/-- A late decline leaves a confirmed order alone (ADR oms.0007). -/
theorem declined_keeps_confirmed {o : Order} {pid : String}
    (h : o.status = .confirmed) : o.step (.declined pid) = (o, []) := by
  simp [step, h]

/-- A cancelled order never comes back: no message changes it or emits anything. -/
theorem cancelled_stays {o : Order} (h : o.status = .cancelled) (m : Msg) :
    o.step m = (o, []) := by
  cases m <;> simp [step, h]

/-- An authorization for another payment changes nothing. -/
theorem foreign_payment_ignored {o : Order} {pid : String} {amount : Money}
    (h : pid ≠ o.id) : o.step (.authorized pid amount) = (o, []) := by
  simp [step, h]

/-- The same message heard twice changes nothing the second time. -/
theorem step_twice (o : Order) (m : Msg) :
    (o.step m).1.step m = ((o.step m).1, []) := by
  cases m with
  | authorized pid amount =>
    by_cases hid : pid = o.id
    · by_cases hamt : amount = o.total
      · cases hs : o.status <;> simp [step, hid, hamt, hs]
      · simp [step, hid, hamt]
    · simp [step, hid]
  | declined pid =>
    by_cases hid : pid = o.id
    · cases hs : o.status <;> simp [step, hid, hs]
    · simp [step, hid]
  | cancelRequested =>
    cases hs : o.status <;> simp [step, hs]

/-- A step either leaves the status where it was or makes a move the table allows. -/
theorem step_respects_table (o : Order) (m : Msg) :
    (o.step m).1.status = o.status ∨ Status.canMove o.status (o.step m).1.status = true := by
  cases m with
  | authorized pid amount =>
    simp only [step]
    split
    · simp
    · split
      · simp
      · cases hs : o.status <;> simp_all [Status.canMove, Status.targets]
  | declined pid =>
    simp only [step]
    split
    · simp
    · split
      · simp
      · cases hs : o.status <;> simp_all [Status.canMove, Status.targets]
  | cancelRequested =>
    simp only [step]
    split
    · simp
    · cases hs : o.status <;> simp_all [Status.canMove, Status.targets]

/-- A step emits `OrderConfirmed` at most once, and only by confirming the order. -/
theorem step_confirms_once (o : Order) (m : Msg) :
    (o.step m).2.count .confirmed = 0 ∨
      ((o.step m).2.count .confirmed = 1 ∧ (o.step m).1.status = .confirmed) := by
  cases m <;> simp only [step] <;> split <;> (try split) <;> simp

/-- Once an order has left placed, a step does not bring it back or confirm it. -/
theorem step_leaves_placed_behind (o : Order) (h : o.status ≠ .placed) (m : Msg) :
    (o.step m).1.status ≠ .placed ∧ (o.step m).2.count .confirmed = 0 := by
  cases m <;> cases hs : o.status <;> simp_all [step]

/-- An order that has left placed is never confirmed again, whatever arrives. -/
theorem run_after_placed (o : Order) (h : o.status ≠ .placed) (ms : List Msg) :
    (o.run ms).2.count .confirmed = 0 := by
  induction ms generalizing o with
  | nil => simp [run]
  | cons m ms ih =>
    obtain ⟨hs, hc⟩ := step_leaves_placed_behind o h m
    have hrest := ih (o.step m).1 hs
    simp only [run, List.count_append]
    omega

/-- Whatever messages arrive, in any order and with any repeats,
`OrderConfirmed` is emitted at most once. -/
theorem run_confirms_at_most_once (o : Order) (ms : List Msg) :
    (o.run ms).2.count .confirmed ≤ 1 := by
  induction ms generalizing o with
  | nil => simp [run]
  | cons m ms ih =>
    simp only [run, List.count_append]
    rcases step_confirms_once o m with h0 | ⟨h1, hs⟩
    · -- this step confirmed nothing: the rest confirms at most once
      have hrest := ih (o.step m).1
      omega
    · -- this step confirmed: the order has left placed, the rest confirms nothing
      have hp : (o.step m).1.status ≠ .placed := by simp [hs]
      have hrest := run_after_placed (o.step m).1 hp ms
      omega

/-- A cancelled order stays exactly as it is, whatever arrives: nothing changes, nothing is emitted. -/
theorem run_after_cancelled (o : Order) (h : o.status = .cancelled) (ms : List Msg) :
    o.run ms = (o, []) := by
  induction ms with
  | nil => simp [run]
  | cons m ms ih =>
    simp [run, cancelled_stays h m, ih]

/-- A step emits `OrderCancelled` at most once, and only by cancelling the order. -/
theorem step_cancels_once (o : Order) (m : Msg) :
    (o.step m).2.count .cancelled = 0 ∨
      ((o.step m).2.count .cancelled = 1 ∧ (o.step m).1.status = .cancelled) := by
  cases m <;> simp only [step] <;> split <;> (try split) <;> simp

/-- Whatever messages arrive, in any order and with any repeats,
`OrderCancelled` is emitted at most once. -/
theorem run_cancels_at_most_once (o : Order) (ms : List Msg) :
    (o.run ms).2.count .cancelled ≤ 1 := by
  induction ms generalizing o with
  | nil => simp [run]
  | cons m ms ih =>
    simp only [run, List.count_append]
    rcases step_cancels_once o m with h0 | ⟨h1, hs⟩
    · -- this step cancelled nothing: the rest cancels at most once
      have hrest := ih (o.step m).1
      omega
    · -- this step cancelled: the order stays as it is, the rest emits nothing
      have hrest := run_after_cancelled (o.step m).1 hs ms
      simp only [hrest, List.count_nil]
      omega

end Order
end Oms
