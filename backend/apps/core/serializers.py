from rest_framework import serializers

from apps.core.money import q2
from .models import AuditLog, BackupRecord, Settings

import re

GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$")


def validate_gstin(value: str) -> str:
    """Shared GSTIN format check (empty allowed)."""
    value = (value or "").strip().upper()
    if value and not GSTIN_RE.match(value):
        raise serializers.ValidationError("Enter a valid 15-character GSTIN (e.g. 29ABCDE1234F1Z5).")
    return value


class AuditLogSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    user_id = serializers.CharField(read_only=True, default="")

    class Meta:
        model = AuditLog
        fields = ["id", "at", "user_id", "user_name", "action", "entity_type", "entity_ref", "summary"]


class SettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = Settings
        exclude = ["id"]

    def validate_company_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Company name is required.")
        return value.strip()

    def validate_gstin(self, value):
        return validate_gstin(value)

    def validate_expiry_alert_days(self, value):
        if not 1 <= value <= 365:
            raise serializers.ValidationError("Must be between 1 and 365 days.")
        return value


class BackupRecordSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    size_mb = serializers.DecimalField(max_digits=8, decimal_places=2, coerce_to_string=False)

    class Meta:
        model = BackupRecord
        fields = ["id", "date", "time", "type", "size_mb", "status"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["size_mb"] = float(q2(instance.size_mb))
        return data
