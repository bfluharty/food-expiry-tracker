import {
  FOOD_CATEGORIES,
  addDays,
  daysBetween,
  expirationBucket,
  exportCsv,
  isValidIsoDate,
  validateCsv,
  type FoodItem,
  type FoodItemInput,
  type SyncResponse
} from '@food-expiry/core';
import { DuplicateNaturalKeyError, IndexedDbItemRepository } from './repository.js';
import './styles.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Pantry application root element was not found.');
const csvInput = document.querySelector<HTMLInputElement>('#csv-input');
if (!csvInput) throw new Error('Pantry CSV import control was not found.');

const repository = new IndexedDbItemRepository();
const settingKeys = {
  window: 'food-expiry.window-days',
  endpoint: 'food-expiry.sync-endpoint',
  secret: 'food-expiry.sync-secret',
  lastSync: 'food-expiry.last-sync'
};
const defaults = { alertWindow: 30, tab: 'dashboard' as 'dashboard' | 'items' | 'settings' };
const state: {
  items: FoodItem[];
  tab: 'dashboard' | 'items' | 'settings';
  category: string;
  sort: string;
  expiringOnly: boolean;
  search: string;
  editingId?: string;
  error?: string;
  notice?: string;
  syncStatus: string;
  syncing: boolean;
  persistStatus: string;
} = {
  items: [],
  tab: defaults.tab,
  category: 'all',
  sort: 'expiration',
  expiringOnly: false,
  search: '',
  syncStatus: 'Not configured',
  syncing: false,
  persistStatus: 'Checking browser storage…'
};

function alertWindow(): number {
  const parsed = Number(localStorage.getItem(settingKeys.window));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaults.alertWindow;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character] ?? character);
}

