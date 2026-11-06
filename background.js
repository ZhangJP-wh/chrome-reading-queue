/**
 * Reading Queue v2.1.3
 * Link context: enqueue that link (prefer visible linkText / card title).
 * Page/frame context: enqueue current tab (tab.url + tab.title) — no network if title strong.
 * Silent network fetch only for weak titles. No focus steal, no autoplay tabs.
 * Popup tabs: 未读队列 (unread only), 星标队列 (unread + starred), 历史队列 (read only).
 * markRead / markUnread / setRead flip read state without opening a tab.
 * Read + starred items keep starred:true and show only under 历史队列.
 * Toolbar: tab-specific action icon gets a thick fluorescent-green check (top-right)
 *   when that tab's URL is an unread queue item. Match is normalizeUrl (hash stripped)
 *   and unread only. The numeric badge stays global blue (#2563eb). Other tabs keep
 *   the default icon; leaving the URL, marking read, or removing the item restores it.
 * Order: storage keeps unread oldest-first (append before history) for simple FIFO layout;
 *   popup display sorts newest addedAt first within each tab's visible list.
 *   Drag-handle reorder reassigns addedAt inside that tab's visible list (same read-group).
 *   Drag feedback: neon insert line + cards push apart (shift-up / shift-down) at the gap.
 *   openNext always picks the oldest unread by addedAt — not by on-screen position.
 * Popup clear: one danger button「清空当前队列」, hidden on 未读队列.
 *   clearCurrentView({ view:'starred' }) deletes unread+starred only;
 *   clearCurrentView({ view:'history' }) deletes read items (former clearHistory).
 *   view 'unread' is refused so unread cannot be mass-cleared.
 * Closed tabs: tabs.get / action.setIcon / scripting.executeScript go through
 *   a callback that reads runtime.lastError. A tab that closed between query
 *   and the call must not show up as Unchecked runtime.lastError.
 * Note: Chrome/Edge cannot add items to the browser tab-strip context menu.
 */

const DEFAULT_MAX_ACTIVE = 2;
const SOFT_MAX_QUEUE = 500;
const TITLE_FETCH_TIMEOUT_MS = 3800; // fail-fast for CN network blocks
const NET_CONCURRENCY = 2;
const ALARM_TITLE_PUMP = 'rq-title-pump';
const STORAGE_KEYS = {
  queue: 'queue',
  maxActiveTabs: 'maxActiveTabs',
  activeQueueTabIds: 'activeQueueTabIds',
  pendingTitleFetches: 'pendingTitleFetches',
  titleFetchDebug: 'titleFetchDebug'
};

let activeTabIds = new Set();
const titleFetchInFlight = new Set();

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isRead(item) {
  return Boolean(item && item.read);
}

function unreadCount(queue) {
  return queue.filter((i) => !isRead(i)).length;
}

function itemAddedAt(item) {
  const n = Number(item && item.addedAt);
  if (Number.isFinite(n) && n > 0) return n;
  const fromId = Number(String((item && item.id) || '').split('-')[0]);
  return Number.isFinite(fromId) && fromId > 0 ? fromId : 0;
}

function normalizeQueueItems(queue) {
  return (Array.isArray(queue) ? queue : []).map((item) => ({
    ...item,
    read: Boolean(item.read),
    starred: Boolean(item.starred),
    addedAt: itemAddedAt(item)
  }));
}

/**
 * Display order: unread first, then history;
 * within each group, newest addedAt at the TOP.
 * Popup tabs filter this list (unread / unread-starred / history).
 * Storage may stay oldest-unread-first for enqueue; do not use this order for openNext.
 */
function sortQueueForDisplay(queue) {
  const unread = [];
  const history = [];
  for (const item of Array.isArray(queue) ? queue : []) {
    if (isRead(item)) history.push(item);
    else unread.push(item);
  }
  const byNewest = (a, b) => itemAddedAt(b) - itemAddedAt(a);
  unread.sort(byNewest);
  history.sort(byNewest);
  return [...unread, ...history];
}

/** Oldest unread by addedAt — FIFO consume, independent of display order. */
function findOldestUnread(queue) {
  let best = null;
  for (const item of Array.isArray(queue) ? queue : []) {
    if (isRead(item)) continue;
    if (!best || itemAddedAt(item) < itemAddedAt(best)) best = item;
  }
  return best;
}

/**
 * 星标队列 badge / status count: starred and still unread.
 * Read items may keep starred:true; they are listed only under 历史队列.
 */
function starredCount(queue) {
  return queue.filter((i) => Boolean(i && i.starred) && !isRead(i)).length;
}

/**
 * Visible drag list for one popup tab.
 * view unread | starred | history matches the three tabs.
 * Legacy amongStarred (no view) is every starred item, read or not.
 * No view and not amongStarred: full queue (unread then history).
 */
function reorderScope(queue, message) {
  const list = Array.isArray(queue) ? queue : [];
  const view = message && message.view;
  if (view === 'history') return list.filter((i) => isRead(i));
  if (view === 'starred') return list.filter((i) => i.starred && !isRead(i));
  if (view === 'unread') return list.filter((i) => !isRead(i));
  if (message && message.amongStarred) return list.filter((i) => i.starred);
  return list;
}

/**
 * Set read without opening a tab. Keeps storage as unread-block then history-block.
 * Marking read sets openedAt (same field openItem uses). Marking unread drops openedAt.
 * starred is left unchanged.
 */
async function setItemRead(itemId, read) {
  const { queue } = await getState();
  const idx = queue.findIndex((i) => i.id === itemId);
  if (idx < 0) return { ok: false, reason: 'not_found' };
  const cur = queue[idx];
  const want = Boolean(read);
  if (isRead(cur) === want && (want ? cur.openedAt : cur.openedAt == null)) {
    return {
      ok: true,
      item: cur,
      unchanged: true,
      unread: unreadCount(queue),
      history: queue.filter(isRead).length,
      starred: starredCount(queue)
    };
  }
  const remaining = [...queue.slice(0, idx), ...queue.slice(idx + 1)];
  let nextItem;
  let nextQueue;
  if (want) {
    nextItem = { ...cur, read: true, openedAt: Date.now() };
    nextQueue = [...remaining, nextItem];
  } else {
    nextItem = { ...cur, read: false };
    delete nextItem.openedAt;
    const firstHist = remaining.findIndex((i) => isRead(i));
    nextQueue =
      firstHist < 0
        ? [...remaining, nextItem]
        : [
            ...remaining.slice(0, firstHist),
            nextItem,
            ...remaining.slice(firstHist)
          ];
  }
  await setQueue(nextQueue);
  return {
    ok: true,
    item: nextItem,
    unread: unreadCount(nextQueue),
    history: nextQueue.filter(isRead).length,
    starred: starredCount(nextQueue)
  };
}

