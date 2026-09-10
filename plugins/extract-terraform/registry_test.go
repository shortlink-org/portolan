package extractterraform

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestNormalizeSource(t *testing.T) {
	cases := map[string]string{
		"terraform-aws-modules/lambda/aws":                                                                           "terraform-aws-modules/lambda/aws",
		"registry.terraform.io/terraform-aws-modules/sqs/aws":                                                        "terraform-aws-modules/sqs/aws",
		"git::https://github.com/terraform-aws-modules/terraform-aws-lambda.git?ref=v7.20.1":                         "terraform-aws-modules/lambda/aws",
		"github.com/terraform-aws-modules/terraform-aws-dynamodb-table?ref=03b38ee3":                                 "terraform-aws-modules/dynamodb-table/aws",
		"git@github.com:terraform-aws-modules/terraform-aws-sns.git":                                                 "terraform-aws-modules/sns/aws",
		"terraform-aws-modules/s3-bucket/aws//modules/notification":                                                  "terraform-aws-modules/s3-bucket/aws//modules/notification",
		"git::https://github.com/terraform-aws-modules/terraform-aws-s3-bucket.git//modules/notification?ref=v4.0.0": "terraform-aws-modules/s3-bucket/aws//modules/notification",
		"./modules/archive": "./modules/archive",
		"acme/thing/aws":    "acme/thing/aws",
	}
	for source, want := range cases {
		if got := normalizeSource(source); got != want {
			t.Errorf("%s: got %s, want %s", source, got, want)
		}
	}
	if known, _ := knownSource("terraform-aws-modules/lambda/aws"); known == nil || known.kind != typeFunction {
		t.Errorf("the lambda module is not known as a function")
	}
	if known, _ := knownSource("terraform-aws-modules/vpc/aws"); known != nil {
		t.Errorf("the vpc module is not one this reader knows")
	}
}

// The registry testdata against a golden, like the serverless one. Refresh
// with `go test ./plugins/extract-terraform -update`.
func TestRegistryGolden(t *testing.T) {
	resp, err := extract(plugin.Input{Root: filepath.Join("testdata", "registry")}, Options{Context: "shop", Service: "orders"})
	if err != nil {
		t.Fatal(err)
	}
	got := resp.Files[0].Contents
	golden := filepath.Join("testdata", "registry", "expected.json")
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

func TestRegistryModulesReadAsTheResourcesTheyWrap(t *testing.T) {
	out, resp := extracted(t, filepath.Join("testdata", "registry"), Options{Context: "shop", Service: "orders"})
	if got := warnings(resp); strings.Join(got, "\n") != "main.tf:160: module \"vpc\" comes from terraform-aws-modules/vpc/aws, which is not in this tree, and is not read" {
		t.Errorf("warnings: %v", got)
	}
	if got := serviceIDs(out); strings.Join(got, ",") != "shop.orders,shop.orders-audit,shop.orders-ingest" {
		t.Fatalf("services: %v - the layer module is not a function", got)
	}

	ingest := service(t, out, "shop.orders-ingest")
	if ingest.Kind != catalog.ComponentKindFunction || strings.Join(ingest.Technologies, ",") != "AWS Lambda,python3.12" {
		t.Errorf("ingest: %+v", ingest)
	}
	inbox := channel(t, ingest, "orders-inbox")
	for _, sentence := range []string{
		"Declared in Terraform as module.queue.",
		"Received by `orders-ingest` through an event source mapping.",
		"Subscribed to SNS topic `orders-events`.",
		"Dead letters go to `orders-inbox-dlq` after 5 receives.",
	} {
		if !strings.Contains(inbox.Doc, sentence) {
			t.Errorf("inbox lacks %q: %s", sentence, inbox.Doc)
		}
	}
	if events := channel(t, ingest, "orders-events"); events.Kind != catalog.ChannelKindEvent || !strings.Contains(events.Doc, "through SQS queue `orders-inbox`") {
		t.Errorf("events on ingest: %+v", events)
	}
	if got := strings.Join(ingest.Stores, ","); got != "shop.orders.orders-table,shop.orders.orders-uploads" {
		t.Errorf("ingest stores, from the environment and the bucket's notification and permission: %s", got)
	}

	audit := service(t, out, "shop.orders-audit")
	if strings.Join(audit.Technologies, ",") != "AWS Lambda,nodejs20.x" {
		t.Errorf("audit from a git source with a ref: %+v", audit)
	}
	if !strings.Contains(channel(t, audit, "orders-events").Doc, "through an SNS subscription") {
		t.Errorf("audit subscribed through the topic module's input: %+v", audit.Channels)
	}
	if got := strings.Join(audit.Stores, ","); got != "shop.orders.orders-table" {
		t.Errorf("audit reads the table through its stream output: %s", got)
	}

	base := service(t, out, "shop.orders")
	dlq := channel(t, base, "orders-inbox-dlq")
	if !strings.Contains(dlq.Doc, "Declared in Terraform as module.queue.dlq.") || !strings.Contains(dlq.Doc, "Dead-letter queue of `orders-inbox`.") || !strings.Contains(dlq.Doc, "Filled by S3 bucket `orders-uploads` on s3:ObjectRemoved:*.") {
		t.Errorf("the dead-letter queue the module makes: %s", dlq.Doc)
	}

	var table catalog.Store
	for _, st := range out.Stores {
		if st.ID == "shop.orders.orders-table" {
			table = st
		}
	}
	if table.Kind != catalog.StoreKindDynamoDB || len(table.Tables) != 1 || len(table.Tables[0].Columns) != 3 || len(table.Tables[0].Indexes) != 1 {
		t.Errorf("table from attributes as a list: %+v", table)
	}
	if table.Tables[0].Evidence[0].Symbol != "module.table" {
		t.Errorf("evidence names the module call: %+v", table.Tables[0].Evidence)
	}
}
