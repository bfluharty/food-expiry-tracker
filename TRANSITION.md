# Food Expiration Tracker — v1 → v2 Transition Plan

## Confirmed Decisions

- **Platforms:** Android and iPhone, both via the installed PWA
- **Architecture:** v1 (AWS) and v2 (phone app) work together permanently. The phone is the source of truth for the UI; the AWS stack is the sync backend and Slack digest source
- **Alerts:** both in-app banner/dashboard on the device and the existing Slack digest from synced data (no native notifications, no Capacitor)
- **Sync:** local-first app with background sync to DynamoDB when online; multiple devices share one dataset (Phase 6)
- **Sync endpoint auth:** shared secret in a request header, validated against SSM
- **Existing CSV upload endpoint:** stays as is for now
- **Hosting:** GitHub Pages
- **Data migration:** none needed (the DynamoDB table is empty)

## 1. Where We Are and Where We're Going

| | v1 (today) | v2 (target) |
|---|---|---|
| Runs on | AWS Lambda + DynamoDB | The phone (works with no internet), with the AWS stack as sync backend and Slack digest |
| Data lives in | DynamoDB | On-device storage (IndexedDB), synced to DynamoDB when online |
| Write path | CSV POST only | In-app add/edit/delete, plus CSV import |
| Read path | Slack digest only | Full item list, dashboard, expiring-soon view |
| Export | None | CSV export |
| Alerts | Slack digest from a daily Lambda | In-app banner and dashboard indicators, plus the Slack digest from synced data (decided, §6) |
| Devices | n/a | Android and iPhone share one dataset via sync |
| Hosting cost | Free (AWS always-free) | Free (static files only) |

**The core shift:** the primary experience moves onto the phone, which works fully offline. The AWS stack stays in place as the sync backend and Slack digest source, so the two parts work together rather than one replacing the other.

## 2. Guiding Principles

1. **v1 and v2 work together.** The AWS stack remains the sync backend and Slack digest source; v2 adds to it rather than replacing it.
2. **Share the domain logic, don't rewrite it.** CSV validation, identity rules, window math, and digest formatting already exist in TypeScript and are runtime-agnostic.
3. **Build the UI once, against the final storage.** Building the UI on top of an AWS API first and then re-pointing it at local storage would be throwaway work.
4. **Data safety before features.** Local-only data has no backup. Export and import land before anyone relies on the app.

## 3. Recommended Approach

A **Progressive Web App (PWA)**: a TypeScript single-page app, installed to the phone's home screen, storing data in IndexedDB.

- Works fully offline after first load (service worker caches the app shell)
- Reuses the existing TypeScript domain code
- One codebase for Android and iOS, free to build and distribute
- Installable on both platforms without app stores or developer accounts

**Suggested stack:** Vite + TypeScript, React (or Preact), Dexie (IndexedDB wrapper), Vitest, lightweight charts (Chart.js or hand-rolled SVG), Tailwind CSS.

## 4. Key Design Change: Item Identity

This matters and affects the data model.

- **v1:** an item's identity *is* its content (`hash(name | category | expirationDate)`). That was fine because rows were never edited.
- **v2:** editing a name, category, or date would change the identity and look like a delete plus a new item.

**v2 model:** each item gets a stable `id` (UUID). The natural key `(lower(name), lower(category), expirationDate)` becomes a **unique index** used only for CSV import upserts, preserving v1's "match, then replace quantity" behavior.

```ts
type FoodItem = {
  id: string;            // UUID, stable across edits
  name: string;
  category: string;
  expirationDate: string; // YYYY-MM-DD
  quantity: number;       // integer >= 1
  createdAt: string;
  updatedAt: string;
};
```

**Edge case to handle:** editing an item so it collides with another item's natural key. Proposed behavior: prompt the user to merge (sum quantities) or cancel.

## 5. Phased Plan, in Priority Order

### Phase 0 — Prepare the codebase (small)
- Convert the repo to an npm workspaces layout:
  ```
  packages/core      # types, CSV parse/validate, natural-key logic, window math, digest/summary logic
  services/aws       # existing v1 Lambdas, now importing from core
  apps/web           # new in Phase 1
  ```