async function getState() {
  const data = await chrome.storage.local.get({
    [STORAGE_KEYS.queue]: [],
    [STORAGE_KEYS.maxActiveTabs]: DEFAULT_MAX_ACTIVE,
    [STORAGE_KEYS.activeQueueTabIds]: [],
    [STORAGE_KEYS.pendingTitleFetches]: [],
    [STORAGE_KEYS.titleFetchDebug]: []
  });
  let max = Number(data[STORAGE_KEYS.maxActiveTabs]);
  if (!Number.isFinite(max) || max < 1) max = DEFAULT_MAX_ACTIVE;
  if (max > 5) max = 5;
  return {
    queue: normalizeQueueItems(data[STORAGE_KEYS.queue]),
    maxActiveTabs: max,
    activeQueueTabIds: Array.isArray(data[STORAGE_KEYS.activeQueueTabIds])
      ? data[STORAGE_KEYS.activeQueueTabIds]
      : [],
    pendingTitleFetches: Array.isArray(data[STORAGE_KEYS.pendingTitleFetches])
      ? data[STORAGE_KEYS.pendingTitleFetches]
      : [],
    titleFetchDebug: Array.isArray(data[STORAGE_KEYS.titleFetchDebug])
      ? data[STORAGE_KEYS.titleFetchDebug]
      : []
  };
}

async function setQueue(queue) {
  await chrome.storage.local.set({ [STORAGE_KEYS.queue]: queue });
  await updateBadge(unreadCount(queue));
  await refreshIconsForQueue(queue);
}

async function getPending() {
  const data = await chrome.storage.local.get({
    [STORAGE_KEYS.pendingTitleFetches]: []
  });
  return Array.isArray(data[STORAGE_KEYS.pendingTitleFetches])
    ? data[STORAGE_KEYS.pendingTitleFetches]
    : [];
}

async function setPending(list) {
  await chrome.storage.local.set({ [STORAGE_KEYS.pendingTitleFetches]: list });
}

async function pushDebug(entry) {
  try {
    const data = await chrome.storage.local.get({
      [STORAGE_KEYS.titleFetchDebug]: []
    });
    const list = Array.isArray(data[STORAGE_KEYS.titleFetchDebug])
      ? data[STORAGE_KEYS.titleFetchDebug]
      : [];
    const raw = entry.lastRawTitle != null ? String(entry.lastRawTitle) : '';
    list.unshift({
      at: Date.now(),
      url: entry.url || '',
      error: String(entry.error || '').slice(0, 300),
      stage: entry.stage || '',
      lastRawTitle: raw.slice(0, 200)
    });
    await chrome.storage.local.set({
      [STORAGE_KEYS.titleFetchDebug]: list.slice(0, 10)
    });
  } catch {
    // ignore
  }
}

async function setActiveIds(ids) {
  const arr = [...ids];
  activeTabIds = new Set(arr);
  await chrome.storage.local.set({ [STORAGE_KEYS.activeQueueTabIds]: arr });
}

/**
 * 调用可能打到已关闭标签的 chrome API。
 * action.setIcon 的 Promise 在「No tab with id」时仍可能 resolve，同时把
 * runtime.lastError 留在内部回调里；try/catch 和 .catch() 都消不掉
 * chrome://extensions 上的 Unchecked runtime.lastError。
 * 回调里必须同步读取 lastError。若实现同时返回 Promise，也接住 rejection，
 * 但以回调结果为准（回调已经把 lastError 标成已检查）。
 * 失败时 { ok:false }，不抛错。标签不存在是正常情况。
 */
function chromeCallChecked(invoke) {
  return new Promise((resolve) => {
    let settled = false;
    let callbackCalled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    const fail = (err) =>
      finish({
        ok: false,
        error: err && err.message ? err.message : String(err || 'failed')
      });
    try {
      const returned = invoke((result) => {
        callbackCalled = true;
        const err = chrome.runtime.lastError;
        if (err) fail(err);
        else finish({ ok: true, result });
      });
      if (returned && typeof returned.then === 'function') {
        returned.then(
          (result) => {
            const err = chrome.runtime.lastError;
            if (callbackCalled) return;
            if (err) fail(err);
            else finish({ ok: true, result });
          },
          (err) => {
            void chrome.runtime.lastError;
            if (callbackCalled) return;
            fail(err);
          }
        );
      }
    } catch (err) {
      fail(err);
    }
  });
}

function safeTabsGet(tabId) {
  if (tabId == null) return Promise.resolve(null);
  return chromeCallChecked((done) => chrome.tabs.get(tabId, done)).then((res) =>
    res.ok ? res.result : null
  );
}

function safeSetTabIcon(tabId, path) {
  if (tabId == null) return Promise.resolve(false);
  return chromeCallChecked((done) =>
    chrome.action.setIcon({ tabId, path }, done)
  ).then((res) => res.ok);
}

function safeExecuteScript(details) {
  if (!details || !details.target || details.target.tabId == null) {
    return Promise.resolve(null);
  }
  return chromeCallChecked((done) =>
    chrome.scripting.executeScript(details, done)
  ).then((res) => (res.ok ? res.result : null));
}

async function syncActiveFromStorage() {
  const { activeQueueTabIds } = await getState();
  const alive = [];
  for (const id of activeQueueTabIds) {
    const tab = await safeTabsGet(id);
    if (tab) alive.push(id);
  }
  await setActiveIds(alive);
  return alive;
}

async function updateBadge(count) {
  const text = count > 0 ? String(count > 99 ? '99+' : count) : '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
}

async function flashBadge(text, ms = 1200) {
  const { queue } = await getState();
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: '#ca8a04' });
  setTimeout(() => {
    updateBadge(unreadCount(queue)).catch(() => {});
  }, ms);
}

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url.trim();
  }
}

/** Default toolbar icon (manifest). Passed per tabId to clear the unread check. */
const ACTION_ICON_DEFAULT = {
  16: 'icons/icon16.png',
  32: 'icons/icon32.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png'
};

/** Same blue document with a thick #39ff14 check in the top-right. */
const ACTION_ICON_IN_UNREAD = {
  16: 'icons/icon16-in-unread.png',
  32: 'icons/icon32-in-unread.png',
  48: 'icons/icon48-in-unread.png',
  128: 'icons/icon128-in-unread.png'
};

/** tabId -> true when the in-unread icon is applied. Cleared when the SW restarts. */
const tabInUnreadIcon = new Map();
/** Sorted unread URLs last painted. Title-only queue writes skip a full rescan. */
let unreadIconUrlKey = null;

function unreadUrlKey(queue) {
  const urls = [];
  for (const item of Array.isArray(queue) ? queue : []) {
    if (!item || isRead(item) || !item.url) continue;
    const n = normalizeUrl(item.url);
    if (n) urls.push(n);
  }
  urls.sort();
  return urls.join('\n');
}

