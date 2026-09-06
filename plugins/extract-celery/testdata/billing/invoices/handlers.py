"""What billing does when somebody else's event arrives."""

from functools import partial

from django.db import transaction
from django.dispatch import receiver
from payments.events import payment_captured

from . import tasks


@receiver(payment_captured)
def mark_invoice_paid(sender, **kwargs):
    """Closes the invoice, and archives it once the row is committed."""
    transaction.on_commit(partial(tasks.archive_invoice.delay, kwargs["invoice_id"]))
