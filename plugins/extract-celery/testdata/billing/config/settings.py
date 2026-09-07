"""Settings. A fixture keeps only what the reader needs to be believable."""

import os
from datetime import timedelta

from celery.schedules import crontab

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "invoices",
]

DATABASES = {"default": {"ENGINE": "django.db.backends.postgresql", "NAME": "billing"}}

# Read by config/celery.py under the CELERY_ prefix: where the messages go,
# where a task lands when nothing else says, and the one task with a queue
# of its own.
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_TASK_DEFAULT_QUEUE = "billing"
CELERY_TASK_ROUTES = {
    "invoices.tasks.send_invoice_email": {"queue": "billing.mail"},
}

# What the clock sets off: the reminder again every six hours, on top of the
# countdown services.py gives it, and the archive nightly.
CELERY_BEAT_SCHEDULE = {
    "remind-unpaid-invoices": {"task": "invoices.tasks.remind_unpaid_invoice", "schedule": timedelta(hours=6)},
    "archive-closed-invoices": {"task": "billing.archive_invoice", "schedule": crontab(hour=2, minute=30)},
}
