"""Decimal helpers. All money, tax and price arithmetic in the backend uses Decimal, never float."""

from decimal import ROUND_HALF_UP, Decimal

TWO = Decimal("0.01")
ZERO = Decimal("0.00")


def D(value) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def q2(value) -> Decimal:
    return D(value).quantize(TWO, rounding=ROUND_HALF_UP)


def round_rupee(value) -> Decimal:
    return D(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
