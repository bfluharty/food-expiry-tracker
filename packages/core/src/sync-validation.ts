import { isValidIsoDate } from './dates.js';
import { FOOD_CATEGORIES, type SyncRequest } from './types.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxChanges = 100;

export function syncRequestError(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('changes' in value)) {
    return 'Request must contain a changes array.';
  }
  const candidate = value as { cursor?: unknown; changes: unknown };
  if (candidate.cursor !== undefined
    && (typeof candidate.cursor !== 'string' || !Number.isFinite(Date.parse(candidate.cursor)))) {
    return 'Cursor must be a valid timestamp.';
  }
  if (!Array.isArray(candidate.changes)) return 'Changes must be an array.';
  if (candidate.changes.length > maxChanges) return `Changes cannot contain more than ${maxChanges} items.`;

  for (const [index, value] of candidate.changes.entries()) {
    const prefix = `Change ${index + 1}`;
    if (typeof value !== 'object' || value === null) return `${prefix} must be an item object.`;
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || !uuidPattern.test(item.id)) return `${prefix} must have a valid UUID.`;
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120) {
      return `${prefix} must have a non-empty name of at most 120 characters.`;
    }
    if (typeof item.category !== 'string'
      || !FOOD_CATEGORIES.includes(item.category as typeof FOOD_CATEGORIES[number])) {
      return `${prefix} must have a valid category.`;
    }
    if (typeof item.expirationDate !== 'string' || !isValidIsoDate(item.expirationDate)) {
      return `${prefix} must have a valid expiration date.`;
    }
    if (typeof item.calories !== 'number' || !Number.isInteger(item.calories) || item.calories < 0) {
      return `${prefix} must have a non-negative whole-number calorie count.`;
    }
    if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 1) {
      return `${prefix} must have a positive whole-number quantity.`;
    }
    if (typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) {
      return `${prefix} must have a valid creation timestamp.`;
    }
    if (typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))) {
      return `${prefix} must have a valid update timestamp.`;
    }
    if (item.notifyWindow !== undefined
      && (typeof item.notifyWindow !== 'number' || !Number.isInteger(item.notifyWindow) || item.notifyWindow < 1)) {
      return `${prefix} must have a positive whole-number alert window.`;
    }
    if (item.deletedAt !== undefined
      && (typeof item.deletedAt !== 'string' || !Number.isFinite(Date.parse(item.deletedAt)))) {
      return `${prefix} must have a valid deletion timestamp.`;
    }
  }
  return undefined;
}

export function isSyncRequest(value: unknown): value is SyncRequest {
  return syncRequestError(value) === undefined;
}
