"""What billing does when somebody else's event arrives - and one receiver on
a model signal, which is the shape the reader reports rather than draws."""

from django.db.models.signals import post_save
from django.dispatch import receiver
from payments.events import payment_captured

from . import services
from .models import Invoice


@receiver(payment_captured)
def mark_invoice_paid(sender, **kwargs):
    """Closes the invoice once the ledger says the money arrived."""
    services.pay_invoice(kwargs["invoice_id"], kwargs["paid_at"])


@receiver(post_save, sender=Invoice)
def index_invoice(sender, instance, **kwargs):
    """Keeps the search index in step with the row - on every save, migrations
    and fixtures included, which is why this is a hook and not a policy."""
