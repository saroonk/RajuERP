from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/admin/", include("apps.core.urls")),
    path("api/", include("apps.users.urls")),
    path("api/", include("apps.catalog.urls")),
    path("api/", include("apps.parties.urls")),
    path("api/", include("apps.inventory.urls")),
    path("api/", include("apps.purchasing.urls")),
    path("api/", include("apps.distribution.urls")),
    path("api/", include("apps.sales.urls")),
    path("api/", include("apps.finance.urls")),
    path("api/", include("apps.reports.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]
