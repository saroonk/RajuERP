from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("purchasing/orders", views.PurchaseOrderViewSet, basename="purchase-order")
router.register("purchasing/receipts", views.GoodsReceiptViewSet, basename="goods-receipt")
router.register("purchasing/returns", views.SupplierReturnViewSet, basename="supplier-return")
router.register("purchasing/payments", views.SupplierPaymentViewSet, basename="supplier-payment")

# Mounted at /api/
urlpatterns = [path("purchasing/outstanding/", views.SupplierOutstandingView.as_view())] + router.urls
