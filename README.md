# Food Expiry Tracker

The tracker pairs an offline-first phone PWA with the AWS sync backend and existing daily Slack digest. The installed PWA is the primary interface; it stores the household pantry in IndexedDB and synchronizes changes to DynamoDB when online. The AWS CSV upload endpoint remains available.

## Local development

- Node.js 22+
- AWS SAM CLI and AWS credentials for backend build/deploy

```sh
npm install
npm run dev
npm test
```

The Vite app runs at `http://localhost:5173/food-expiry-tracker/`. It can be used without AWS: add, edit, delete, import, and export data locally. Browser storage is device-specific until sync is configured.

## Workspaces

- `packages/core` — portable item, CSV, date, summary, notification, and digest logic
- `apps/web` — IndexedDB-backed PWA
- `services/aws` — CSV upload, Slack notification, and sync Lambdas

Build both the AWS stack and web app with `npm run build`; build only the PWA with `npm run build:web`. `npm run build:aws` builds only the SAM stack.

## CSV format

CSV files require `name`, `category`, `expiration_date`, and `calories`. `calories` is a non-negative integer; `quantity` is optional and defaults to `1`. Categories are `Meat/Beans`, `Fruit`, `Veggie`, `Nuts/Seeds`, `Snack`, `Grain`, `Misc`, and `Meal`. The optional `notify_window` column is a positive number of days. An invalid row rejects the entire import; duplicate natural keys use the last row. The app can export a CSV backup at any time.

## AWS backend

The stack provisions a UUID-keyed DynamoDB table with an expiration-date GSI, the existing CSV endpoint, the daily 08:00 America/New_York Slack digest, and an authenticated `/sync` Function URL. The table changes to `FoodItemsV2` because DynamoDB key schemas cannot be altered in place; the transition plan confirms the old table is empty, so it is deleted during replacement. The new table is retained if the CloudFormation stack is later removed. Table and index provisioned capacity total 24 RCU / 10 WCU, within the documented 25/25 free allowance.

The default server-side Slack notification window remains 30 days in `services/aws/src/config.ts`.

After deployment, set the PWA's sync endpoint and the same secret in **Settings** on each device. The endpoint is the `SyncEndpoint` CloudFormation output; the app calls its `/sync` path. The endpoint permits requests from the GitHub Pages origin and local Vite development origins. Slack digest messages include the last server-side data update time.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` deploys the static app on pushes to `main`. Enable GitHub Pages for the repository with **GitHub Actions** as the build source. The Vite base path is configured for the `food-expiry-tracker` project site. The service worker precaches the app shell and production assets for offline use.

Install on Android from Chrome or on iPhone via Safari's **Add to Home Screen**. In Settings, export a CSV backup and request persistent storage; browser data can still be lost if the device or site data is removed.
