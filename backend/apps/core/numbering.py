from django.db import transaction

from .models import DocumentSequence

PREFIX = {
    "po": "PO",
    "grn": "GRN",
    "supplier_return": "SRT",
    "supplier_payment": "SPY",
    "order": "ORD",
    "dispatch": "DSP",
    "invoice": "INV",
    "credit_note": "CN",
    "debit_note": "DN",
    "sales_return": "RET",
    "receipt": "RCT",
    "write_off": "WO",
    "reconciliation": "REC",
    "expense": "EXP",
}


def next_doc_no(kind: str, on_date) -> str:
    """
    Sequential document number per kind and calendar year, e.g. INV-2026-0012.

    The sequence row is locked (`select_for_update`: effective on PostgreSQL, a no-op on SQLite where
    writers are already serialised) inside the caller's transaction. The unique constraint on every
    document number column is the final guard against duplicates.
    """
    year = on_date.year
    with transaction.atomic():
        seq, _ = DocumentSequence.objects.select_for_update().get_or_create(kind=kind, year=year)
        seq.last_number += 1
        seq.save(update_fields=["last_number"])
    return f"{PREFIX[kind]}-{year}-{seq.last_number:04d}"
