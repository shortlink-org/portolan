"""An abstract base intentionally later than its consumers in path order."""

from django.db import models


class RecordBase(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
