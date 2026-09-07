from rest_framework import serializers

from .models import Invoice


class InvoiceSerializer(serializers.ModelSerializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=200)
    secret = serializers.CharField(write_only=True)

    class Meta:
        model = Invoice
        fields = (
            "id",
            "order_id",
            "number",
            "currency",
            "total_minor",
            "tax_rate",
            "status",
            "issued_at",
            "note",
            "secret",
        )
        read_only_fields = ("id", "status", "issued_at")


class InvoiceLineSerializer(serializers.Serializer):
    sku = serializers.CharField(max_length=64)
    quantity = serializers.IntegerField()


class InvoiceCreateSerializer(serializers.Serializer):
    order_id = serializers.UUIDField()
    currency = serializers.CharField(min_length=3, max_length=3)


class InvoiceEnvelopeSerializer(InvoiceSerializer):
    lines = InvoiceLineSerializer(many=True)
