"""The Celery app: one per project, configured from the Django settings under
the CELERY_ prefix. Tasks are found in each application's tasks.py."""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("billing")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
