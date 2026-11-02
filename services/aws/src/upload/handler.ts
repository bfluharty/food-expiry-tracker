import type { LambdaFunctionURLEvent, LambdaFunctionURLResult } from 'aws-lambda';
import { validateCsv } from '@food-expiry/core';
import { createHash } from 'node:crypto';
import { updateLastDataUpdatedAt, writeItems } from '../shared/db.js';

export async function handler(event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> {
  const contentType = event.headers['content-type'] ?? event.headers['Content-Type'] ?? '';
  if (!contentType.toLowerCase().startsWith('text/csv')) {
    return response(415, { error: 'Content-Type must be text/csv' });
  }
  const body = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body ?? '';
  const result = validateCsv(body);
  if (result.errors.length > 0) return response(400, { errors: result.errors });
  try {
    const now = new Date().toISOString();
    await writeItems(result.items.map((item) => {
      const digest = createHash('sha256')
        .update(`${item.name.toLowerCase()}|${item.category.toLowerCase()}|${item.expirationDate}`)
        .digest('hex');
      const bytes = Buffer.from(digest.slice(0, 32), 'hex');
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
      const hex = bytes.toString('hex');
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      return {
        ...item,
        id,
        createdAt: item.createdAt ?? now,
        updatedAt: item.updatedAt ?? now,
        serverUpdatedAt: now,
        expirationPk: 'ITEM',
        expirationSk: `${item.expirationDate}#${id}`
      };
    }));
    await updateLastDataUpdatedAt(now);
    return response(200, { processed: result.items.length });
  } catch (error) {
    console.error('Failed to write CSV upload', error);
    return response(500, { error: 'Internal server error' });
  }
}

function response(statusCode: number, body: object): LambdaFunctionURLResult {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
