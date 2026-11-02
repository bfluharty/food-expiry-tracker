import { naturalKey, newItem } from '@food-expiry/core';
import type { FoodItem, FoodItemInput, ItemRepository } from '@food-expiry/core';

type StoredFoodItem = FoodItem & { _naturalKey: string };
const DATABASE_NAME = 'food-expiry';
const DATABASE_VERSION = 2;
let databasePromise: Promise<IDBDatabase> | undefined;

export class DuplicateNaturalKeyError extends Error {
  constructor(readonly existing: FoodItem) {
    super(`An item with the same name, category, and expiration date already exists.`);
    this.name = 'DuplicateNaturalKeyError';
  }
}

export class IndexedDbItemRepository implements ItemRepository {
  async list(includeDeleted = false): Promise<FoodItem[]> {
    const tx = (await openDatabase()).transaction('items', 'readonly');
    const rows = await request(tx.objectStore('items').getAll()) as StoredFoodItem[];
    await transactionDone(tx);
    return rows.filter((item) => includeDeleted || !item.deletedAt)
      .sort((first, second) => first.expirationDate.localeCompare(second.expirationDate)
        || first.name.localeCompare(second.name));
  }

  async get(id: string): Promise<FoodItem | undefined> {
    const item = await this.getStored(id);
    return item && clean(item);
  }

  private async getStored(id: string): Promise<StoredFoodItem | undefined> {
    const tx = (await openDatabase()).transaction('items', 'readonly');
    const item = await request(tx.objectStore('items').get(id)) as StoredFoodItem | undefined;
    await transactionDone(tx);
    return item;
  }

  async findByNaturalKey(
    item: Pick<FoodItemInput, 'name' | 'category' | 'expirationDate'>
  ): Promise<FoodItem | undefined> {
    const tx = (await openDatabase()).transaction('items', 'readonly');
    const matches = await request(tx.objectStore('items').index('naturalKey').getAll(naturalKey(item))) as
      StoredFoodItem[];
    await transactionDone(tx);
    const row = matches.find((candidate) => !candidate.deletedAt) ?? matches[0];
    return row && clean(row);
  }

  async upsertByNaturalKey(input: FoodItemInput): Promise<FoodItem> {
    const [item] = await this.bulkUpsert([input]);
    if (!item) throw new Error('CSV upsert did not produce an item.');
    return item;
  }

  async create(input: FoodItemInput): Promise<FoodItem> {
    const tx = (await openDatabase()).transaction('items', 'readwrite');
    const collision = await request(tx.objectStore('items').index('naturalKey').get(naturalKey(input))) as
      StoredFoodItem | undefined;
    if (collision && !collision.deletedAt) {
      tx.abort();
      throw new DuplicateNaturalKeyError(clean(collision));
    }
    const item = {
      ...newItem({ ...input, ...(collision ? { id: collision.id, createdAt: collision.createdAt } : {}) }),
      syncPending: true
    };
    tx.objectStore('items').put(store(item));
    await transactionDone(tx);
    return item;
  }

  async update(id: string, input: FoodItemInput): Promise<FoodItem> {
    const tx = (await openDatabase()).transaction('items', 'readwrite');
    const objectStore = tx.objectStore('items');
    const previous = await request(objectStore.get(id)) as StoredFoodItem | undefined;
    if (!previous || previous.deletedAt) {
      tx.abort();
      throw new Error('The item no longer exists.');
    }
    const collision = await request(objectStore.index('naturalKey').get(naturalKey(input))) as
      StoredFoodItem | undefined;
    if (collision && collision.id !== id && !collision.deletedAt) {
      tx.abort();
      throw new DuplicateNaturalKeyError(clean(collision));
    }
    if (collision && collision.id !== id) {
      objectStore.put({ ...collision, _naturalKey: duplicateNaturalKey(clean(collision)) });
    }
    const item: FoodItem = {
      ...newItem({
        ...input,
        id,
        createdAt: previous.createdAt,
        updatedAt: nextUpdatedAt(previous.updatedAt)
      }),
      syncPending: true
    };
    const key = !collision && previous._naturalKey !== naturalKey(previous)
      && naturalKey(item) === naturalKey(previous)
      ? previous._naturalKey
      : naturalKey(item);
    objectStore.put(store(item, key));
    await transactionDone(tx);
    return item;
  }

  async delete(id: string): Promise<void> {
    const stored = await this.getStored(id);
    const item = stored && clean(stored);
    if (!item || item.deletedAt) return;
    const updatedAt = nextUpdatedAt(item.updatedAt);
    await this.saveLocal({ ...item, deletedAt: updatedAt, updatedAt, syncPending: true }, stored._naturalKey);
  }

