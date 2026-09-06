"""The Celery app is imported here so a worker started with `-A config` finds it."""

from .celery import app  # noqa: F401
