import { describe, expect, it } from 'vitest';
import { itemsReadyForNotification } from '@food-expiry/core';
import type { FoodItem } from '@food-expiry/core';

const item = (expirationDate: string, notifyWindow?: number): FoodItem => ({
  id: '90bf5a93-dda6-5a7f-9f64-b4eb014513c1',
  name: 'Milk',
  category: 'Meal',
  expirationDate,
  calories: 150,
  quantity: 1,
  notifyWindow,
  createdAt: '',
  updatedAt: ''
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
