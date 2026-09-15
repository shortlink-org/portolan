import Oms.Scenarios

/-- Prints the fixture for `tests/lean_scenarios.rs`: every sequence of up to four messages. -/
def main : IO Unit :=
  IO.print (Oms.Scenarios.document 4)