- Move `src/shared` logic that doesn't touch AWS into `packages/core`
- Define a `ItemRepository` interface (`list`, `get`, `upsertByNaturalKey`, `create`, `update`, `delete`, `bulkUpsert`) with the DynamoDB implementation staying in `services/aws`
- **Exit criteria:** v1 still deploys and passes tests, nothing user-visible changes

### Phase 1 — CSV export core (before building the UI)
- Core CSV **export** function (the inverse of import), with round-trip tests (export → import yields identical data)
- Add a sample CSV for development (`samples/items.csv`)
- No data migration is needed since the DynamoDB table is empty
- **Exit criteria:** export and import round-trip cleanly in tests

### Phase 2 — Local-first web app, read side (highest user value)
- IndexedDB repository implementing `ItemRepository`
- CSV import UI (same validation and all-or-nothing rules as v1, with line-level error display)
- **Item list:** sortable by expiration, filterable by category, search by name, visual states for expired / expiring ≤7 days / expiring within window
- **Dashboard:**
  - Items and total quantity by category
  - Expiration buckets: expired, ≤7 days, ≤30 days, later
  - Upcoming-expirations timeline (next N weeks)
  - Headline numbers (total items, expiring soon, expired)
- CSV export button
- **Exit criteria:** you can import a sample CSV and see accurate lists and dashboards in a desktop browser

### Phase 3 — Write side in the UI
- Add item form (with category autocomplete from existing categories)
- Edit item (with collision handling from §4)
- Delete item (with undo toast to avoid accidental loss)
- Optional quick actions: "decrement quantity" / "used it", since this is the most common day-to-day action
- **Exit criteria:** CSV is no longer required for day-to-day use

### Phase 4 — Offline and installable
- Web app manifest, icons, service worker (precache app shell)
- Request persistent storage (`navigator.storage.persist()`) to reduce the chance the browser evicts data
- Test on both an Android phone (Chrome install prompt) and an iPhone (Safari → Add to Home Screen) in airplane mode
- Deploy the built static files to GitHub Pages via a GitHub Actions workflow (see §7)
- **Exit criteria:** installed on both phones, fully functional with no connection

### Phase 5 — In-app alerts
- On app open, show a banner when items are expired or expiring within the configured window, with counts and a tap-through to the filtered list
- Dashboard indicators (expired / ≤7 days / within window) stay visible at the top of the main screen
- **Exit criteria:** opening the app makes it immediately obvious what needs to be used soon

### Phase 6 — Sync to DynamoDB (see §6.1)
- Shared-secret header auth for the sync endpoint
- Re-key the DynamoDB table on the item UUID and add sync fields (the table is empty, so no migration; replacing it is fine)
- Add the sync Lambda and the client sync layer
- Keep the existing CSV upload endpoint, adapted to the new key schema so it still writes valid items (e.g., derive a deterministic `id` from the natural key so re-uploads still upsert)
- Small Notify Lambda update: it keeps reading the same table, but queries the new expiration index and skips tombstoned items
- **Exit criteria:** add an item on one phone in airplane mode, reconnect, and see it on the other phone and in the next Slack digest

### Phase 7 — Sync polish
- Show "last synced" in settings and a stale-sync warning
- Add a "data last updated" line to the Slack digest

## 6. Alerts (Decision: Both)

Expiry alerts come through two channels that complement each other:

| Channel | Where it runs | Works offline? | Freshness |
|---|---|---|---|
| In-app banner and dashboard indicators | On the phone | Yes | Always current with local data |
| Slack digest | Existing daily Lambda against DynamoDB | Needs the phone to have synced | As fresh as the last sync |

No native notifications or app wrapper are planned.

## 6.1 Sync Design (Phase 6)

**Principle:** IndexedDB is always the source of truth for the UI. Sync is best-effort in the background and never blocks the app; failures just leave the "last synced" indicator stale.

