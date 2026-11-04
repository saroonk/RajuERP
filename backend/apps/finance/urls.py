from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("finance/payments", views.PaymentViewSet, basename="payment")
router.register("finance/expenses", views.ExpenseViewSet, basename="expense")
router.register("expense-categories", views.ExpenseCategoryViewSet, basename="expense-category")

# Mounted at /api/
urlpatterns = [
    path("finance/balances/", views.BalancesView.as_view()),
    path("finance/ledger/", views.LedgerView.as_view()),
    path("finance/open-invoices/", views.OpenInvoicesView.as_view()),
    path("finance/suggest-allocations/", views.SuggestAllocationsView.as_view()),
    path("finance/summary/", views.SummaryView.as_view()),
] + router.urls
