import { daysBetween } from './dates.js';
import type { FoodItem } from './types.js';

export interface SlackPayload {
  blocks: Array<{ type: string; text: { type: 'mrkdwn' | 'plain_text'; text: string } }>;
}

const MAX_BLOCK_TEXT = 3000;

export function buildDigestPayloads(items: FoodItem[], today: string, windowDays: number): SlackPayload[] {
  const sections: string[] = [];
  for (const [date, dateItems] of Object.entries(groupByDate(items))) {
    const heading = `*${date} — ${formatDaysRemaining(daysBetween(today, date))}*`;
    let section = heading;
    for (const item of dateItems) {
      const line = `• ${item.name} (${item.category}) ×${item.quantity}`;
      if (`${section}\n${line}`.length > MAX_BLOCK_TEXT) {
        sections.push(section);
        section = `${heading}\n${line}`;
      } else {
        section += `\n${line}`;
      }
    }
    sections.push(section);
  }

  const payloads: SlackPayload[] = [];
  let blocks = header(windowDays);
  for (const section of sections) {
    if (blocks.length === 50) {
      payloads.push({ blocks });
      blocks = header(windowDays);
    }
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: section } });
  }
  if (blocks.length > 1) payloads.push({ blocks });
  return payloads;
}

function header(windowDays: number): SlackPayload['blocks'] {
  return [{ type: 'header', text: { type: 'plain_text', text: `Food expiring in the next ${windowDays} days` } }];
}

function groupByDate(items: FoodItem[]): Record<string, FoodItem[]> {
  return items.reduce<Record<string, FoodItem[]>>((groups, item) => {
    (groups[item.expirationDate] ??= []).push(item);
    return groups;
  }, {});
}

function formatDaysRemaining(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return '1 day remaining';
  return `${days} days remaining`;
}
