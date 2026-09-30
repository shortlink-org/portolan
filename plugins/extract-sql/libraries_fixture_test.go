package extractsql

import (
	"os"
	"testing"

	"github.com/shortlink-org/portolan/plugin"
)

// One committed tree per library, each read end to end into the fragment the
// catalog gets. `go test ./plugins/extract-sql -update` rewrites them.
func TestLibraryFixturesMatchGoldenFragments(t *testing.T) {
	for _, library := range []string{"gorm", "sqlx", "sqlc", "ent", "squirrel"} {
		t.Run(library, func(t *testing.T) {
			root := "testdata/" + library
			resp := extract(plugin.Input{Root: root}, Options{Context: "shop", Service: library, Store: "pg"})
			if warnings := resp.Warnings(); len(warnings) != 0 {
				t.Fatalf("warnings = %+v", warnings)
			}
			if len(resp.Files) != 1 {
				t.Fatalf("files = %+v", resp.Files)
			}
			got := resp.Files[0].Contents
			golden := root + "/expected.json"
			if *updateFixtureGolden {
				if err := os.WriteFile(golden, []byte(got), 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(golden)
			if err != nil {
				t.Fatalf("reading golden: %v (run `go test ./plugins/extract-sql -update`)", err)
			}
			if string(want) != got {
				t.Fatalf("fixture differs from golden\n%s", fixtureFirstDifference(string(want), got))
			}
		})
	}
}
