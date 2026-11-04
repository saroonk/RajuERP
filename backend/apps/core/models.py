from django.conf import settings
from django.db import models


class DocumentSequence(models.Model):
    """Last number issued per document kind and year (INV-2026-0012). Locked while issuing a number."""

    kind = models.CharField(max_length=20)
    year = models.PositiveIntegerField()
    last_number = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["kind", "year"], name="uniq_sequence_kind_year")]


class AuditLog(models.Model):
    ACTIONS = [(a, a) for a in ("create", "update", "delete", "status", "login", "other")]

    at = models.DateTimeField(auto_now_add=True, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    user_name = models.CharField(max_length=150)
    action = models.CharField(max_length=10, choices=ACTIONS)
    entity_type = models.CharField(max_length=60, db_index=True)
    entity_ref = models.CharField(max_length=120)
    summary = models.CharField(max_length=300)

    class Meta:
        ordering = ["-at", "-id"]


class Settings(models.Model):
    """Single-row company and billing configuration."""

    VALUATION = [("fifo", "FIFO"), ("weighted_average", "Weighted average")]

    company_name = models.CharField(max_length=150, default="My Company")
    gstin = models.CharField(max_length=15, blank=True)
    state = models.CharField(max_length=60, default="Karnataka")
    address = models.CharField(max_length=300, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    valuation_method = models.CharField(max_length=20, choices=VALUATION, default="fifo")
    expiry_alert_days = models.PositiveIntegerField(default=90)
    default_credit_days = models.PositiveIntegerField(default=30)
    invoice_terms = models.TextField(blank=True)

    class Meta:
        verbose_name_plural = "settings"

    @classmethod
    def load(cls) -> "Settings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class BackupRecord(models.Model):
    """Backup history. In this build a 'backup' is only a recorded event; nothing is exported."""

    date = models.DateField()
    time = models.CharField(max_length=5)
    type = models.CharField(max_length=10, choices=[("scheduled", "scheduled"), ("manual", "manual")])
    size_mb = models.DecimalField(max_digits=8, decimal_places=2)
    status = models.CharField(max_length=10, choices=[("completed", "completed"), ("failed", "failed")])
