"""What somebody can ask billing to do."""

from django.db import transaction
from django.utils import timezone

from .clients.auth.client import AuthClient
from . import bus
from .models import Invoice, InvoiceLine
from .tasks import remind_unpaid_invoice, send_invoice_email

auth = AuthClient()

# How long an issued invoice is left alone before the customer is reminded.
REMINDER_AFTER = 3 * 24 * 3600


def draw_up_invoice(order_id, customer_id, currency, tax_rate, lines):
    """Draws up a draft invoice for an order, with a line for each thing sold."""
    with transaction.atomic():
        invoice = Invoice.objects.create(
            order_id=order_id,
            customer_id=customer_id,
            currency=currency,
            tax_rate=tax_rate,
            total_minor=sum(line["quantity"] * line["unit_price_minor"] for line in lines),
            drawn_up_at=timezone.now(),
        )
        for line in lines:
            InvoiceLine.objects.create(
                invoice=invoice,
                sku=line["sku"],
                quantity=line["quantity"],
                unit_price_minor=line["unit_price_minor"],
            )
    return invoice


def issue_invoice(invoice_id, token, number):
    """Confirms the session, freezes the invoice and asks the customer to pay."""
    session = auth.validate_session(token)
    invoice = Invoice.objects.get(id=invoice_id, customer_id=session["customerId"])
    if invoice.status != Invoice.Status.DRAFT:
        raise ValueError("this invoice has been issued already")
    event = invoice.issue(number, timezone.now())
    with transaction.atomic():
        invoice.save()
        # The mail and the reminder leave once the row is in: a task that ran
        # before the commit would read an invoice that is still a draft.
        transaction.on_commit(lambda: send_invoice_email.delay(str(invoice.id)))
        transaction.on_commit(lambda: remind_unpaid_invoice.apply_async(args=[str(invoice.id)], countdown=REMINDER_AFTER))
    bus.publish(event)
    return event


def pay_invoice(invoice_id, paid_at):
    """Closes an issued invoice against the money the ledger says arrived."""
    invoice = Invoice.objects.filter(id=invoice_id, status=Invoice.Status.ISSUED).first()
    if invoice is None:
        return None
    event = invoice.pay(paid_at)
    invoice.save()
    bus.publish(event)
    return event


def void_invoice(invoice_id, reason):
    """Ends an invoice nobody is going to pay."""
    invoice = Invoice.objects.get(id=invoice_id)
    event = invoice.void(reason, timezone.now())
    invoice.save()
    bus.publish(event)
    return event


def get_invoice(invoice_id):
    """Reads one invoice and the lines it is made of."""
    return Invoice.objects.get(id=invoice_id)
