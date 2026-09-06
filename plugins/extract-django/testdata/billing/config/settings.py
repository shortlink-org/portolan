"""Settings. A fixture keeps only what the layout needs to be believable."""

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "rest_framework",
    "invoices",
]

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

DATABASES = {"default": {"ENGINE": "django.db.backends.postgresql", "NAME": "billing"}}

# Read by config/celery.py under the CELERY_ prefix: the one task with a
# queue of its own, and where the rest land.
CELERY_TASK_DEFAULT_QUEUE = "billing"
CELERY_TASK_ROUTES = {"invoices.tasks.send_invoice_email": {"queue": "billing.mail"}}
