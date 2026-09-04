"""A ticket whose states and whose methods have drifted apart."""

from django.db import models


class Ticket(models.Model):
    """Something somebody asked for, open until it is not."""

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        CLOSED = "closed", "Closed"

    TRANSITIONS = {
        Status.OPEN: [Status.CLOSED],
        # Nothing reopens a ticket, whatever this says.
        Status.CLOSED: [Status.OPEN],
    }

    subject = models.CharField(max_length=200)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN)

    class Meta:
        db_table = "tickets"

    def close(self):
        """Closes the ticket."""
        self.status = self.Status.CLOSED

    def archive(self):
        """Puts it out of the way, into a state the table does not list."""
        self.status = "archived"