**Data model additions** (local and DynamoDB)
- `deletedAt` (tombstone) instead of hard deletes, so deletions propagate; purge tombstones after ~90 days
- `serverUpdatedAt`, assigned by the server on write, used as the sync cursor
- DynamoDB table re-keyed on the item UUID (`id`); a GSI on `expirationDate` serves the Notify Lambda. At household scale (thousands of items) a filtered Scan for "changes since cursor" is acceptable. Keep total provisioned capacity within the 25 RCU/WCU free allowance

**Endpoint:** `POST /sync` via Lambda Function URL, one round trip:
```
request:  { cursor, changes: [FoodItem...] }
response: { changes: [FoodItem...], cursor }
```

**Conflict resolution**
- Last-write-wins per item: the server accepts an incoming change if its `updatedAt` is newer than the stored one
- Known limitation: phone clock skew, and two devices editing the same item's quantity while both offline (one edit is lost). Acceptable for one person or household
- **Duplicate natural keys:** two devices can independently add the same item offline, producing two UUIDs with the same name/category/date. Sync flags these as "possible duplicate" and prompts a merge in the UI

**Sync triggers:** app open/foreground, the browser `online` event, a debounced pass after local changes, and a manual "Sync now" button. iOS has no background sync, so true background sync is not available

**Auth (decided: shared secret in a header)**
- Clients send the secret in a request header (e.g. `x-api-key`); the sync Lambda validates it against an SSM SecureString (created via CLI, like the Slack webhook) using a constant-time comparison
- The secret is entered once in the app's settings and stored on-device. It is never baked into the build or committed, since the GitHub Pages repo is public
- The Function URL needs **CORS** configured for the Pages origin and the custom header, because the browser will send a preflight request
- The existing CSV upload endpoint is kept as is for now. It stays unauthenticated and writes to the same table (see §8)

**Slack digest:** the Notify Lambda keeps reading the same DynamoDB table, with a small update to use the expiration index and skip tombstones. It is only as fresh as the last sync, so the digest should include a "data last updated" line.

**Free-tier impact:** none expected; the extra Lambda and Function URL are free, and traffic is a handful of requests a day.

## 7. Hosting — Decision: GitHub Pages

**Decision:** deploy the built static files to GitHub Pages using a GitHub Actions workflow. Only code lives on the host; your data lives on the devices and in DynamoDB via sync.

- HTTPS is provided automatically (required for installing and for offline caching)
- Free Pages requires a **public repo**, so keep secrets out of the repo and the build; the sync secret is entered at runtime
- Project sites are served under `/<repo-name>/`, so set Vite's `base`, the manifest `start_url`/`scope`, and the service worker scope to match
- Updates: pushing to `main` builds and deploys; phones pick up the new version the next time they are online (service worker update flow)

## 8. Risks

- **Data loss:** local-only data disappears if browser data is cleared or the phone is lost. Mitigation: persistent storage request, CSV export, and DynamoDB sync (Phase 6).
- **iOS storage limits:** Safari may evict data for sites not added to the home screen. Installing to the home screen and requesting persistence reduces but doesn't eliminate this.
- **Sync conflicts:** last-write-wins can drop a concurrent offline edit, and independent adds can create duplicates (§6.1).
- **Legacy CSV endpoint stays unauthenticated:** accepted for now, but it writes to the same table that syncs to your phones, so anyone with the URL could add or overwrite items. A header check would be a small change later.
- **Shared secret on device:** anyone with access to the unlocked app or device storage can read it. Acceptable for personal use.
- **Scope creep:** the UI is where features multiply. Phases 2 and 3 are intentionally minimal.

## 9. Out of Scope for v2

- Accounts and multi-user tenancy (v2 is one shared dataset for one person or household)
- Barcode scanning or product lookup
- Shopping lists, recipes, or sharing

## 10. Assumptions (Confirmed)

- [x] A PWA is acceptable vs. going native from day one
- [x] Stable UUID identity, with natural-key matching only for CSV import
- [x] The UI is built against local storage directly, skipping a cloud CRUD API
- [x] The AWS stack stays as the sync backend and Slack digest source
- [x] Last-write-wins conflict resolution is acceptable
- [x] The existing CSV upload endpoint stays unauthenticated for now
