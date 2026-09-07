"""The way in: invoices, as the storefront sees them."""

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from drf_yasg import openapi
from drf_yasg.utils import swagger_auto_schema
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema

from . import services
from .flow_helpers import issue_invoice
from .serializers import InvoiceCreateSerializer, InvoiceSerializer


class InvoiceViewSet(viewsets.ModelViewSet):
    """Invoices over HTTP."""

    serializer_class = InvoiceSerializer
    permission_classes = (IsAuthenticatedOrReadOnly,)
    filterset_fields = ("status",)
    search_fields = ("number", "order_id")
    ordering_fields = ("issued_at",)

    def get_serializer_class(self):
        if self.action == "create":
            return InvoiceCreateSerializer
        return InvoiceSerializer

    def retrieve(self, request, pk=None):
        """Reads one invoice."""
        currency = request.query_params.get("currency", "USD")
        limit = int(request.GET.get("limit", 25))
        partner = request.GET.get("partner")
        if partner is None:
            raise ValueError("partner is required")
        if pk is None:
            return Response({}, status=404)
        serializer = self.get_serializer(self._get_invoice(pk), context={"currency": currency, "limit": limit})
        return Response({"data": serializer.data})

    def _get_invoice(self, pk):
        return services.get_invoice(pk)

    @swagger_auto_schema(
        operation_id="issue_invoice",
        operation_description="Issues an invoice and returns the resulting event id.",
        request_body=InvoiceCreateSerializer,
        manual_parameters=[
            openapi.Parameter("dry_run", openapi.IN_QUERY, description="Validate without issuing.", type=openapi.TYPE_BOOLEAN),
        ],
        responses={
            200: openapi.Response(
                description="Invoice accepted.",
                schema=openapi.Schema(
                    type=openapi.TYPE_OBJECT,
                    properties={"invoiceId": openapi.Schema(type=openapi.TYPE_STRING)},
                    required=["invoiceId"],
                ),
            ),
            409: openapi.Response(description="The invoice was already issued."),
        },
        tags=["invoice commands"],
    )
    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def issue(self, request, pk=None):
        """Issues the invoice drawn up for an order."""
        event = issue_invoice(
            request.data["order_id"],
            request.data["lines"],
            request.data["number"],
            timezone.now(),
        )
        return Response({"invoiceId": event.invoice_id})

    @extend_schema(
        summary="Void an invoice",
        parameters=[OpenApiParameter(name="notify", type=OpenApiTypes.BOOL, description="Notify the customer.")],
        responses={204: None},
    )
    def destroy(self, request, pk=None):
        """Voids an invoice."""
        services.void_invoice(pk, request.data.get("reason", ""))
        return Response(status=204)
