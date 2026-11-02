import { timingSafeEqual } from 'node:crypto';
import type { LambdaFunctionURLEvent, LambdaFunctionURLResult } from 'aws-lambda';
import { FOOD_CATEGORIES, isValidIsoDate, type FoodItem, type SyncRequest } from '@food-expiry/core';
import { GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getSyncSecret } from '../shared/sync-auth.js';
import { updateLastDataUpdatedAt } from '../shared/db.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = process.env.TABLE_NAME ?? '';
const maxChanges = 100;
const retentionDays = 90;
const cursorOverlapMs = 2 * 60 * 1000;

export async function handler(event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> {
  const method = event.requestContext.http.method;
  if (method === 'OPTIONS') return response(204, '');
  if (method !== 'POST' || (event.rawPath !== '/sync' && event.rawPath !== '/')) {
    return response(404, { error: 'Not found' });
  }

  try {
    const secret = await getSyncSecret();
    const suppliedSecret = getHeader(event, 'x-api-key');
    if (!secret || !suppliedSecret || !constantTimeEqual(secret, suppliedSecret)) {
      return response(401, { error: 'Unauthorized' });
    }

    const body = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : event.body ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return response(400, { error: 'Request body must be valid JSON.' });
    }
    const request = validateRequest(parsed);
    if (!request) return response(400, { error: 'Request must contain a valid cursor and up to 100 valid item changes.' });

    const cursorTime = request.cursor ? Date.parse(request.cursor) : 0;
    const changed = new Map<string, FoodItem>();
    let newestServerTime = Math.max(Date.now(), cursorTime + 1);
    let writeTime = newestServerTime;
    for (const [index, incoming] of request.changes.entries()) {
      const currentResponse = await client.send(new GetCommand({
        TableName: tableName,
        Key: { id: incoming.id }
      }));
      const current = currentResponse.Item as FoodItem | undefined;
      if (!current || incoming.updatedAt > current.updatedAt) {
        const serverUpdatedAt = new Date(writeTime++).toISOString();
        const saved: FoodItem = {
          ...incoming,
          serverUpdatedAt,
          expirationPk: 'ITEM',
          expirationSk: `${incoming.expirationDate}#${incoming.id}`,
          ...(incoming.deletedAt
            ? { expiresAt: Math.floor((Date.parse(incoming.deletedAt) + retentionDays * 86_400_000) / 1000) }
            : {})
        };
        if (!incoming.deletedAt) delete saved.expiresAt;
        try {
          await client.send(new PutCommand({
            TableName: tableName,
            Item: saved,
            ConditionExpression: 'attribute_not_exists(id) OR updatedAt < :updatedAt',
            ExpressionAttributeValues: { ':updatedAt': incoming.updatedAt }
          }));
          changed.set(saved.id, saved);
          newestServerTime = Math.max(newestServerTime, Date.parse(serverUpdatedAt));
        } catch (error) {
          if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException') throw error;
          const latest = await getItem(incoming.id);
          if (latest) changed.set(latest.id, latest);
        }
      } else {
        changed.set(current.id, current);
      }
    }

    const scanCutoff = Math.max(Date.now(), newestServerTime, cursorTime + 1);
    // Keep an overlap so concurrent writes assigned just before a scan are fetched again next pass.
    const scanFloor = Math.max(0, cursorTime - cursorOverlapMs);
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await client.send(new ScanCommand({
        TableName: tableName,
        FilterExpression: 'serverUpdatedAt >= :cursor',
        ExpressionAttributeValues: { ':cursor': new Date(scanFloor).toISOString() },
        ExclusiveStartKey: exclusiveStartKey
      }));
      for (const item of (page.Items ?? []) as FoodItem[]) {
        if (item.id !== '__METADATA__') changed.set(item.id, item);
      }
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);

    const latestChangeTime = [...changed.values()]
      .map((item) => item.serverUpdatedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    if (latestChangeTime) await updateLastDataUpdatedAt(latestChangeTime);

    return response(200, {
      changes: [...changed.values()],
      cursor: new Date(Math.max(cursorTime, scanCutoff - cursorOverlapMs)).toISOString()
    });
  } catch (error) {
    console.error('Failed to synchronize food items', error);
    return response(500, { error: 'Internal server error' });
  }
}

function validateRequest(value: unknown): SyncRequest | undefined {
  if (typeof value !== 'object' || value === null || !('changes' in value)) return undefined;
  const candidate = value as { cursor?: unknown; changes: unknown };
  if (candidate.cursor !== undefined
    && (typeof candidate.cursor !== 'string' || !Number.isFinite(Date.parse(candidate.cursor)))) return undefined;
  if (!Array.isArray(candidate.changes) || candidate.changes.length > maxChanges) return undefined;
  const changes: FoodItem[] = [];
  for (const value of candidate.changes) {
    if (typeof value !== 'object' || value === null) return undefined;
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id)
      || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120
      || typeof item.category !== 'string' || !FOOD_CATEGORIES.includes(item.category as typeof FOOD_CATEGORIES[number])
      || typeof item.expirationDate !== 'string' || !isValidIsoDate(item.expirationDate)
      || typeof item.calories !== 'number' || !Number.isInteger(item.calories) || item.calories < 0
      || typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 1
      || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))
      || typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))
      || (item.notifyWindow !== undefined
        && (typeof item.notifyWindow !== 'number' || !Number.isInteger(item.notifyWindow) || item.notifyWindow < 1))
      || (item.deletedAt !== undefined
        && (typeof item.deletedAt !== 'string' || !Number.isFinite(Date.parse(item.deletedAt))))) return undefined;
    changes.push({
      id: item.id,
      name: item.name.trim(),
      category: item.category as FoodItem['category'],
      expirationDate: item.expirationDate,
      calories: item.calories,
      quantity: item.quantity,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ...(typeof item.notifyWindow === 'number' ? { notifyWindow: item.notifyWindow } : {}),
      ...(typeof item.deletedAt === 'string' ? { deletedAt: item.deletedAt } : {})
    });
  }
  return {
    ...(typeof candidate.cursor === 'string' ? { cursor: candidate.cursor } : {}),
    changes
  };
}

async function getItem(id: string): Promise<FoodItem | undefined> {
  const response = await client.send(new GetCommand({ TableName: tableName, Key: { id } }));
  return response.Item as FoodItem | undefined;
}

function getHeader(event: LambdaFunctionURLEvent, name: string): string | undefined {
  const entry = Object.entries(event.headers).find(([header]) => header.toLowerCase() === name);
  return entry?.[1];
}

function constantTimeEqual(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function response(statusCode: number, body: object | string): LambdaFunctionURLResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}
