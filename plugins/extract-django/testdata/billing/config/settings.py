"""Settings. A fixture keeps only what the layout needs to be believable."""

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "rest_framework",
    "invoices",
]

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

DATABASES = {"default": {"ENGINE": "django.db.backends.postgresql", "NAME": "billing"}}
