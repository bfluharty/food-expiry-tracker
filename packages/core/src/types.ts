export const FOOD_CATEGORIES = ['Meat/Beans', 'Fruit', 'Veggie', 'Nuts/Seeds', 'Snack', 'Grain', 'Misc', 'Meal'] as const;
export type FoodCategory = typeof FOOD_CATEGORIES[number];

export interface FoodItemInput {
  id?: string;
  name: string;
  category: FoodCategory;
  expirationDate: string;
  calories: number;
  quantity: number;
  notifyWindow?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface FoodItem extends Required<Omit<FoodItemInput, 'notifyWindow'>> {
  notifyWindow?: number;
  deletedAt?: string;
  serverUpdatedAt?: string;
  syncPending?: boolean;
  possibleDuplicate?: boolean;
  expiresAt?: number;
  expirationPk?: 'ITEM';
  expirationSk?: string;
}

export interface CsvError {
  line: number;
  message: string;
}

export interface CsvValidationResult {
  items: FoodItemInput[];
  errors: CsvError[];
}

export interface ItemRepository {
  list(includeDeleted?: boolean): Promise<FoodItem[]>;
  get(id: string): Promise<FoodItem | undefined>;
  findByNaturalKey(item: Pick<FoodItemInput, 'name' | 'category' | 'expirationDate'>): Promise<FoodItem | undefined>;
  upsertByNaturalKey(item: FoodItemInput): Promise<FoodItem>;
  create(item: FoodItemInput): Promise<FoodItem>;
  update(id: string, item: FoodItemInput): Promise<FoodItem>;
  delete(id: string): Promise<void>;
  bulkUpsert(items: FoodItemInput[]): Promise<FoodItem[]>;
}

export interface SyncRequest {
  cursor?: string;
  changes: FoodItem[];
}

export interface SyncResponse {
  changes: FoodItem[];
  cursor: string;
}
