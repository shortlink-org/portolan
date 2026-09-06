"""What billing does later, off the request.

Three tasks, each placed by a different rule: the first by `CELERY_TASK_ROUTES`
in the settings, the second by the `queue=` on its own decorator, the third by
`CELERY_TASK_DEFAULT_QUEUE`, under a name it was given rather than composed.
"""

from celery import shared_task


@shared_task
def send_invoice_email(invoice_id):
    """Emails the customer the invoice they were asked to pay."""


@shared_task(queue="billing.slow")
def remind_unpaid_invoice(invoice_id):
    """Nudges the customer about an invoice that has stayed unpaid."""


@shared_task(name="billing.archive_invoice")
def archive_invoice(invoice_id):
    """Moves a closed invoice to cold storage."""
