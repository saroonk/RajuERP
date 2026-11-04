import random
from decimal import Decimal

from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from .audit import audit
from .models import AuditLog, BackupRecord, Settings
from .serializers import AuditLogSerializer, BackupRecordSerializer, SettingsSerializer


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    permission_module = "admin"
    serializer_class = AuditLogSerializer
    queryset = AuditLog.objects.all()
    search_fields = ["summary", "entity_ref", "user_name", "entity_type"]
    filterset_fields = ["entity_type", "action", "user"]
    ordering_fields = ["at"]


class SettingsView(APIView):
    """GET is open to every signed-in user (invoices and screens need company details); PUT needs Administration edit."""

    permission_modules = None

    def get_permissions(self):
        from rest_framework.permissions import IsAuthenticated

        from .permissions import ModulePermission

        return [IsAuthenticated()] if self.request.method == "GET" else [ModulePermission()]

    permission_module = "admin"

    def get(self, request):
        return Response(SettingsSerializer(Settings.load()).data)

    def put(self, request):
        s = SettingsSerializer(Settings.load(), data=request.data)
        s.is_valid(raise_exception=True)
        s.save()
        audit(request.user, "update", "Settings", "Company settings", "Updated company and billing settings")
        return Response(s.data)


class BackupViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_module = "admin"
    serializer_class = BackupRecordSerializer
    queryset = BackupRecord.objects.all().order_by("-date", "-time", "-id")
    pagination_class = None

    def create(self, request):
        """Records a simulated backup. No data is exported in this build; real backups belong to the deployment."""
        now = timezone.localtime()
        rec = BackupRecord.objects.create(
            date=now.date(), time=now.strftime("%H:%M"), type="manual", size_mb=Decimal(str(round(40 + random.random(), 2))), status="completed"
        )
        audit(request.user, "other", "Backup", str(rec.pk), "Simulated backup recorded")
        return Response(BackupRecordSerializer(rec).data, status=201)
