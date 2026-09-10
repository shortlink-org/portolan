package extractterraform

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

var update = flag.Bool("update", false, "rewrite testdata/*/expected.json")

func extracted(t *testing.T, root string, opts Options) (catalog.Catalog, plugin.Response) {
	t.Helper()
	if opts.Context == "" {
		opts.Context = "shop"
	}
	if opts.Service == "" {
		opts.Service = "fulfillment"
	}
	resp, err := extract(plugin.Input{Root: root}, opts)
	if err != nil {
		t.Fatal(err)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}
	return out, resp
}

func warnings(resp plugin.Response) []string {
	var out []string
	for _, warning := range resp.Warnings() {
		out = append(out, warning.Ref+": "+warning.Message)
	}
	sort.Strings(out)
	return out
}

func service(t *testing.T, out catalog.Catalog, id string) catalog.Service {
	t.Helper()
	for _, svc := range out.Contexts[0].Services {
		if svc.ID == id {
			return svc
		}
	}
	t.Fatalf("no service %s among %v", id, serviceIDs(out))
	return catalog.Service{}
}

func serviceIDs(out catalog.Catalog) []string {
	var ids []string
	for _, svc := range out.Contexts[0].Services {
		ids = append(ids, svc.ID)
	}
	return ids
}

func channel(t *testing.T, svc catalog.Service, address string) catalog.Channel {
	t.Helper()
	for _, ch := range svc.Channels {
		if ch.Address == address {
			return ch
		}
	}
	var have []string
	for _, ch := range svc.Channels {
		have = append(have, ch.Address)
	}
	t.Fatalf("%s lists no channel %s; has %v", svc.ID, address, have)
	return catalog.Channel{}
}

