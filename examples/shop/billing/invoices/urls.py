"""What each endpoint is called.

The basename is half of every endpoint id the catalog reads - `invoice_issue` -
and the other half is the action. The document under `schema/` gives its
operations the same ids, which is what pairs an operation with the interface
that exposes it.
"""

from rest_framework.routers import DefaultRouter

from .views import InvoiceViewSet

router = DefaultRouter()
router.register("v1/invoices", InvoiceViewSet, basename="invoice")

urlpatterns = router.urls
