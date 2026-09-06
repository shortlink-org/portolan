"""A chain, a task sent by name to another tree, and a `.delay` on something
that is not a task."""

from celery import chain

from config.celery import app

from .tasks import build_report, deliver_report
from .utils import helper


def request_report(period):
    """Builds the report and then delivers it."""
    chain(build_report.s(period), deliver_report.s()).apply_async()


def forward_receipt(receipt_id):
    """Hands a receipt to the mail service's own task."""
    app.send_task("mail.tasks.send_receipt", args=[receipt_id], queue="mail")


def mystery():
    helper.delay(1)
