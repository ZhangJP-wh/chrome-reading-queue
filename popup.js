function $(id) {
  return document.getElementById(id);
}

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    let path = u.pathname || '';
    if (path.length > 32) path = path.slice(0, 29) + '…';
    return u.host + path + (u.search ? '…' : '');
  } catch {
    return url;
  }
}

function displayTitle(item) {
  const t = (item.title && String(item.title).trim()) || '';
  if (t && !/^https?:\/\//i.test(t)) return t;
  try {
    const u = new URL(item.url);
    const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
    const snippet = path.length > 40 ? path.slice(0, 37) + '…' : path;
    return u.hostname + snippet;
  } catch {
    return item.url;
  }
}

function looksWeakTitle(item) {
  const t = (item.title && String(item.title).trim()) || '';
  if (!t) return true;
  if (/^https?:\/\//i.test(t)) return true;
  try {
    const u = new URL(item.url);
    const host = u.hostname;
    const hostBare = host.replace(/^www\./, '');
    if (t === host || t === u.host || t === hostBare) return true;
    if (t === host + u.pathname || t === host + '/watch') return true;
    if (
      t === 'www.youtube.com/watch' ||
      t === 'youtube.com/watch' ||
      t === hostBare + '/watch'
    ) {
      return true;
    }
    if (t.startsWith(host + '/') || t.startsWith(hostBare + '/')) {
      const rest = t.startsWith(host) ? t.slice(host.length) : t.slice(hostBare.length);
      const base = rest.split('…')[0];
      if (/^\/(watch|shorts|live|embed)\/?$/.test(base)) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function formatDebugHint(debug) {
  if (!Array.isArray(debug) || !debug.length) return '';
  const d = debug[0];
  const raw = (d.lastRawTitle && String(d.lastRawTitle).trim()) || '';
  const err = (d.error && String(d.error).trim()) || '';
  const stage = (d.stage && String(d.stage).trim()) || '';
  let tip = '';
  if (raw) tip = `调试: 读到「${raw.slice(0, 36)}${raw.length > 36 ? '…' : ''}」未采用`;
  else if (err) tip = `调试: ${err.slice(0, 55)}`;
  else if (stage) tip = `调试: ${stage.slice(0, 40)}`;
  if (!tip) return '';
  return tip;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

let pollTimer = null;
/** @type {'all' | 'starred'} */
let currentView = 'all';

function setView(view) {
  currentView = view === 'starred' ? 'starred' : 'all';
  const tabAll = $('tabAll');
  const tabStarred = $('tabStarred');
  const isStarred = currentView === 'starred';
  tabAll.classList.toggle('active', !isStarred);
  tabStarred.classList.toggle('active', isStarred);
  tabAll.setAttribute('aria-selected', String(!isStarred));
  tabStarred.setAttribute('aria-selected', String(isStarred));
}

function startTitlePoll(seconds = 90) {
  if (pollTimer) clearInterval(pollTimer);
  let n = 0;
  const max = Math.ceil(seconds);
  pollTimer = setInterval(async () => {
    n += 1;
    try {
      await send('pumpTitles');
      await refresh();
      const st = await send('getState');
      const pendingLeft = st && st.pendingTitles ? st.pendingTitles : 0;
      if (!st || pendingLeft === 0 || n >= max) {
        clearInterval(pollTimer);
        pollTimer = null;
        await refresh();
      }
    } catch {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, 1000);
}

async function refresh() {
  const state = await send('getState');
  if (!state || !state.ok) {
    $('statusLine').textContent = '无法读取队列状态';
    return;
  }

  const { queue, maxActiveTabs, activeCount, softMax, unread, history, pendingTitles } =
    state;
  $('maxActive').value = String(maxActiveTabs);
  const cap = softMax || 500;
  const u = unread != null ? unread : queue.filter((i) => !i.read).length;
  const h = history != null ? history : queue.filter((i) => i.read).length;
  const starredTotal =
    state.starred != null ? state.starred : queue.filter((i) => i.starred).length;
  const pending = pendingTitles || 0;
  let status = `未读 ${u} · 历史 ${h} · ${queue.length}/${cap} · 已开 ${activeCount}/${maxActiveTabs}`;
  if (starredTotal > 0) status += ` · 星标 ${starredTotal}`;
  if (pending > 0) status += ` · 正在抓取标题 ${pending}`;
  const unreadWeak = queue.filter((i) => !i.read && looksWeakTitle(i));
  if (pending === 0 && unreadWeak.length > 0) {
    const hint = formatDebugHint(state.titleFetchDebug);
    if (hint) {
      status += ` · ${hint}`;
      status += ' · 网络取标题失败（国内常见）；不会再自动开标签页';
    } else {
      status += ` · ${unreadWeak.length} 条标题仍弱（可点「补全标题」）`;
    }
  }
  $('statusLine').textContent = status;

  function setBadge(el, n) {
    if (!el) return;
    if (n > 0) {
      el.textContent = String(n > 99 ? '99+' : n);
      el.classList.remove('hidden');
    } else {
      el.textContent = '';
      el.classList.add('hidden');
    }
  }
  setBadge($('allCountBadge'), queue.length);
  setBadge($('starredCountBadge'), starredTotal);

  // getState already returns display order: newest addedAt first within unread, then history.
  const visible =
    currentView === 'starred' ? queue.filter((i) => i.starred) : queue;

  const list = $('queueList');
  const empty = $('emptyHint');
  list.innerHTML = '';

  if (!visible.length) {
    empty.classList.remove('hidden');
    empty.textContent =
      currentView === 'starred'
        ? '还没有星标条目。点卡片左侧 ★ 即可收藏到星标队列。'
        : '队列是空的。在链接上右键 →「加入阅读队列」。点击条目可打开为当前标签。';
  } else {
    empty.classList.add('hidden');
  }

  visible.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'item' + (item.read ? ' history' : '');
    li.dataset.id = item.id;
    li.dataset.url = item.url;
    li.title = '点击打开为当前标签页';

    const title = displayTitle(item);
    const lit = Boolean(item.starred);
    li.innerHTML = `
      <div class="item-main">
        <div class="title-row">
          <button type="button" class="star-btn${lit ? ' lit' : ''}" data-act="star"
            title="${lit ? '取消星标' : '加星标'}" aria-label="${lit ? '取消星标' : '加星标'}"
            aria-pressed="${lit ? 'true' : 'false'}">${lit ? '★' : '☆'}</button>
          <p class="title" title="${escapeHtml(title)}">${escapeHtml(title)}</p>
        </div>
        <div class="url-row">
          <p class="url" title="${escapeHtml(item.url)}">${escapeHtml(shortUrl(item.url))}</p>
          <button type="button" class="copy-btn" data-act="copy" title="复制完整链接">复制链接</button>
        </div>
      </div>
      <div class="item-actions">
        <button type="button" class="drag-handle" data-act="drag" title="拖动排序"
          aria-label="拖动排序">
          <span class="grip" aria-hidden="true"></span>
        </button>
        <button type="button" class="icon-btn delete" data-act="del" title="删除">×</button>
      </div>
    `;
    list.appendChild(li);
  });

  $('btnOpenNext').disabled = u === 0;
  $('btnFill').disabled = u === 0 || activeCount >= maxActiveTabs;
  $('btnClearHistory').disabled = h === 0;
  $('btnClear').disabled = queue.length === 0;
}

document.addEventListener('DOMContentLoaded', () => {
  let isDragging = false;

  setView('all');
  refresh().then(() => {
    send('refetchWeakTitles', { limit: 50 }).then(() => startTitlePoll(60));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (isDragging) return;
    if (area === 'local' && (changes.queue || changes.pendingTitleFetches)) {
      refresh();
    }
  });

  $('tabAll').addEventListener('click', async () => {
    setView('all');
    await refresh();
  });

  $('tabStarred').addEventListener('click', async () => {
    setView('starred');
    await refresh();
  });

  $('btnOpenNext').addEventListener('click', async () => {
    await send('openNext', { force: true });
    await refresh();
  });

  $('btnFill').addEventListener('click', async () => {
    await send('fillToMax');
    await refresh();
  });

  $('btnRefetchTitles').addEventListener('click', async () => {
    $('statusLine').textContent = '正在网络抓取标题…';
    $('btnRefetchTitles').disabled = true;
    const r = await send('refetchWeakTitles', {
      limit: 100,
      includeHistory: false
    });
    $('btnRefetchTitles').disabled = false;
    if (r && r.ok) {
      $('statusLine').textContent = `正在静默抓取…已安排 ${r.scheduled || 0} 条（不开标签页）`;
    } else {
      $('statusLine').textContent = '补全标题失败';
    }
    startTitlePoll(90);
  });


  $('btnClearHistory').addEventListener('click', async () => {
    if (!confirm('确定清空历史记录？（未读条目会保留）')) return;
    await send('clearHistory');
    await refresh();
  });

  $('btnClear').addEventListener('click', async () => {
    if (!confirm('确定清空全部队列（未读 + 历史）？')) return;
    await send('clearQueue');
    await refresh();
  });

  $('maxActive').addEventListener('change', async (e) => {
    const value = Number(e.target.value);
    await send('setMaxActiveTabs', { value });
    await refresh();
  });

  $('queueList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    const item = e.target.closest('.item');
    if (!item) return;

    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const id = item.dataset.id;
      const act = btn.dataset.act;

      if (act === 'star') {
        await send('toggleStar', { id });
        await refresh();
        return;
      }
      if (act === 'copy') {
        const ok = await copyText(item.dataset.url || '');
        const prev = btn.textContent;
        btn.textContent = ok ? '已复制' : '失败';
        btn.classList.toggle('copied', ok);
        setTimeout(() => {
          btn.textContent = prev;
          btn.classList.remove('copied');
        }, 1000);
        return;
      }
      if (act === 'drag') {
        // Drag handle: reordering via drag events, not click.
        return;
      }
      if (act === 'del') await send('removeItem', { id });
      await refresh();
      return;
    }

    if (justDragged) return;
    const id = item.dataset.id;
    await send('openItem', { id });
    try {
      await refresh();
    } catch {
      // popup closed
    }
  });

  // --- Pointer drag reorder (custom ghost + blue insert line) ---
  let dragId = null;
  let dragFromIndex = -1;
  let insertBeforeIndex = -1;
  let justDragged = false;
  let ghostEl = null;
  let grabOffsetX = 0;
  let grabOffsetY = 0;
  let activePointerId = null;

  function listItems() {
    return [...$('queueList').querySelectorAll('.item')];
  }

  function clearDropMarkers() {
    $('queueList').querySelectorAll('.item.drop-before, .item.drop-after').forEach((el) => {
      el.classList.remove('drop-before', 'drop-after');
    });
  }

  function updateDropMarkers(insertBefore, items) {
    clearDropMarkers();
    if (!items.length) return;
    if (insertBefore <= 0) {
      items[0].classList.add('drop-before');
    } else if (insertBefore >= items.length) {
      items[items.length - 1].classList.add('drop-after');
    } else {
      items[insertBefore].classList.add('drop-before');
    }
  }

  function computeInsertBefore(clientY, items) {
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return items.length;
  }

  function placeGhost(clientX, clientY) {
    if (!ghostEl) return;
    ghostEl.style.left = `${Math.round(clientX - grabOffsetX)}px`;
    ghostEl.style.top = `${Math.round(clientY - grabOffsetY)}px`;
  }

  function endDragCleanup() {
    clearDropMarkers();
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }
    $('queueList').querySelectorAll('.item.dragging').forEach((el) => {
      el.classList.remove('dragging');
    });
    document.body.classList.remove('is-reordering');
    isDragging = false;
    dragId = null;
    dragFromIndex = -1;
    insertBeforeIndex = -1;
    activePointerId = null;
  }

  $('queueList').addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const item = handle.closest('.item');
    if (!item || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const items = listItems();
    dragId = item.dataset.id;
    dragFromIndex = items.indexOf(item);
    insertBeforeIndex = dragFromIndex;
    isDragging = true;
    justDragged = false;
    activePointerId = e.pointerId;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const itemRect = item.getBoundingClientRect();
    // Keep the grab point (☰ under the cursor) glued to the pointer.
    grabOffsetX = e.clientX - itemRect.left;
    grabOffsetY = e.clientY - itemRect.top;

    ghostEl = item.cloneNode(true);
    ghostEl.classList.add('drag-ghost');
    ghostEl.classList.remove('dragging', 'drop-before', 'drop-after');
    ghostEl.style.width = `${itemRect.width}px`;
    document.body.appendChild(ghostEl);
    placeGhost(e.clientX, e.clientY);

    item.classList.add('dragging');
    document.body.classList.add('is-reordering');
    updateDropMarkers(insertBeforeIndex, items);
  });

  $('queueList').addEventListener('pointermove', (e) => {
    if (!isDragging || e.pointerId !== activePointerId) return;
    e.preventDefault();
    placeGhost(e.clientX, e.clientY);
    const items = listItems();
    insertBeforeIndex = computeInsertBefore(e.clientY, items);
    updateDropMarkers(insertBeforeIndex, items);
  });

  async function finishDrag(e) {
    if (!isDragging) return;
    if (e && activePointerId != null && e.pointerId !== activePointerId) return;

    const sourceId = dragId;
    const from = dragFromIndex;
    const items = listItems();
    let insertBefore = insertBeforeIndex;
    if (e && typeof e.clientY === 'number') {
      insertBefore = computeInsertBefore(e.clientY, items);
    }
    const toIndex = insertBefore > from ? insertBefore - 1 : insertBefore;

    endDragCleanup();
    justDragged = true;
    setTimeout(() => {
      justDragged = false;
    }, 50);

    if (!sourceId || from < 0 || toIndex < 0 || from === toIndex) {
      try {
        await refresh();
      } catch {
        // popup closed
      }
      return;
    }
    await send('reorderItem', {
      id: sourceId,
      toIndex,
      amongStarred: currentView === 'starred'
    });
    try {
      await refresh();
    } catch {
      // popup closed
    }
  }

  $('queueList').addEventListener('pointerup', (e) => {
    finishDrag(e);
  });

  $('queueList').addEventListener('pointercancel', (e) => {
    if (!isDragging || e.pointerId !== activePointerId) return;
    endDragCleanup();
    justDragged = true;
    setTimeout(() => {
      justDragged = false;
    }, 50);
    refresh();
  });

});