/**
 * True when url matches an unread queue item.
 * Uses normalizeUrl (hash stripped). Read/history items do not match.
 * chrome://, edge://, empty, and non-http(s) URLs are never "in unread".
 */
function isUnreadQueueUrl(url, queue) {
  if (!url || typeof url !== 'string') return false;
  const clean = normalizeUrl(url);
  if (!clean || !/^https?:\/\//i.test(clean)) return false;
  for (const item of Array.isArray(queue) ? queue : []) {
    if (!item || isRead(item) || !item.url) continue;
    if (normalizeUrl(item.url) === clean) return true;
  }
  return false;
}

function tabPageUrl(tab) {
  if (!tab) return '';
  const url = typeof tab.url === 'string' ? tab.url : '';
  const pending = typeof tab.pendingUrl === 'string' ? tab.pendingUrl : '';
  if (/^https?:\/\//i.test(url)) return url;
  if (/^https?:\/\//i.test(pending)) return pending;
  return url || pending || '';
}

/** onUpdated should repaint on navigation url or load status, not on title-only noise. */
function shouldRefreshTabIcon(changeInfo) {
  if (!changeInfo) return false;
  if (typeof changeInfo.url === 'string') return true;
  return changeInfo.status === 'loading' || changeInfo.status === 'complete';
}

async function applyTabQueueIcon(tab, queue) {
  if (!tab || tab.id == null) return;
  const show = isUnreadQueueUrl(tabPageUrl(tab), queue);
  if (tabInUnreadIcon.get(tab.id) === show) return;
  // 查询和 setIcon 之间标签可能已关。失败时不记缓存，下次激活再试。
  const ok = await safeSetTabIcon(
    tab.id,
    show ? ACTION_ICON_IN_UNREAD : ACTION_ICON_DEFAULT
  );
  if (ok) tabInUnreadIcon.set(tab.id, show);
  else tabInUnreadIcon.delete(tab.id);
}

/**
 * Queue writes and tab events can overlap (setQueue plus storage.onChanged).
 * Paint serially and drop a stale snapshot when a newer queue paint is already queued.
 */
let iconPaintSerial = Promise.resolve();
let iconPaintGen = 0;

function enqueueIconPaint(task) {
  const run = iconPaintSerial.then(task, task);
  iconPaintSerial = run.then(
    () => {},
    () => {}
  );
  return run;
}

function refreshIconsForQueue(queue) {
  const gen = ++iconPaintGen;
  const snapshot = queue;
  return enqueueIconPaint(() => {
    if (gen !== iconPaintGen) return;
    return paintQueueIcons(snapshot);
  });
}

async function paintQueueIcons(queue) {
  const key = unreadUrlKey(queue);
  const keySame = key === unreadIconUrlKey;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  const seen = new Set();
  await Promise.all(
    tabs.map((tab) => {
      if (tab && tab.id != null) seen.add(tab.id);
      if (keySame && tab && tabInUnreadIcon.has(tab.id)) return null;
      return applyTabQueueIcon(tab, queue);
    })
  );
  for (const id of tabInUnreadIcon.keys()) {
    if (!seen.has(id)) tabInUnreadIcon.delete(id);
  }
  unreadIconUrlKey = key;
}

function syncTabQueueIcon(tabOrId) {
  return enqueueIconPaint(() => syncTabQueueIconNow(tabOrId));
}

async function syncTabQueueIconNow(tabOrId) {
  let tab = tabOrId;
  if (typeof tabOrId === 'number') {
    tab = await safeTabsGet(tabOrId);
    if (!tab) {
      tabInUnreadIcon.delete(tabOrId);
      return;
    }
  } else if (!tab || tab.id == null) {
    return;
  } else if (!tabPageUrl(tab)) {
    const id = tab.id;
    tab = await safeTabsGet(id);
    if (!tab) {
      tabInUnreadIcon.delete(id);
      return;
    }
  }
  let queue = [];
  try {
    const state = await getState();
    queue = state.queue;
  } catch {
    return;
  }
  await applyTabQueueIcon(tab, queue);
}

function fallbackTitleFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
    const snippet = path.length > 40 ? path.slice(0, 37) + '…' : path;
    return u.hostname + snippet;
  } catch {
    return url;
  }
}

function looksLikeUrl(text) {
  if (!text) return true;
  const t = String(text).trim();
  if (!t) return true;
  // Explicit scheme
  if (/^https?:\/\//i.test(t)) return true;
  // Scheme-relative //host/...
  if (/^\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(t)) return true;
  // Bare host/path with no whitespace and no CJK — e.g. www.youtube.com/watch
  // NEVER use (t === normalizeUrl(t)): normalizeUrl returns trim(t) for non-URLs,
  // which made every real title look like a URL and get discarded.
  if (
    /[\u4e00-\u9fff\s]/.test(t) === false &&
    /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:[/:?#][^\s]*)?$/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

function isWeakTitle(title, url) {
  if (!title || !String(title).trim()) return true;
  const t = String(title).trim();
  if (looksLikeUrl(t)) return true;
  const fb = fallbackTitleFromUrl(url);
  if (t === fb) return true;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const hostWww = u.hostname;
    if (t === u.hostname || t === u.host || t === host) return true;
    if (t === hostWww + u.pathname || t === u.host + u.pathname) return true;
    if (
      t === hostWww + '/watch' ||
      t === 'www.youtube.com/watch' ||
      t === 'youtube.com/watch' ||
      t === host + '/watch'
    ) {
      return true;
    }
    // hostname + short path only
    if (t === hostWww + u.pathname.split('?')[0]) return true;
    if (t.startsWith(hostWww + '/') || t.startsWith(host + '/')) {
      const rest = t.startsWith(hostWww) ? t.slice(hostWww.length) : t.slice(host.length);
      const base = rest.split('…')[0];
      if (/^\/(watch|shorts|live|embed)\/?$/.test(base)) return true;
      // host+/watch with no real words beyond path crumbs
      if (
        /^\/[a-z0-9_/-]*$/i.test(base) &&
        !/[\u4e00-\u9fff]/.test(t) &&
        base.length < 24
      ) {
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    )
    .replace(/&nbsp;/g, ' ');
}

function cleanPageTitle(raw, url) {
  if (!raw) return null;
  let t = decodeHtmlEntities(String(raw)).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  t = t.replace(/\s*[-–|]\s*YouTube\s*$/i, '').trim();
  t = t.replace(/\s*[-–|]\s*X\s*$/i, '').trim();
  t = t.replace(/\s*[-–|]\s*Twitter\s*$/i, '').trim();
  if (!t || looksLikeUrl(t)) return null;
  const lower = t.toLowerCase();
  if (
    lower === 'youtube' ||
    lower === 'loading...' ||
    lower === 'about:blank' ||
    lower === 'privacy policy' ||
    lower.includes('before you continue') ||
    lower.includes('consent')
  ) {
    return null;
  }
  // Reject only if still looks like host/path fallback
  if (isWeakTitle(t, url)) return null;
  return t;
}

function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '');
    if (h === 'youtu.be') return true;
    if (
      h === 'youtube.com' ||
      h === 'm.youtube.com' ||
      h === 'music.youtube.com'
    ) {
      return (
        u.pathname === '/watch' ||
        u.pathname.startsWith('/watch/') ||
        u.pathname.startsWith('/shorts/') ||
        u.pathname.startsWith('/live/') ||
        u.pathname.startsWith('/embed/')
      );
    }
  } catch {
    // ignore
  }
  return false;
}

function youtubeVideoId(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '').toLowerCase();
    if (h === 'youtu.be') {
      return (u.pathname.replace(/^\//, '').split('/')[0] || '').split('?')[0];
    }
    if (
      h === 'youtube.com' ||
      h === 'm.youtube.com' ||
      h === 'music.youtube.com' ||
      h.endsWith('.youtube.com')
    ) {
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || '';
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || '';
      if (u.pathname.startsWith('/live/')) return u.pathname.split('/')[2] || '';
      return u.searchParams.get('v') || '';
    }
  } catch {
    // ignore
  }
  return '';
}

function youtubeCanonicalWatchUrl(url) {
  const id = youtubeVideoId(url);
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  return normalizeUrl(url);
}

function makeRoom(queue, need = 1) {
  let next = [...queue];
  while (next.length + need > SOFT_MAX_QUEUE) {
    const histIdx = next.findIndex((i) => isRead(i));
    if (histIdx < 0) return null;
    next.splice(histIdx, 1);
  }
  return next;
}

async function updateItemTitle(itemId, title) {
  const { queue } = await getState();
  const idx = queue.findIndex((i) => i.id === itemId);
  if (idx < 0) return false;
  if (queue[idx].title === title) return false;
  const next = [...queue];
  next[idx] = { ...next[idx], title, titleFetchedAt: Date.now() };
  await setQueue(next);
  return true;
}

function fetchWithTimeout(resource, options = {}, ms = TITLE_FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(resource, { ...options, signal: ctrl.signal }).finally(() =>
    clearTimeout(id)
  );
}

async function fetchJsonTitle(apiUrl, attempts) {
  try {
    const res = await fetchWithTimeout(apiUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'follow'
    });
    if (!res.ok) {
      if (attempts) {
        attempts.push({ stage: 'json', url: apiUrl, status: res.status, error: `HTTP ${res.status}` });
      }
      return null;
    }
    const data = await res.json();
    if (data && typeof data.title === 'string') {
      if (attempts) {
        attempts.push({
          stage: 'json',
          url: apiUrl,
          status: res.status,
          raw: String(data.title).slice(0, 120)
        });
      }
      return data.title;
    }
    if (attempts) {
      attempts.push({ stage: 'json', url: apiUrl, status: res.status, error: 'no title field' });
    }
  } catch (err) {
    if (attempts) {
      attempts.push({ stage: 'json', url: apiUrl, error: String(err) });
    }
  }
  return null;
}

function extractTitleFromHtml(html) {
  if (!html) return null;
  const og =
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i
    );
  if (og && og[1]) return og[1];
  const tw =
    html.match(
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["']/i
    );
  if (tw && tw[1]) return tw[1];
  // YouTube sometimes embeds "title":"..." in ytInitialPlayerResponse
  const ytJson = html.match(/"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"\}/);
  if (ytJson && ytJson[1]) {
    try {
      return JSON.parse(`"${ytJson[1]}"`);
    } catch {
      return ytJson[1];
    }
  }
  const ytSimple = html.match(/"videoDetails":\{[^}]*"title":"((?:\\.|[^"\\])*)"/);
  if (ytSimple && ytSimple[1]) {
    try {
      return JSON.parse(`"${ytSimple[1]}"`);
    } catch {
      return ytSimple[1];
    }
  }
  // alternate videoDetails order
  const ytAlt = html.match(/"videoDetails":\{[\s\S]{0,800}?"title":"((?:\\.|[^"\\])*)"/);
  if (ytAlt && ytAlt[1]) {
    try {
      return JSON.parse(`"${ytAlt[1]}"`);
    } catch {
      return ytAlt[1];
    }
  }
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (title && title[1]) return title[1];
  return null;
}

