import Checkout.Search

/-- Prints what the search finds for each property of the checkout. -/
def main : IO Unit :=
  IO.print (Checkout.Search.report 40)
