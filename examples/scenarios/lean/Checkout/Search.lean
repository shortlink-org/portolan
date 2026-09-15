import Checkout.World
import Oms.Scenarios

/-!
Breadth-first search over every interleaving from a freshly placed order. Two
worlds that agree on the order's status, the payment, the shipment, the RPC and
the counts on the bus are one world here. Most facts are said at most once, but
a capture asked again says `PaymentCaptured` again (ledger.0004), so the worlds
do not run out and the search stops at a depth; the report says so. What must
hold everywhere is proved in `Checkout.Invariants`, not searched.

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
  shipment : Option Ship
  capturedFacts : Nat
  refunded : Bool
  deriving DecidableEq

def key (w : World) : Key :=
  ⟨w.order.status, w.payment, w.rpc, w.authorizedFacts, w.declinedFacts, w.cancelledFacts,
   w.confirmedFacts, w.shipment, w.capturedFacts, w.refunded⟩

/-- Every action, the ordinary ones first — delivered once, published — so that the
shortest trace to a world is the one with the fewest mishaps in it. -/
def actions : List Action :=
  [.request, .reply, .cancel] ++
  [.hold] ++
  ([true, false].flatMap fun published => [.check published, .recheck published, .refuse published]) ++
  ([false, true].flatMap fun keep =>
    [.deliverAuthorized keep, .deliverDeclined keep, .deliverCancelled keep, .deliverCaptured keep]) ++
  ([true, false].flatMap fun published => [false, true].map fun keep =>
    .deliverConfirmed keep published) ++
  [.lose]

/-- Whether an action has ledger say what it did. -/
def publishes : Action → Bool
  | .check p | .recheck p | .refuse p | .deliverConfirmed _ p => p
  | _ => true

/-- The same actions, with every ledger publication leaving. -/
def reliable : List Action :=
  actions.filter publishes

/-- Nothing any action does changes the world any more. -/
def settled (w : World) : Bool :=
  actions.all fun a => key (w.act a) == key w

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
    ⟨"once all is delivered, a cancelled order charged has had its money sent back",
      fun w => !(decide w.quiet && w.order.status == .cancelled &&
        w.payment == some .captured && !w.refunded)⟩,
    ⟨"once nothing more can happen, the order is not left placed",
      fun w => !(settled w && w.order.status == .placed)⟩,
    ⟨"once all is delivered, money captured has released its shipment",
      fun w => !(decide w.quiet && w.payment == some .captured &&
        w.shipment != some .planned)⟩ ]

/-- A world met by the search, with the actions that led to it, latest first. -/
abbrev Node := World × List Action

/-- The next level: every enabled action from every node, minus the worlds already seen. -/
def expand (acts : List Action) (seen : List Key) (level : List Node) : List Key × List Node :=
  level.foldl (init := (seen, [])) fun (seen, next) (w, path) =>
    acts.foldl (init := (seen, next)) fun (seen, next) a =>
      let w' := w.act a
      let k := key w'
      if seen.contains k then (seen, next) else (k :: seen, next ++ [(w', a :: path)])

/-- Every world reachable in at most `depth` actions, each with a shortest trace to it, and
whether that is every reachable world: `false` when the search stopped at the depth. -/
def reach (acts : List Action) : Nat → List Key → List Node → List Node → List Node × Bool
  | 0, _, _, all => (all, false)
  | depth + 1, seen, level, all =>
    match expand acts seen level with
    | (_, []) => (all, true)
    | (seen, next) => reach acts depth seen next (all ++ next)

def worlds (acts : List Action) (start : World) (depth : Nat) : List Node × Bool :=
  let first : Node := (start, [])
  reach acts depth [key start] [first] [first]

def statusName : Status → String
  | .placed => "placed" | .confirmed => "confirmed" | .cancelled => "cancelled"

def paymentName : Option PayStatus → String
  | none => "none"
  | some .pending => "PENDING" | some .authorized => "AUTHORIZED"
  | some .captured => "CAPTURED" | some .declined => "DECLINED" | some .voided => "VOIDED"

def actionName : Action → String
  | .request => "OMS asks ledger to authorize"
  | .check p => s!"ledger checks the record and the order{lost p}"
  | .hold => "the gateway holds the money and ledger records it"
  | .recheck p => s!"ledger asks about the order again{lost p}"
  | .refuse p => s!"the gateway refuses{lost p}"
  | .reply => "OMS applies the RPC answer"
  | .lose => "the RPC answer is lost"
  | .deliverAuthorized keep => s!"OMS hears PaymentAuthorized{again keep}"
  | .deliverDeclined keep => s!"OMS hears PaymentDeclined{again keep}"
  | .cancel => "the customer cancels"
  | .deliverCancelled keep => s!"ledger hears OrderCancelled{again keep}"
  | .deliverConfirmed keep p => s!"delivery hears OrderConfirmed and asks to capture{lost p}{again keep}"
  | .deliverCaptured keep => s!"delivery hears PaymentCaptured{again keep}"
where
  again (keep : Bool) : String := if keep then " (kept for redelivery)" else ""
  lost (published : Bool) : String := if published then "" else " (ledger's event is lost)"

def shipmentName : Option Ship → String
  | none => "none" | some .awaitingPayment => "awaiting-payment" | some .planned => "planned"

def describe (w : World) : String :=
  s!"order {statusName w.order.status}, payment {paymentName w.payment}{if w.refunded then " refunded" else ""}, shipment {shipmentName w.shipment}"

def traceLines (start : World) (path : List Action) : List String :=
  let steps := path.reverse
  let (_, lines) := steps.foldl (init := (start, [])) fun (w, lines) a =>
    let w' := w.act a
    (w', lines ++ [s!"    {actionName a} → {describe w'}"])
  lines

/-- For each property: where it holds, or the shortest trace that breaks it — one where
ledger's events all leave if there is such a trace, since a loss is then not the cause. -/
def report (depth : Nat) : String :=
  let start := World.fresh Oms.Scenarios.start
  let (ordinary, _) := worlds reliable start depth
  let (all, complete) := worlds actions start depth
  let scope := if complete then s!"in all {all.length} worlds"
    else s!"in the {all.length} worlds within {depth} steps"
  let lines := properties.map fun p =>
    let broken (nodes : List Node) := nodes.find? fun (w, _) => !p.holds w
    match broken ordinary, broken all with
    | some (_, path), _ =>
      "\n".intercalate (s!"BROKEN {p.name}:" :: traceLines start path)
    | none, some (_, path) =>
      "\n".intercalate (s!"BROKEN {p.name}, only when ledger's event is lost:" ::
        traceLines start path)
    | none, none => s!"holds  {p.name} — {scope}"
  "\n".intercalate lines ++ "\n"

end Checkout.Search
