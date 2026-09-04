"""What billing does when somebody else's event arrives."""

from django.dispatch import receiver
from shop_events.payments import payment_captured

from . import services


@receiver(payment_captured)
def close_invoice_on_payment(sender, **kwargs):
    """Closes the invoice for an order once the ledger says the money arrived."""
    services.pay_invoice(kwargs["invoice_id"], kwargs["captured_at"])
