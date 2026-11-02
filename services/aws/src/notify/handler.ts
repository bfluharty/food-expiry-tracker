import { notificationWindowDays } from '../config.js';
import { getSlackWebhookUrl } from '../shared/config.js';
import {
  buildDigestPayloads,
  buildEmptyDigestPayload,
  itemsReadyForNotification,
  todayInTimezone
} from '@food-expiry/core';
import { getLastDataUpdatedAt, queryNotificationItems } from '../shared/db.js';

export async function handler(): Promise<void> {
  const webhookUrl = await getSlackWebhookUrl();
  if (!webhookUrl) throw new Error('Missing required SSM parameter /food-expiry/slack-webhook-url');
  const today = todayInTimezone();
  const items = itemsReadyForNotification(
    await queryNotificationItems(today, '9999-12-31'),
    today,
    notificationWindowDays
  );
  const lastUpdatedAt = await getLastDataUpdatedAt();
  if (items.length === 0) {
    console.info('No food items are expiring within the notification window.');
    await postToSlack(webhookUrl, buildEmptyDigestPayload(lastUpdatedAt));
    return;
  }
  for (const payload of buildDigestPayloads(items, today, lastUpdatedAt)) {
    await postToSlack(webhookUrl, payload);
  }
}

async function postToSlack(webhookUrl: string, payload: object): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Slack webhook failed with ${response.status}: ${await response.text()}`);
}
