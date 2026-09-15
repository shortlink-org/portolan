import Oms.Policy

/-!
Scenarios for the Rust tests: every sequence of messages from a small alphabet,
up to a length, with what `Order.run` says the order ends as. The expectations
come from the same `run` the theorems are about, so a Rust test that agrees with
this file agrees with a model whose properties are proved.
-/

namespace Oms.Scenarios

def eur (n : Int) : Money := ⟨n, "EUR"⟩

/-- The order every scenario starts from: one line of tea, just placed. -/
def start : Order :=
  { id := "o1"
    lines := [{ sku := "tea", quantity := 2, unitPrice := eur 450 }]
    total := eur 900
    status := .placed }

/-- The messages a scenario is made of, each under the name the fixture gives it. -/
def alphabet : List (String × Msg) :=
  [ ("authorize",             .authorized "o1" (eur 900)),
    ("authorizeOtherAmount",  .authorized "o1" (eur 800)),
    ("authorizeOtherPayment", .authorized "o2" (eur 900)),
    ("decline",               .declined "o1"),
    ("declineOtherPayment",   .declined "o2"),
    ("cancel",                .cancelRequested) ]

/-- Every sequence of exactly `n` messages from the alphabet. -/
def sequencesOf : Nat → List (List (String × Msg))
  | 0 => [[]]
  | n + 1 => alphabet.flatMap fun m => (sequencesOf n).map (m :: ·)

/-- Every sequence of one to `n` messages from the alphabet. -/
def upTo (n : Nat) : List (List (String × Msg)) :=
  (List.range n).flatMap fun k => sequencesOf (k + 1)

/-! JSON, written by hand: the values are ids, names and numbers, nothing to escape. -/

def quote (s : String) : String := "\"" ++ s ++ "\""

def obj (fields : List (String × String)) : String :=
  "{" ++ ",".intercalate (fields.map fun (k, v) => quote k ++ ":" ++ v) ++ "}"

def arr (items : List String) : String :=
  "[" ++ ",".intercalate items ++ "]"

def moneyJson (m : Money) : String :=
  obj [("amountMinor", toString m.amountMinor), ("currency", quote m.currency)]

def msgJson : Msg → String
  | .authorized pid amount =>
    obj [("kind", quote "authorized"), ("paymentId", quote pid), ("amount", moneyJson amount)]
  | .declined pid =>
    obj [("kind", quote "declined"), ("paymentId", quote pid)]
  | .cancelRequested =>
    obj [("kind", quote "cancelRequested")]

/-- The status as Rust spells it, `Status::as_str`. -/
def statusName : Status → String
  | .placed    => "placed"
  | .confirmed => "confirmed"
  | .cancelled => "cancelled"

/-- The event as Rust names it, `Event::name`. -/
def eventName : Event → String
  | .confirmed => "oms.OrderConfirmed"
  | .cancelled => "oms.OrderCancelled"

def scenarioJson (ms : List (String × Msg)) : String :=
  let result := start.run (ms.map (·.2))
  obj [ ("messages", arr (ms.map fun (name, _) => quote name)),
        ("status", quote (statusName result.1.status)),
        ("events", arr (result.2.map fun e => quote (eventName e))) ]

/-- The whole fixture: the starting order, the alphabet, and one scenario per line. -/
def document (n : Nat) : String :=
  "{\n" ++
  quote "order" ++ ":" ++ obj [("id", quote start.id), ("total", moneyJson start.total)] ++ ",\n" ++
  quote "messages" ++ ":" ++ obj (alphabet.map fun (name, m) => (name, msgJson m)) ++ ",\n" ++
  quote "scenarios" ++ ":[\n" ++
  ",\n".intercalate ((upTo n).map scenarioJson) ++
  "\n]\n}\n"

end Oms.Scenarios
