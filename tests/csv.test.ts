import { describe, expect, it } from 'vitest';
import { FOOD_CATEGORIES, exportCsv, naturalKey, validateCsv } from '@food-expiry/core';

describe('CSV validation', () => {
  it('keeps categories alphabetized with Misc last and accepts Medicine', () => {
    expect(FOOD_CATEGORIES.at(-1)).toBe('Misc');
    expect(FOOD_CATEGORIES.slice(0, -1)).toEqual(
      [...FOOD_CATEGORIES.slice(0, -1)].sort((first, second) => first.localeCompare(second))
    );
    const result = validateCsv('name,category,expiration_date,calories\nPain reliever,Medicine,2026-11-10,0');
    expect(result.errors).toEqual([]);
    expect(result.items[0]?.category).toBe('Medicine');
  });

  it('normalizes and deduplicates identical item identities using the final row', () => {
    const result = validateCsv([
      'name,category,expiration_date,calories,quantity',
      'Whole Milk,Meal,2026-11-10,200,2',
      'whole milk,Meal,2026-11-10,200,3'
    ].join('\n'));
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

  it('uses case-insensitive name and category natural keys', () => {
    expect(naturalKey({ name: 'Milk', category: 'Meal', expirationDate: '2026-11-10' }))
      .toBe(naturalKey({ name: 'mILK', category: 'Meal', expirationDate: '2026-11-10' }));
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

  it('round-trips CSV exports without losing item fields', () => {
    const item = {
      id: '90bf5a93-dda6-5a7f-9f64-b4eb014513c1',
      name: 'Whole "Cream" Milk',
      category: 'Meal' as const,
      expirationDate: '2026-11-10',
      calories: 150,
      quantity: 2,
      notifyWindow: 14,
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z'
    };
    const exported = exportCsv([item]);
    const imported = validateCsv(exported);
    expect(imported.errors).toEqual([]);
    expect(imported.items).toEqual([item]);
  });
});
