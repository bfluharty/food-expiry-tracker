import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { isValidIsoDate } from './dates.js';
import type { FoodItem, UploadError } from './types.js';

const REQUIRED_HEADERS = ['name', 'category', 'expiration_date', 'quantity'];
const quantitySchema = z.coerce.number().int().min(1);

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
    const rawQuantity = record.quantity?.trim() ?? '';
    const rowErrors: string[] = [];
    if (!name) rowErrors.push('name must be a non-empty string');
    if (!category) rowErrors.push('category must be a non-empty string');
    if (!isValidIsoDate(expirationDate)) rowErrors.push('expiration_date must be YYYY-MM-DD');
    const quantity = quantitySchema.safeParse(rawQuantity);
    if (!quantity.success) rowErrors.push('quantity must be an integer greater than or equal to 1');
    if (rowErrors.length > 0) {
      errors.push({ line: info.lines, message: rowErrors.join('; ') });
      continue;
    }
    const hash = itemHash(name, category, expirationDate);
    byKey.set(hash, {
      pk: 'ITEM',
      sk: `${expirationDate}#${hash}`,
      name,
      category,
      expirationDate,
      quantity: quantity.data ?? 0,
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
