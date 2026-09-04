"""A shipment, whose states are written down one decorator at a time."""

from django.db import models
from django_fsm import FSMField, transition


class Shipment(models.Model):
    """Where a parcel is between the warehouse and the door."""

    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        HELD = "held", "Held"
        DISPATCHED = "dispatched", "Dispatched"
        DELIVERED = "delivered", "Delivered"

    order_id = models.UUIDField()
    status = FSMField(default=Status.PLANNED, choices=Status.choices)

    class Meta:
        db_table = "shipments"

    @transition(field=status, source=Status.PLANNED, target=Status.HELD)
    def hold(self, reason: str):
        """Keeps the parcel back."""

    @transition(field=status, source=[Status.PLANNED, Status.HELD], target=Status.DISPATCHED)
    def dispatch(self, carrier: str):
        """Hands the parcel to the carrier."""

    @transition(field=status, source=Status.DISPATCHED, target=Status.DELIVERED)
    def deliver(self, at):
        """Ends the shipment at the door."""
