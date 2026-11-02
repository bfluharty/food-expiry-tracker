import { daysBetween } from './dates.js';
import type { FoodItem } from './types.js';

export interface SlackPayload {
  blocks: Array<{ type: string; text: { type: 'mrkdwn' | 'plain_text'; text: string } }>;
}

const MAX_BLOCK_TEXT = 3000;
const USER_MENTION = '<@U0CE1LDJY6R>';

export function buildDigestPayloads(items: FoodItem[], today: string): SlackPayload[] {
  const sections: string[][] = [];
  for (const [date, dateItems] of Object.entries(groupByDate(items))) {
    const heading = `*${date} — ${formatDaysRemaining(daysBetween(today, date))}*`;
    let section = heading;
    const dateBlocks: string[] = [];
    for (const item of dateItems) {
      const line = `• ${item.name} (${item.category}) ×${item.quantity}`;
      if (`${section}\n${line}`.length > MAX_BLOCK_TEXT) {
        dateBlocks.push(section);
        section = `${heading}\n${line}`;
      } else {
        section += `\n${line}`;
      }
    }
    dateBlocks.push(section);
    sections.push(dateBlocks);
  }

  const payloads: SlackPayload[] = [];
  let blocks = messageIntro(true);
  for (const dateBlocks of sections) {
    if (dateBlocks.length > 49) {
      throw new Error('One expiration-date section exceeds Slack’s single-message block limit.');
    }
    if (blocks.length + dateBlocks.length > 50) {
      payloads.push({ blocks });
      blocks = messageIntro(false);
    }
    blocks.push(...dateBlocks.map((text) => ({ type: 'section' as const, text: { type: 'mrkdwn' as const, text } })));
  }
  payloads.push({ blocks });
  return payloads;
}

export function buildEmptyDigestPayload(): SlackPayload {
  return {
    blocks: [
      ...messageIntro(true),
      { type: 'section', text: { type: 'mrkdwn', text: 'Nothing is in the expiration window.' } }
    ]
  };
}

function messageIntro(includeMention: boolean): SlackPayload['blocks'] {
  const title = includeMention ? 'Food expiring soon' : 'Food expiring soon (continued)';
  const blocks: SlackPayload['blocks'] = [
    { type: 'header', text: { type: 'plain_text', text: title } }
  ];
  if (includeMention) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: USER_MENTION } });
  return blocks;
}

function groupByDate(items: FoodItem[]): Record<string, FoodItem[]> {
  return [...items].sort((first, second) => first.expirationDate.localeCompare(second.expirationDate))
    .reduce<Record<string, FoodItem[]>>((groups, item) => {
    (groups[item.expirationDate] ??= []).push(item);
    return groups;
  }, {});
}

function formatDaysRemaining(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return '1 day remaining';
  return `${days} days remaining`;
}