  async restore(item: FoodItem): Promise<void> {
    const stored = await this.getStored(item.id);
    if (!stored) throw new Error('The item no longer exists.');
    const { deletedAt: _deletedAt, ...restored } = item;
    await this.saveLocal(
      { ...restored, updatedAt: nextUpdatedAt(item.updatedAt), syncPending: true },
      stored._naturalKey
    );
  }

  async bulkUpsert(inputs: FoodItemInput[]): Promise<FoodItem[]> {
    const tx = (await openDatabase()).transaction('items', 'readwrite');
    const objectStore = tx.objectStore('items');
    const updated: FoodItem[] = [];
    for (const input of inputs) {
      const matches = await request(objectStore.index('naturalKey').getAll(naturalKey(input))) as
        StoredFoodItem[];
      const existing = matches.find((candidate) => !candidate.deletedAt) ?? matches[0];
      const changed = !existing
        || Boolean(existing.deletedAt)
        || existing.quantity !== input.quantity
        || existing.calories !== input.calories
        || existing.notifyWindow !== input.notifyWindow;
      const item: FoodItem = {
        ...newItem({
          ...input,
          ...(existing ? {
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: changed
              ? nextUpdatedAt(existing.updatedAt)
              : input.updatedAt ?? existing.updatedAt
          } : {})
        }),
        syncPending: true
      };
      objectStore.put(store(item));
      updated.push(item);
    }
    await transactionDone(tx);
    return updated;
  }

  async applyRemote(item: FoodItem, sent?: FoodItem): Promise<void> {
    const current = await this.get(item.id);
    if (current?.syncPending && sent && current.updatedAt !== sent.updatedAt) return;
    const tx = (await openDatabase()).transaction('items', 'readwrite');
    const objectStore = tx.objectStore('items');
    const collision = await request(objectStore.index('naturalKey').get(naturalKey(item))) as
      StoredFoodItem | undefined;
    const isDuplicate = Boolean(collision && collision.id !== item.id);
    const key = isDuplicate ? duplicateNaturalKey(item) : naturalKey(item);
    objectStore.put({
      ...item,
      _naturalKey: key,
      syncPending: false,
      ...(isDuplicate ? { possibleDuplicate: true } : {})
    });
    await transactionDone(tx);
  }

  private async saveLocal(item: FoodItem, key = naturalKey(item)): Promise<void> {
    const tx = (await openDatabase()).transaction('items', 'readwrite');
    tx.objectStore('items').put(store(item, key));
    await transactionDone(tx);
  }
}

function store(item: FoodItem, key = naturalKey(item)): StoredFoodItem {
  return { ...item, _naturalKey: key };
}

function duplicateNaturalKey(item: FoodItem): string {
  return `${naturalKey(item)}|duplicate|${item.id}`;
}

function clean(item: StoredFoodItem): FoodItem {
  const { _naturalKey: _key, ...foodItem } = item;
  return foodItem;
}

function nextUpdatedAt(previous?: string): string {
  const timestamp = Date.parse(previous ?? '');
  return new Date(Math.max(Date.now(), Number.isFinite(timestamp) ? timestamp + 1 : 0)).toISOString();
}

function openDatabase(): Promise<IDBDatabase> {
  databasePromise ??= new Promise((resolve, reject) => {
    const opening = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    opening.onupgradeneeded = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains('items')) {
        const items = database.createObjectStore('items', { keyPath: 'id' });
        items.createIndex('expirationDate', 'expirationDate');
        items.createIndex('category', 'category');
        items.createIndex('naturalKey', '_naturalKey', { unique: true });
      } else {
        const items = opening.transaction?.objectStore('items');
        if (!items) {
          reject(new Error('Unable to migrate local pantry storage.'));
          return;
        }
        if (items.indexNames.contains('naturalKey')) items.deleteIndex('naturalKey');
        const seenKeys = new Set<string>();
        const cursorRequest = items.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            items.createIndex('naturalKey', '_naturalKey', { unique: true });
            return;
          }
          const item = cursor.value as StoredFoodItem;
          const key = naturalKey(item);
          item._naturalKey = seenKeys.has(key) ? duplicateNaturalKey(item) : key;
          seenKeys.add(key);
          cursor.update(item);
          cursor.continue();
        };
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error('Unable to open local pantry storage.'));
  });
  return databasePromise;
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('Local storage request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Local storage transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Local storage transaction failed.'));
  });
}