func write(t *testing.T, root, name, contents string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

// The whole module, against a golden: the fragment as reviewed. Refresh with
// `go test ./plugins/extract-terraform -update`.
func TestServerlessGolden(t *testing.T) {
	resp, err := extract(plugin.Input{Root: filepath.Join("testdata", "serverless")}, Options{Context: "shop", Service: "fulfillment"})
	if err != nil {
		t.Fatal(err)
	}
	got := resp.Files[0].Contents
	golden := filepath.Join("testdata", "serverless", "expected.json")
	if *update {
		if err := os.WriteFile(golden, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal([]byte(got), want) {
		t.Errorf("fragment differs from %s; run with -update after reviewing:\n%s", golden, got)
	}
}

func TestServerlessWarnings(t *testing.T) {
	_, resp := extracted(t, filepath.Join("testdata", "serverless"), Options{})
	got := warnings(resp)
	want := []string{
		"data.tf:76: bucket of aws_s3_bucket.uploads is `fulfillment-uploads-{suffix}`, with {suffix} decided at apply time",
		"data.tf:80: name of aws_sqs_queue.per_account is `fulfillment-events-{account_id}`, with {account_id} decided at apply time",
		"data.tf:83: aws_kinesis_stream.clicks is not read: Kinesis is not part of this reader yet",
		"lambda.tf:52: aws_lambda_function.unnamed sets no function_name, so its name is decided at apply time and is not read",
		"main.tf:36: module \"vpc\" comes from terraform-aws-modules/vpc/aws, which is not in this tree, and is not read",
		"messaging.tf:40: aws_sqs_queue.generated is named with name_prefix, so its name is decided at apply time and is not read",
		"messaging.tf:45: name of aws_sqs_queue.opaque could not be resolved to a literal, a variable default, a local or a module argument",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("warnings:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestFunctionsBecomeComponentsAndReadTheirTriggers(t *testing.T) {
	out, _ := extracted(t, filepath.Join("testdata", "serverless"), Options{})
	if got := serviceIDs(out); strings.Join(got, ",") != "shop.fulfillment,shop.fulfillment-notify,shop.fulfillment-reindex,shop.fulfillment-ship" {
		t.Fatalf("services: %v", got)
	}

	ship := service(t, out, "shop.fulfillment-ship")
	if ship.Kind != catalog.ComponentKindFunction || strings.Join(ship.Technologies, ",") != "AWS Lambda,python3.12" {
		t.Errorf("ship: kind %q technologies %v", ship.Kind, ship.Technologies)
	}
	orders := channel(t, ship, "fulfillment-orders")
	if orders.Kind != catalog.ChannelKindMessage || orders.Source != "messaging.tf:11" {
		t.Errorf("orders: %+v", orders)
	}
	for _, sentence := range []string{
		"Received by `fulfillment-ship` through an event source mapping.",
		"Subscribed to SNS topic `fulfillment-order-events`.",
		"Dead letters go to `fulfillment-orders-dlq` after 4 receives.",
	} {
		if !strings.Contains(orders.Doc, sentence) {
			t.Errorf("orders doc lacks %q: %s", sentence, orders.Doc)
		}
	}
	events := channel(t, ship, "fulfillment-order-events")
	if events.Kind != catalog.ChannelKindEvent || !strings.Contains(events.Doc, "through SQS queue `fulfillment-orders`") {
		t.Errorf("events on ship: %+v", events)
	}
	audit := channel(t, ship, "fulfillment-audit.fifo")
	if !strings.Contains(audit.Doc, "FIFO.") || !strings.Contains(audit.Doc, "Handed to `fulfillment-ship` as `AUDIT_QUEUE_URL`") || !strings.Contains(audit.Doc, "Filled by S3 bucket `fulfillment-labels` on s3:ObjectRemoved:*.") {
		t.Errorf("audit: %s", audit.Doc)
	}
	if got := strings.Join(ship.Stores, ","); got != "shop.fulfillment.fulfillment-archive,shop.fulfillment.fulfillment-labels,shop.fulfillment.fulfillment-orders" {
		t.Errorf("ship stores: %s", got)
	}

	notify := service(t, out, "shop.fulfillment-notify")
	if !strings.Contains(channel(t, notify, "fulfillment-order-events").Doc, "through an SNS subscription") {
		t.Errorf("notify: %+v", notify.Channels)
	}
	if got := strings.Join(notify.Stores, ","); got != "shop.fulfillment.fulfillment-labels" {
		t.Errorf("notify stores from the bucket notification: %s", got)
	}

	reindex := service(t, out, "shop.fulfillment-reindex")
	if got := strings.Join(reindex.Stores, ","); got != "shop.fulfillment.fulfillment-orders" {
		t.Errorf("reindex reads the table through its stream: %s", got)
	}
}

func TestUnclaimedInfrastructureSitsOnTheBaseService(t *testing.T) {
	out, _ := extracted(t, filepath.Join("testdata", "serverless"), Options{})
	base := service(t, out, "shop.fulfillment")
	if base.Kind != "" {
		t.Errorf("the base service is not a function: %q", base.Kind)
	}
	dlq := channel(t, base, "fulfillment-orders-dlq")
	if !strings.Contains(dlq.Doc, "Dead-letter queue of `fulfillment-orders`.") {
		t.Errorf("dlq: %s", dlq.Doc)
	}
	legacy := channel(t, base, "legacy")
	if !strings.Contains(legacy.Doc, "Dead letters go to `legacy-dlq` after 10 receives.") || !strings.Contains(legacy.Doc, "Nothing in the module receives from it") {
		t.Errorf("legacy, whose policy is a JSON string: %s", legacy.Doc)
	}
	if got := strings.Join(base.Stores, ","); got != "shop.fulfillment.fulfillment-archive,shop.fulfillment.fulfillment-labels,shop.fulfillment.fulfillment-ledger,shop.fulfillment.fulfillment-orders,shop.fulfillment.fulfillment-reporting,shop.fulfillment.fulfillment-uploads-suffix" {
		t.Errorf("base owns every store: %s", got)
	}
	perAccount := channel(t, base, "fulfillment-events-{account_id}")
	if perAccount.Source != "data.tf:79" {
		t.Errorf("a name decided at apply time in part keeps its shape: %+v", perAccount)
	}
	for _, st := range out.Stores {
		if st.Slug == "fulfillment-uploads-suffix" && st.Name != "fulfillment-uploads-{suffix}" {
			t.Errorf("the bucket keeps its shape as its name: %+v", st)
		}
	}
	for _, svc := range out.Contexts[0].Services {
		for _, ch := range svc.Channels {
			if ch.Address == "tmp-" || ch.Address == "generated" || ch.Address == "opaque" {
				t.Errorf("%s lists %s, whose name is not known", svc.ID, ch.Address)
			}
		}
	}
}

func TestStores(t *testing.T) {
	out, _ := extracted(t, filepath.Join("testdata", "serverless"), Options{})
	byID := map[string]catalog.Store{}
	for _, st := range out.Stores {
		byID[st.ID] = st
	}
	table := byID["shop.fulfillment.fulfillment-orders"]
	if table.Kind != catalog.StoreKindDynamoDB || table.Owner != "shop.fulfillment" || len(table.Tables) != 1 {
		t.Fatalf("dynamodb: %+v", table)
	}
	var columns []string
	for _, col := range table.Tables[0].Columns {
		columns = append(columns, col.Name+":"+col.Type+":"+map[bool]string{true: "pk", false: ""}[col.PK])
	}
	if got := strings.Join(columns, " "); got != "order_id:S:pk version:N:pk customer_id:S:" {
		t.Errorf("columns, keys first: %s", got)
	}
	var indexes []string
	for _, idx := range table.Tables[0].Indexes {
		indexes = append(indexes, idx.Name+"("+strings.Join(idx.Columns, ",")+")")
	}
	if got := strings.Join(indexes, " "); got != "by_customer(customer_id,version) by_version(order_id,version)" {
		t.Errorf("indexes: %s", got)
	}
	if table.Tables[0].ID != "shop.fulfillment.fulfillment-orders.fulfillment-orders" || table.Tables[0].Evidence[0].Symbol != "aws_dynamodb_table.orders" {
		t.Errorf("table id and evidence: %+v", table.Tables[0])
	}
	if byID["shop.fulfillment.fulfillment-reporting"].Kind != catalog.StoreKindPostgres || byID["shop.fulfillment.fulfillment-ledger"].Kind != catalog.StoreKindMySQL {
		t.Errorf("rds kinds: %+v %+v", byID["shop.fulfillment.fulfillment-reporting"], byID["shop.fulfillment.fulfillment-ledger"])
	}
	archive := byID["shop.fulfillment.fulfillment-archive"]
	if archive.Kind != catalog.StoreKindS3 || archive.Source != "modules/archive/main.tf:5" {
		t.Errorf("the bucket in the called module, named through its argument: %+v", archive)
	}
}

func TestTheFunctionNamedLikeTheServiceIsTheService(t *testing.T) {
	root := t.TempDir()
	write(t, root, "main.tf", `
resource "aws_lambda_function" "this" {
  function_name = "notify"
  runtime       = "nodejs20.x"
}
resource "aws_sqs_queue" "in" {
  name = "notify-in"
}
resource "aws_lambda_event_source_mapping" "in" {
  event_source_arn = aws_sqs_queue.in.arn
  function_name    = aws_lambda_function.this.function_name
}
`)
	out, _ := extracted(t, root, Options{Context: "shop", Service: "notify"})
	if got := serviceIDs(out); strings.Join(got, ",") != "shop.notify" {
		t.Fatalf("services: %v", got)
	}
	svc := out.Contexts[0].Services[0]
	if svc.Kind != catalog.ComponentKindFunction || svc.Name != "notify" || len(svc.Channels) != 1 {
		t.Errorf("service: %+v", svc)
	}
}

func TestFindsTheOneDirectoryWithTerraform(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "deploy/terraform/main.tf", "resource \"aws_sqs_queue\" \"q\" {\n  name = \"deep\"\n}\n")
	write(t, root, "node_modules/x/main.tf", "resource \"aws_sqs_queue\" \"q\" {\n  name = \"ignored\"\n}\n")
	out, resp := extracted(t, root, Options{})
	base := out.Contexts[0].Services[0]
	if len(base.Channels) != 1 || base.Channels[0].Address != "deep" || base.Channels[0].Source != "deploy/terraform/main.tf:1" {
		t.Errorf("channels: %+v", base.Channels)
	}
	if len(warnings(resp)) != 0 {
		t.Errorf("warnings: %v", warnings(resp))
	}
}

func TestNothingFoundIsSaidOnce(t *testing.T) {
	root := t.TempDir()
	write(t, root, "main.tf", "resource \"aws_iam_role\" \"r\" {\n  name = \"r\"\n}\n")
	out, resp := extracted(t, root, Options{})
	if len(out.Contexts[0].Services) != 1 || len(out.Contexts[0].Services[0].Channels) != 0 || len(out.Stores) != 0 {
		t.Errorf("fragment: %+v", out)
	}
	got := warnings(resp)
	if len(got) != 1 || !strings.HasSuffix(got[0], "no AWS resource this reader knows was found") {
		t.Errorf("warnings: %v", got)
	}
}

func TestBrokenFileIsReportedAndTheRestRead(t *testing.T) {
	root := t.TempDir()
	write(t, root, "a.tf", "resource \"aws_sqs_queue\" \"q\" {\n  name = \"ok\"\n}\n")
	write(t, root, "b.tf", "resource \"aws_sqs_queue\" {\n")
	out, resp := extracted(t, root, Options{})
	if len(out.Contexts[0].Services[0].Channels) != 1 {
		t.Errorf("channels: %+v", out.Contexts[0].Services[0].Channels)
	}
	got := warnings(resp)
	if len(got) != 1 || !strings.HasPrefix(got[0], "b.tf: could not be parsed") {
		t.Errorf("warnings: %v", got)
	}
}

func TestSameFragmentWhateverTheFileOrder(t *testing.T) {
	first := t.TempDir()
	second := t.TempDir()
	queue := "resource \"aws_sqs_queue\" \"q\" {\n  name = \"orders\"\n}\n"
	fn := "resource \"aws_lambda_function\" \"f\" {\n  function_name = \"worker\"\n}\nresource \"aws_lambda_event_source_mapping\" \"m\" {\n  event_source_arn = aws_sqs_queue.q.arn\n  function_name    = aws_lambda_function.f.arn\n}\n"
	write(t, first, "a.tf", queue)
	write(t, first, "b.tf", fn)
	write(t, second, "a.tf", fn)
	write(t, second, "b.tf", queue)
	one, _ := extract(plugin.Input{Root: first}, Options{Context: "c", Service: "s"})
	two, _ := extract(plugin.Input{Root: second}, Options{Context: "c", Service: "s"})
	strip := func(text string) string {
		return strings.NewReplacer("a.tf", "x.tf", "b.tf", "x.tf").Replace(text)
	}
	if strip(one.Files[0].Contents) != strip(two.Files[0].Contents) {
		t.Errorf("order-dependent output:\n%s\n---\n%s", one.Files[0].Contents, two.Files[0].Contents)
	}
}
