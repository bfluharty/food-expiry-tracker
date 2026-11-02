import { daysBetween } from './dates.js'; import type { FoodItem } from './types.js';
export function expirationBucket(item: FoodItem, today: string): 'expired' | 'week' | 'month' | 'later' { const days = daysBetween(today, item.expirationDate); return days < 0 ? 'expired' : days <= 7 ? 'week' : days <= 30 ? 'month' : 'later'; }
export function activeItems(items: FoodItem[]): FoodItem[] { return items.filter((item) => !item.deletedAt); }
