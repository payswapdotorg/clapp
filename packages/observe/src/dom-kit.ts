/**
 * @clapp/observe — dom-kit: in-page JavaScript helpers as STRING constants.
 *
 * Calling convention (verified against Playwright 1.63): a string passed
 * to page.evaluate is evaluated as an EXPRESSION, not called as a
 * function — so every constant here is a function-expression source meant
 * to be invoked by wrapping it at the call site:
 *
 *   await page.evaluate('(' + DOM_TREE_FN + ')(' + JSON.stringify(arg) + ')')
 *
 * encapsulated once in evaluateFn() (playwright-session.ts). Arguments are
 * therefore always plain JSON (the helpers below never need richer data),
 * and NO page-side code is bundled from this package — the strings are the
 * entire surface injected into the observed page.
 *
 * Style constraints inside the strings: ES5-level syntax (var/function,
 * no template literals, no arrow functions, no let/const) so nothing
 * depends on page-side transpilation assumptions; single quotes only;
 * every helper is defensive (try/catch around optional APIs) because it
 * runs inside an arbitrary authorized web app.
 *
 * Bounds: the DOM walker caps nodes (default 25_000), storage values are
 * truncated in-page (4096 chars) and keys capped (512), static link lists
 * capped (256 each) — so a pathological page cannot blow up the runner
 * process through the evaluate bridge.
 */

/**
 * Walks the DOM (whole document, or opts.rootSelector) into the raw tree
 * { tag, attrs, text, children } — element children only, comment nodes
 * skipped, script/style/noscript/template TEXT omitted. Returns the
 * DomTreeEnvelope { root, truncated, nodeCount }.
 */
export const DOM_TREE_FN = `
(function (opts) {
  opts = opts || {};
  var maxNodes = typeof opts.maxNodes === 'number' && opts.maxNodes > 0 ? opts.maxNodes : 25000;
  var count = 0;
  var truncated = false;
  var skipText = { script: 1, style: 1, noscript: 1, template: 1 };
  function walk(el) {
    count++;
    var tag = (el.tagName || '').toLowerCase();
    var node = { tag: tag };
    var attrs = {};
    var names = el.attributes || [];
    for (var i = 0; i < names.length; i++) attrs[names[i].name] = names[i].value;
    node.attrs = attrs;
    if (skipText[tag]) return node;
    var ownText = '';
    var children = [];
    var kid = el.firstChild;
    while (kid) {
      if (kid.nodeType === 3) {
        ownText += kid.nodeValue;
      } else if (kid.nodeType === 1) {
        if (count >= maxNodes) { truncated = true; break; }
        children.push(walk(kid));
      }
      kid = kid.nextSibling;
    }
    if (ownText !== '') node.text = ownText;
    if (children.length) node.children = children;
    return node;
  }
  var root = null;
  try {
    root = opts.rootSelector ? document.querySelector(opts.rootSelector) : document.documentElement;
  } catch (e) { root = null; }
  if (!root) return { root: null, truncated: false, nodeCount: 0, error: 'root-not-found' };
  var tree = walk(root);
  return { root: tree, truncated: truncated, nodeCount: count };
})
`;

/**
 * Collects static-asset links from the live DOM: script[src],
 * link[rel=stylesheet|manifest|icon-ish|preload(as=font)], img src
 * (currentSrc first), source[srcset] first URL. URLs are absolutized via
 * element properties. Returns the DomAssetLinks shape.
 */
export const STATIC_LINKS_FN = `
(function () {
  var CAP = 256;
  var out = { scripts: [], stylesheets: [], images: [], manifests: [], icons: [], fonts: [] };
  function push(list, value) { if (value && list.length < CAP) list.push(value); }
  function each(selector, fn) {
    var list = [];
    try { list = document.querySelectorAll(selector); } catch (e) { return; }
    for (var i = 0; i < list.length; i++) fn(list[i]);
  }
  each('script[src]', function (el) { push(out.scripts, el.src || el.getAttribute('src')); });
  each('link[href]', function (el) {
    var rel = (el.getAttribute('rel') || '').toLowerCase();
    var href = el.href || el.getAttribute('href');
    if (rel === 'stylesheet') push(out.stylesheets, href);
    else if (rel === 'manifest') push(out.manifests, href);
    else if (rel.indexOf('icon') !== -1) push(out.icons, href);
    else if (rel === 'preload' || rel === 'prefetch') {
      var as = (el.getAttribute('as') || '').toLowerCase();
      if (as === 'font') push(out.fonts, href);
      else if (as === 'script') push(out.scripts, href);
      else if (as === 'style') push(out.stylesheets, href);
    }
  });
  each('img', function (el) { push(out.images, el.currentSrc || el.src || el.getAttribute('src')); });
  each('source[srcset]', function (el) {
    var srcset = el.getAttribute('srcset') || '';
    var first = srcset.split(',')[0];
    if (first) {
      var url = first.trim().split(/\\s+/)[0];
      if (url) push(out.images, url);
    }
  });
  return out;
})
`;

