import { describe, expect, it } from 'vitest';
import { buildDigestPayloads, buildEmptyDigestPayload } from '../src/shared/digest.js';
import type { FoodItem } from '../src/shared/types.js';

const items: FoodItem[] = [
  { pk: 'ITEM', sk: '2026-11-10#c', name: 'Yogurt', category: 'Snack', expirationDate: '2026-11-10', calories: 110, quantity: 3, updatedAt: '' },
  { pk: 'ITEM', sk: '2026-11-05#a', name: 'Chicken Breast', category: 'Meat/Beans', expirationDate: '2026-11-05', calories: 220, quantity: 1, updatedAt: '' },
  { pk: 'ITEM', sk: '2026-11-05#b', name: 'Whole Milk', category: 'Meal', expirationDate: '2026-11-05', calories: 150, quantity: 2, updatedAt: '' }
];

describe('Slack digest', () => {
  it('groups items by date and includes the configured window in the header', () => {
    const [payload] = buildDigestPayloads(items, '2026-11-02');
    expect(payload.blocks[0].text.text).toBe('Food expiring soon');
    expect(payload.blocks[1].text.text).toBe('<@U0CE1LDJY6R>');
    expect(payload.blocks[2].text.text).toContain('2026-11-05 — 3 days remaining');
    expect(payload.blocks[2].text.text).toContain('• Whole Milk (Meal) ×2');
    expect(payload.blocks).toHaveLength(4);
  });

  it('creates a tagged message when no items are expiring', () => {
    const payload = buildEmptyDigestPayload();
    expect(payload.blocks[1].text.text).toBe('<@U0CE1LDJY6R>');
    expect(payload.blocks[2].text.text).toBe('Nothing is in the expiration window.');
  });

  it('moves whole date sections to a continuation without another mention', () => {
    const manyDates = Array.from({ length: 49 }, (_, index): FoodItem => {
      const day = String(index + 1).padStart(2, '0');
      return {
        pk: 'ITEM', sk: `2026-12-${day}#${index}`, name: `Item ${index}`, category: 'Misc',
        expirationDate: `2026-12-${day}`, calories: 1, quantity: 1, updatedAt: ''
      };
    });
    const payloads = buildDigestPayloads(manyDates, '2026-11-30');
    expect(payloads).toHaveLength(2);
    expect(payloads[0].blocks).toHaveLength(50);
    expect(payloads[1].blocks[0].text.text).toBe('Food expiring soon (continued)');
    expect(payloads[1].blocks).toHaveLength(2);
    expect(payloads[1].blocks.some((block) => block.text.text === '<@U0CE1LDJY6R>')).toBe(false);
  });
});
