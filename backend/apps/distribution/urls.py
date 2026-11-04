from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("distribution/orders", views.OrderViewSet, basename="distribution-order")
router.register("distribution/dispatches", views.DispatchViewSet, basename="distribution-dispatch")
router.register("distribution/stock-reports", views.StockReportViewSet, basename="distribution-stock-report")

# Mounted at /api/
urlpatterns = [path("distribution/stock/", views.DistributorStockView.as_view())] + router.urls
