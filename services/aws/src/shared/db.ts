import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  type BatchWriteCommandInput
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { FoodItem } from '@food-expiry/core';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME ?? '';

export async function writeItems(items: FoodItem[]): Promise<void> {
  for (let index = 0; index < items.length; index += 25) {
    let requests: NonNullable<NonNullable<BatchWriteCommandInput['RequestItems']>[string]> =
      items.slice(index, index + 25).map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; requests.length > 0; attempt += 1) {
      if (attempt === 6) throw new Error('DynamoDB left items unprocessed after retries');
      const response = await client.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: requests } }));
      requests = response.UnprocessedItems?.[TABLE_NAME] ?? [];
      if (requests.length > 0) await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}

/** Returns non-tombstoned items in the requested date range in expiration order. */
export async function queryNotificationItems(startDate: string, endDate: string): Promise<FoodItem[]> {
  const items: FoodItem[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'ExpirationIndex',
      KeyConditionExpression: 'expirationPk = :pk AND expirationSk BETWEEN :start AND :end',
      FilterExpression: 'attribute_not_exists(deletedAt)',
      ExpressionAttributeValues: {
        ':pk': 'ITEM',
        ':start': `${startDate}#`,
        ':end': `${endDate}#~`
      },
      ExclusiveStartKey
    }));
    items.push(...((response.Items ?? []) as FoodItem[]));
    ExclusiveStartKey = response.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export async function getLastDataUpdatedAt(): Promise<string | undefined> {
  const response = await client.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { id: '__METADATA__' },
    ProjectionExpression: 'lastDataUpdatedAt'
  }));
  return response.Item?.lastDataUpdatedAt as string | undefined;
}

export async function updateLastDataUpdatedAt(value: string): Promise<void> {
  try {
    await client.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: '__METADATA__' },
      UpdateExpression: 'SET lastDataUpdatedAt = :value',
      ConditionExpression: 'attribute_not_exists(lastDataUpdatedAt) OR lastDataUpdatedAt < :value',
      ExpressionAttributeValues: { ':value': value }
    }));
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return;
    throw error;
  }
}
