import { describe, expect, it } from 'vitest';
import { buildDigestPayloads } from '../src/shared/digest.js';
import type { FoodItem } from '../src/shared/types.js';

const items: FoodItem[] = [
  { pk: 'ITEM', sk: '2026-11-05#a', name: 'Chicken Breast', category: 'Meat/Beans', expirationDate: '2026-11-05', calories: 220, quantity: 1, updatedAt: '' },
  { pk: 'ITEM', sk: '2026-11-05#b', name: 'Whole Milk', category: 'Meal', expirationDate: '2026-11-05', calories: 150, quantity: 2, updatedAt: '' },
  { pk: 'ITEM', sk: '2026-11-10#c', name: 'Yogurt', category: 'Snack', expirationDate: '2026-11-10', calories: 110, quantity: 3, updatedAt: '' }
];

describe('Slack digest', () => {
  it('groups items by date and includes the configured window in the header', () => {
    const [payload] = buildDigestPayloads(items, '2026-11-02');
    expect(payload.blocks[0].text.text).toBe('Food expiring soon');
    expect(payload.blocks[1].text.text).toContain('2026-11-05 — 3 days remaining');
    expect(payload.blocks[1].text.text).toContain('• Whole Milk (Meal) ×2');
    expect(payload.blocks).toHaveLength(3);
  });
});
