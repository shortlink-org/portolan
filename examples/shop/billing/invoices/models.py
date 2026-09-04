"""The invoice, and the lines it is made of."""

import uuid

from django.db import models

from .events import InvoiceIssued, InvoicePaid, InvoiceVoided


class Invoice(models.Model):
    """What a customer owes for one order, and where it is in its life."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ISSUED = "issued", "Issued"
        PAID = "paid", "Paid"
        VOID = "void", "Void"

    # The one way through the states. The methods below are held to this
    # table, and nothing else may move the status.
    TRANSITIONS = {
        Status.DRAFT: [Status.ISSUED, Status.VOID],
        Status.ISSUED: [Status.PAID, Status.VOID],
        Status.PAID: [],
        Status.VOID: [],
    }

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    order_id = models.UUIDField(help_text="The order this invoice is drawn up for.", db_index=True)
    customer_id = models.UUIDField(help_text="Opaque, and only ever as good as the session auth vouched for.")
    number = models.CharField(max_length=32, unique=True, null=True, help_text="What the customer quotes. A draft has none.")
    currency = models.CharField(max_length=3, help_text="ISO 4217, frozen when the first line is drawn up.")
    total_minor = models.BigIntegerField(help_text="The sum of the lines, in the minor unit of the currency.")
    tax_rate = models.DecimalField(max_digits=5, decimal_places=4, help_text="The rate the total was taxed at.")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    drawn_up_at = models.DateTimeField()
    issued_at = models.DateTimeField(null=True)
    settled_at = models.DateTimeField(null=True, help_text="When it was paid or voided; null while it is neither.")

    class Meta:
        db_table = "invoices"
        indexes = [models.Index(fields=["customer_id", "status"], name="invoices_by_customer")]

    def issue(self, number: str, now) -> "InvoiceIssued":
        """Freezes the invoice and gives it the number the customer will quote."""
        self.number = number
        self.issued_at = now
        self.status = self.Status.ISSUED
        return InvoiceIssued(invoice_id=str(self.id), order_id=str(self.order_id), number=number, total_minor=self.total_minor, currency=self.currency)

    def pay(self, now) -> "InvoicePaid":
        """Closes the invoice: the money arrived."""
        self.settled_at = now
        self.status = self.Status.PAID
        return InvoicePaid(invoice_id=str(self.id), order_id=str(self.order_id), paid_at=str(now))

    def void(self, reason: str, now) -> "InvoiceVoided":
        """Ends the invoice without payment. Nobody is asked for the money again."""
        self.settled_at = now
        self.status = self.Status.VOID
        return InvoiceVoided(invoice_id=str(self.id), order_id=str(self.order_id), reason=reason)


class InvoiceLine(models.Model):
    """One line of an invoice: what was bought, and what it was sold at."""

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="lines")
    sku = models.CharField(max_length=64)
    quantity = models.PositiveIntegerField()
    unit_price_minor = models.BigIntegerField(db_column="unit_price", help_text="Captured when the line is drawn up, never recomputed.")

    class Meta:
        db_table = "invoice_lines"
        unique_together = (("invoice", "sku"),)
