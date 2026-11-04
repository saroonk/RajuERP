from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("suppliers", views.SupplierViewSet, basename="supplier")
router.register("distributors", views.DistributorViewSet, basename="distributor")
router.register("distributor-prices", views.DistributorPriceViewSet, basename="distributor-price")

# Mounted at /api/
urlpatterns = router.urls
