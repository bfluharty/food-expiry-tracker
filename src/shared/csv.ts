import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { isValidIsoDate } from './dates.js';
import { FOOD_CATEGORIES, type FoodCategory, type FoodItem, type UploadError } from './types.js';

const REQUIRED_HEADERS = ['name', 'category', 'expiration_date', 'calories'];
const quantitySchema = z.coerce.number().int().min(1);
const caloriesSchema = z.coerce.number().int().nonnegative();
const notifyWindowSchema = z.coerce.number().int().positive();
const categorySchema = z.enum(FOOD_CATEGORIES);

interface ParsedCsvRow {
  record: Record<string, string>;
  info: { lines: number };
}

export interface CsvValidationResult {
  items: FoodItem[];
  errors: UploadError[];
}

export function itemHash(name: string, category: string, expirationDate: string): string {
  return createHash('sha256')
    .update(`${name.toLowerCase()}|${category.toLowerCase()}|${expirationDate}`)
    .digest('hex');
}

export function validateCsv(input: string, updatedAt = new Date().toISOString()): CsvValidationResult {
  let rows: ParsedCsvRow[];
  try {
    rows = parse(input, {
      bom: true,
      columns: (header: string[]) => header.map((column) => column.trim()),
      info: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true
    }) as ParsedCsvRow[];
  } catch (error) {
    return { items: [], errors: [{ line: csvErrorLine(error), message: `invalid CSV: ${errorMessage(error)}` }] };
  }

  const header = input.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0]?.split(',').map((column) => column.trim()) ?? [];
  const missing = REQUIRED_HEADERS.filter((name) => !header.includes(name));
  if (missing.length > 0) {
    return { items: [], errors: [{ line: 1, message: `missing required column(s): ${missing.join(', ')}` }] };
  }

  const errors: UploadError[] = [];
  const byKey = new Map<string, FoodItem>();
  for (const { record, info } of rows) {
    const name = record.name?.trim() ?? '';
    const category = record.category?.trim() ?? '';
    const expirationDate = record.expiration_date?.trim() ?? '';
    const rawCalories = record.calories?.trim() ?? '';
    const rawQuantity = record.quantity?.trim() || '1';
    const rawNotifyWindow = record.notify_window?.trim() ?? '';
    const rowErrors: string[] = [];
    if (!name) rowErrors.push('name must be a non-empty string');
    const parsedCategory = categorySchema.safeParse(category);
    if (!parsedCategory.success) rowErrors.push(`category must be one of: ${FOOD_CATEGORIES.join(', ')}`);
    if (!isValidIsoDate(expirationDate)) rowErrors.push('expiration_date must be YYYY-MM-DD');
    const calories = caloriesSchema.safeParse(rawCalories);
    if (!calories.success) rowErrors.push('calories must be a non-negative integer');
    const quantity = quantitySchema.safeParse(rawQuantity);
    if (!quantity.success) rowErrors.push('quantity must be an integer greater than or equal to 1');
    const notifyWindow = rawNotifyWindow ? notifyWindowSchema.safeParse(rawNotifyWindow) : undefined;
    if (notifyWindow && !notifyWindow.success) rowErrors.push('notify_window must be a positive integer');
    if (rowErrors.length > 0) {
      errors.push({ line: info.lines, message: rowErrors.join('; ') });
      continue;
    }
    const validCategory = parsedCategory.data as FoodCategory;
    const hash = itemHash(name, validCategory, expirationDate);
    byKey.set(hash, {
      pk: 'ITEM',
      sk: `${expirationDate}#${hash}`,
      name,
      category: validCategory,
      expirationDate,
      calories: calories.data ?? 0,
      quantity: quantity.data ?? 0,
      ...(notifyWindow?.success ? { notifyWindow: notifyWindow.data } : {}),
      updatedAt
    });
  }
  return { items: errors.length === 0 ? [...byKey.values()] : [], errors };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'parse failure';
}

function csvErrorLine(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'lines' in error && typeof error.lines === 'number') {
    return error.lines;
  }
  return 1;
}