function today(): string {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function activeItems(): FoodItem[] {
  return state.items.filter((item) => !item.deletedAt);
}

function soonItems(): FoodItem[] {
  return activeItems().filter((item) =>
    item.expirationDate >= today()
    && item.expirationDate <= addDays(today(), item.notifyWindow ?? alertWindow()));
}

function render(): void {
  const active = activeItems();
  const expiring = soonItems();
  const expired = active.filter((item) => item.expirationDate < today());
  const lastSync = localStorage.getItem(settingKeys.lastSync);
  const stale = lastSync ? Date.now() - Date.parse(lastSync) > 24 * 60 * 60 * 1000 : false;
  app!.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#" data-tab="dashboard" aria-label="Pantry home"><span class="brand-mark">P</span><span>pantry<span class="brand-dot">.</span></span></a>
      <div class="top-actions">
        <span class="sync-pill ${navigator.onLine ? '' : 'offline'}"><i></i>${navigator.onLine ? escapeHtml(state.syncStatus) : 'Offline'}</span>
        <button class="icon-button" data-action="settings" aria-label="Settings" title="Settings">⚙</button>
      </div>
    </header>
    <section class="page">
      ${state.error ? `<div class="notice error" role="alert">${escapeHtml(state.error)}<button data-action="dismiss" aria-label="Dismiss">×</button></div>` : ''}
      ${state.notice ? `<div class="notice success" role="status">${escapeHtml(state.notice)}<button data-action="dismiss" aria-label="Dismiss">×</button></div>` : ''}
      ${expiring.length || expired.length ? `
        <button class="alert-banner" data-action="show-expiring">
          <span class="alert-icon">!</span>
          <span><strong>${expired.length ? `${expired.length} expired` : ''}${expired.length && expiring.length ? ' · ' : ''}${expiring.length ? `${expiring.length} expiring soon` : ''}</strong><small>Tap to review your food that needs attention</small></span>
          <span class="banner-arrow">→</span>
        </button>` : ''}
      <div class="page-heading">
        <div><p class="eyebrow">${new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</p><h1>${state.tab === 'settings' ? 'Settings' : state.tab === 'items' ? 'Your pantry' : 'Good food, no waste.'}</h1><p class="subtitle">${state.tab === 'settings' ? 'Keep your data safe and your devices in sync.' : state.tab === 'items' ? `${active.length} ${active.length === 1 ? 'item' : 'items'} in your pantry` : 'A little planning makes a lot of difference.'}</p></div>
        ${state.tab !== 'settings' ? '<button class="button primary add-button" data-action="add">＋ <span>Add food</span></button>' : ''}
      </div>
      ${state.tab === 'dashboard' ? renderDashboard(active, expiring, expired) : ''}
      ${state.tab === 'items' ? renderItems(active) : ''}
      ${state.tab === 'settings' ? renderSettings(lastSync, stale) : ''}
      <nav class="bottom-nav" aria-label="Main navigation">
        <button class="${state.tab === 'dashboard' ? 'selected' : ''}" data-tab="dashboard"><span>⌂</span>Overview</button>
        <button class="${state.tab === 'items' ? 'selected' : ''}" data-tab="items"><span>▤</span>My food</button>
        <button class="${state.tab === 'settings' ? 'selected' : ''}" data-tab="settings"><span>⚙</span>Settings</button>
      </nav>
    </section>
    <dialog id="item-dialog"></dialog>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
  `;
}

function renderDashboard(active: FoodItem[], expiring: FoodItem[], expired: FoodItem[]): string {
  const buckets = {
    expired: active.filter((item) => expirationBucket(item, today()) === 'expired'),
    week: active.filter((item) => expirationBucket(item, today()) === 'week'),
    month: active.filter((item) => expirationBucket(item, today()) === 'month'),
    later: active.filter((item) => expirationBucket(item, today()) === 'later')
  };
  const byCategory = FOOD_CATEGORIES.map((category) => ({
    category,
    items: active.filter((item) => item.category === category)
  })).filter((group) => group.items.length > 0);
  const max = Math.max(1, ...byCategory.map((group) =>
    group.items.reduce((quantity, item) => quantity + item.quantity, 0)));
  const weeks = Array.from({ length: 8 }, (_, index) => {
    const start = addDays(today(), index * 7);
    const end = addDays(start, 6);
    return {
      label: index === 0 ? 'This week' : `Week ${index + 1}`,
      count: active.filter((item) => item.expirationDate >= start && item.expirationDate <= end).length
    };
  });
  const maxWeek = Math.max(1, ...weeks.map((week) => week.count));
  return `
    ${expired.length || expiring.length ? `<div class="urgent-heading"><span class="live-dot"></span> NEEDS YOUR ATTENTION <span class="urgent-rule"></span></div>
      ${renderFoodList([...expired, ...expiring].slice(0, 4), true)}`
    : `<div class="welcome-card"><div class="welcome-sun">✳</div><div><strong>All clear. Nice work!</strong><p>Nothing needs your attention right now.</p></div></div>`}
    <section class="stat-grid" aria-label="Pantry summary">
      ${statCard('Total food', active.length, 'in your pantry', 'mint')}
      ${statCard('Expiring soon', expiring.length, `within ${alertWindow()} days`, 'amber')}
      ${statCard('Expired', expired.length, 'items to check', 'rose')}
    </section>
    <div class="dashboard-grid">
      <section class="card category-card">
        <div class="section-title"><div><p class="eyebrow">YOUR INVENTORY</p><h2>By category</h2></div><span class="section-icon">◒</span></div>
        ${byCategory.length ? `<div class="category-bars">${byCategory.map((group) => `
          <div class="category-row"><div class="category-label"><span>${escapeHtml(group.category)}</span><strong>${group.items.length} <small>${group.items.length === 1 ? 'item' : 'items'} · ${group.items.reduce((quantity, item) => quantity + item.quantity, 0)} total units</small></strong></div><div class="bar-track"><span style="width:${Math.max(8, group.items.reduce((quantity, item) => quantity + item.quantity, 0) / max * 100)}%"></span></div></div>
        `).join('')}</div>` : '<p class="empty-note">Add your first food item to see your inventory here.</p>'}
      </section>
      <section class="card expiry-card">
        <div class="section-title"><div><p class="eyebrow">EXPIRATION CHECK</p><h2>What’s coming up</h2></div><span class="section-icon">◷</span></div>
        <div class="bucket-list">
          ${bucketRow('Past date', buckets.expired.length, 'rose')}
          ${bucketRow('In 7 days', buckets.week.length, 'amber')}
          ${bucketRow('In 8–30 days', buckets.month.length, 'blue')}
          ${bucketRow('Later on', buckets.later.length, 'green')}
        </div>
        <div class="timeline"><p class="eyebrow">NEXT 8 WEEKS</p><div class="week-bars">${weeks.map((week) => `<div class="week-bar"><span class="week-count">${week.count || ''}</span><div class="week-track"><i style="height:${week.count ? Math.max(10, week.count / maxWeek * 100) : 0}%"></i></div><small>${escapeHtml(week.label.replace('Week ', 'W'))}</small></div>`).join('')}</div></div>
      </section>
    </div>
    <section class="card next-card"><div class="section-title"><div><p class="eyebrow">UP NEXT</p><h2>Coming up soon</h2></div><button class="text-button" data-tab="items">See all →</button></div>${expiring.length ? renderFoodList(expiring.slice(0, 5), false) : '<p class="empty-note">No food is approaching its expiration date.</p>'}</section>
    <p class="privacy-note"><span>◉</span> Your pantry is stored privately on this device. <button data-tab="settings">Learn about sync</button></p>`;
}

function renderItems(active: FoodItem[]): string {
  const matching = active.filter((item) => (state.category === 'all' || item.category === state.category)
    && item.name.toLowerCase().includes(state.search.toLowerCase())
    && (!state.expiringOnly || item.expirationDate <= addDays(today(), item.notifyWindow ?? alertWindow())))
    .sort((first, second) => state.sort === 'name'
      ? first.name.localeCompare(second.name)
      : state.sort === 'category'
        ? first.category.localeCompare(second.category)
        : first.expirationDate.localeCompare(second.expirationDate));
  return `
    <section class="card filters">
      <label class="search-box"><span>⌕</span><input id="search" type="search" placeholder="Search your food…" value="${escapeHtml(state.search)}" /></label>
      <label class="select-box"><span class="sr-only">Filter by category</span><select id="category-filter"><option value="all">All categories</option>${FOOD_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}" ${state.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select></label>
      <label class="select-box"><span class="sr-only">Sort items</span><select id="sort-items"><option value="expiration" ${state.sort === 'expiration' ? 'selected' : ''}>Sort: Expiration</option><option value="name" ${state.sort === 'name' ? 'selected' : ''}>Sort: Name</option><option value="category" ${state.sort === 'category' ? 'selected' : ''}>Sort: Category</option></select></label>
      <div class="filter-actions"><button class="button secondary" data-action="import">↑ Import CSV</button><button class="button secondary" data-action="export">↓ Export CSV</button></div>
    </section>
    <div id="csv-errors"></div>
    <section class="card pantry-list">
      <div class="list-heading"><span>FOOD ITEM</span><span>EXPIRES</span><span>QUANTITY</span><span></span></div>
      ${matching.length ? renderFoodList(matching, false, true) : `<div class="empty-state"><span>⌕</span><h2>${active.length ? 'No matching food' : 'Your pantry is ready'}</h2><p>${active.length ? 'Try another search or category.' : 'Add food, or import a CSV to get started.'}</p>${active.length ? '' : '<button class="button primary" data-action="add">＋ Add your first food</button>'}</div>`}
    </section>
    <p class="list-footnote">${matching.length} ${matching.length === 1 ? 'item' : 'items'} shown · Quantities update as you use things</p>`;
}

function renderSettings(lastSync: string | null, stale: boolean): string {
  const endpoint = localStorage.getItem(settingKeys.endpoint) ?? '';
  return `
    ${stale ? '<div class="notice warning">Your pantry has not synced in over a day. Open this page while online to catch up.</div>' : ''}
    <section class="card settings-card">
      <div class="section-title"><div><p class="eyebrow">EXPIRATION ALERTS</p><h2>When should I be alerted?</h2></div><span class="section-icon">◷</span></div>
      <p class="settings-copy">Set the default number of days before expiration. Individual food items can override this.</p>
      <label class="field-label" for="alert-window">Alert window in days</label>
      <div class="inline-field"><input id="alert-window" type="number" min="1" max="3650" value="${alertWindow()}" /><span>days before expiration</span></div>
      <button class="button secondary" data-action="save-window">Save alert window</button>
    </section>
    <section class="card settings-card">
      <div class="section-title"><div><p class="eyebrow">DEVICE SYNC</p><h2>Keep your devices in sync</h2></div><span class="section-icon">↻</span></div>
      <p class="settings-copy">Connect to the AWS sync endpoint to share your pantry between phones. Your secret is stored only on this device and is never part of the app build.</p>
      <label class="field-label" for="sync-endpoint">Sync endpoint URL</label><input id="sync-endpoint" class="text-field" type="url" autocomplete="url" placeholder="https://…lambda-url…on.aws" value="${escapeHtml(endpoint)}" />
      <label class="field-label" for="sync-secret">Shared sync secret</label><input id="sync-secret" class="text-field" type="password" autocomplete="new-password" placeholder="Enter once; leave blank to keep the saved secret" />
      <div class="sync-detail"><span>Last synced</span><strong>${lastSync ? `${escapeHtml(new Date(lastSync).toLocaleString())}${stale ? ' · Stale' : ''}` : 'Never'}</strong></div>
      <div class="sync-buttons"><button class="button primary" data-action="sync-now" ${state.syncing ? 'disabled' : ''}>${state.syncing ? 'Syncing…' : '↻ Sync now'}</button><button class="button secondary" data-action="save-sync">Save sync settings</button></div>
      <p class="privacy-note">Sync is best-effort. The app always works offline with local data.</p>
    </section>
    <section class="card settings-card safety-card">
      <div class="section-title"><div><p class="eyebrow">YOUR DATA</p><h2>Keep a copy of your pantry</h2></div><span class="section-icon">↓</span></div>
      <p class="settings-copy">Export a CSV backup at any time. Clearing browser data or losing your phone can remove unsynced items.</p>
      <div class="sync-buttons"><button class="button secondary" data-action="export">↓ Export CSV backup</button><button class="button secondary" data-action="persist">Protect local storage</button></div>
      <p id="storage-status" class="privacy-note">${escapeHtml(state.persistStatus)}</p>
    </section>`;
}

function statCard(title: string, value: number, caption: string, tone: string): string {
  return `<div class="stat-card ${tone}"><div class="stat-top"><span>${title}</span><span class="stat-spark">↗</span></div><strong>${value}</strong><small>${caption}</small></div>`;
}

function bucketRow(label: string, count: number, tone: string): string {
  return `<div class="bucket-row"><span class="bucket-dot ${tone}"></span><span>${label}</span><strong>${count}</strong></div>`;
}

function renderFoodList(items: FoodItem[], compact: boolean, table = false): string {
  const sorted = table ? items : [...items].sort((first, second) => first.expirationDate.localeCompare(second.expirationDate));
  return sorted.map((item) => {
    const days = daysBetween(today(), item.expirationDate);
    const status = days < 0 ? 'expired' : days <= 7 ? 'urgent' : days <= (item.notifyWindow ?? alertWindow()) ? 'soon' : 'good';
    const expiryText = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`;
    return `<article class="food-row ${compact ? 'compact' : ''} ${table ? 'table-row' : ''} ${status}">
      <span class="food-avatar ${status}">${escapeHtml(item.name.slice(0, 1).toUpperCase())}</span>
      <span class="food-info"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)} · ${item.calories} cal${item.notifyWindow ? ` · ${item.notifyWindow}d alert` : ''}${item.possibleDuplicate ? ' · Possible duplicate' : ''}</small></span>
      <span class="expiry-label"><i></i>${escapeHtml(item.expirationDate)}<small>${expiryText}</small></span>
      <span class="quantity-label"><strong>${item.quantity}</strong><small>${item.quantity === 1 ? 'item' : 'items'}</small></span>
      <span class="row-actions">
        <button class="mini-button" data-action="used" data-id="${escapeHtml(item.id)}" aria-label="Use one ${escapeHtml(item.name)}" title="Use one">−</button>
        <button class="mini-button" data-action="edit" data-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)}" title="Edit">✎</button>
        <button class="mini-button delete" data-action="delete" data-id="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.name)}" title="Delete">×</button>
      </span>
    </article>`;
  }).join('');
}

