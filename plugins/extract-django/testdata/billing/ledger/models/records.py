"""Concrete records whose abstract base sorts after this module."""

from django.contrib.postgres.fields import ArrayField
from django.db import models
from multiselectfield import MultiSelectField

from .zbase import RecordBase


class LedgerEntry(RecordBase):
    reference = models.CharField(max_length=64)
    tags = ArrayField(models.CharField(max_length=16), size=4)
    modes = MultiSelectField(max_length=32)
    audit_code = models.ForeignKey(
        "AuditRecord",
        to_field="code",
        db_column="audit_code",
        db_constraint=False,
        on_delete=models.DO_NOTHING,
    )
    owner = models.ForeignKey("auth.User", on_delete=models.PROTECT)
    audits = models.ManyToManyField("AuditRecord")


class AuditRecord(RecordBase):
    code = models.CharField(max_length=12, unique=True)
    note = models.TextField()


class LedgerEntryProxy(LedgerEntry):
    class Meta:
        proxy = True
