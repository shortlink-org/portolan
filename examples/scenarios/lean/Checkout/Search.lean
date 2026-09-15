import Checkout.World
import Oms.Scenarios

/-!
Breadth-first search over every interleaving from a freshly placed order. Two
worlds that agree on the order's status, the payment, the RPC and the counts
on the bus are one world here, so the search ends: the facts are bounded (each
is emitted at most once, which OMS's model proves for its own), and a kept
delivery leads back to a world already seen.

For each property the search reports the shortest trace that breaks it, or how
many worlds it holds in.
-/

namespace Checkout.Search

open Oms

structure Key where
  status : Status
  payment : Option PayStatus
  rpc : Rpc
  authorizedFacts : Nat
  declinedFacts : Nat
  cancelledFacts : Nat
  confirmedFacts : Nat
  deriving DecidableEq

def key (w : World) : Key :=
  ⟨w.order.status, w.payment, w.rpc, w.authorizedFacts, w.declinedFacts, w.cancelledFacts,
   w.confirmedFacts⟩

def actions : List Action :=
  [.request, .check, .hold, .refuse, .reply, .lose, .cancel] ++
  ([false, true].flatMap fun keep =>
    [.deliverAuthorized keep, .deliverDeclined keep, .deliverCancelled keep,
     .deliverConfirmed keep])

structure Property where
  name : String
  holds : World → Bool

def properties : List Property :=
  [ ⟨"a confirmed order has its money held or captured",
      fun w => w.order.status != .confirmed ||
        w.payment == some .authorized || w.payment == some .captured⟩,
    ⟨"a declined payment never stands beside a confirmed order",
      fun w => !(w.payment == some .declined && w.order.status == .confirmed)⟩,
    ⟨"once all is delivered, a cancelled order holds no money",
      fun w => !(decide w.quiet && w.order.status == .cancelled &&
        w.payment == some .authorized)⟩,
    ⟨"once all is delivered, a cancelled order has not been charged",
      fun w => !(decide w.quiet && w.order.status == .cancelled &&
        w.payment == some .captured)⟩ ]

/-- A world met by the search, with the actions that led to it, latest first. -/
abbrev Node := World × List Action

/-- The next level: every enabled action from every node, minus the worlds already seen. -/
def expand (seen : List Key) (level : List Node) : List Key × List Node :=
  level.foldl (init := (seen, [])) fun (seen, next) (w, path) =>
    actions.foldl (init := (seen, next)) fun (seen, next) a =>
      let w' := w.act a
      let k := key w'
      if seen.contains k then (seen, next) else (k :: seen, next ++ [(w', a :: path)])

/-- Every world reachable in at most `depth` actions, each with a shortest trace to it. -/
def reach (start : World) : Nat → List Key → List Node → List Node → List Node
  | 0, _, _, all => all
  | depth + 1, seen, level, all =>
    match expand seen level with
    | (_, []) => all
    | (seen, next) => reach start depth seen next (all ++ next)

def worlds (start : World) (depth : Nat) : List Node :=
  let first : Node := (start, [])
  reach start depth [key start] [first] [first]

def statusName : Status → String
  | .placed => "placed" | .confirmed => "confirmed" | .cancelled => "cancelled"

def paymentName : Option PayStatus → String
  | none => "none"
  | some .pending => "PENDING" | some .authorized => "AUTHORIZED"
  | some .captured => "CAPTURED" | some .declined => "DECLINED" | some .voided => "VOIDED"

def actionName : Action → String
  | .request => "OMS asks ledger to authorize"
  | .check => "ledger checks the record and the order"
  | .hold => "the gateway holds the money"
  | .refuse => "the gateway refuses"
  | .reply => "OMS applies the RPC answer"
  | .lose => "the RPC answer is lost"
  | .deliverAuthorized keep => s!"OMS hears PaymentAuthorized{again keep}"
  | .deliverDeclined keep => s!"OMS hears PaymentDeclined{again keep}"
  | .cancel => "the customer cancels"
  | .deliverCancelled keep => s!"ledger hears OrderCancelled{again keep}"
  | .deliverConfirmed keep => s!"delivery hears OrderConfirmed and captures{again keep}"
where
  again (keep : Bool) : String := if keep then " (kept for redelivery)" else ""

def describe (w : World) : String :=
  s!"order {statusName w.order.status}, payment {paymentName w.payment}"

def traceLines (start : World) (path : List Action) : List String :=
  let steps := path.reverse
  let (_, lines) := steps.foldl (init := (start, [])) fun (w, lines) a =>
    let w' := w.act a
    (w', lines ++ [s!"    {actionName a} → {describe w'}"])
  lines

def report (depth : Nat) : String :=
  let start := World.fresh Oms.Scenarios.start
  let all := worlds start depth
  let lines := properties.map fun p =>
    match all.find? (fun (w, _) => !p.holds w) with
    | none => s!"holds  {p.name} — in all {all.length} worlds"
    | some (_, path) =>
      "\n".intercalate (s!"BROKEN {p.name}:" :: traceLines start path)
  "\n".intercalate lines ++ "\n"

end Checkout.Search
