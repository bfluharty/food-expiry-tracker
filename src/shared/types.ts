export const FOOD_CATEGORIES = [
  'Meat/Beans',
  'Fruit',
  'Veggie',
  'Nuts/Seeds',
  'Snack',
  'Grain',
  'Misc',
  'Meal'
] as const;

export type FoodCategory = typeof FOOD_CATEGORIES[number];

export interface FoodItem {
  pk: 'ITEM';
  sk: string;
  name: string;
  category: FoodCategory;
  expirationDate: string;
  calories: number;
  quantity: number;
  /** Optional per-item override; absent items use the application default. */
  notifyWindow?: number;
  updatedAt: string;
}

export interface UploadError {
  line: number;
  message: string;
}
