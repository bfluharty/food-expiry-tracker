import { describe, expect, it } from 'vitest';
import { itemsReadyForNotification } from '../src/shared/notification.js';
import type { FoodItem } from '../src/shared/types.js';

const item = (expirationDate: string, notifyWindow?: number): FoodItem => ({
  pk: 'ITEM', sk: `${expirationDate}#id`, name: 'Milk', category: 'Meal', expirationDate, calories: 150, quantity: 1, notifyWindow, updatedAt: ''
});

describe('per-item notification windows', () => {
  it('uses the item override when present and the configured default otherwise', () => {
    const result = itemsReadyForNotification([
      item('2026-11-10', 7),
      item('2026-11-10'),
      item('2026-12-03', 31)
    ], '2026-11-02', 30);
    expect(result.map(({ expirationDate }) => expirationDate)).toEqual(['2026-11-10', '2026-12-03']);
  });
});
