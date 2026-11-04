from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("inventory/batches", views.BatchViewSet, basename="batch")
router.register("inventory/movements", views.MovementViewSet, basename="movement")
router.register("inventory/write-offs", views.WriteOffViewSet, basename="write-off")
router.register("inventory/reconciliations", views.ReconciliationViewSet, basename="reconciliation")

# Mounted at /api/
urlpatterns = [
    path("inventory/stock-by-product/", views.StockByProductView.as_view()),
    path("inventory/valuation/", views.ValuationView.as_view()),
    path("inventory/alerts/", views.AlertsView.as_view()),
    path("inventory/suggest-allocation/", views.SuggestAllocationView.as_view()),
    path("inventory/dispatchable-batches/", views.DispatchableBatchesView.as_view()),
] + router.urls
