"""The project's routes: each application brings its own."""

from django.urls import include, path

urlpatterns = [path("api/", include("invoices.urls"))]
