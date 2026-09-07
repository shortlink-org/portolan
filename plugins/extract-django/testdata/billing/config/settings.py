"""Settings. A fixture keeps only what the layout needs to be believable."""

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "rest_framework",
    "invoices",
]

DEFAULT_AUTO_FIELD = "django.db.models.AutoField"

# Who may call, when a view does not say: a JWT bearer, and only a caller.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
}

DATABASES = {
    "default": {"ENGINE": "psqlextra.backend", "NAME": "billing"},
    "archive": {"ENGINE": "django.db.backends.postgresql", "NAME": "billing_archive"},
}

# Read by config/celery.py under the CELERY_ prefix: the one task with a
# queue of its own, and where the rest land.
CELERY_TASK_DEFAULT_QUEUE = "billing"
CELERY_TASK_ROUTES = {"invoices.tasks.send_invoice_email": {"queue": "billing.mail"}}
