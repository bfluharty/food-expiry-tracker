import { notificationWindowDays } from '../config.js';
import { getSlackWebhookUrl } from '../shared/config.js';
import { queryUnexpiredItems } from '../shared/db.js';
import { todayInTimezone } from '../shared/dates.js';
import { buildDigestPayloads } from '../shared/digest.js';
import { itemsReadyForNotification } from '../shared/notification.js';

export async function handler(): Promise<void> {
  const webhookUrl = await getSlackWebhookUrl();
  if (!webhookUrl) throw new Error('Missing required SSM parameter /food-expiry/slack-webhook-url');
  const today = todayInTimezone();
  const items = itemsReadyForNotification(
    await queryUnexpiredItems(today),
    today,
    notificationWindowDays
  );
  if (items.length === 0) {
    console.info('No food items are expiring within the notification window.');
    return;
  }
  for (const payload of buildDigestPayloads(items, today)) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Slack webhook failed with ${response.status}: ${await response.text()}`);
  }
}