function showItemDialog(id?: string): void {
  state.editingId = id;
  const item = id ? state.items.find((candidate) => candidate.id === id) : undefined;
  const dialog = document.querySelector<HTMLDialogElement>('#item-dialog');
  if (!dialog) return;
  dialog.innerHTML = `
    <form id="item-form" class="item-form">
      <div class="dialog-heading"><div><p class="eyebrow">${item ? 'UPDATE YOUR PANTRY' : 'ADD TO YOUR PANTRY'}</p><h2>${item ? 'Edit food' : 'Add food'}</h2></div><button type="button" class="close-button" data-action="close-dialog" aria-label="Close">×</button></div>
      <label class="field-label" for="item-name">Food name</label><input id="item-name" name="name" class="text-field" required maxlength="120" placeholder="e.g. Whole milk" value="${escapeHtml(item?.name ?? '')}" />
      <div class="form-pair"><div><label class="field-label" for="item-category">Category</label><select id="item-category" name="category" class="text-field" required><option value="" disabled ${!FOOD_CATEGORIES.some((category) => category === item?.category) ? 'selected' : ''}>Choose a category</option>${FOOD_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}" ${item?.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select></div><div><label class="field-label" for="item-expiration">Expiration date</label><input id="item-expiration" class="text-field" type="date" name="expirationDate" required value="${escapeHtml(item?.expirationDate ?? '')}" /></div></div>
      <div class="form-pair"><div><label class="field-label" for="item-quantity">Quantity</label><input id="item-quantity" class="text-field" type="number" name="quantity" min="1" step="1" required value="${item?.quantity ?? 1}" /></div><div><label class="field-label" for="item-calories">Calories per item</label><input id="item-calories" class="text-field" type="number" name="calories" min="0" step="1" required value="${item?.calories ?? 0}" /></div></div>
      <label class="field-label" for="item-notify">Alert window <span class="muted">(optional override)</span></label><div class="inline-field"><input id="item-notify" class="text-field" name="notifyWindow" type="number" min="1" step="1" value="${item?.notifyWindow ?? ''}" placeholder="${alertWindow()}" /><span>days before expiration</span></div>
      <div class="dialog-actions"><button type="button" class="button secondary" data-action="close-dialog">Cancel</button><button class="button primary" type="submit">${item ? 'Save changes' : 'Add to pantry'}</button></div>
    </form>`;
  dialog.showModal();
  dialog.querySelector<HTMLInputElement>('#item-name')?.focus();
}

