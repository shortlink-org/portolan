"""The way in: invoices, as the storefront sees them."""

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from . import services


class InvoiceViewSet(viewsets.ModelViewSet):
    """Invoices over HTTP."""

    def retrieve(self, request, pk=None):
        """Reads one invoice."""
        return Response(services.get_invoice(pk))

    @action(detail=True, methods=["post"])
    def issue(self, request, pk=None):
        """Issues the invoice drawn up for an order."""
        event = services.issue_invoice(
            request.data["order_id"],
            request.data["lines"],
            request.data["number"],
            timezone.now(),
        )
        return Response({"invoiceId": event.invoice_id})

    def destroy(self, request, pk=None):
        """Voids an invoice."""
        services.void_invoice(pk, request.data.get("reason", ""))
        return Response(status=204)
