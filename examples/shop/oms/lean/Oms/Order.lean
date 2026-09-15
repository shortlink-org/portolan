import Oms.Status

namespace Oms

/-- An amount in the minor unit of a currency: 1999 EUR is 19.99. -/
structure Money where
  amountMinor : Int
  currency : String
  deriving Repr, DecidableEq

structure Line where
  sku : String
  quantity : Nat
  unitPrice : Money
  deriving Repr

/-- Why an order was not placed. -/
inductive PlaceError where
  | empty
  | currency
  deriving Repr, DecidableEq

structure Order where
  id : String
  lines : List Line
  total : Money
  status : Status
  deriving Repr

namespace Order

/-- An order from a checked-out basket (ADR oms.0002). -/
def place (id : String) (lines : List Line) (total : Money) : Except PlaceError Order :=
  if lines.isEmpty then
    .error .empty
  else if lines.any (fun l => l.unitPrice.currency != total.currency) then
    .error .currency
  else
    .ok { id := id, lines := lines, total := total, status := .placed }

/-- A placed order starts in `placed`. -/
theorem place_starts_placed {id : String} {lines : List Line} {total : Money} {o : Order}
    (h : place id lines total = .ok o) : o.status = .placed := by
  unfold place at h
  split at h
  · contradiction
  · split at h
    · contradiction
    · cases h
      rfl

/-- A placed order has at least one line. -/
theorem place_has_lines {id : String} {lines : List Line} {total : Money} {o : Order}
    (h : place id lines total = .ok o) : o.lines ≠ [] := by
  unfold place at h
  split at h
  · contradiction
  · split at h
    · contradiction
    · cases h
      simp_all

/-- Every line of a placed order is priced in the order's currency. -/
theorem place_one_currency {id : String} {lines : List Line} {total : Money} {o : Order}
    (h : place id lines total = .ok o) :
    ∀ l ∈ o.lines, l.unitPrice.currency = o.total.currency := by
  unfold place at h
  split at h
  · contradiction
  · split at h
    · contradiction
    · cases h
      simp_all

end Order
end Oms