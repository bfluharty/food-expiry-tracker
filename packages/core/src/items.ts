import type { FoodItem, FoodItemInput } from './types.js';

export function naturalKey(
  item: Pick<FoodItemInput, 'name' | 'category' | 'expirationDate'>
): string {
  return `${item.name.trim().toLowerCase()}|${item.category.toLowerCase()}|${item.expirationDate}`;
}

export function newItem(
  input: FoodItemInput,
  now = new Date().toISOString(),
  id = globalThis.crypto.randomUUID()
): FoodItem {
  return {
    id: input.id ?? id,
    name: input.name.trim(),
    category: input.category,
    expirationDate: input.expirationDate,
    calories: input.calories,
    quantity: input.quantity,
    ...(input.notifyWindow ? { notifyWindow: input.notifyWindow } : {}),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  };
}

export function isWithinWindow(item: FoodItem, today: string, defaultWindow: number): boolean {
  const max = new Date(`${today}T00:00:00Z`);
  max.setUTCDate(max.getUTCDate() + (item.notifyWindow ?? defaultWindow));
  return item.expirationDate >= today && item.expirationDate <= max.toISOString().slice(0, 10);
}
