"""The way in: invoices, as the storefront sees them."""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from . import services


class InvoiceViewSet(viewsets.ModelViewSet):
    """Invoices over HTTP. Every action here runs one function of services.py."""

    def create(self, request):
        """Draws up a draft invoice for an order."""
        invoice = services.draw_up_invoice(
            request.data["orderId"],
            request.data["customerId"],
            request.data["currency"],
            request.data["taxRate"],
            request.data["lines"],
        )
        return Response({"invoiceId": str(invoice.id)}, status=201)

    def retrieve(self, request, pk=None):
        """Reads one invoice."""
        return Response(services.get_invoice(pk))

    @action(detail=True, methods=["post"])
    def issue(self, request, pk=None):
        """Issues a draft invoice and asks the customer to pay it."""
        event = services.issue_invoice(pk, request.headers.get("Authorization", ""), request.data["number"])
        return Response({"invoiceId": event.invoice_id, "number": event.number})

    def destroy(self, request, pk=None):
        """Voids an invoice."""
        services.void_invoice(pk, request.data.get("reason", ""))
        return Response(status=204)
