"""The reader, held to a fixture.

`testdata/billing` is a Django service in the layout this plugin reads, each
shape it claims to read present once; `expected.json` and `expected-stores.json`
are what it comes out as. Set UPDATE_GOLDEN=1 to write them again after a
deliberate change, and read the diff.
"""

import ast
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(1, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pyplugin"))

from extract import extract, response_statuses  # noqa: E402
from options import Options  # noqa: E402
from protocol import Builder, Input  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FIXTURE = os.path.relpath(os.path.join(HERE, "testdata", "billing"), ROOT)

OPTIONS = {
    "context": "shop",
    "service": "billing",
    "store": "pg",
    "peers": {"pricing.v1": "shop.pricing"},
    "events": {"payments.events": "payments.ledger.payment"},
}


def run(options):
    b = Builder()
    extract(
        Input(root=FIXTURE, output=FIXTURE + "/portolan", commit="abc1234", generated_at="2026-09-05T00:00:00Z"),
        Options.of(options),
        b,
        cwd=ROOT,
    )
    return {f.name: f.contents for f in b.files}, b.warnings


class Fragment(unittest.TestCase):
    def setUp(self):
        self.files, self.warnings = run(OPTIONS)

    def golden(self, name, contents):
        path = os.path.join(HERE, "testdata", "billing", name)
        if os.environ.get("UPDATE_GOLDEN"):
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(contents)
        with open(path, "r", encoding="utf-8") as handle:
            self.assertEqual(json.loads(handle.read()), json.loads(contents))

    def test_the_service_it_reads(self):
        self.golden("expected.json", self.files["domain.json"])

    def test_the_database_the_models_describe(self):
        self.golden("expected-stores.json", self.files["stores.json"])

    def test_the_inferred_http_contract_is_a_standard_openapi_document(self):
        spec = json.loads(self.files["openapi.inferred.yaml"])
        self.assertEqual(spec["openapi"], "3.1.0")
        self.assertTrue(spec["x-portolan-inferred"])
        self.assertEqual(spec["x-portolan-generator"], "extract-django")
        self.assertEqual(
            sorted(spec["paths"]["/api/invoices/{id}/"]),
            ["delete", "get", "patch", "put"],
        )
        retrieve = spec["paths"]["/api/invoices/{id}/"]["get"]
        self.assertEqual(retrieve["operationId"], "invoices_invoice_retrieve")
        self.assertEqual(retrieve["parameters"][0]["name"], "id")
        self.assertEqual(
            retrieve["responses"]["200"]["content"]["application/json"]["schema"],
            {
                "type": "object",
                "properties": {"data": {"$ref": "#/components/schemas/InvoiceSerializer"}},
                "required": ["data"],
            },
        )
        self.assertEqual(retrieve["responses"]["404"]["content"]["application/json"]["schema"], {"type": "object", "properties": {}})
        self.assertNotIn("requestBody", retrieve)
        create = spec["paths"]["/api/invoices/"]["post"]
        self.assertEqual(create["responses"]["201"]["content"]["application/json"]["schema"], {"$ref": "#/components/schemas/InvoiceCreateSerializer"})
        self.assertEqual(create["requestBody"]["content"]["application/json"]["schema"], {"$ref": "#/components/schemas/InvoiceCreateSerializer"})
        self.assertEqual(
            spec["components"]["schemas"]["InvoiceCreateSerializer"]["properties"]["currency"],
            {"type": "string", "maxLength": 3, "minLength": 3},
        )
        self.assertEqual(spec["paths"]["/api/invoices/"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["type"], "array")
        self.assertEqual(
            spec["paths"]["/api/invoices/{id}/"]["put"]["responses"]["200"]["content"]["application/json"]["schema"],
            {"$ref": "#/components/schemas/InvoiceSerializer"},
        )
        self.assertEqual(
            spec["paths"]["/api/invoices/{id}/"]["delete"]["responses"],
            {"204": {"description": "Documented response."}},
        )

        schema = spec["components"]["schemas"]["InvoiceSerializer"]
        self.assertEqual(schema["properties"]["id"], {"type": "string", "format": "uuid", "readOnly": True})
        self.assertEqual(schema["properties"]["order_id"]["description"], "The order this invoice is drawn up for.")
        self.assertEqual(schema["properties"]["number"]["type"], ["string", "null"])
        self.assertEqual(schema["properties"]["note"], {"type": "string", "maxLength": 200})
        self.assertTrue(schema["properties"]["secret"]["writeOnly"])
        self.assertNotIn("id", schema["required"])
        self.assertIn("currency", schema["required"])
        self.assertIn("secret", schema["required"])
        envelope = spec["components"]["schemas"]["InvoiceEnvelopeSerializer"]
        self.assertIn("currency", envelope["properties"])
        self.assertEqual(
            envelope["properties"]["lines"],
            {"type": "array", "items": {"$ref": "#/components/schemas/InvoiceLineSerializer"}},
        )

        parameter = {item["name"]: item for item in retrieve["parameters"]}
        self.assertEqual(parameter["currency"]["schema"], {"type": "string", "default": "USD"})
        self.assertEqual(parameter["limit"]["schema"], {"type": "integer", "default": 25})
        self.assertTrue(parameter["partner"]["required"])
        self.assertEqual(parameter["status"]["description"], "Declared by DRF filterset_fields.")
        self.assertIn("search", parameter)
        self.assertIn("ordering", parameter)

        issue = spec["paths"]["/api/invoices/{id}/issue/"]["post"]
        self.assertEqual(issue["operationId"], "issue_invoice")
        self.assertEqual(issue["description"], "Issues an invoice and returns the resulting event id.")
        self.assertEqual(issue["tags"], ["invoice commands"])
        self.assertEqual(issue["requestBody"]["content"]["application/json"]["schema"], {"$ref": "#/components/schemas/InvoiceCreateSerializer"})
        self.assertEqual(issue["responses"]["200"]["description"], "Invoice accepted.")
        self.assertEqual(
            issue["responses"]["200"]["content"]["application/json"]["schema"],
            {"type": "object", "properties": {"invoiceId": {"type": "string"}}, "required": ["invoiceId"]},
        )
        self.assertNotIn("content", issue["responses"]["409"])
        self.assertEqual(next(item for item in issue["parameters"] if item["name"] == "dry_run")["schema"], {"type": "boolean"})

        destroy = spec["paths"]["/api/invoices/{id}/"]["delete"]
        self.assertEqual(destroy["summary"], "Void an invoice")
        self.assertEqual(destroy["responses"], {"204": {"description": "Documented response."}})
        self.assertEqual(next(item for item in destroy["parameters"] if item["name"] == "notify")["schema"], {"type": "boolean"})

    def test_the_host_output_directory_is_part_of_the_plugin_input(self):
        self.assertEqual(Input.of({"root": "service", "output": "generated/api"}).output, "generated/api")

    def test_response_statuses_are_read_from_keyword_and_positional_drf_responses(self):
        node = ast.parse(
            "def post(request):\n"
            "    if request.data:\n"
            "        return Response({}, status=status.HTTP_201_CREATED)\n"
            "    return Response({}, status.HTTP_400_BAD_REQUEST)\n"
        ).body[0]
        self.assertEqual(response_statuses(node), ["201", "400"])

    def test_what_it_reports_beside_them(self):
        self.assertEqual(
            [(d.severity, d.ref.split("/")[-1]) for d in self.warnings],
            [("warning", "shop.billing.invoice.InvoiceVoided"), ("warning", "handlers.py:19")],
        )
        self.assertIn("a signal declares no payload", self.warnings[0].message)
        self.assertTrue(self.warnings[1].message.startswith("index_invoice runs on post_save of Invoice: a policy hanging on a persistence hook"))

    def test_without_a_store_the_models_describe_no_database(self):
        options = dict(OPTIONS)
        del options["store"]
        files, warnings = run(options)
        self.assertEqual(list(files), ["domain.json", "openapi.inferred.yaml"])
        self.assertIn("`store` is what says which one they are the schema of", " ".join(d.message for d in warnings))

    def test_the_store_kind_is_read_off_the_settings_and_the_manifest_wins_when_it_speaks(self):
        _, warnings = run(OPTIONS)
        self.assertEqual(json.loads(self.files["stores.json"])["stores"][0]["kind"], "postgres")
        self.assertFalse([w for w in warnings if "storeKind" in w.message])
        files, warnings = run(dict(OPTIONS, storeKind="sqlite"))
        self.assertEqual(json.loads(files["stores.json"])["stores"][0]["kind"], "sqlite")
        said = [w.message for w in warnings if "storeKind" in w.message]
        self.assertEqual(said, ["the manifest says storeKind sqlite but the settings' DATABASES engine is django.db.backends.postgresql, which is postgres; the manifest's kind is used"])

    def test_an_option_nobody_reads_is_refused_rather_than_dropped(self):
        with self.assertRaises(ValueError):
            Options.of({"context": "shop", "storeKnd": "postgres"})


class Reading(unittest.TestCase):
    """The claims the golden holds, named one at a time so a failure says which
    rule stopped being true."""

    def setUp(self):
        files, _ = run(OPTIONS)
        self.fragment = json.loads(files["domain.json"])
        self.service = self.fragment["contexts"][0]["services"][0]
        self.aggregate = self.service["aggregates"][0]
        self.stores = json.loads(files["stores.json"])["stores"][0]

    def test_an_application_is_an_aggregate_named_after_its_root(self):
        self.assertEqual(self.aggregate["id"], "shop.billing.invoice")
        self.assertEqual(self.aggregate["root"], "Invoice")
        self.assertEqual([b["name"] for b in self.aggregate["entities"]], ["Invoice", "InvoiceLine"])
        self.assertEqual([b["name"] for b in self.aggregate["valueObjects"]], ["Money"])

    def test_a_service_function_is_an_operation_and_a_write_makes_it_a_command(self):
        kinds = {o["id"]: o["kind"] for o in self.aggregate["operations"]}
        self.assertEqual(kinds["IssueInvoice"], "command")
        self.assertEqual(kinds["GetInvoice"], "query")

    def test_the_endpoint_that_runs_an_operation_names_it(self):
        exposed = {o["id"]: o.get("exposedBy", []) for o in self.aggregate["operations"]}
        self.assertEqual(exposed["IssueInvoice"], ["invoice_issue"])
        self.assertEqual(exposed["PayInvoice"], [])

    def test_an_event_carries_the_name_it_travels_under(self):
        wire = {e["name"]: e.get("wire", {}) for e in self.aggregate["events"]}
        self.assertEqual(wire["InvoiceIssued"], {"name": "billing.InvoiceIssued", "channel": "shop.billing.invoice"})

    def test_a_client_call_is_the_id_the_callee_would_give_it(self):
        self.assertEqual([c["id"] for c in self.service["consumes"]], ["pricing.v1.Quotes/createQuote"])
        self.assertEqual(self.service["consumes"][0]["peer"], "shop.pricing")

    def test_the_http_contract_points_at_the_generated_openapi_document(self):
        self.assertEqual(
            self.service["provides"][0]["source"],
            "plugins/extract-django/testdata/billing/portolan/openapi.inferred.yaml",
        )

    def test_an_endpoint_opens_a_flow_and_a_receiver_opens_one_from_the_bus(self):
        flows = {f["slug"]: f for f in self.fragment["flows"]}
        self.assertEqual(
            sorted(flows),
            [
                "billing-invoice-create",
                "billing-invoice-destroy",
                "billing-invoice-issue",
                "billing-invoice-list",
                "billing-invoice-partial-update",
                "billing-invoice-retrieve",
                "billing-invoice-update",
                "billing-mark-invoice-paid",
            ],
        )
        self.assertEqual(flows["billing-mark-invoice-paid"]["steps"][0]["ref"], "payments.ledger.payment.PaymentCaptured")

    def test_inherited_drf_actions_become_framework_flows_when_the_model_is_proven(self):
        found = {flow["slug"]: flow for flow in self.fragment["flows"]}
        labels = {
            name: [step["label"] for step in found[name]["steps"]]
            for name in (
                "billing-invoice-list",
                "billing-invoice-create",
                "billing-invoice-update",
                "billing-invoice-partial-update",
            )
        }
        self.assertEqual(labels["billing-invoice-list"], ["invoice_list", "Invoice.objects.all", "Serialize InvoiceSerializer collection"])
        self.assertEqual(labels["billing-invoice-create"], ["invoice_create", "Validate InvoiceCreateSerializer", "Invoice.objects.create"])
        self.assertEqual(labels["billing-invoice-update"], ["invoice_update", "Invoice.objects.get", "Validate InvoiceSerializer", "Invoice.save"])
        self.assertEqual(
            labels["billing-invoice-partial-update"],
            ["invoice_partial_update", "Invoice.objects.get", "Validate InvoiceSerializer (partial)", "Invoice.save"],
        )
        framework = found["billing-invoice-create"]["steps"][1]
        self.assertEqual(framework["status"], "declared")
        self.assertIn("Supplied by DRF ModelViewSet", framework["note"])
        self.assertTrue(framework["line"].endswith("invoices/views.py:16"))

    def test_a_branch_with_a_hop_in_it_is_an_alt_and_a_loop_is_a_note(self):
        steps = {f["slug"]: f["steps"] for f in self.fragment["flows"]}["billing-invoice-issue"]
        alt = [s for s in steps if s["type"] == "alt"]
        self.assertEqual(len(alt), 1)
        self.assertEqual(alt[0]["branches"][0]["steps"][0]["kind"], "rpc")
        note = [s for s in steps if s["type"] == "step" and "for each" in s.get("note", "")]
        self.assertEqual(note[0]["note"], "in one transaction, for each line.")

    def test_an_enqueue_is_a_hop_to_celery_and_on_commit_is_its_note(self):
        flow = {f["slug"]: f for f in self.fragment["flows"]}["billing-invoice-issue"]
        self.assertIn("celery-billing-mail", [p["id"] for p in flow["participants"]])
        step = [s for s in flow["steps"] if s["type"] == "step" and s["label"] == "enqueue send_invoice_email"][0]
        self.assertEqual(step["to"], "celery-billing-mail")
        self.assertEqual(step["note"], "in one transaction, after the transaction commits.")
        self.assertTrue(step["line"].endswith("invoices/services.py:32"))

    def test_a_producer_names_the_address_and_the_event_takes_it_as_its_channel(self):
        flow = {f["slug"]: f for f in self.fragment["flows"]}["billing-mark-invoice-paid"]
        step = [s for s in flow["steps"] if s["type"] == "step" and s["kind"] == "event"][-1]
        self.assertEqual(step["ref"], "shop.billing.invoice.InvoicePaid")
        self.assertEqual(step["note"], "on shop.billing.invoice")
        wire = {e["name"]: e.get("wire", {}) for e in self.aggregate["events"]}
        self.assertEqual(wire["InvoicePaid"], {"name": "billing.InvoicePaid", "channel": "shop.billing.invoice"})

    def test_a_queryset_chain_makes_its_query_where_it_is_built(self):
        steps = {f["slug"]: f["steps"] for f in self.fragment["flows"]}["billing-invoice-retrieve"]
        self.assertEqual([s["label"] for s in steps], ["invoice_retrieve", "Invoice.objects.filter"])

    def test_endpoint_flows_follow_imported_helpers_and_self_methods(self):
        flows = {f["slug"]: f for f in self.fragment["flows"]}
        retrieve = [step["label"] for step in flows["billing-invoice-retrieve"]["steps"]]
        issue = [step["label"] for step in flows["billing-invoice-issue"]["steps"] if step["type"] == "step"]
        self.assertIn("Invoice.objects.filter", retrieve)
        self.assertIn("Invoice.objects.get", issue)
        self.assertEqual(
            next(operation for operation in self.aggregate["operations"] if operation["id"] == "IssueInvoice")["exposedBy"],
            ["invoice_issue"],
        )

    def test_a_model_is_the_table_and_the_field_the_column_carries(self):
        table = self.stores["tables"][0]
        self.assertEqual(table["name"], "invoices")
        self.assertEqual(table["persists"], {"aggregate": "shop.billing.invoice", "block": "shop.billing.invoice.invoice"})
        columns = {c["name"]: c for c in table["columns"]}
        self.assertEqual(columns["tax_rate"]["type"], "numeric(5,4)")
        self.assertEqual(columns["number"]["maps"], "Invoice.number")
        self.assertTrue(columns["issued_at"]["nullable"])

    def test_a_foreign_key_holds_what_the_row_it_points_at_holds(self):
        lines = self.stores["tables"][1]
        columns = {c["name"]: c for c in lines["columns"]}
        self.assertEqual(columns["invoice_id"]["type"], "uuid")
        self.assertEqual(columns["invoice_id"]["fk"], {"table": "shop.billing.pg.invoices", "column": "id", "onDelete": "cascade"})
        self.assertEqual(columns["id"]["type"], "bigserial")
        self.assertEqual(columns["unit_price"]["maps"], "InvoiceLine.unit_price_minor")


if __name__ == "__main__":
    unittest.main()
