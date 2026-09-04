"""The table is the claim, whichever of the two ways it is written down."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import apps as apps_module  # noqa: E402
import domain  # noqa: E402
import events as events_module  # noqa: E402
import lifecycle  # noqa: E402
from protocol import Builder  # noqa: E402
from source import Project  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def read(fixture: str, service: str):
    root = os.path.join(HERE, "testdata", fixture)
    b = Builder()
    project = Project(root, root, lambda path: os.path.relpath(path, ROOT).replace(os.sep, "/"))
    aggregates = domain.read_aggregates(project, apps_module.discover(project, []), "shop." + service, {}, b)
    registry = {}
    for agg in aggregates:
        _, found = events_module.read_events(agg, service, b)
        registry.update(found)
    return aggregates, registry, b


class Transitions(unittest.TestCase):
    def test_a_table_and_the_methods_held_to_it(self):
        aggregates, registry, b = read("billing", "billing")
        life = lifecycle.read(aggregates[0], registry, b)
        self.assertEqual(life["states"], ["draft", "issued", "paid", "void"])
        self.assertEqual(
            [(t["from"], t["to"], t["on"]) for t in life["transitions"]],
            [("draft", "issued", "issue"), ("issued", "paid", "pay"), ("draft", "void", "void"), ("issued", "void", "void")],
        )

    def test_the_event_a_mover_hands_back_is_what_it_publishes(self):
        aggregates, registry, b = read("billing", "billing")
        life = lifecycle.read(aggregates[0], registry, b)
        emits = {t["on"]: t.get("emits", "") for t in life["transitions"]}
        self.assertEqual(emits["issue"], "shop.billing.invoice.InvoiceIssued")
        self.assertEqual(emits["pay"], "shop.billing.invoice.InvoicePaid")
        self.assertEqual(emits["void"], "")

    def test_a_decorator_is_a_table_written_one_edge_at_a_time(self):
        aggregates, registry, b = read("fsm", "delivery")
        life = lifecycle.read(aggregates[0], registry, b)
        self.assertEqual(life["states"], ["planned", "held", "dispatched", "delivered"])
        self.assertEqual(
            [(t["from"], t["to"], t["on"]) for t in life["transitions"]],
            [
                ("planned", "held", "hold"),
                ("planned", "dispatched", "dispatch"),
                ("held", "dispatched", "dispatch"),
                ("dispatched", "delivered", "deliver"),
            ],
        )

    def test_a_table_and_its_methods_that_have_drifted_apart_are_reported(self):
        aggregates, registry, b = read("drift", "support")
        life = lifecycle.read(aggregates[0], registry, b)
        messages = [d.message for d in b.diagnostics]
        self.assertIn("archive moves to 'archived', which the table does not list", messages)
        self.assertIn("the table has closed -> open and no method of Ticket makes it", messages)
        # Reported, and still drawn: the state a method reaches is a state.
        self.assertIn("archived", life["states"])


if __name__ == "__main__":
    unittest.main()
