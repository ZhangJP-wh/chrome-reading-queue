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
  // Keep tip short; tip about CN / no tab steal sits in status when weak titles remain
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
        // One more refresh so status can show lastRawTitle / error after jobs drain
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
  const pending = pendingTitles || 0;
  let status = `未读 ${u} · 历史 ${h} · ${queue.length}/${cap} · 已开 ${activeCount}/${maxActiveTabs}`;
  if (pending > 0) status += ` · 正在抓取标题 ${pending}`;
  const unreadWeak = queue.filter((i) => !i.read && looksWeakTitle(i));
  if (pending === 0 && unreadWeak.length > 0) {
    const hint = formatDebugHint(state.titleFetchDebug);
    if (hint) {
      status += ` · ${hint}`;
      status += ' · 网络取标题失败（国内常见）；不会再自动开标签页';
    } else {
      status += ` · ${unreadWeak.length} 条标题仍弱（可点补全，或「从已打开标签补标题」）`;
    }
  }
  $('statusLine').textContent = status;

  const list = $('queueList');
  const empty = $('emptyHint');
  list.innerHTML = '';

  if (!queue.length) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
  }

  queue.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'item' + (item.read ? ' history' : '');
    li.dataset.id = item.id;
    li.dataset.url = item.url;
    li.title = '点击打开为当前标签页';

    const title = displayTitle(item);
    li.innerHTML = `
      <div class="item-main">
        <p class="title" title="${escapeHtml(title)}">${escapeHtml(title)}</p>
        <div class="url-row">
          <p class="url" title="${escapeHtml(item.url)}">${escapeHtml(shortUrl(item.url))}</p>
          <button type="button" class="copy-btn" data-act="copy" title="复制完整链接">复制</button>
        </div>
      </div>
      <div class="item-actions">
        <button type="button" class="icon-btn" data-act="up" title="上移" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-btn" data-act="down" title="下移" ${index === queue.length - 1 ? 'disabled' : ''}>↓</button>
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
  refresh().then(() => {
    send('refetchWeakTitles', { limit: 50 }).then(() => startTitlePoll(60));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.queue || changes.pendingTitleFetches)) {
      refresh();
    }
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

  $('btnFromOpenTabs').addEventListener('click', async () => {
    $('statusLine').textContent = '正在从已打开标签读取标题…';
    $('btnFromOpenTabs').disabled = true;
    const r = await send('fillTitlesFromOpenTabs', {
      onlyWeak: true,
      includeHistory: false
    });
    $('btnFromOpenTabs').disabled = false;
    if (r && r.ok) {
      $('statusLine').textContent = `已从打开标签更新 ${r.updated || 0} 条（匹配 ${r.checked || 0}/${r.openTabs || 0} 个标签）`;
    } else {
      $('statusLine').textContent = '从已打开标签补标题失败';
    }
    await refresh();
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
      if (act === 'up') await send('moveItem', { id, direction: 'up' });
      if (act === 'down') await send('moveItem', { id, direction: 'down' });
      if (act === 'del') await send('removeItem', { id });
      await refresh();
      return;
    }

    const id = item.dataset.id;
    await send('openItem', { id });
    try {
      await refresh();
    } catch {
      // popup closed
    }
  });
});
