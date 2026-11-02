import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});
let secretPromise: Promise<string | undefined> | undefined;

export function getSyncSecret(): Promise<string | undefined> {
  secretPromise ??= loadSecret();
  return secretPromise;
}

async function loadSecret(): Promise<string | undefined> {
  const response = await ssm.send(new GetParameterCommand({
    Name: process.env.SYNC_SECRET_PARAMETER ?? '/food-expiry/sync-api-key',
    WithDecryption: true
  }));
  return response.Parameter?.Value;
}
