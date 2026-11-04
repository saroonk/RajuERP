from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("brands", views.BrandViewSet, basename="brand")
router.register("categories", views.CategoryViewSet, basename="category")
router.register("units", views.UnitViewSet, basename="unit")
router.register("unit-conversions", views.UnitConversionViewSet, basename="unit-conversion")
router.register("products", views.ProductViewSet, basename="product")

# Mounted at /api/
urlpatterns = router.urls
