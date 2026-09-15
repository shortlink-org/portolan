namespace Oms

/-- Where an order is in its life. -/
inductive Status where
  | placed
  | confirmed
  | cancelled
  deriving Repr, DecidableEq

namespace Status

/-- Where an order can go from where it is. -/
def targets : Status → List Status
  | .placed    => [.confirmed, .cancelled]
  | .confirmed => [.cancelled]
  | .cancelled => []

def canMove (current next : Status) : Bool :=
  (targets current).contains next

/-- Out of placed, an order can be confirmed. -/
theorem placed_can_confirm : canMove .placed .confirmed = true := by
  decide

/-- Nothing leads out of cancelled. -/
theorem cancelled_is_terminal (s : Status) : canMove .cancelled s = false := by
  cases s <;> decide

end Status
end Oms
