import csv

from django.http import HttpResponse


def _is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def _safe(value):
    """Neutralise spreadsheet formula injection in text cells (leading = + - @)."""
    if value is None:
        return ""
    if isinstance(value, str) and value[:1] in ("=", "+", "@", "-") and not _is_number(value):
        return "'" + value
    return value


def csv_response(filename: str, headers: list[str], rows: list[list]) -> HttpResponse:
    """UTF-8 CSV with a BOM so Excel opens it correctly."""
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}.csv"'
    response.write("﻿")
    writer = csv.writer(response)
    writer.writerow(headers)
    for row in rows:
        writer.writerow([_safe(v) for v in row])
    return response
