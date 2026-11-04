from django.utils import timezone

from .exceptions import DomainError


def reject_future_date(value, label: str) -> None:
    """Business documents record something that already happened, so they cannot be dated after today (local date)."""
    if value > timezone.localdate():
        raise DomainError(f"{label} cannot be in the future.")
