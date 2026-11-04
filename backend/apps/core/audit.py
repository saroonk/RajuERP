from .models import AuditLog


def audit(user, action: str, entity_type: str, entity_ref: str, summary: str) -> None:
    """Record an important financial, inventory or administrative action."""
    AuditLog.objects.create(
        user=user if getattr(user, "pk", None) else None,
        user_name=getattr(user, "name", "") or "System",
        action=action,
        entity_type=entity_type,
        entity_ref=str(entity_ref)[:120],
        summary=summary[:300],
    )
