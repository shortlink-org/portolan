"""What billing tells everybody else.

The dataclass carries the payload and the name the message travels under; the
signal beside it is how Django hands it on. `invoices/bus/asyncapi.yaml` says
the same thing from the other side, and the catalog holds the two against each
other.
"""

from dataclasses import dataclass

from django.dispatch import Signal


@dataclass(frozen=True)
class InvoiceIssued:
    """The invoice is final and the customer has been asked to pay it."""

    name = "billing.InvoiceIssued"
    channel = "shop.billing.invoice"

    invoice_id: str
    order_id: str
    number: str
    total_minor: int
    currency: str


@dataclass(frozen=True)
class InvoicePaid:
    """The money arrived and the invoice is closed. Nothing is owed on the order."""

    name = "billing.InvoicePaid"
    channel = "shop.billing.invoice"

    invoice_id: str
    order_id: str
    paid_at: str


@dataclass(frozen=True)
class InvoiceVoided:
    """The invoice was ended without payment, and nobody will be asked again."""

    name = "billing.InvoiceVoided"
    channel = "shop.billing.invoice"

    invoice_id: str
    order_id: str
    reason: str


invoice_issued = Signal()
invoice_paid = Signal()
invoice_voided = Signal()
