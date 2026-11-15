/**
 * Stand-in for chrome://extensions (this VM cannot load the MV3 extension).
 *
 * Proves two things:
 * 1. The harness reproduces the overlapping removeAll + create race and records
 *    Unchecked runtime.lastError when a duplicate id is created with no callback
 *    that synchronously reads chrome.runtime.lastError.
 * 2. Loading background.js and firing the three boot paths together (service
 *    worker start, onInstalled, onStartup) leaves no unchecked error, does not
 *    attempt a duplicate id, and ends with exactly the two live menu items.
 *
 * Run: node test/context-menus.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LINK_TITLE = '将此链接加入到阅读队列';
const PAGE_TITLE = '将当前页加入到阅读队列';

function createChrome() {
  const unchecked = [];
  const unobserved = [];
  const duplicateAttempts = [];
  const menus = new Map();
  const listeners = {
    onInstalled: [],
    onStartup: []
  };

  let pendingError = null;
  let readCount = 0;
  const queue = [];
  let flushScheduled = false;

  function later(fn) {
    queue.push(fn);
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(() => {
        flushScheduled = false;
        const batch = queue.splice(0, queue.length);
        for (const fn of batch) fn();
      });
    }
  }

  function settle(cb) {
    const readsBefore = readCount;
    const err = pendingError;
    try {
      if (typeof cb === 'function') cb();
    } finally {
      const observed = readCount > readsBefore;
      if (!observed) {
        unobserved.push(err ? err.message : 'no-error');
        if (err) {
          unchecked.push('Unchecked runtime.lastError: ' + err.message);
        }
      }
      pendingError = null;
    }
  }

  const chrome = {
    runtime: {
      onInstalled: {
        addListener(fn) {
          listeners.onInstalled.push(fn);
        }
      },
      onStartup: {
        addListener(fn) {
          listeners.onStartup.push(fn);
        }
      },
      onMessage: { addListener() {} },
      get lastError() {
        readCount += 1;
        return pendingError || undefined;
      }
    },
    contextMenus: {
      onClicked: { addListener() {} },
      removeAll(cb) {
        later(() => {
          menus.clear();
          later(() => settle(cb));
        });
      },
      create(props, cb) {
        later(() => {
          if (menus.has(props.id)) {
            duplicateAttempts.push(props.id);
            pendingError = {
              message: 'Cannot create item with duplicate id ' + props.id
            };
            settle(cb);
            return;
          }
          menus.set(props.id, {
            id: props.id,
            title: props.title,
            contexts: props.contexts.slice()
          });
          pendingError = null;
          settle(cb);
        });
        return props.id;
      }
    },
    storage: {
      local: {
        get(defaults, cb) {
          const result = Object.assign({}, defaults);
          if (typeof cb === 'function') {
            later(() => cb(result));
            return;
          }
          return Promise.resolve(result);
        },
        set(_items, cb) {
          if (typeof cb === 'function') {
            later(() => cb());
            return;
          }
          return Promise.resolve();
        }
      },
      onChanged: { addListener() {} }
    },
    action: {
      setBadgeText() {
        return Promise.resolve();
      },
      setBadgeBackgroundColor() {
        return Promise.resolve();
      },
      setIcon(_details, cb) {
        if (typeof cb === 'function') later(() => settle(cb));
        return Promise.resolve();
      }
    },
    tabs: {
      query() {
        return Promise.resolve([]);
      },
      get(_id, cb) {
        if (typeof cb === 'function') {
          pendingError = { message: 'No tab with id' };
          later(() => settle(cb));
        }
        return Promise.resolve();
      },
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
      create() {
        return Promise.resolve({ id: 1 });
      }
    },
    alarms: {
      create() {},
      onAlarm: { addListener() {} }
    },
    scripting: {
      executeScript(_details, cb) {
        if (typeof cb === 'function') later(() => settle(cb));
        return Promise.resolve([]);
      }
    }
  };

  return { chrome, unchecked, unobserved, duplicateAttempts, menus, listeners };
}

function drain() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function settleTasks() {
  for (let i = 0; i < 20; i++) await drain();
}

function fire(list) {
  for (const fn of list) fn();
}

async function testHarnessSeesTheRace() {
  const env = createChrome();
  function ensureOld() {
    env.chrome.contextMenus.removeAll(() => {
      env.chrome.contextMenus.create({
        id: 'rq-add-link',
        title: LINK_TITLE,
        contexts: ['link']
      });
      env.chrome.contextMenus.create({
        id: 'rq-add-page',
        title: PAGE_TITLE,
        contexts: ['page', 'frame']
      });
    });
  }
  ensureOld();
  ensureOld();
  ensureOld();
  await settleTasks();

  assert.ok(
    env.unchecked.some((line) => line.includes('rq-add-link')),
    'harness should record unchecked duplicate rq-add-link, got ' +
      JSON.stringify(env.unchecked)
  );
  assert.ok(
    env.unchecked.some((line) => line.includes('rq-add-page')),
    'harness should record unchecked duplicate rq-add-page, got ' +
      JSON.stringify(env.unchecked)
  );
  assert.ok(env.duplicateAttempts.includes('rq-add-link'));
  assert.ok(env.duplicateAttempts.includes('rq-add-page'));
  assert.strictEqual(env.menus.size, 2);
}

async function testOverlappingBootStaysSilent() {
  const env = createChrome();
  env.menus.set('rq-add-link', {
    id: 'rq-add-link',
    title: 'stale-link',
    contexts: ['all']
  });
  env.menus.set('rq-add-page', {
    id: 'rq-add-page',
    title: 'stale-page',
    contexts: ['all']
  });

  global.chrome = env.chrome;
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'background.js'),
    'utf8'
  );
  vm.runInThisContext(source, { filename: 'background.js' });

  fire(env.listeners.onInstalled);
  fire(env.listeners.onStartup);
  await drain();
  fire(env.listeners.onStartup);
  fire(env.listeners.onInstalled);
  await settleTasks();

  assert.deepStrictEqual(
    env.unchecked,
    [],
    'overlapping boot left Unchecked runtime.lastError: ' +
      JSON.stringify(env.unchecked)
  );
  assert.deepStrictEqual(
    env.unobserved,
    [],
    'contextMenus calls must synchronously read runtime.lastError: ' +
      JSON.stringify(env.unobserved)
  );
  assert.deepStrictEqual(
    env.duplicateAttempts,
    [],
    'overlapping registration still tried duplicate ids: ' +
      JSON.stringify(env.duplicateAttempts)
  );
  assert.strictEqual(env.menus.size, 2);
  assert.deepStrictEqual(env.menus.get('rq-add-link'), {
    id: 'rq-add-link',
    title: LINK_TITLE,
    contexts: ['link']
  });
  assert.deepStrictEqual(env.menus.get('rq-add-page'), {
    id: 'rq-add-page',
    title: PAGE_TITLE,
    contexts: ['page', 'frame']
  });
}

async function main() {
  await testHarnessSeesTheRace();
  await testOverlappingBootStaysSilent();
  console.log('context-menus.test.js: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
