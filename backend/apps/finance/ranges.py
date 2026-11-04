"""Date helpers shared by finance and report endpoints."""

from datetime import date, timedelta

from django.utils import timezone
from rest_framework import serializers

from apps.core.exceptions import DomainError

_DATE = serializers.DateField()


def _parse(value: str, label: str) -> date:
    try:
        return _DATE.run_validation(value)
    except serializers.ValidationError:
        raise DomainError(f"'{label}' must be a date in YYYY-MM-DD format.")


def parse_range(request) -> tuple[date, date]:
    """`?from=&to=` (both optional): defaults to all time up to today."""
    raw_from, raw_to = request.query_params.get("from"), request.query_params.get("to")
    frm = _parse(raw_from, "from") if raw_from else date(2000, 1, 1)
    to = _parse(raw_to, "to") if raw_to else timezone.localdate()
    if frm > to:
        raise DomainError("From date must be before To date.")
    return frm, to


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def start_of_month(d: date) -> date:
    return d.replace(day=1)


def add_months(d: date, months: int) -> date:
    idx = d.year * 12 + (d.month - 1) + months
    return date(idx // 12, idx % 12 + 1, 1)


def month_keys_between(frm: date, to: date) -> list[str]:
    out, cur = [], start_of_month(frm)
    while cur <= to:
        out.append(month_key(cur))
        cur = add_months(cur, 1)
    return out


def last_months(n: int, d: date) -> list[str]:
    base = start_of_month(d)
    return [month_key(add_months(base, -i)) for i in range(n - 1, -1, -1)]


def prev_month_end(d: date) -> date:
    return start_of_month(d) - timedelta(days=1)
