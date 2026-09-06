"""What somebody can ask billing to do. The work that can wait leaves for Celery."""

from django.db import transaction

from .tasks import archive_invoice, remind_unpaid_invoice, send_invoice_email


def issue_invoice(invoice_id, number):
    """Freezes the invoice and, once that is committed, asks the customer to pay."""
    with transaction.atomic():
        invoice = _freeze(invoice_id, number)
        transaction.on_commit(lambda: send_invoice_email.delay(invoice.id))
    return invoice


def nudge_customer(invoice_id, days):
    """Reminds the customer about an invoice, some days from now."""
    remind_unpaid_invoice.apply_async(args=[invoice_id], countdown=days * 86400)


def close_invoice(invoice_id):
    """Closes an invoice and sends it to the archive."""
    archive_invoice.s(invoice_id).apply_async()


def _freeze(invoice_id, number):
    return {"id": invoice_id, "number": number}