async function fetchHtmlTitle(url, attempts, stage = 'html') {
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        redirect: 'follow',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      },
      TITLE_FETCH_TIMEOUT_MS
    );
    if (!res.ok) {
      if (attempts) {
        attempts.push({
          stage,
          url,
          status: res.status,
          error: `HTML HTTP ${res.status}`
        });
      }
      return null;
    }
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > 400 * 1024 ? buf.slice(0, 400 * 1024) : buf;
    const html = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    const raw = extractTitleFromHtml(html);
    if (attempts) {
      attempts.push({
        stage,
        url,
        status: res.status,
        raw: raw ? String(raw).slice(0, 120) : '',
        error: raw ? '' : 'no title in HTML'
      });
    }
    return raw;
  } catch (err) {
    if (attempts) {
      attempts.push({ stage, url, error: String(err) });
    }
    return null;
  }
}

function youtubeMobileWatchUrl(url) {
  try {
    const watch = youtubeCanonicalWatchUrl(url);
    const u = new URL(watch);
    const id = u.searchParams.get('v');
    if (id) return `https://m.youtube.com/watch?v=${id}`;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Network-only resolve (no tabs, no focus steal).
 * Returns { title, attempts } where title is cleaned or null.
 */
async function resolveRemoteTitle(url) {
  const clean = normalizeUrl(url);
  const attempts = [];
  if (!clean || !/^https?:\/\//i.test(clean)) {
    return { title: null, attempts };
  }

  if (isYouTubeUrl(clean)) {
    const watch = youtubeCanonicalWatchUrl(clean);

    // 1) oEmbed
    const yt = await fetchJsonTitle(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`,
      attempts
    );
    const cleanedYt = cleanPageTitle(yt, clean);
    if (cleanedYt) return { title: cleanedYt, attempts };

    // 2) desktop watch HTML
    const htmlTitle = await fetchHtmlTitle(watch, attempts, 'yt-html');
    const cleanedHtml = cleanPageTitle(htmlTitle, clean);
    if (cleanedHtml) return { title: cleanedHtml, attempts };

    // 3) mobile watch HTML (sometimes lighter / different CDN path)
    const mobile = youtubeMobileWatchUrl(clean);
    if (mobile) {
      const mobTitle = await fetchHtmlTitle(mobile, attempts, 'yt-mobile');
      const cleanedMob = cleanPageTitle(mobTitle, clean);
      if (cleanedMob) return { title: cleanedMob, attempts };
    }
  }

  // noembed (public mirror; often blocked in CN too — fail-fast)
  const noembed = await fetchJsonTitle(
    `https://noembed.com/embed?url=${encodeURIComponent(clean)}`,
    attempts
  );
  const cleanedNo = cleanPageTitle(noembed, clean);
  if (cleanedNo) return { title: cleanedNo, attempts };

  // generic page HTML
  const htmlTitle = await fetchHtmlTitle(clean, attempts, 'html');
  const cleanedHtml = cleanPageTitle(htmlTitle, clean);
  if (cleanedHtml) return { title: cleanedHtml, attempts };

  return { title: null, attempts };
}

function summarizeAttempts(attempts) {
  if (!attempts || !attempts.length) {
    return { stage: 'none', error: 'no attempts', lastRawTitle: '', status: '' };
  }
  const last = attempts[attempts.length - 1];
  const withRaw = [...attempts].reverse().find((a) => a.raw);
  const stages = attempts.map((a) => a.stage).join('>');
  const errs = attempts
    .map((a) => a.error || (a.status != null ? `HTTP ${a.status}` : ''))
    .filter(Boolean)
    .slice(-3)
    .join('; ');
  return {
    stage: stages.slice(0, 80),
    error: errs.slice(0, 280) || 'all sources failed',
    lastRawTitle: withRaw ? String(withRaw.raw) : '',
    status: last.status != null ? String(last.status) : ''
  };
}

/** Match queue URL against already-open tabs (no new tabs). */
function urlsLikelySame(a, b) {
  try {
    const ua = new URL(normalizeUrl(a));
    const ub = new URL(normalizeUrl(b));
    if (ua.href === ub.href) return true;
    // YouTube: compare video id
    if (isYouTubeUrl(ua.href) && isYouTubeUrl(ub.href)) {
      return youtubeCanonicalWatchUrl(ua.href) === youtubeCanonicalWatchUrl(ub.href);
    }
    return false;
  } catch {
    return normalizeUrl(a) === normalizeUrl(b);
  }
}

async function fillTitlesFromOpenTabs({ onlyWeak = true, includeHistory = false } = {}) {
  const { queue } = await getState();
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (err) {
    await pushDebug({
      url: '',
      error: String(err),
      stage: 'open-tabs-query'
    });
    return { ok: false, updated: 0, checked: 0, error: String(err) };
  }

  let updated = 0;
  let checked = 0;
  for (const item of queue) {
    if (!item.url) continue;
    if (isRead(item) && !includeHistory) continue;
    if (onlyWeak && !isWeakTitle(item.title, item.url)) continue;

    const match = tabs.find(
      (t) => t.url && urlsLikelySame(t.url, item.url)
    );
    if (!match) continue;
    checked += 1;

    let raw = (match.title || '').trim();
    // Prefer page meta if injectable. 标签已关或页面不可注入时返回 null，沿用 tab.title。
    if (match.id != null) {
      const results = await safeExecuteScript({
        target: { tabId: match.id },
        func: () => {
            const og = document.querySelector('meta[property="og:title"]');
            if (og && og.content) return og.content.trim();
            const tw = document.querySelector('meta[name="twitter:title"]');
            if (tw && tw.content) return tw.content.trim();
            try {
              const y = window.ytInitialPlayerResponse;
              if (y && y.videoDetails && y.videoDetails.title) {
                return String(y.videoDetails.title);
              }
            } catch (_) {}
            const h1 =
              document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
              document.querySelector('h1.ytd-watch-metadata') ||
              document.querySelector('#title h1') ||
              document.querySelector('h1');
            if (h1 && h1.textContent) return h1.textContent.trim();
            return (document.title || '').trim();
          }
      });
      const value = results && results[0] && results[0].result;
      if (value) raw = String(value).trim();
    }

    const cleaned = cleanPageTitle(raw, item.url);
    if (cleaned) {
      const ok = await updateItemTitle(item.id, cleaned);
      if (ok) updated += 1;
    } else if (raw) {
      await pushDebug({
        url: item.url,
        error: 'open-tab title weak/rejected',
        stage: 'open-tabs',
        lastRawTitle: raw.slice(0, 200)
      });
    }
  }

  return { ok: true, updated, checked, openTabs: tabs.length };
}

async function enqueuePendingJobs(jobs) {
  if (!jobs || !jobs.length) return 0;
  const pending = await getPending();
  const seen = new Set(pending.map((j) => j.id));
  let added = 0;
  const next = [...pending];
  for (const job of jobs) {
    if (!job || !job.id || !job.url) continue;
    if (seen.has(job.id)) continue;
    next.push({ id: job.id, url: job.url });
    seen.add(job.id);
    added += 1;
  }
  if (added) await setPending(next);
  return added;
}

async function removePendingId(itemId) {
  const pending = await getPending();
  const next = pending.filter((j) => j.id !== itemId);
  if (next.length !== pending.length) await setPending(next);
}

async function processOneTitleJob(job) {
  const { queue } = await getState();
  const item = queue.find((i) => i.id === job.id);
  if (!item) {
    await removePendingId(job.id);
    return;
  }
  if (!isWeakTitle(item.title, item.url)) {
    await removePendingId(job.id);
    return;
  }

  let title = null;
  let attempts = [];
  try {
    const result = await resolveRemoteTitle(item.url);
    title = result.title;
    attempts = result.attempts || [];
  } catch (err) {
    await pushDebug({
      url: item.url,
      error: String(err),
      stage: 'remote',
      lastRawTitle: ''
    });
  }

  if (title) {
    await updateItemTitle(job.id, title);
  } else {
    const summary = summarizeAttempts(attempts);
    await pushDebug({
      url: item.url,
      error: summary.error || 'network title fetch failed',
      stage: summary.stage || 'final',
      lastRawTitle: summary.lastRawTitle || ''
    });
  }
  await removePendingId(job.id);
}

async function pumpTitleFetches() {
  const limit = NET_CONCURRENCY;

  while (titleFetchInFlight.size < limit) {
    const pending = await getPending();
    const job = pending.find((j) => !titleFetchInFlight.has(j.id));
    if (!job) break;

    titleFetchInFlight.add(job.id);

    processOneTitleJob(job)
      .catch(() => null)
      .finally(() => {
        titleFetchInFlight.delete(job.id);
        pumpTitleFetches().catch(() => {});
      });
  }
}

async function scheduleTitleFetchForWeakItems({
  onlyUnread = true,
  includeHistory = false,
  limit = 100
} = {}) {
  const { queue } = await getState();
  const jobs = [];
  for (const item of queue) {
    if (!item.url || !/^https?:\/\//i.test(item.url)) continue;
    const read = isRead(item);
    if (read && !includeHistory) continue;
    if (onlyUnread && read) continue;
    if (!isWeakTitle(item.title, item.url)) continue;
    jobs.push({ id: item.id, url: item.url });
    if (jobs.length >= limit) break;
  }
  await enqueuePendingJobs(jobs);
  ensureTitleAlarm();
  // Kick pump immediately (don't wait for alarm)
  pumpTitleFetches().catch(() => {});
  // Also schedule a near-term alarm wake in case SW sleeps mid-run
  try {
    chrome.alarms.create('rq-title-pump-soon', { delayInMinutes: 0.05 });
  } catch {
    // ignore
  }
  return jobs.length;
}

function ensureTitleAlarm() {
  chrome.alarms.create(ALARM_TITLE_PUMP, { periodInMinutes: 1 });
}

async function scrapeLinkTitleFromTab(tabId, linkUrl) {
  if (tabId == null || !linkUrl) return null;
  try {
    const results = await safeExecuteScript({
      target: { tabId },
      func: (targetUrl) => {
        function norm(href) {
          try {
            const u = new URL(href, location.href);
            u.hash = '';
            return u.href;
          } catch {
            return href;
          }
        }
        function ytId(href) {
          try {
            const u = new URL(href, location.href);
            const h = u.hostname.replace(/^www\./, '').toLowerCase();
            if (h === 'youtu.be') {
              return (u.pathname.replace(/^\//, '').split('/')[0] || '').split(
                '?'
              )[0];
            }
            if (
              h === 'youtube.com' ||
              h === 'm.youtube.com' ||
              h === 'music.youtube.com' ||
              h.endsWith('.youtube.com')
            ) {
              if (u.pathname.startsWith('/shorts/'))
                return u.pathname.split('/')[2] || '';
              if (u.pathname.startsWith('/embed/'))
                return u.pathname.split('/')[2] || '';
              if (u.pathname.startsWith('/live/'))
                return u.pathname.split('/')[2] || '';
              return u.searchParams.get('v') || '';
            }
          } catch (_) {}
          return '';
        }
        function pickText(a) {
          const titleEl =
            (a.id === 'video-title' ? a : null) ||
            a.querySelector('#video-title') ||
            a.querySelector('yt-formatted-string#video-title');
          const candidates = [];
          if (titleEl) {
            candidates.push(titleEl.getAttribute('title'));
            candidates.push(titleEl.getAttribute('aria-label'));
            candidates.push(titleEl.textContent);
          }
          candidates.push(a.getAttribute('title'));
          candidates.push(a.getAttribute('aria-label'));
          const direct = String(a.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
          // Cap whole-card dumps; prefer short visible title text
          if (direct && direct.length <= 200) candidates.push(direct);
          for (const c of candidates) {
            const text = String(c || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 200);
            if (text) return text;
          }
          return '';
        }
        const want = norm(targetUrl);
        const wantId = ytId(targetUrl);
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        let best = '';
        let bestScore = -1;
        for (const a of anchors) {
          const href = a.href || a.getAttribute('href') || '';
          const same =
            norm(href) === want || (wantId && ytId(href) && ytId(href) === wantId);
          if (!same) continue;
          const text = pickText(a);
          if (!text) continue;
          let score = Math.min(text.length, 200);
          if (a.id === 'video-title' || a.querySelector('#video-title'))
            score += 1000;
          if (a.getAttribute('aria-label')) score += 50;
          if (score > bestScore) {
            bestScore = score;
            best = text;
          }
        }
        return best || null;
      },
      args: [linkUrl]
    });
    const value = results && results[0] && results[0].result;
    if (value && typeof value === 'string') {
      const cleaned = cleanPageTitle(value, linkUrl);
      if (cleaned) return cleaned;
      const s = String(value).replace(/\s+/g, ' ').trim().slice(0, 200);
      if (s && !looksLikeUrl(s) && !isWeakTitle(s, linkUrl)) return s;
    }
  } catch {
    // 页面不可读，或其它意外失败。标签已关时 safeExecuteScript 返回 null。
  }
  return null;
}

function titleFromCandidate(raw, linkUrl) {
  if (!raw) return null;
  const cleaned = cleanPageTitle(raw, linkUrl);
  if (cleaned) return cleaned;
  const s = String(raw).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (s && s.length >= 2 && !looksLikeUrl(s) && !isWeakTitle(s, linkUrl)) return s;
  return null;
}

async function resolveLinkTitle({ linkUrl, tab, linkText, selectionText }) {
  // 1) Visible link text Chrome exposes on right-click (card title on YouTube)
  const fromLinkText = titleFromCandidate(linkText, linkUrl);
  if (fromLinkText) return fromLinkText;

  // 2) Scrape matching <a> on the page (video id aware)
  if (tab && tab.id != null) {
    const scraped = await scrapeLinkTitleFromTab(tab.id, linkUrl);
    if (scraped) return scraped;
  }

  // 3) Selected text as last human-visible hint
  const fromSel = titleFromCandidate(selectionText, linkUrl);
  if (fromSel) return fromSel;

  return fallbackTitleFromUrl(linkUrl);
}

async function enqueue({ url, title, fetchTitle = true }) {
  const clean = normalizeUrl(url);
  if (!clean || !/^https?:\/\//i.test(clean)) {
    return { ok: false, reason: 'invalid' };
  }
  let { queue } = await getState();

  const unreadDup = queue.find(
    (item) => !isRead(item) && normalizeUrl(item.url) === clean
  );
  if (unreadDup) {
    await flashBadge('=');
    return { ok: false, reason: 'duplicate' };
  }

  queue = queue.filter(
    (item) => !(isRead(item) && normalizeUrl(item.url) === clean)
  );

  if (queue.length >= SOFT_MAX_QUEUE) {
    const trimmed = makeRoom(queue, 1);
    if (!trimmed) {
      await flashBadge('MAX');
      return { ok: false, reason: 'full', max: SOFT_MAX_QUEUE };
    }
    queue = trimmed;
  }

  let resolved = (title && String(title).trim()) || '';
  if (resolved) {
    const cleaned = cleanPageTitle(resolved, clean);
    if (cleaned) {
      resolved = cleaned;
    } else if (looksLikeUrl(resolved) || isWeakTitle(resolved, clean)) {
      resolved = fallbackTitleFromUrl(clean);
    } else {
      resolved = resolved.slice(0, 200);
    }
  } else {
    resolved = fallbackTitleFromUrl(clean);
  }

  const item = {
    id: uid(),
    url: clean,
    title: resolved,
    addedAt: Date.now(),
    read: false,
    starred: false
  };

  // Storage: append among unread (before history) so unread stays oldest→newest in array.
  // Popup shows newest-first via sortQueueForDisplay; openNext uses findOldestUnread.
  const firstHist = queue.findIndex((i) => isRead(i));
  const next =
    firstHist < 0
      ? [...queue, item]
      : [...queue.slice(0, firstHist), item, ...queue.slice(firstHist)];

  await setQueue(next);

  // Strong on-page title → skip network refetch
  const needsFetch = fetchTitle && isWeakTitle(item.title, item.url);
  if (needsFetch) {
    await enqueuePendingJobs([{ id: item.id, url: item.url }]);
    ensureTitleAlarm();
    pumpTitleFetches().catch(() => {});
  }

  return { ok: true, item, length: next.length, unread: unreadCount(next) };
}

async function openItemById(itemId, { force = true } = {}) {
  await syncActiveFromStorage();
  const { queue, maxActiveTabs } = await getState();
  const idx = queue.findIndex((i) => i.id === itemId);
  if (idx < 0) return { ok: false, reason: 'not_found' };
  if (!force && activeTabIds.size >= maxActiveTabs) {
    return {
      ok: false,
      reason: 'at_max',
      active: activeTabIds.size,
      max: maxActiveTabs
    };
  }

  const item = queue[idx];
  const remaining = [...queue.slice(0, idx), ...queue.slice(idx + 1)];
  const marked = {
    ...item,
    read: true,
    openedAt: Date.now()
  };
  const nextQueue = [...remaining, marked];
  await setQueue(nextQueue);

  try {
    const tab = await chrome.tabs.create({ url: item.url, active: true });
    const ids = new Set(activeTabIds);
    ids.add(tab.id);
    await setActiveIds(ids);
    return {
      ok: true,
      tabId: tab.id,
      item: marked,
      remainingUnread: unreadCount(nextQueue)
    };
  } catch (err) {
    await setQueue(queue);
    return { ok: false, reason: 'create_failed', error: String(err) };
  }
}

async function openNext({ force = false } = {}) {
  const { queue } = await getState();
  // FIFO: oldest unread by addedAt (not top-of-popup / newest).
  const oldest = findOldestUnread(queue);
  if (!oldest) return { ok: false, reason: 'empty' };
  return openItemById(oldest.id, { force });
}

/**
 * Delete only the items the named popup tab is showing.
 * starred: unread + starred. history: every read item (former clearHistory).
 * Any other view, including unread, is refused and does not touch storage.
 */
async function clearCurrentView(view) {
  if (view !== 'starred' && view !== 'history') {
    return { ok: false, reason: 'bad_view' };
  }
  const { queue } = await getState();
  const drop =
    view === 'history'
      ? (item) => isRead(item)
      : (item) => Boolean(item && item.starred) && !isRead(item);
  const removedIds = new Set();
  const next = [];
  for (const item of queue) {
    if (drop(item)) removedIds.add(item.id);
    else next.push(item);
  }
  await setQueue(next);
  if (removedIds.size) {
    const pending = await getPending();
    await setPending(pending.filter((job) => !removedIds.has(job.id)));
  }
  return {
    ok: true,
    view,
    removed: removedIds.size,
    unread: unreadCount(next),
    history: next.filter(isRead).length,
    starred: starredCount(next)
  };
}

async function fillToMax() {
  await syncActiveFromStorage();
  const results = [];
  while (true) {
    const state = await getState();
    if (unreadCount(state.queue) === 0) break;
    if (activeTabIds.size >= state.maxActiveTabs) break;
    const r = await openNext({ force: false });
    results.push(r);
    if (!r.ok) break;
  }
  return { ok: true, opened: results.filter((r) => r.ok).length };
}

function ensureContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'rq-add-link',
      title: '将此链接加入到阅读队列',
      contexts: ['link']
    });
    chrome.contextMenus.create({
      id: 'rq-add-page',
      title: '将当前页加入到阅读队列',
      contexts: ['page', 'frame']
    });
  });
}

function boot() {
  ensureContextMenus();
  ensureTitleAlarm();
  getState().then((s) => {
    updateBadge(unreadCount(s.queue)).catch(() => {});
    refreshIconsForQueue(s.queue).catch(() => {});
  });
  syncActiveFromStorage();
  pumpTitleFetches().catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  boot();
  chrome.storage.local.get(
    { [STORAGE_KEYS.maxActiveTabs]: DEFAULT_MAX_ACTIVE },
    (data) => {
      if (data[STORAGE_KEYS.maxActiveTabs] == null) {
        chrome.storage.local.set({
          [STORAGE_KEYS.maxActiveTabs]: DEFAULT_MAX_ACTIVE
        });
      }
    }
  );
});

