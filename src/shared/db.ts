import { BatchWriteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand, type BatchWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { FoodItem } from './types.js';

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

/** Returns every item that has not yet expired, preserving DynamoDB's date order. */
export async function queryUnexpiredItems(today: string): Promise<FoodItem[]> {
  const items: FoodItem[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk >= :today',
      ExpressionAttributeValues: { ':pk': 'ITEM', ':today': today },
      ExclusiveStartKey
    }));
    items.push(...((response.Items ?? []) as FoodItem[]));
    ExclusiveStartKey = response.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// Exported for narrow integration use without duplicating DynamoDB configuration.
export async function putItem(item: FoodItem): Promise<void> {
  await client.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}