function showDeleteConfirmation(id: string): void {
  const item = state.items.find((candidate) => candidate.id === id);
  const dialog = document.querySelector<HTMLDialogElement>('#item-dialog');
  if (!item || !dialog) return;
  state.editingId = undefined;
  dialog.innerHTML = `
    <section class="delete-confirmation" aria-labelledby="delete-confirmation-title">
      <div class="dialog-heading"><div><p class="eyebrow">REMOVE FROM YOUR PANTRY</p><h2 id="delete-confirmation-title">Delete this food?</h2></div><button type="button" class="close-button" data-action="cancel-delete" aria-label="Close">×</button></div>
      <p class="settings-copy">Are you sure you want to delete <strong>${escapeHtml(item.name)}</strong>? You can undo this from the confirmation message.</p>
      <div class="dialog-actions"><button type="button" class="button secondary" data-action="cancel-delete">Keep item</button><button type="button" class="button danger" data-action="confirm-delete" data-id="${escapeHtml(id)}">Delete food</button></div>
    </section>`;
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('[data-action="cancel-delete"]')?.focus();
}

function formInput(form: HTMLFormElement): FoodItemInput {
  const data = new FormData(form);
  const name = String(data.get('name') ?? '').trim();
  const category = String(data.get('category') ?? '').trim();
  const expirationDate = String(data.get('expirationDate') ?? '').trim();
  const quantity = Number(data.get('quantity'));
  const calories = Number(data.get('calories'));
  const notifyWindowValue = String(data.get('notifyWindow') ?? '').trim();
  const validCategory = FOOD_CATEGORIES.find((candidate) => candidate === category);
  if (!name) throw new Error('Enter a food name.');
  if (!validCategory) {
    throw new Error(`Choose a category: ${FOOD_CATEGORIES.join(', ')}.`);
  }
  if (!isValidIsoDate(expirationDate)) throw new Error('Choose a valid expiration date.');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Quantity must be a whole number greater than zero.');
  if (!Number.isInteger(calories) || calories < 0) throw new Error('Calories must be a non-negative whole number.');
  const notifyWindow = notifyWindowValue ? Number(notifyWindowValue) : undefined;
  if (notifyWindow !== undefined && (!Number.isInteger(notifyWindow) || notifyWindow < 1)) {
    throw new Error('Alert window must be a positive whole number.');
  }
  return {
    name,
    category: validCategory,
    expirationDate,
    quantity,
    calories,
    ...(notifyWindow ? { notifyWindow } : {})
  };
}

