import { describe, expect, it } from 'vitest';
import { itemHash, validateCsv } from '../src/shared/csv.js';

describe('CSV validation', () => {
  it('normalizes and deduplicates identical item identities using the final row', () => {
    const result = validateCsv([
      'name,category,expiration_date,quantity',
      'Whole Milk,Dairy,2026-11-10,2',
      'whole milk,dairy,2026-11-10,3'
    ].join('\n'), '2026-01-01T00:00:00.000Z');
    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'whole milk', category: 'dairy', quantity: 3 });
  });

  it('returns every invalid row and no items', () => {
    const result = validateCsv([
      'name,category,expiration_date,quantity',
      ',Dairy,2026-02-30,0',
      'Chicken,,not-a-date,one'
    ].join('\n'));
    expect(result.items).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatchObject({ line: 2 });
    expect(result.errors[1]).toMatchObject({ line: 3 });
  });

  it('uses case-insensitive name and category identity', () => {
    expect(itemHash('Milk', 'Dairy', '2026-11-10')).toBe(itemHash('mILK', 'dAiRY', '2026-11-10'));
  });
});
