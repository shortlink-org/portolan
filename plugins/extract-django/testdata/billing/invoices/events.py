"""What billing tells everybody else.

The dataclass carries the payload and the name the message travels under; the
signal beside it is how Django hands it on. A signal with no dataclass of its
own is still an event - and one whose payload nothing declares.
"""

from dataclasses import dataclass

from django.dispatch import Signal


@dataclass(frozen=True)
class InvoiceIssued:
    """The invoice is final and the customer has been asked to pay it."""

    name = "billing.InvoiceIssued"
    channel = "shop.billing.invoice"

    invoice_id: str
    number: str
    total_minor: int


@dataclass(frozen=True)
class InvoicePaid:
    """The money arrived and the invoice is closed."""

    name = "billing.InvoicePaid"
    channel = "shop.billing.invoice"

    invoice_id: str
    paid_at: str


invoice_issued = Signal()
invoice_paid = Signal()
invoice_voided = Signal()
