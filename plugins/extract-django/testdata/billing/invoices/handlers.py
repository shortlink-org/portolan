"""What billing does when somebody else's event arrives."""

from django.dispatch import receiver
from payments.events import payment_captured

from . import services


@receiver(payment_captured)
def mark_invoice_paid(sender, **kwargs):
    """Closes the invoice once the ledger says the money arrived."""
    services.pay_invoice(kwargs["invoice_id"], kwargs["paid_at"])
