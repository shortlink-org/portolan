package main

import (
	"reflect"
	"testing"
)

// The note names the table it stands above, and only that one. A bare slug is
// an aggregate of the store's owner; a dotted name is somebody's full id.
func TestAggregateNoteBindsToTheNextCreateTable(t *testing.T) {
	got := readProjected(`
-- Planned stops, rebuilt from RoutePlanned.
-- aggregate: shop.oms.order
CREATE TABLE route_stops (
    route_id text NOT NULL
);

-- aggregate: price_list
CREATE TABLE IF NOT EXISTS board.prices (
    id text PRIMARY KEY
);

CREATE TABLE seen (
    id text PRIMARY KEY
);`, "shop.delivery")

	want := map[string]string{
		"route_stops": "shop.oms.order",
		"prices":      "shop.delivery.price-list",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("projected = %v, want %v", got, want)
	}
}

// A note that a statement gets in front of was not about the table after it,
// and a note nothing follows says nothing.
func TestAggregateNoteDoesNotReachPastAStatement(t *testing.T) {
	got := readProjected(`
-- aggregate: shop.oms.order
CREATE INDEX route_stops_by_route ON route_stops (route_id);
CREATE TABLE route_stops_copy (
    route_id text NOT NULL
);
-- aggregate: shop.oms.order`, "shop.delivery")

	if len(got) != 0 {
		t.Errorf("no table should carry the note, got %v", got)
	}
}
