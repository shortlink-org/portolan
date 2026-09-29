"""An operation emits what the domain calls it makes produce."""

import ast
import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(1, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pyplugin"))

import apps as apps_module  # noqa: E402
import domain  # noqa: E402
import emits  # noqa: E402
import events as events_module  # noqa: E402
import operations  # noqa: E402
from protocol import Builder  # noqa: E402
from source import Import, Project  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

AGG = "shop.billing.invoice"
ISSUED, PAID, VOIDED = AGG + ".InvoiceIssued", AGG + ".InvoicePaid", AGG + ".InvoiceVoided"
EVENTS = {
    "InvoiceIssued": SimpleNamespace(id=ISSUED),
    "InvoicePaid": SimpleNamespace(id=PAID),
    "InvoiceVoided": SimpleNamespace(id=VOIDED),
    "invoice_voided": SimpleNamespace(id=VOIDED),
    # Another aggregate's event: never this one's to emit.
    "PaymentTaken": SimpleNamespace(id="shop.billing.payment.PaymentTaken"),
}
ORDER = [ISSUED, PAID, VOIDED]

MODELS = '''
class Invoice(models.Model):
    def issue(self, number) -> "InvoiceIssued":
        return InvoiceIssued(number=number)

    def settle(self, now):
        # Through a private helper, which records the event.
        return self._paid(now)

    def _paid(self, now):
        return InvoicePaid(paid_at=now)

    def close(self, now):
        # Two hops, and one of them repeats an event already had.
        self.settle(now)
        return self.issue("x")

    def cancel(self):
        invoice_voided.send(sender=Invoice)

    def take_payment(self):
        return PaymentTaken()

def reissue(invoice):
    return invoice.issue("again")
'''


def emitters(source=MODELS, events=EVENTS):
    tree = ast.parse(source)
    classes = [n for n in tree.body if isinstance(n, ast.ClassDef)]
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)]
    return emits.Emitters(classes, functions, events, ORDER, ["billing.invoices.models"])


def emitted(handler, e=None, imports=None):
    tree = ast.parse(handler)
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)]
    return (e or emitters()).of(functions[0], functions, imports or {})


class Domain(unittest.TestCase):
    def test_a_method_produces_what_it_names_builds_or_sends(self):
        e = emitters()
        self.assertEqual(e.methods["issue"], {ISSUED})
        self.assertEqual(e.methods["cancel"], {VOIDED})

    def test_what_a_method_calls_is_folded_in_to_a_fixpoint(self):
        e = emitters()
        self.assertEqual(e.methods["settle"], {PAID})
        self.assertEqual(e.methods["close"], {ISSUED, PAID})
        # A method called on an argument is matched where a use case calls
        # it, not folded into the function that happens to pass it along.
        self.assertNotIn("reissue", e.funcs)

    def test_a_private_name_is_folded_in_and_not_offered(self):
        self.assertNotIn("_paid", emitters().methods)

    def test_another_aggregates_event_is_not_this_ones(self):
        self.assertNotIn("take_payment", emitters().methods)


class Operation(unittest.TestCase):
    def test_the_model_methods_it_calls_in_the_aggregates_event_order(self):
        handler = '''
def close_invoice(invoice_id, now):
    invoice = Invoice.objects.get(id=invoice_id)
    invoice.cancel()
    invoice.close(now)
    invoice.issue("again")
'''
        self.assertEqual(emitted(handler), [ISSUED, PAID, VOIDED])

    def test_an_event_built_or_sent_in_the_handler_itself(self):
        handler = '''
def void_invoice(invoice_id):
    invoice_voided.send(sender=None, invoice_id=invoice_id)
    bus.publish(InvoicePaid(paid_at=None))
'''
        self.assertEqual(emitted(handler), [PAID, VOIDED])

    def test_a_helper_of_the_services_module_is_part_of_the_use_case(self):
        handler = '''
def pay_invoice(invoice_id, now):
    return _settle(Invoice.objects.get(id=invoice_id), now)

def _settle(invoice, now):
    return invoice.settle(now)

def issue_invoice(invoice):
    return invoice.issue("n")
'''
        self.assertEqual(emitted(handler), [PAID])

    def test_a_domain_function_through_the_import_that_names_it(self):
        e = emitters(MODELS + '''
def open_invoice(number) -> "InvoiceIssued":
    return InvoiceIssued(number=number)
''')
        by_name = '''
def reopen(number):
    return open_invoice(number)
'''
        self.assertEqual(emitted(by_name, e, {"open_invoice": Import("billing.invoices.models", "open_invoice")}), [ISSUED])
        # Not imported from the models, it is somebody else's function.
        self.assertEqual(emitted(by_name, e, {"open_invoice": Import("billing.invoices.legacy", "open_invoice")}), [])
        by_module = '''
def reopen(number):
    return models.open_invoice(number)
'''
        self.assertEqual(emitted(by_module, e, {"models": Import("billing.invoices", "models")}), [ISSUED])

    def test_a_query_that_reaches_nothing_emits_nothing(self):
        handler = '''
def get_invoice(invoice_id):
    return Invoice.objects.filter(id=invoice_id).first()
'''
        self.assertEqual(emitted(handler), [])

    def test_an_aggregate_without_events_emits_nothing(self):
        handler = '''
def issue(invoice):
    return invoice.issue("n")
'''
        self.assertEqual(emitted(handler, emitters(events={})), [])


class Fixture(unittest.TestCase):
    def test_the_billing_services(self):
        root = os.path.join(HERE, "testdata", "billing")
        b = Builder()
        project = Project(root, root, lambda path: os.path.relpath(path, ROOT).replace(os.sep, "/"))
        agg = domain.read_aggregates(project, apps_module.discover(project, []), "shop.billing", {}, b)[0]
        found, registry = events_module.read_events(agg, "billing", b)
        agg.aggregate["events"] = found
        e = emits.for_aggregate(agg, registry)
        got = {u.id: e.of(u.node, u.module.functions(), u.module.imports) for u in operations.read_use_cases(agg, b)}
        self.assertEqual(
            got,
            {
                "GetInvoice": [],
                # The method's annotation, and the signal the service sends.
                "IssueInvoice": [ISSUED],
                # What `pay` hands back is what bus.publish puts on the wire.
                "PayInvoice": [PAID],
                # `void` names no event; the signal the service sends does.
                "VoidInvoice": [VOIDED],
            },
        )


if __name__ == "__main__":
    unittest.main()
