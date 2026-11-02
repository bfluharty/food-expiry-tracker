# Food Expiry Tracker

Serverless food-expiration tracking with bulk CSV uploads and a daily Slack digest. It uses a Lambda Function URL, DynamoDB provisioned capacity, EventBridge Scheduler, and SSM Parameter Store.

## Prerequisites

- Node.js 22+
- AWS SAM CLI configured with AWS credentials
- A Slack incoming webhook URL

## Upload a CSV

```sh
curl -X POST "$UPLOAD_ENDPOINT" \
  -H 'Content-Type: text/csv' \
  --data-binary @samples/items.csv
```

The CSV requires `name`, `category`, `expiration_date`, and `calories` headers. `calories` must be a non-negative integer. `quantity` is optional and defaults to `1` when omitted or blank. `category` must be one of `Meat/Beans`, `Fruit`, `Veggie`, `Nuts/Seeds`, `Snack`, `Grain`, `Misc`, or `Meal`.

The optional `notify_window` column accepts a positive integer number of days for that item. Blank or omitted values use the default in `src/config.ts`. Rows are validated as a single transaction: any invalid row rejects the entire upload. Re-uploading the same identity updates its calories, quantity, and notification window.

## Configuration

Set the expiration window in [src/config.ts](src/config.ts). It defaults to 30 days; deploy after changing it:

```sh
npm run build
sam deploy
```

The digest runs daily at 08:00 in `America/New_York`. The Slack webhook remains a SecureString in SSM and is cached for the lifetime of a warm Lambda container.

## Test

```sh
npm test
```
