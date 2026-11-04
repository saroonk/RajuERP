"""Stock valuation (Decimal port of frontend/src/utils/valuation.ts)."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from apps.core.money import ZERO, q2


@dataclass(frozen=True)
class CostLayer:
    received_qty: int
    unit_cost: Decimal
    received_on: date


def value_stock(method: str, on_hand_qty: int, layers: list[CostLayer]) -> tuple[Decimal, Decimal]:
    """
    (unit_cost, value) of `on_hand_qty` units of one product.

    - fifo: oldest receipts are consumed first, so remaining stock is costed from the newest layers backwards.
    - weighted_average: all receipts averaged by quantity.
    """
    if on_hand_qty <= 0 or not layers:
        return ZERO, ZERO
    if method == "weighted_average":
        total_qty = sum(l.received_qty for l in layers)
        total_cost = sum((l.received_qty * l.unit_cost for l in layers), ZERO)
        unit = total_cost / total_qty if total_qty else ZERO
        return q2(unit), q2(unit * on_hand_qty)
    remaining = on_hand_qty
    value = ZERO
    for layer in sorted(layers, key=lambda l: l.received_on, reverse=True):
        if remaining <= 0:
            break
        take = min(remaining, layer.received_qty)
        value += take * layer.unit_cost
        remaining -= take
    if remaining > 0:  # stock beyond known receipts (should not happen) is costed at the oldest layer
        value += remaining * layers[-1].unit_cost
    return q2(value / on_hand_qty), q2(value)