async function reload(): Promise<void> {
  state.items = await repository.list(true);
  render();
}

function flash(message: string): void {
  const toast = document.querySelector<HTMLElement>('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 3200);
}

function showError(error: unknown): void {
  state.error = error instanceof Error ? error.message : 'Something went wrong.';
  state.notice = undefined;
  render();
}

function clearError(): void {
  state.error = undefined;
  state.notice = undefined;
}

function saveCsv(): void {
  const csv = exportCsv(activeItems());
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `pantry-${today()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  flash('Your pantry CSV is ready.');
}

async function importCsv(file: File): Promise<void> {
  const result = validateCsv(await file.text());
  const errors = document.querySelector<HTMLElement>('#csv-errors');
  if (result.errors.length) {
    if (errors) errors.innerHTML = `<div class="notice error"><strong>Nothing was imported. Fix these CSV issues:</strong><ul>${result.errors.map((error) => `<li>Line ${error.line}: ${escapeHtml(error.message)}</li>`).join('')}</ul></div>`;
    return;
  }
  await repository.bulkUpsert(result.items);
  await reload();
  state.notice = `Imported ${result.items.length} food ${result.items.length === 1 ? 'item' : 'items'}.`;
  render();
}

async function syncNow(): Promise<void> {
  const endpoint = localStorage.getItem(settingKeys.endpoint);
  const secret = localStorage.getItem(settingKeys.secret);
  if (!endpoint || !secret) throw new Error('Add your sync endpoint and shared secret in Settings first.');
  const parsedEndpoint = new URL(endpoint);
  if (parsedEndpoint.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsedEndpoint.hostname)) {
    throw new Error('The sync endpoint must use HTTPS.');
  }
  state.syncing = true;
  state.syncStatus = 'Syncing…';
  render();
  const localChanges = (await repository.list(true)).filter((item) => item.syncPending);
  const sent = new Map(localChanges.map((item) => [item.id, item]));
  const outgoing = localChanges.slice(0, 100).map(({ syncPending: _pending, ...item }) => item);
  const flaggedDuplicates = new Set(state.items.filter((item) => item.possibleDuplicate).map((item) => item.id));
  const response = await fetch(`${parsedEndpoint.toString().replace(/\/+$/, '')}/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': secret },
    body: JSON.stringify({ cursor: localStorage.getItem('food-expiry.sync-cursor') ?? undefined, changes: outgoing })
  });
  if (!response.ok) {
    let detail = '';
    try {
      const errorBody: unknown = await response.json();
      if (typeof errorBody === 'object' && errorBody !== null && 'error' in errorBody) {
        detail = `: ${String(errorBody.error)}`;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    throw new Error(`Sync failed (${response.status})${detail}`);
  }
  const result = await response.json() as SyncResponse;
  const duplicates: string[] = [];
  for (const remote of result.changes) {
    const localDuplicate = await repository.findByNaturalKey(remote);
    if (localDuplicate && localDuplicate.id !== remote.id && !localDuplicate.deletedAt && !remote.deletedAt
      && !flaggedDuplicates.has(remote.id)) {
      const merge = window.confirm(
        `Possible duplicate: ${remote.name} (${remote.category}, ${remote.expirationDate}) exists on this device as a separate item. Merge the quantities?`
      );
      if (merge) {
        await repository.update(localDuplicate.id, {
          ...localDuplicate,
          quantity: localDuplicate.quantity + remote.quantity
        });
        await repository.applyRemote(remote, sent.get(remote.id));
        await repository.delete(remote.id);
        duplicates.push(remote.name);
        continue;
      }
      flaggedDuplicates.add(remote.id);
    }
    await repository.applyRemote(remote, sent.get(remote.id));
  }
  if (localChanges.length > outgoing.length) {
    state.syncStatus = 'More to sync';
    flash(`Synced ${outgoing.length} changes. Sync again to send the remaining items.`);
  } else {
    localStorage.setItem('food-expiry.sync-cursor', result.cursor);
    const syncedAt = new Date().toISOString();
    localStorage.setItem(settingKeys.lastSync, syncedAt);
    state.syncStatus = 'Up to date';
    flash(duplicates.length ? `Synced. Merged duplicate${duplicates.length === 1 ? '' : 's'}: ${duplicates.join(', ')}.` : 'Your pantry is up to date across devices.');
  }
  state.syncing = false;
  await reload();
}

app.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLElement>('[data-action], [data-tab]');
  if (!button) return;
  const tab = button.dataset.tab as typeof state.tab | undefined;
  if (tab) {
    state.tab = tab;
    state.expiringOnly = false;
    render();
    return;
  }
  const action = button.dataset.action;
  const id = button.dataset.id;
  try {
    clearError();
    if (action === 'settings') state.tab = 'settings';
    else if (action === 'add') {
      showItemDialog();
      return;
    } else if (action === 'edit' && id) {
      showItemDialog(id);
      return;
    } else if (action === 'close-dialog') {
      document.querySelector<HTMLDialogElement>('#item-dialog')?.close();
      return;
    } else if (action === 'cancel-delete') {
      document.querySelector<HTMLDialogElement>('#item-dialog')?.close();
      return;
    }
    else if (action === 'dismiss') state.error = state.notice = undefined;
    else if (action === 'show-expiring') {
      state.tab = 'items';
      state.category = 'all';
      state.search = '';
      state.expiringOnly = true;
    } else if (action === 'export') saveCsv();
    else if (action === 'import') {
      csvInput.value = '';
      csvInput.click();
    }
    else if (action === 'save-window') {
      const input = document.querySelector<HTMLInputElement>('#alert-window');
      const value = Number(input?.value);
      if (!Number.isInteger(value) || value < 1 || value > 3650) throw new Error('Alert window must be a whole number between 1 and 3650.');
      localStorage.setItem(settingKeys.window, String(value));
      state.notice = `Your default alert window is now ${value} days.`;
    } else if (action === 'save-sync') {
      const endpoint = document.querySelector<HTMLInputElement>('#sync-endpoint')?.value.trim() ?? '';
      const secret = document.querySelector<HTMLInputElement>('#sync-secret')?.value
        || localStorage.getItem(settingKeys.secret) || '';
      if (!endpoint || !secret) throw new Error('Enter both the sync endpoint URL and shared secret.');
      const parsed = new URL(endpoint);
      if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new Error('The sync endpoint must use HTTPS.');
      localStorage.setItem(settingKeys.endpoint, parsed.toString().replace(/\/+$/, ''));
      localStorage.setItem(settingKeys.secret, secret);
      state.notice = 'Sync settings saved on this device.';
      state.syncStatus = 'Ready to sync';
    } else if (action === 'sync-now') {
      await syncNow();
      return;
    } else if (action === 'persist') {
      if (!navigator.storage?.persist) throw new Error('Persistent storage is not supported by this browser.');
      const persisted = await navigator.storage.persist();
      state.persistStatus = persisted
        ? 'Persistent storage is enabled.'
        : 'The browser did not grant persistent storage. Install this app to your home screen to reduce eviction risk.';
      const status = document.querySelector<HTMLElement>('#storage-status');
      if (status) status.textContent = state.persistStatus;
      if (!persisted) flash('The browser did not grant storage persistence.');
      else flash('Persistent storage is enabled.');
      return;
    } else if (action === 'delete' && id) {
      showDeleteConfirmation(id);
      return;
    } else if (action === 'confirm-delete' && id) {
      const item = state.items.find((candidate) => candidate.id === id);
      if (!item) throw new Error('The item no longer exists.');
      document.querySelector<HTMLDialogElement>('#item-dialog')?.close();
      await repository.delete(id);
      scheduleSync();
      state.notice = `Removed ${item.name} from your pantry.`;
      await reload();
      const toast = document.querySelector<HTMLElement>('#toast');
      if (toast) {
        toast.innerHTML = `Removed ${escapeHtml(item.name)} <button data-action="undo" data-id="${escapeHtml(id)}">Undo</button>`;
        toast.classList.add('visible');
      }
      window.setTimeout(() => document.querySelector('#toast')?.classList.remove('visible'), 5000);
      return;
    } else if (action === 'undo' && id) {
      const item = state.items.find((candidate) => candidate.id === id);
      if (item) {
        await repository.restore(item);
        scheduleSync();
      }
      flash('Item restored.');
    } else if (action === 'used' && id) {
      const item = state.items.find((candidate) => candidate.id === id);
      if (item) {
        if (item.quantity <= 1) await repository.delete(id);
        else await repository.update(id, { ...item, quantity: item.quantity - 1 });
        scheduleSync();
        state.notice = item.quantity <= 1 ? `${item.name} was removed from your pantry.` : `One ${item.name} marked as used.`;
      }
    }
    await reload();
  } catch (error) {
    state.syncing = false;
    state.syncStatus = 'Sync issue';
    showError(error);
  }
});

