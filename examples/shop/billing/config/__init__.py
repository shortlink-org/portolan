"""The Celery app is imported with the project so that a worker started with
`celery -A config worker` finds it, and `shared_task` binds to it."""

from .celery import app  # noqa: F401
