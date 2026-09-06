"""What billing does later, off the request: the two things an issued
invoice sets in motion that nobody should wait on.

Both are enqueued by services.py once the invoice's row is committed. The
mail goes out on its own queue, `billing.mail`, routed there by the settings;
the reminder lands on the default queue, with a countdown of a few days, and
does nothing if the invoice was paid in the meantime.
"""

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail

from .models import Invoice


@shared_task
def send_invoice_email(invoice_id):
    """Emails the customer the invoice they were asked to pay."""
    invoice = Invoice.objects.get(id=invoice_id)
    send_mail(
        "Invoice %s" % invoice.number,
        "Please pay %d %s." % (invoice.total_minor, invoice.currency),
        settings.DEFAULT_FROM_EMAIL,
        [invoice.customer_id],
    )


@shared_task
def remind_unpaid_invoice(invoice_id):
    """Nudges the customer about an invoice that has stayed unpaid."""
    invoice = Invoice.objects.filter(id=invoice_id, status=Invoice.Status.ISSUED).first()
    if invoice is None:
        return
    send_mail(
        "Invoice %s is still unpaid" % invoice.number,
        "A reminder: %d %s is due." % (invoice.total_minor, invoice.currency),
        settings.DEFAULT_FROM_EMAIL,
        [invoice.customer_id],
    )
