# Food Expiration Tracker — Specification (v1)

## 1. Goal

Track food items (name, category, expiration date, quantity) and post a daily Slack digest of items expiring within a configurable window. Runs entirely on AWS free-tier-eligible, always-free services.

## 2. Scope

**In scope (v1)**
- Upload items in bulk via CSV (HTTP POST to a Lambda Function URL)
- Upsert semantics with a quantity field
- Daily scheduled check for items expiring within N days (default 30)
- Slack digest via incoming webhook, grouped by expiration date
- Configurable window and webhook via SSM Parameter Store

**Out of scope (v1)**
- UI, authentication, multi-user/tenancy
- Editing or deleting individual items (re-uploading a CSV is the only write path)
- Notifications for already-expired items
- Per-category windows or per-user channels

## 3. Tech Stack

| Concern | Choice |
|---|---|
| Language | TypeScript, Node.js 22 runtime, arm64 |
| IaC / deploy | AWS SAM (`sam build` with esbuild, `sam deploy`) |
| Compute | 2 Lambda functions (Upload, Notify) |
| Storage | DynamoDB, **provisioned** capacity (see §9) |
| Scheduling | EventBridge Scheduler (`ScheduleV2`) with timezone |
| Config / secrets | SSM Parameter Store (standard tier) |
| Libraries | AWS SDK v3 (DynamoDB, SSM), `csv-parse`, `zod` for validation; `vitest` for tests |

## 4. Architecture

```
curl POST text/csv ──► Lambda Function URL ──► UploadFunction ──► DynamoDB
                                                                      ▲
EventBridge Scheduler (daily) ──► NotifyFunction ── query window ─────┘
                                       │
                                       ├── reads SSM: webhook URL, window days
                                       └── POST ──► Slack incoming webhook
```

## 5. Data Model

Single DynamoDB table `FoodItems`:

| Attribute | Type | Notes |
|---|---|---|
| `pk` | String | Constant `"ITEM"` (single partition; fine at this scale) |
| `sk` | String | `<expirationDate>#<itemHash>` e.g. `2026-11-15#9f2c…` |
| `name` | String | As provided (trimmed) |
| `category` | String | As provided (trimmed) |
| `expirationDate` | String | ISO `YYYY-MM-DD` |
| `quantity` | Number | Integer ≥ 1 |
| `updatedAt` | String | ISO timestamp |

- `itemHash` = SHA-256 of `lower(name) | lower(category) | expirationDate`. This is the identity of an item.
- Upsert = `PutItem` on the same `pk`/`sk`, which replaces the existing record (and therefore its quantity).
- Expiring-soon lookup = `Query` on `pk = "ITEM"` with `sk BETWEEN "<today>" AND "<today+N>~"`. No scans, no GSI.

## 6. CSV Upload

**Endpoint:** Lambda Function URL, `AuthType: NONE` (per decision; see §10 risks), `POST`, body `text/csv`, max ~6 MB (Function URL limit).

**Format** (header row required, column order flexible):

```csv
name,category,expiration_date,quantity
Whole Milk,Dairy,2026-11-10,2
Chicken Breast,Meat,2026-11-05,1
```

**Rules**
- `name`, `category`: non-empty strings
- `expiration_date`: `YYYY-MM-DD`, valid calendar date
- `quantity`: integer ≥ 1
- Duplicate rows within one file collapse to the last occurrence
- **All-or-nothing validation:** if any row is invalid, nothing is written and the response lists every bad row with its line number and reason
- Writes use `BatchWriteItem` in chunks of 25 with retry on unprocessed items

**Responses**
- `200` `{ "processed": 42 }`
- `400` `{ "errors": [{ "line": 3, "message": "expiration_date must be YYYY-MM-DD" }] }`
- `415` if content type is not `text/csv`
- `500` on unexpected failure (logged)

## 7. Daily Notification