/**
 * Snapshots page-visible storage: localStorage + sessionStorage (values
 * truncated in-page, keys capped), service-worker registrations, Cache
 * Storage (names + capped URL lists), IndexedDB (database + object store
 * names via non-upgrading opens). Async — returns a promise of the
 * RawStorageSnapshot shape. Cookies are NOT read here (the driver gathers
 * them structurally via the browser context).
 */
export const STORAGE_SNAPSHOT_FN = `
(async function () {
  var VALUE_CAP = 4096;
  var KEY_CAP = 512;
  var CACHE_URL_CAP = 32;
  var snap = { origin: '', localStorage: {}, sessionStorage: {}, serviceWorkers: [], caches: [], indexedDB: [] };
  try { snap.origin = location.origin; } catch (e) {}
  function dumpStorage(storage, out) {
    try {
      var n = storage.length;
      for (var i = 0; i < n && i < KEY_CAP; i++) {
        var key = storage.key(i);
        if (!key) continue;
        var value = storage.getItem(key);
        if (typeof value === 'string') out[key] = value.slice(0, VALUE_CAP);
      }
    } catch (e) {}
  }
  dumpStorage(localStorage, snap.localStorage);
  dumpStorage(sessionStorage, snap.sessionStorage);
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      var regs = await navigator.serviceWorker.getRegistrations();
      for (var r = 0; r < regs.length; r++) {
        var reg = regs[r];
        var scriptUrl = '';
        var worker = reg.active || reg.installing || reg.waiting;
        if (worker && worker.scriptURL) scriptUrl = worker.scriptURL;
        snap.serviceWorkers.push({ scopeUrl: reg.scope || '', scriptUrl: scriptUrl });
      }
    }
  } catch (e) {}
  try {
    if (window.caches && caches.keys) {
      var names = await caches.keys();
      for (var c = 0; c < names.length; c++) {
        var cache = await caches.open(names[c]);
        var requests = await cache.keys();
        var urls = [];
        for (var u = 0; u < requests.length && u < CACHE_URL_CAP; u++) urls.push(requests[u].url);
        snap.caches.push({ name: names[c], urls: urls });
      }
    }
  } catch (e) {}
  try {
    if (indexedDB && indexedDB.databases) {
      var dbs = await indexedDB.databases();
      for (var d = 0; d < dbs.length && d < 16; d++) {
        var dbInfo = dbs[d];
        if (!dbInfo || !dbInfo.name) continue;
        try {
          var db = await new Promise(function (resolve, reject) {
            var rq = indexedDB.open(dbInfo.name);
            rq.onsuccess = function () { resolve(rq.result); };
            rq.onerror = function () { reject(rq.error); };
            rq.onupgradeneeded = function () { reject(new Error('unexpected upgrade')); };
          });
          var stores = [];
          for (var s = 0; s < db.objectStoreNames.length && s < 64; s++) stores.push({ name: db.objectStoreNames[s] });
          db.close();
          snap.indexedDB.push({ name: dbInfo.name, version: db.version, objectStores: stores });
        } catch (e2) {}
      }
    }
  } catch (e) {}
  return snap;
})
`;

/**
 * Clicks the element at an element-child path from documentElement
 * (paths are produced by resolveTarget over the serialized tree, whose
 * children are exactly the element children — index spaces align).
 * Input: { path: number[] }. Returns { ok, tag } or { ok: false, error }.
 */
export const CLICK_BY_PATH_FN = `
(function (input) {
  var el = document.documentElement;
  if (!el) return { ok: false, error: 'no-document' };
  var path = (input && input.path) || [];
  for (var i = 0; i < path.length; i++) {
    var idx = path[i];
    if (typeof idx !== 'number' || idx < 0 || idx >= el.children.length) {
      return { ok: false, error: 'path-out-of-bounds' };
    }
    el = el.children[idx];
  }
  try { el.click(); } catch (e) { return { ok: false, error: 'click-failed' }; }
  return { ok: true, tag: (el.tagName || '').toLowerCase() };
})
`;

/**
 * Fills a text field at an element-child path using the native value
 * setter (so framework listeners on the value property still fire) and
 * dispatches input + change events. Input: { path, value }.
 * Returns { ok, tag } or { ok: false, error }.
 */
export const SET_VALUE_BY_PATH_FN = `
(function (input) {
  var el = document.documentElement;
  if (!el) return { ok: false, error: 'no-document' };
  var path = (input && input.path) || [];
  for (var i = 0; i < path.length; i++) {
    var idx = path[i];
    if (typeof idx !== 'number' || idx < 0 || idx >= el.children.length) {
      return { ok: false, error: 'path-out-of-bounds' };
    }
    el = el.children[idx];
  }
  var tag = (el.tagName || '').toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') return { ok: false, error: 'not-a-text-field' };
  var proto = tag === 'textarea' ? window.HTMLTextAreaElement && HTMLTextAreaElement.prototype : window.HTMLInputElement && HTMLInputElement.prototype;
  if (!proto) return { ok: false, error: 'no-prototype' };
  var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && descriptor.set) descriptor.set.call(el, (input && input.value) || '');
  else el.value = (input && input.value) || '';
  try {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (e) {}
  return { ok: true, tag: tag };
})
`;
