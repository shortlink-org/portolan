package extractflows

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

// A flow that names no source is sourced from its own file, spelled from the
// repository the file lives in: in a monorepo the workspace, root and all, and
// in a fetched copy the copy. A source the author typed is left as typed.
func TestSourcesAreSpelledFromTheRepository(t *testing.T) {
	t.Chdir(t.TempDir())
	own := "# Order accepted\nowner: shop\n\n## Participants\n- customer: actor\n\n## Steps\ncustomer -> shop.oms: rpc PlaceOrder\n"
	typed := "# Order paid\nowner: shop\nsource: services/oms/test/paid_test.go\n\n## Participants\n- customer: actor\n\n## Steps\ncustomer -> shop.oms: rpc PayOrder\n"
	for _, c := range []struct {
		in   plugin.Input
		want string
	}{
		{plugin.Input{Root: "examples/shop/oms"}, "examples/shop/oms/order-accepted.flow.md"},
		{plugin.Input{Root: "vendor/repos/acme/shop", Repository: "vendor/repos/acme/shop"}, "order-accepted.flow.md"},
	} {
		if err := os.MkdirAll(c.in.Root, 0o755); err != nil {
			t.Fatal(err)
		}
		for name, contents := range map[string]string{"order-accepted.flow.md": own, "order-paid.flow.md": typed} {
			if err := os.WriteFile(filepath.Join(c.in.Root, name), []byte(contents), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		resp, err := extract(c.in, Options{})
		if err != nil {
			t.Fatal(err)
		}
		var cat catalog.Catalog
		if err := json.Unmarshal([]byte(resp.Files[0].Contents), &cat); err != nil {
			t.Fatal(err)
		}
		if len(cat.Flows) != 2 {
			t.Fatalf("root %s: flows = %+v", c.in.Root, cat.Flows)
		}
		if got := cat.Flows[0].Source; got != c.want {
			t.Errorf("root %s: source = %q, want %q", c.in.Root, got, c.want)
		}
		if got := cat.Flows[1].Source; got != "services/oms/test/paid_test.go" {
			t.Errorf("root %s: a typed source became %q", c.in.Root, got)
		}
	}
}
