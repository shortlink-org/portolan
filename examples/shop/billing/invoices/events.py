"""What billing tells everybody else.

The dataclass carries the payload and the name the message travels under;
`bus.py` is how it leaves, on the subject named here and there alike.
`invoices/bus/asyncapi.yaml` says the same thing from the other side, and the
catalog holds the three against each other.
"""

from dataclasses import dataclass



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