app.addEventListener('submit', async (event) => {
  if (!(event.target instanceof HTMLFormElement) || event.target.id !== 'item-form') return;
  event.preventDefault();
  try {
    clearError();
    const input = formInput(event.target);
    if (state.editingId) await repository.update(state.editingId, input);
    else await repository.create(input);
    scheduleSync();
    document.querySelector<HTMLDialogElement>('#item-dialog')?.close();
    state.editingId = undefined;
    state.notice = 'Your pantry has been updated.';
    await reload();
  } catch (error) {
    if (error instanceof DuplicateNaturalKeyError) {
      const merge = window.confirm(`This matches ${error.existing.name} already in your pantry. Merge quantities and keep the existing item?`);
      if (merge) {
        const input = formInput(event.target);
        await repository.update(error.existing.id, {
          ...input,
          quantity: input.quantity + error.existing.quantity
        });
        if (state.editingId && state.editingId !== error.existing.id) await repository.delete(state.editingId);
        scheduleSync();
        document.querySelector<HTMLDialogElement>('#item-dialog')?.close();
        state.editingId = undefined;
        await reload();
        return;
      }
      return;
    }
    showError(error);
  }
});

app.addEventListener('change', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if (target.id === 'category-filter') {
    state.category = target.value;
    render();
  } else if (target.id === 'sort-items') {
    state.sort = target.value;
    state.items.sort((first, second) => {
      if (target.value === 'name') return first.name.localeCompare(second.name);
      if (target.value === 'category') return first.category.localeCompare(second.category);
      return first.expirationDate.localeCompare(second.expirationDate);
    });
    render();
  }
});

