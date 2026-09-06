"""Two tasks on the app, one shared task nothing enqueues."""

from celery import shared_task

from config.celery import app


@app.task
def build_report(period):
    """Builds the monthly report."""


@app.task
def deliver_report(report_id):
    """Sends the report to whoever asked for it."""


@shared_task
def orphan():
    """Declared, never enqueued."""
