import { describe, expect, it } from 'vitest';
import { addDays, isValidIsoDate, todayInTimezone } from '@food-expiry/core';

describe('date utilities', () => {
  it('rejects calendar-invalid ISO dates', () => {
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026/11/10')).toBe(false);
  });

  it('adds calendar days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('uses the requested timezone for today', () => {
    expect(todayInTimezone('America/New_York', new Date('2026-11-02T03:30:00.000Z'))).toBe('2026-11-01');
  });
});
