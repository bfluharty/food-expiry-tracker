import { describe, expect, it } from 'vitest';
import { isSyncRequest, syncRequestError, type FoodItem } from '@food-expiry/core';

const validItem: FoodItem = {
  id: '90bf5a93-dda6-5a7f-9f64-b4eb014513c1',
  name: 'Milk',
  category: 'Meal',
  expirationDate: '2026-11-10',
  calories: 120,
  quantity: 1,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z'
};

describe('sync request validation', () => {
  it('accepts a valid request with or without a cursor', () => {
    expect(isSyncRequest({ changes: [validItem] })).toBe(true);
    expect(isSyncRequest({ cursor: '2026-11-02T10:00:00.000Z', changes: [validItem] })).toBe(true);
  });

  it('identifies an invalid cursor', () => {
    expect(syncRequestError({ cursor: 'invalid', changes: [] })).toBe('Cursor must be a valid timestamp.');
  });

  it('identifies a malformed pending change', () => {
    expect(syncRequestError({ changes: [{ ...validItem, id: 'not-a-uuid' }] }))
      .toBe('Change 1 must have a valid UUID.');
  });

  it('identifies an oversized batch', () => {
    expect(syncRequestError({ changes: Array.from({ length: 101 }, () => validItem) }))
      .toBe('Changes cannot contain more than 100 items.');
  });

  it('identifies an invalid item field', () => {
    expect(syncRequestError({ changes: [{ ...validItem, name: 'x'.repeat(121) }] }))
      .toBe('Change 1 must have a non-empty name of at most 120 characters.');
  });
});
