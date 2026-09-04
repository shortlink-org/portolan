"""What each endpoint is called."""

from rest_framework.routers import DefaultRouter

from .views import InvoiceViewSet

router = DefaultRouter()
router.register("invoices", InvoiceViewSet, basename="invoice")

urlpatterns = router.urls
