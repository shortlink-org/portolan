/-!
Ledger's payment, as `PaymentStatus.java` has it. `AuthorizePayment` saves a
payment already authorized or declined, so `pending` is a state the model never
stores; it is here because the table has it.
-/

namespace Checkout

inductive PayStatus where
  | pending
  | authorized
  | captured
  | declined
  | voided
  deriving Repr, DecidableEq

namespace PayStatus

/-- `PaymentStatus.TRANSITIONS`. -/
def targets : PayStatus → List PayStatus
  | .pending    => [.authorized, .declined]
  | .authorized => [.captured, .voided]
  | .captured   => []
  | .declined   => []
  | .voided     => []

def canMove (current next : PayStatus) : Bool :=
  (targets current).contains next

/-- The gateway held the money at some point. -/
def granted : PayStatus → Bool
  | .authorized | .captured | .voided => true
  | .pending | .declined => false

end PayStatus

/-- A payment on record whose money was held at some point. -/
def grantedOpt : Option PayStatus → Bool
  | some p => p.granted
  | none => false

end Checkout
