import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});
let webhookUrlPromise: Promise<string | undefined> | undefined;

export function getSlackWebhookUrl(): Promise<string | undefined> {
  webhookUrlPromise ??= loadSlackWebhookUrl();
  return webhookUrlPromise;
}

async function loadSlackWebhookUrl(): Promise<string | undefined> {
  const response = await ssm.send(new GetParameterCommand({
    Name: '/food-expiry/slack-webhook-url',
    WithDecryption: true
  }));
  return response.Parameter?.Value;
}
