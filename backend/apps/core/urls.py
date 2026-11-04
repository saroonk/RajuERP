from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("audit", views.AuditLogViewSet, basename="audit")
router.register("backups", views.BackupViewSet, basename="backup")

# Mounted at /api/admin/
urlpatterns = [path("settings/", views.SettingsView.as_view())] + router.urls
