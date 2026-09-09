package extractsql

import (
	"flag"
	"os"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/plugin"
)

var updateFixtureGolden = flag.Bool("update", false, "rewrite the golden fragment instead of comparing against it")

const fixtureGoldenPath = "testdata/order/expected.json"

// DDL is meaningful in migration order and in its repository layout. This
// committed tree exercises those boundaries as well as the parser itself.
func fixtureResponse(t *testing.T) plugin.Response {
	t.Helper()

	resp := extract(
		plugin.Input{Root: "testdata/order", Commit: "abc1234", GeneratedAt: "2026-01-01T00:00:00Z"},
		Options{Context: "shop", Service: "order", Store: "pg", Name: "Order database"},
	)
	if len(resp.Files) != 1 || resp.Files[0].Name != "stores.json" {
		t.Fatalf("files = %+v", resp.Files)
	}

	return resp
}

func TestFixtureMatchesGoldenFragment(t *testing.T) {
	resp := fixtureResponse(t)
	got := resp.Files[0].Contents
	if warnings := resp.Warnings(); len(warnings) != 0 {
		t.Fatalf("warnings = %+v", warnings)
	}
	if *updateFixtureGolden {
		if err := os.WriteFile(fixtureGoldenPath, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}

	want, err := os.ReadFile(fixtureGoldenPath)
	if err != nil {
		t.Fatalf("reading golden: %v (run `go test ./plugins/extract-sql -update`)", err)
	}
	if string(want) != got {
		t.Fatalf("fixture differs from golden\n%s", fixtureFirstDifference(string(want), got))
	}
}

func fixtureFirstDifference(want, got string) string {
	a, b := strings.Split(want, "\n"), strings.Split(got, "\n")
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return "first differing line: want " + a[i] + "; got " + b[i]
		}
	}
	return "different line counts"
}
