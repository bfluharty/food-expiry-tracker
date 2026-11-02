import { describe, expect, it } from 'vitest';
import { itemHash, validateCsv } from '../src/shared/csv.js';

describe('CSV validation', () => {
  it('normalizes and deduplicates identical item identities using the final row', () => {
    const result = validateCsv([
      'name,category,expiration_date,calories,quantity',
      'Whole Milk,Meal,2026-11-10,200,2',
      'whole milk,Meal,2026-11-10,200,3'
    ].join('\n'), '2026-01-01T00:00:00.000Z');
    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'whole milk', category: 'Meal', calories: 200, quantity: 3 });
  });

  it('returns every invalid row and no items', () => {
    const result = validateCsv([
      'name,category,expiration_date,calories,quantity',
      ',Dairy,2026-02-30,-1,0',
      'Chicken,,not-a-date,nope,one'
    ].join('\n'));
    expect(result.items).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatchObject({ line: 2 });
    expect(result.errors[1]).toMatchObject({ line: 3 });
  });

  it('uses case-insensitive name and category identity', () => {
    expect(itemHash('Milk', 'Meal', '2026-11-10')).toBe(itemHash('mILK', 'mEAL', '2026-11-10'));
  });

  it('accepts an optional positive per-item notification window', () => {
    const result = validateCsv('name,category,expiration_date,calories,quantity,notify_window\nMilk,Meal,2026-11-10,120,1,14');
    expect(result.errors).toEqual([]);
    expect(result.items[0]?.notifyWindow).toBe(14);
  });

  it('rejects an invalid per-item notification window', () => {
    const result = validateCsv('name,category,expiration_date,calories,quantity,notify_window\nMilk,Meal,2026-11-10,120,1,0');
    expect(result.errors).toEqual([{ line: 2, message: 'notify_window must be a positive integer' }]);
  });

  it('defaults an omitted quantity column to one', () => {
    const result = validateCsv('name,category,expiration_date,calories\nAlmonds,Nuts/Seeds,2026-11-10,170');
    expect(result.errors).toEqual([]);
    expect(result.items[0]).toMatchObject({ quantity: 1, calories: 170, category: 'Nuts/Seeds' });
  });

  it('rejects unknown categories and invalid calories', () => {
    const result = validateCsv('name,category,expiration_date,calories\nMilk,Dairy,2026-11-10,-1');
    expect(result.items).toEqual([]);
    expect(result.errors[0]?.message).toContain('category must be one of');
    expect(result.errors[0]?.message).toContain('calories must be a non-negative integer');
  });
});