- **Trigger:** EventBridge Scheduler, daily at 08:00 `America/New_York`
- **Logic:**
  1. Read `windowDays` from SSM (default 30 if missing/invalid)
  2. Compute `today` and `today + windowDays` in `America/New_York`
  3. Query items in that range (inclusive), sorted by date ascending
  4. If none, post nothing (log only)
  5. Otherwise post one digest, split into multiple Slack messages only if the 3000-char block limit is exceeded
- **Message format:** header "Food expiring in the next N days", then one section per expiration date (with days remaining), each line `• Name (Category) ×quantity`
- Failures to post to Slack raise an error so the invocation shows as failed in CloudWatch

## 8. Configuration

| Parameter | Type | Value |
|---|---|---|
| `/food-expiry/slack-webhook-url` | SecureString (AWS-managed key `aws/ssm`, free) | Created manually via CLI (CloudFormation cannot create SecureString) |
| `/food-expiry/notification-window-days` | String | Default `30`, created by the SAM template |

Lambdas fetch parameters at cold start and cache them for the container lifetime. Table name is injected via env var `TABLE_NAME`.

## 9. Keeping It Free

- **Lambda:** 1M requests + 400k GB-s per month always free; usage here is a few invocations per day
- **DynamoDB:** the always-free tier covers 25 GB and **25 provisioned RCU/WCU only — on-demand mode is not covered**, so the table uses provisioned capacity of 5 RCU / 5 WCU
- **EventBridge Scheduler:** 14M invocations/month free
- **SSM:** standard parameters are free; no advanced tier, no custom KMS key
- **Lambda Function URL:** no additional charge (unlike API Gateway, which is free only for 12 months)
- **CloudWatch Logs:** retention set to 14 days to stay under the 5 GB free ingestion
- **Avoid:** VPC/NAT gateways, S3, API Gateway, custom KMS keys, X-Ray
- **Guardrail:** create an AWS Budget alert at $0.01 (first two budgets are free)
- **Caveat:** AWS accounts created after mid-July 2025 use a credit-based free plan with a time limit. Always-free services such as the above should remain free, but confirm your account type

## 10. Risks and Notes

- **Unauthenticated upload endpoint:** anyone with the URL can write data. The URL is unguessable but not secret-grade. Mitigation in v1: `ReservedConcurrentExecutions: 2` on UploadFunction to cap abuse/cost. Recommended follow-up: header API key stored in SSM or AWS_IAM auth.
- **Single partition key:** fine up to tens of thousands of items; revisit if data grows substantially.
- **Replace-quantity semantics:** re-uploading a stale CSV will overwrite newer quantities.

## 11. Repository Layout

```
food-expiry-tracker/
├── template.yaml
├── samconfig.toml
├── package.json
├── tsconfig.json
├── src/
│   ├── upload/handler.ts
│   ├── notify/handler.ts
│   └── shared/{db.ts,config.ts,csv.ts,digest.ts,dates.ts}
├── tests/
└── samples/items.csv
```

## 12. Acceptance Criteria

1. `sam deploy` creates all resources with no manual steps other than creating the webhook SSM parameter
2. POSTing a valid CSV stores/updates items; re-POSTing the same file changes nothing; changing a quantity replaces it
3. An invalid CSV returns `400` with line-level errors and writes nothing
4. Invoking NotifyFunction posts a digest containing only items within the configured window, grouped by date
5. Changing `notification-window-days` changes the next run's results without redeploying
6. Unit tests cover CSV validation, hash/identity, window date math, and digest formatting

## 13. Assumptions to Confirm

- [ ] Digest runs at 08:00 Eastern daily
- [ ] CSV columns: `name,category,expiration_date,quantity` with ISO dates
- [ ] Quantity is required (≥ 1), not defaulted
- [ ] No Slack message when nothing is expiring
- [ ] Already-expired items are ignored in v1
- [ ] Category and name matching for identity is case-insensitive
- [ ] Reject the entire CSV if any row is invalid
