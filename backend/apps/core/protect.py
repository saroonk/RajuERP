"""Shared helpers for master-data viewsets: audited CRUD and a friendly 409 when a record is still referenced."""

from rest_framework import viewsets

from .audit import audit
from .exceptions import ConflictError


def ensure_unused(name: str, checks: list[tuple[str, object]]) -> None:
    """`checks` is [(label, queryset)]. Raises a 409 naming the first dependency that still uses the record."""
    for label, qs in checks:
        n = qs.count()
        if n:
            raise ConflictError(f'Cannot delete "{name}": it is used by {n} {label}. Mark it inactive instead.')


class AuditedModelViewSet(viewsets.ModelViewSet):
    """ModelViewSet that writes audit entries and blocks deletes of referenced rows (`protect_checks`)."""

    entity_name = "Record"

    def name_of(self, obj) -> str:
        return str(obj)

    def protect_checks(self, instance) -> list[tuple[str, object]]:
        return []

    def perform_create(self, serializer):
        obj = serializer.save()
        audit(self.request.user, "create", self.entity_name, self.name_of(obj), f"Created {self.entity_name.lower()} {self.name_of(obj)}")

    def perform_update(self, serializer):
        obj = serializer.save()
        audit(self.request.user, "update", self.entity_name, self.name_of(obj), f"Updated {self.entity_name.lower()} {self.name_of(obj)}")

    def perform_destroy(self, instance):
        name = self.name_of(instance)
        ensure_unused(name, self.protect_checks(instance))
        instance.delete()
        audit(self.request.user, "delete", self.entity_name, name, f"Deleted {self.entity_name.lower()} {name}")
