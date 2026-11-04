from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("sales/invoices", views.InvoiceViewSet, basename="sales-invoice")
router.register("sales/notes", views.NoteViewSet, basename="sales-note")
router.register("sales/returns", views.SalesReturnViewSet, basename="sales-return")

# Mounted at /api/
urlpatterns = router.urls
