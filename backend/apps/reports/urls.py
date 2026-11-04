from django.urls import path

from . import views

# Mounted at /api/
urlpatterns = [
    path("reports/sales-profitability/", views.SalesProfitabilityView.as_view()),
    path("reports/brands/", views.BrandReportView.as_view()),
    path("reports/products/", views.ProductReportView.as_view()),
    path("reports/distributors/", views.DistributorReportView.as_view()),
    path("reports/purchase-register/", views.PurchaseRegisterView.as_view()),
    path("reports/sales-register/", views.SalesRegisterView.as_view()),
    path("reports/gst-summary/", views.GstSummaryView.as_view()),
    path("dashboard/", views.DashboardView.as_view()),
    path("lookups/", views.LookupsView.as_view()),
    path("search/", views.SearchView.as_view()),
]
