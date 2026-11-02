import { parse } from 'csv-parse/browser/esm/sync';
import { z } from 'zod';
import { isValidIsoDate } from './dates.js';
import { naturalKey } from './items.js';
import { FOOD_CATEGORIES, type CsvError, type CsvValidationResult, type FoodItem, type FoodItemInput } from './types.js';

const requiredHeaders = ['name', 'category', 'expiration_date', 'calories'];
const categorySchema = z.enum(FOOD_CATEGORIES);
const quantitySchema = z.coerce.number().int().min(1);
const caloriesSchema = z.coerce.number().int().nonnegative();
const notifyWindowSchema = z.coerce.number().int().positive();
const idSchema = z.string().uuid();

interface ParsedRow { record: Record<string, string>; info: { lines: number }; }

export function validateCsv(input: string): CsvValidationResult {
  let rows: ParsedRow[];
  try {
    rows = parse(input, {
      bom: true,
      columns: (headers: string[]) => headers.map((header) => header.trim()),
      info: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true
    }) as ParsedRow[];
  } catch (error) {
    const line = typeof error === 'object' && error !== null && 'lines' in error
      && typeof error.lines === 'number' ? error.lines : 1;
    return {
      items: [],
      errors: [{ line, message: `invalid CSV: ${error instanceof Error ? error.message : 'parse failure'}` }]
    };
  }

  const headers = rows.length > 0
    ? Object.keys(rows[0]?.record ?? {})
    : input.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0]?.split(',').map((header) => header.trim()) ?? [];
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    return { items: [], errors: [{ line: 1, message: `missing required column(s): ${missing.join(', ')}` }] };
  }

  const errors: CsvError[] = [];
  const items = new Map<string, FoodItemInput>();
  for (const { record, info } of rows) {
    const name = record.name?.trim() ?? '';
    const category = categorySchema.safeParse(record.category?.trim());
    const expirationDate = record.expiration_date?.trim() ?? '';
    const calories = caloriesSchema.safeParse(record.calories?.trim());
    const quantity = quantitySchema.safeParse(record.quantity?.trim() || '1');
    const rawWindow = record.notify_window?.trim() ?? '';
    const notifyWindow = rawWindow ? notifyWindowSchema.safeParse(rawWindow) : undefined;
    const rawId = record.id?.trim() ?? '';
    const id = rawId ? idSchema.safeParse(rawId) : undefined;
    const rawCreatedAt = record.created_at?.trim() ?? '';
    const rawUpdatedAt = record.updated_at?.trim() ?? '';
    const rowErrors: string[] = [];
    if (!name) rowErrors.push('name must be a non-empty string');
    if (name.length > 120) rowErrors.push('name must be 120 characters or fewer');
    if (!category.success) rowErrors.push(`category must be one of: ${FOOD_CATEGORIES.join(', ')}`);
    if (!isValidIsoDate(expirationDate)) rowErrors.push('expiration_date must be YYYY-MM-DD');
    if (!calories.success) rowErrors.push('calories must be a non-negative integer');
    if (!quantity.success) rowErrors.push('quantity must be an integer greater than or equal to 1');
    if (notifyWindow && !notifyWindow.success) rowErrors.push('notify_window must be a positive integer');
    if (id && !id.success) rowErrors.push('id must be a UUID');
    if (rawCreatedAt && !Number.isFinite(Date.parse(rawCreatedAt))) rowErrors.push('created_at must be a valid timestamp');
    if (rawUpdatedAt && !Number.isFinite(Date.parse(rawUpdatedAt))) rowErrors.push('updated_at must be a valid timestamp');
    if (rowErrors.length > 0) {
      errors.push({ line: info.lines, message: rowErrors.join('; ') });
      continue;
    }
    if (!category.success || !calories.success || !quantity.success || (notifyWindow && !notifyWindow.success)) {
      errors.push({ line: info.lines, message: 'invalid CSV row' });
      continue;
    }

    const item: FoodItemInput = {
      ...(id?.success ? { id: id.data } : {}),
      name,
      category: category.data,
      expirationDate,
      calories: calories.data,
      quantity: quantity.data,
      ...(notifyWindow?.success ? { notifyWindow: notifyWindow.data } : {}),
      ...(rawCreatedAt ? { createdAt: rawCreatedAt } : {}),
      ...(rawUpdatedAt ? { updatedAt: rawUpdatedAt } : {})
    };
    items.set(naturalKey(item), item);
  }
  return { items: errors.length > 0 ? [] : [...items.values()], errors };
}

export function exportCsv(items: FoodItem[]): string {
  const fields = [
    'id', 'name', 'category', 'expiration_date', 'calories',
    'quantity', 'notify_window', 'created_at', 'updated_at'
  ];
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [
    fields.join(','),
    ...items.filter((item) => !item.deletedAt).map((item) => [
      item.id, item.name, item.category, item.expirationDate, item.calories,
      item.quantity, item.notifyWindow ?? '', item.createdAt, item.updatedAt
    ].map(escape).join(','))
  ].join('\n');
}
