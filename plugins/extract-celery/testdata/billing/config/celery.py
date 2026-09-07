"""The Celery app: one per project, configured from the Django settings under
the CELERY_ prefix, which is the arrangement the Celery documentation gives."""

import os

from celery import Celery
from celery.schedules import crontab

from invoices.tasks import close_stale_drafts

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("billing")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@app.on_after_configure.connect
def schedule_housekeeping(sender, **kwargs):
    """The other way to say what the clock sets off: a task nothing in the
    code enqueues, run nightly."""
    sender.add_periodic_task(crontab(hour=3, minute=0), close_stale_drafts.s(), name="close-stale-drafts")
