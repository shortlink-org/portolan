package wsdl

import "testing"

func TestAPIIDsOnlyVersionCollidingContracts(t *testing.T) {
	contracts := []Contract{
		{Name: "BookingService", Source: "booking_1.0_4.0.wsdl", Interfaces: []Interface{{Name: "BookingPort"}}},
		{Name: "BookingService", Source: "booking_1.2_4.0.wsdl", Interfaces: []Interface{{Name: "BookingPort"}}},
		{Name: "StatusService", Source: "status.wsdl", Interfaces: []Interface{{Name: "StatusPort"}}},
	}
	ids := APIIDs(contracts)
	if got := ids[ContractKey(contracts[0])]; got != "bookingservice.soap.v1-0" {
		t.Fatalf("v1 id = %q", got)
	}
	if got := ids[ContractKey(contracts[1])]; got != "bookingservice.soap.v1-2" {
		t.Fatalf("v1.2 id = %q", got)
	}
	if got := ids[ContractKey(contracts[2])]; got != "statusservice.soap" {
		t.Fatalf("unrelated id = %q", got)
	}
}
