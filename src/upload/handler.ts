import type { LambdaFunctionURLEvent, LambdaFunctionURLResult } from 'aws-lambda';
import { validateCsv } from '../shared/csv.js';
import { writeItems } from '../shared/db.js';

export async function handler(event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> {
  const contentType = event.headers['content-type'] ?? event.headers['Content-Type'] ?? '';
  if (!contentType.toLowerCase().startsWith('text/csv')) {
    return response(415, { error: 'Content-Type must be text/csv' });
  }
  const body = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body ?? '';
  const result = validateCsv(body);
  if (result.errors.length > 0) return response(400, { errors: result.errors });
  try {
    await writeItems(result.items);
    return response(200, { processed: result.items.length });
  } catch (error) {
    console.error('Failed to write CSV upload', error);
    return response(500, { error: 'Internal server error' });
  }
}

function response(statusCode: number, body: object): LambdaFunctionURLResult {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
