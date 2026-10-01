"""The shapes of a fragment: each key in the order `catalog/model.go` declares
it, and an optional one written only when the source said something."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import catalog  # noqa: E402


class Fields(unittest.TestCase):
    def test_a_field_says_only_what_the_source_said(self):
        self.assertEqual(catalog.field("total", "Money"), {"name": "total", "type": "Money", "doc": ""})
        full = catalog.field("email", "str", "the address", ref="shop.email", required=True, rules=[catalog.rule("format", "email")])
        self.assertEqual(list(full), ["name", "type", "doc", "ref", "required", "rules"])
        self.assertEqual(full["rules"], [{"name": "format", "value": "email"}])

    def test_a_bare_rule_has_no_value(self):
        self.assertEqual(catalog.rule("unique"), {"name": "unique"})
        self.assertEqual(catalog.rule("min_len", "3"), {"name": "min_len", "value": "3"})


class Domain(unittest.TestCase):
    def test_an_aggregate_starts_empty_in_the_order_the_model_declares(self):
        agg = catalog.aggregate("shop.billing.invoice", "invoice", "Invoice", "", "Invoice")
        self.assertEqual(list(agg), ["id", "slug", "name", "readme", "root", "entities", "valueObjects", "operations", "events"])
        self.assertEqual(agg["operations"], [])

    def test_an_operation_sorts_who_exposes_it_and_keeps_the_event_order_it_was_given(self):
        op = catalog.operation("IssueInvoice", "command", exposed_by=["http:POST /invoices", "grpc:Issue"], emits=["InvoiceIssued", "InvoiceDrafted"])
        self.assertEqual(op["exposedBy"], ["grpc:Issue", "http:POST /invoices"])
        self.assertEqual(op["emits"], ["InvoiceIssued", "InvoiceDrafted"])
        self.assertEqual(catalog.operation("GetInvoice", "query"), {"id": "GetInvoice", "kind": "query"})

    def test_an_event_has_no_consumers_yet_and_a_wire_only_when_it_travels(self):
        ev = catalog.event("shop.billing.invoice-issued", "invoice-issued", "InvoiceIssued", [catalog.version("", "events.py:4", [])], None)
        self.assertEqual(ev["consumers"], [])
        self.assertNotIn("wire", ev)
        self.assertEqual(ev["versions"][0], {"version": "v1", "doc": "", "source": "events.py:4", "fields": []})
        self.assertEqual(catalog.event("e", "e", "E", [], {"name": "shop.e"})["wire"], {"name": "shop.e"})

    def test_a_transition_carries_what_it_emits_and_where_only_when_known(self):
        self.assertEqual(catalog.transition("draft", "paid", "Pay", "InvoicePaid", ""), {"from": "draft", "to": "paid", "on": "Pay", "emits": "InvoicePaid"})
        self.assertEqual(catalog.block("b", "b", "B", "", []), {"id": "b", "slug": "b", "name": "B", "doc": "", "fields": []})


class Channels(unittest.TestCase):
    def test_a_channel_keeps_its_messages_between_the_doc_and_the_source(self):
        ch = catalog.channel("orders", "job", "", "over redis", [catalog.message("place", "", "", "send", encoding="json")], source="celery.py:1", protocol="celery")
        self.assertEqual(list(ch), ["address", "kind", "protocol", "doc", "messages", "source"])
        self.assertEqual(ch["messages"][0], {"name": "place", "direction": "send", "encoding": "json"})
        self.assertEqual(catalog.rpc_call("GetOrder", "shop.oms", catalog.DECLARED, "client.py:9"), {"id": "GetOrder", "peer": "shop.oms", "status": "declared", "source": "client.py:9"})


class Flows(unittest.TestCase):
    def test_a_step_is_typed_and_its_detail_is_written_only_when_given(self):
        step = catalog.step("s1", "a", "b", "call", "", "declared", line="x.py:3", handoff={"kind": "message"})
        self.assertEqual(list(step), ["type", "id", "from", "to", "kind", "status", "line", "handoff"])
        self.assertEqual(step["type"], "step")
        self.assertEqual(catalog.alt("a1", [catalog.branch("ok", [], terminal=True)]), {"type": "alt", "id": "a1", "branches": [{"title": "ok", "steps": [], "terminal": True}]})

    def test_a_flow_puts_the_trigger_before_the_owner_and_the_examples_last(self):
        flow = catalog.flow("f", "f", "F", "", "x.py", "shop.billing", [], [], trigger={"kind": "http"}, examples=[{"name": "one"}])
        self.assertEqual(list(flow), ["id", "slug", "name", "summary", "source", "trigger", "owner", "participants", "steps", "examples"])

    def test_a_participant_keeps_a_missing_context_and_a_label_when_it_has_one(self):
        self.assertEqual(catalog.participant("celery-beat", "external", None, label="Beat"), {"id": "celery-beat", "kind": "external", "context": None, "label": "Beat"})


class Stores(unittest.TestCase):
    def test_a_column_says_nullable_always_and_the_rest_when_true(self):
        self.assertEqual(catalog.column("id", "uuid", False, pk=True), {"name": "id", "type": "uuid", "nullable": False, "pk": True})
        fk = catalog.column("invoice_id", "uuid", True, fk={"table": "invoices", "column": "id"}, maps="invoice")
        self.assertEqual(list(fk), ["name", "type", "nullable", "fk", "maps"])

    def test_a_table_drops_an_empty_index_list_and_a_store_its_missing_source(self):
        table = catalog.table("t", "invoices", [], [], {"aggregate": "invoice"}, "aggregate")
        self.assertEqual(list(table), ["id", "name", "columns", "persists", "role"])
        store = catalog.store("db", "db", "DB", "postgres", "shop.billing", [table], "")
        self.assertEqual(list(store), ["id", "slug", "name", "kind", "owner", "tables"])


if __name__ == "__main__":
    unittest.main()
