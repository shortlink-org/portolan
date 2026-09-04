"""The reader, held to a fixture.

`testdata/billing` is a Django service in the layout this plugin reads, each
shape it claims to read present once; `expected.json` and `expected-stores.json`
are what it comes out as. Set UPDATE_GOLDEN=1 to write them again after a
deliberate change, and read the diff.
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract import extract  # noqa: E402
from protocol import Builder, Input, Options  # noqa: E402

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
        Input(root=FIXTURE, commit="abc1234", generated_at="2026-09-05T00:00:00Z"),
        Options.of(options),
        b,
        cwd=ROOT,
    )
    return {f.name: f.contents for f in b.files}, b.diagnostics


class Fragment(unittest.TestCase):
    def setUp(self):
        self.files, self.diagnostics = run(OPTIONS)

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

    def test_what_it_reports_beside_them(self):
        self.assertEqual(
            [(d.severity, d.ref) for d in self.diagnostics],
            [("warning", "shop.billing.invoice.InvoiceVoided")],
        )
        self.assertIn("a signal declares no payload", self.diagnostics[0].message)

    def test_without_a_store_the_models_describe_no_database(self):
        options = dict(OPTIONS)
        del options["store"]
        files, diagnostics = run(options)
        self.assertEqual(list(files), ["domain.json"])
        self.assertIn("`store` is what says which one they are the schema of", " ".join(d.message for d in diagnostics))

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

    def test_an_endpoint_opens_a_flow_and_a_receiver_opens_one_from_the_bus(self):
        flows = {f["slug"]: f for f in self.fragment["flows"]}
        self.assertEqual(
            sorted(flows),
            ["billing-invoice-destroy", "billing-invoice-issue", "billing-invoice-retrieve", "billing-mark-invoice-paid"],
        )
        self.assertEqual(flows["billing-mark-invoice-paid"]["steps"][0]["ref"], "payments.ledger.payment.PaymentCaptured")

    def test_a_branch_with_a_hop_in_it_is_an_alt_and_a_loop_is_a_note(self):
        steps = {f["slug"]: f["steps"] for f in self.fragment["flows"]}["billing-invoice-issue"]
        alt = [s for s in steps if s["type"] == "alt"]
        self.assertEqual(len(alt), 1)
        self.assertEqual(alt[0]["branches"][0]["steps"][0]["kind"], "rpc")
        note = [s for s in steps if s["type"] == "step" and "for each" in s.get("note", "")]
        self.assertEqual(note[0]["note"], "in one transaction, for each line.")

    def test_a_queryset_chain_makes_its_query_where_it_is_built(self):
        steps = {f["slug"]: f["steps"] for f in self.fragment["flows"]}["billing-invoice-retrieve"]
        self.assertEqual([s["label"] for s in steps], ["invoice_retrieve", "Invoice.objects.filter"])

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
