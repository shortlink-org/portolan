"""Settings. The example keeps what the service needs to run and no more."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("SECRET_KEY", "example-only-not-a-secret")
DEBUG = os.environ.get("DEBUG", "1") == "1"
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "drf_spectacular",
    "invoices",
]

MIDDLEWARE = ["django.middleware.common.CommonMiddleware"]

ROOT_URLCONF = "config.urls"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "billing"),
        "USER": os.environ.get("POSTGRES_USER", "billing"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "billing"),
        "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
        "PORT": os.environ.get("POSTGRES_PORT", "5436"),
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {"DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema"}

# The document under invoices/schema is this, written out and committed: the
# catalog reads it for what the service provides, and the operation ids are
# given rather than generated so that both sides spell an endpoint the same.
SPECTACULAR_SETTINGS = {"TITLE": "billing", "VERSION": "1.0.0", "SERVE_INCLUDE_SCHEMA": False}

AUTH_URL = os.environ.get("AUTH_URL", "http://auth:8080")

DEFAULT_FROM_EMAIL = "billing@shop.example"

# Read by config/celery.py under the CELERY_ prefix: the broker the messages
# go through, the queue a task lands on when nothing else says, and the one
# task with a queue of its own. The catalog reads the same three lines.
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_TASK_DEFAULT_QUEUE = "billing"
CELERY_TASK_ROUTES = {
    "invoices.tasks.send_invoice_email": {"queue": "billing.mail"},
}
