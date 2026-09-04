"""What somebody can ask billing to do."""

from django.db import transaction

from .clients.pricing.client import PricingClient
from .events import invoice_issued, invoice_paid, invoice_voided
from .models import Invoice, InvoiceLine

pricing = PricingClient()


def issue_invoice(order_id, lines, number, now):
    """Draws the lines up, freezes the invoice and asks the customer to pay."""
    invoice = Invoice.objects.get(order_id=order_id)
    if invoice.status != Invoice.Status.DRAFT:
        raise ValueError("this invoice has been issued already")
    if invoice.total_minor == 0:
        quote = pricing.create_quote(order_id)
        invoice.total_minor = quote["totalMinor"]
    with transaction.atomic():
        for line in lines:
            InvoiceLine.objects.create(
                invoice=invoice,
                sku=line["sku"],
                quantity=line["quantity"],
                unit_price_minor=line["unit_price_minor"],
            )
        event = invoice.issue(number, now)
        invoice.save()
    invoice_issued.send(sender=Invoice, event=event)
    return event


def pay_invoice(invoice_id, paid_at):
    """Closes an issued invoice against the money the ledger says arrived."""
    invoice = Invoice.objects.get(id=invoice_id)
    event = invoice.pay(paid_at)
    invoice.save()
    invoice_paid.send(sender=Invoice, event=event)
    return event


def void_invoice(invoice_id, reason):
    """Ends an invoice nobody is going to pay."""
    invoice = Invoice.objects.get(id=invoice_id)
    invoice.void(reason)
    invoice.save()
    invoice_voided.send(sender=Invoice, invoice_id=invoice_id, reason=reason)


def get_invoice(invoice_id):
    """Reads one invoice."""
    return Invoice.objects.filter(id=invoice_id).first()
