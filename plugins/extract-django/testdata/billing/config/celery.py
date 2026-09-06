"""The Celery app, configured from the settings under the CELERY_ prefix. The
flow reader reads it for the queue an enqueue lands on."""

from celery import Celery

app = Celery("billing")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
