"""What billing does later, off the request. An enqueue of one of these is a
hop to Celery in the flow that makes it; the queue it lands on is not read
here."""

from celery import shared_task


@shared_task
def send_invoice_email(invoice_id):
    """Emails the customer the invoice they were asked to pay."""
