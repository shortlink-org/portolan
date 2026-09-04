"""The invoice, and the lines it is made of."""

import uuid

from django.db import models

from .events import InvoiceIssued, InvoicePaid


class Invoice(models.Model):
    """What a customer owes for one order, and where it is in its life."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ISSUED = "issued", "Issued"
        PAID = "paid", "Paid"
        VOID = "void", "Void"

    # The one way through the states. The methods below are held to it.
    TRANSITIONS = {
        Status.DRAFT: [Status.ISSUED, Status.VOID],
        Status.ISSUED: [Status.PAID, Status.VOID],
        Status.PAID: [],
        Status.VOID: [],
    }

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    order_id = models.UUIDField(help_text="The order this invoice is drawn up for.", db_index=True)
    customer_id = models.UUIDField()
    number = models.CharField(max_length=32, unique=True, null=True)
    currency = models.CharField(max_length=3)
    total_minor = models.BigIntegerField()
    tax_rate = models.DecimalField(max_digits=5, decimal_places=4)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    issued_at = models.DateTimeField(null=True)
    paid_at = models.DateTimeField(null=True)

    class Meta:
        db_table = "invoices"
        indexes = [models.Index(fields=["customer_id", "status"], name="invoices_by_customer")]

    def issue(self, number: str, now) -> "InvoiceIssued":
        """Freezes the invoice and gives it the number the customer will quote."""
        self.number = number
        self.issued_at = now
        self.status = self.Status.ISSUED
        return InvoiceIssued(invoice_id=str(self.id), number=number, total_minor=self.total_minor)

    def pay(self, now) -> "InvoicePaid":
        """Ends the invoice: the money arrived."""
        self.paid_at = now
        self.status = self.Status.PAID
        return InvoicePaid(invoice_id=str(self.id), paid_at=str(now))

    def void(self, reason: str):
        """Ends the invoice without payment. Nobody is asked for the money again."""
        self.status = self.Status.VOID


class InvoiceLine(models.Model):
    """One line of an invoice: what was bought, and what it cost."""

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="lines")
    sku = models.CharField(max_length=64)
    quantity = models.PositiveIntegerField()
    unit_price_minor = models.BigIntegerField(db_column="unit_price")

    class Meta:
        db_table = "invoice_lines"
        unique_together = (("invoice", "sku"),)
