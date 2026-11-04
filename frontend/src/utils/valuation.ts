import { round2 } from './format';

export interface CostLayer {
  /** Quantity originally received. */
  receivedQty: number;
  unitCost: number;
  /** Receipt date, used to order FIFO layers. */
  receivedOn: string;
}

/**
 * Value `onHandQty` units of one product.
 *
 * - FIFO: the oldest receipts are consumed first, so what remains is costed from the newest layers backwards.
 * - Weighted average: all receipts are averaged by quantity.
 */
export function valueStock(
  method: 'fifo' | 'weighted_average',
  onHandQty: number,
  layers: CostLayer[],
): { unitCost: number; value: number } {
  if (onHandQty <= 0 || layers.length === 0) return { unitCost: 0, value: 0 };
  if (method === 'weighted_average') {
    const qty = layers.reduce((s, l) => s + l.receivedQty, 0);
    const cost = layers.reduce((s, l) => s + l.receivedQty * l.unitCost, 0);
    const unitCost = qty ? cost / qty : 0;
    return { unitCost: round2(unitCost), value: round2(unitCost * onHandQty) };
  }
  let remaining = onHandQty;
  let value = 0;
  for (const l of [...layers].sort((a, b) => b.receivedOn.localeCompare(a.receivedOn))) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, l.receivedQty);
    value += take * l.unitCost;
    remaining -= take;
  }
  // Stock beyond known receipts (should not happen) is costed at the oldest layer.
  if (remaining > 0) value += remaining * layers[layers.length - 1].unitCost;
  return { unitCost: round2(value / onHandQty), value: round2(value) };
}