chrome.runtime.onStartup.addListener(() => {
  boot();
});

chrome.tabs.onActivated.addListener((info) => {
  if (!info || info.tabId == null) return;
  syncTabQueueIcon(info.tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!shouldRefreshTabIcon(changeInfo)) return;
  const snapshot = tab && tab.id != null ? tab : { id: tabId };
  syncTabQueueIcon(snapshot).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes || !changes[STORAGE_KEYS.queue]) return;
  refreshIconsForQueue(changes[STORAGE_KEYS.queue].newValue).catch(() => {});
});

boot();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (
    alarm.name === ALARM_TITLE_PUMP ||
    alarm.name === 'rq-title-pump-soon'
  ) {
    pumpTitleFetches().catch(() => {});
  }
});

async function enqueueFromOpenTab(tab) {
  if (!tab || !tab.url) return { ok: false, reason: 'no-tab' };
  const url = tab.url;
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, reason: 'invalid' };
  }
  const title = cleanPageTitle(tab.title, url);
  const strong =
    Boolean(title) &&
    !looksLikeUrl(title) &&
    !isWeakTitle(title, url);
  return enqueue({ url, title, fetchTitle: !strong });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'rq-add-link') {
    const url = info.linkUrl;
    const title = await resolveLinkTitle({
      linkUrl: url,
      tab,
      linkText: info.linkText,
      selectionText: info.selectionText
    });
    const strong =
      Boolean(title) &&
      !looksLikeUrl(title) &&
      !isWeakTitle(title, url);
    await enqueue({ url, title, fetchTitle: !strong });
    return;
  }
  if (info.menuItemId === 'rq-add-page') {
    await enqueueFromOpenTab(tab);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  tabInUnreadIcon.delete(tabId);
  await syncActiveFromStorage();
  if (!activeTabIds.has(tabId)) return;
  const ids = new Set(activeTabIds);
  ids.delete(tabId);
  await setActiveIds(ids);

  const { queue, maxActiveTabs } = await getState();
  if (unreadCount(queue) > 0 && ids.size < maxActiveTabs) {
    await openNext({ force: false });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'getState': {
          await syncActiveFromStorage();
          const state = await getState();
          sendResponse({
            ok: true,
            // Newest-added first within unread, then history (see sortQueueForDisplay).
            queue: sortQueueForDisplay(state.queue),
            maxActiveTabs: state.maxActiveTabs,
            activeCount: activeTabIds.size,
            activeQueueTabIds: [...activeTabIds],
            softMax: SOFT_MAX_QUEUE,
            unread: unreadCount(state.queue),
            history: state.queue.filter(isRead).length,
            starred: starredCount(state.queue),
            pendingTitles: state.pendingTitleFetches.length,
            titleFetchDebug: state.titleFetchDebug
          });
          break;
        }
        case 'enqueue': {
          const r = await enqueue({
            url: message.url,
            title: message.title,
            fetchTitle: message.fetchTitle !== false
          });
          sendResponse(r);
          break;
        }
        case 'openNext': {
          const r = await openNext({ force: Boolean(message.force) });
          sendResponse(r);
          break;
        }
        case 'openItem': {
          const r = await openItemById(message.id, { force: true });
          sendResponse(r);
          break;
        }
        case 'fillToMax': {
          const r = await fillToMax();
          sendResponse(r);
          break;
        }
        case 'clearQueue': {
          await setQueue([]);
          await setPending([]);
          sendResponse({ ok: true });
          break;
        }
        case 'clearHistory': {
          sendResponse(await clearCurrentView('history'));
          break;
        }
        case 'clearCurrentView': {
          sendResponse(await clearCurrentView(message.view));
          break;
        }
        case 'markRead': {
          sendResponse(await setItemRead(message.id, true));
          break;
        }
        case 'markUnread': {
          sendResponse(await setItemRead(message.id, false));
          break;
        }
        case 'setRead': {
          sendResponse(await setItemRead(message.id, Boolean(message.read)));
          break;
        }
        case 'toggleStar': {
          const { queue } = await getState();
          const idx = queue.findIndex((i) => i.id === message.id);
          if (idx < 0) {
            sendResponse({ ok: false, reason: 'not_found' });
            break;
          }
          const next = [...queue];
          const cur = next[idx];
          next[idx] = { ...cur, starred: !Boolean(cur.starred) };
          await setQueue(next);
          sendResponse({
            ok: true,
            item: next[idx],
            starred: next[idx].starred,
            starredCount: starredCount(next)
          });
          break;
        }
        case 'removeItem': {
          const { queue } = await getState();
          await setQueue(queue.filter((i) => i.id !== message.id));
          await removePendingId(message.id);
          sendResponse({ ok: true });
          break;
        }
        case 'moveItem': {
          // Legacy adjacent swap (kept for compatibility). Prefer reorderItem.
          const { queue } = await getState();
          const id = message.id;
          const scope = reorderScope(queue, message);
          const display = sortQueueForDisplay(scope);
          const pos = display.findIndex((i) => i.id === id);
          if (pos < 0) {
            sendResponse({
              ok: false,
              reason:
                message.view === 'starred' || message.amongStarred
                  ? 'not_starred'
                  : 'not_found'
            });
            break;
          }
          const dir = message.direction === 'up' ? -1 : 1;
          const npos = pos + dir;
          if (npos < 0 || npos >= display.length) {
            sendResponse({ ok: true, queue: sortQueueForDisplay(queue) });
            break;
          }
          const a = display[pos];
          const b = display[npos];
          if (isRead(a) !== isRead(b)) {
            sendResponse({ ok: true, queue: sortQueueForDisplay(queue) });
            break;
          }
          const aAt = itemAddedAt(a);
          const bAt = itemAddedAt(b);
          const next = queue.map((item) => {
            if (item.id === a.id) return { ...item, addedAt: bAt };
            if (item.id === b.id) return { ...item, addedAt: aAt };
            return item;
          });
          await setQueue(next);
          sendResponse({ ok: true, queue: sortQueueForDisplay(next) });
          break;
        }
        case 'reorderItem': {
          // Drag-drop: place id at toIndex in the visible tab list.
          // view unread|starred|history scopes to that tab; still refuses
          // to cross read-groups if a legacy full-queue scope is used.
          // Reassigns that group's addedAt newest-first so display + FIFO stay consistent.
          const { queue } = await getState();
          const id = message.id;
          const scope = reorderScope(queue, message);
          const display = sortQueueForDisplay(scope);
          const from = display.findIndex((i) => i.id === id);
          if (from < 0) {
            sendResponse({
              ok: false,
              reason:
                message.view === 'starred' || message.amongStarred
                  ? 'not_starred'
                  : 'not_found'
            });
            break;
          }
          let to = Number(message.toIndex);
          if (!Number.isFinite(to)) {
            sendResponse({ ok: false, reason: 'bad_index' });
            break;
          }
          to = Math.max(0, Math.min(display.length - 1, Math.round(to)));
          const moved = display[from];
          const sameGroup = (i) => isRead(i) === isRead(moved);
          const group = display.filter(sameGroup);
          const groupIndices = [];
          for (let i = 0; i < display.length; i++) {
            if (sameGroup(display[i])) groupIndices.push(i);
          }
          const fromG = group.findIndex((i) => i.id === id);
          const gMin = groupIndices[0];
          const gMax = groupIndices[groupIndices.length - 1];
          const clampedTo = Math.max(gMin, Math.min(gMax, to));
          let toG = groupIndices.indexOf(clampedTo);
          if (toG < 0) toG = fromG;
          if (fromG === toG) {
            sendResponse({ ok: true, queue: sortQueueForDisplay(queue) });
            break;
          }
          const newGroup = group.slice();
          const [spliced] = newGroup.splice(fromG, 1);
          newGroup.splice(toG, 0, spliced);
          const stamps = newGroup.map((i) => itemAddedAt(i)).sort((a, b) => b - a);
          for (let i = 1; i < stamps.length; i++) {
            if (stamps[i] >= stamps[i - 1]) stamps[i] = stamps[i - 1] - 1;
          }
          const atById = new Map();
          newGroup.forEach((item, idx) => atById.set(item.id, stamps[idx]));
          const next = queue.map((item) => {
            if (!atById.has(item.id)) return item;
            return { ...item, addedAt: atById.get(item.id) };
          });
          await setQueue(next);
          sendResponse({ ok: true, queue: sortQueueForDisplay(next) });
          break;
        }
        case 'setMaxActiveTabs': {
          let n = Number(message.value);
          if (!Number.isFinite(n)) n = DEFAULT_MAX_ACTIVE;
          n = Math.min(5, Math.max(1, Math.round(n)));
          await chrome.storage.local.set({ [STORAGE_KEYS.maxActiveTabs]: n });
          sendResponse({ ok: true, maxActiveTabs: n });
          break;
        }
        case 'refetchWeakTitles': {
          const n = await scheduleTitleFetchForWeakItems({
            onlyUnread: true,
            includeHistory: Boolean(message.includeHistory),
            limit: message.limit || 100
          });
          sendResponse({ ok: true, scheduled: n });
          break;
        }
        case 'pumpTitles': {
          pumpTitleFetches().catch(() => {});
          sendResponse({ ok: true });
          break;
        }
        case 'fillTitlesFromOpenTabs': {
          const r = await fillTitlesFromOpenTabs({
            onlyWeak: message.onlyWeak !== false,
            includeHistory: Boolean(message.includeHistory)
          });
          sendResponse(r);
          break;
        }
        default:
          sendResponse({ ok: false, reason: 'unknown' });
      }
    } catch (err) {
      sendResponse({ ok: false, reason: 'error', error: String(err) });
    }
  })();
  return true;
});
