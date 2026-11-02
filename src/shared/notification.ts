import { addDays } from './dates.js';
import type { FoodItem } from './types.js';

/** Filters non-expired items using their individual window or the app default. */
export function itemsReadyForNotification(
  items: FoodItem[],
  today: string,
  defaultWindowDays: number
): FoodItem[] {
  return items.filter((item) => item.expirationDate <= addDays(today, item.notifyWindow ?? defaultWindowDays));
}