csvInput.addEventListener('change', async () => {
  const file = csvInput.files?.[0];
  if (!file) return;
  try {
    await importCsv(file);
    scheduleSync();
  } catch (error) {
    showError(error);
  } finally {
    csvInput.value = '';
  }
});

app.addEventListener('input', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.id === 'search') {
    state.search = target.value;
    const cursor = target.selectionStart;
    render();
    const search = document.querySelector<HTMLInputElement>('#search');
    search?.focus();
    if (cursor !== null) search?.setSelectionRange(cursor, cursor);
  }
});

window.addEventListener('online', () => void syncWhenConfigured());
window.addEventListener('focus', () => void syncWhenConfigured());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void syncWhenConfigured();
});

let syncTimer: number | undefined;
async function syncWhenConfigured(): Promise<void> {
  if (!navigator.onLine || !localStorage.getItem(settingKeys.endpoint) || !localStorage.getItem(settingKeys.secret)) return;
  try {
    await syncNow();
  } catch (error) {
    state.syncing = false;
    state.syncStatus = 'Sync issue';
    if (state.tab === 'settings') showError(error);
    else render();
  }
}

function scheduleSync(): void {
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => void syncWhenConfigured(), 1500);
}

async function start(): Promise<void> {
  try {
    state.items = await repository.list(true);
    render();
    await syncWhenConfigured();
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL
      });
    }
    if (navigator.storage?.persist) {
      try {
        state.persistStatus = await navigator.storage.persist()
          ? 'Persistent storage is enabled.'
          : 'The browser may still clear local data. Install this app to your home screen and keep a CSV backup.';
      } catch (error) {
        state.persistStatus = `Could not request persistent storage: ${error instanceof Error ? error.message : 'unknown error'}`;
      }
    } else {
      state.persistStatus = 'Persistent storage is not supported by this browser.';
    }
    if (!localStorage.getItem(settingKeys.lastSync)) {
      const help = document.createElement('p');
      help.className = 'first-run-note';
      help.textContent = 'Tip: export a CSV backup or connect sync in Settings to protect your pantry.';
      app?.querySelector('.page-heading')?.after(help);
    }
  } catch (error) {
    showError(error);
  }
}

void start();
