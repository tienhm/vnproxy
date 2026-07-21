/**
 * VN Proxy Manager – Background Script
 *
 * Model:
 *   - 1 proxy duy nhất (state.proxyData) dùng cho tất cả groups
 *   - Groups chỉ để quản lý danh sách URL (không có proxy riêng)
 *   - Bất kỳ URL nào thuộc group đang bật → đi qua proxy
 *   - Kill switch: URL trong group mà proxy down → block, không đi thẳng
 *
 * Quy tắc:
 *   - buyProxy() CHỈ gọi khi proxy đã hết hạn, bởi user action
 *   - Nếu bước 1 (mua) thành công → không mua lại dù bước 2 fail
 */

const API_BASE_DEFAULT = 'https://app.2proxy.vn/api/proxyv2.php';
const IP_CHECK_HOST = 'api.ipify.org'; // luôn route qua proxy để đọc IP thực tế

const GROUP_COLORS = ['#e94560','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];

const DEFAULTS = {
  ngay:      1,
  proxyType: 'HTTP',
  loaiproxy: 'Viettel',
  proxytk:   '',
  proxymk:   '',
};

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  apiUrl:     API_BASE_DEFAULT,
  proxyData:  null,   // {host, port, username, password, type, expiresAt, idproxy, loaiproxy, purchasedAt}
  groups:     [],     // [{id, name, color, enabled, sites}]
  apiKey:     '',
  loaiproxy:  DEFAULTS.loaiproxy,
  proxyType:  DEFAULTS.proxyType,
  ngay:       DEFAULTS.ngay,
  proxytk:    DEFAULTS.proxytk,
  proxymk:    DEFAULTS.proxymk,
  isRenewing:  false,
  lastError:   null,
  proxyIp:     null,
};

function makeGroup(overrides = {}) {
  return {
    id:    'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name:  'Group mới',
    color: GROUP_COLORS[state.groups.length % GROUP_COLORS.length],
    sites: [],
    ...overrides,
  };
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const keys = [
    'proxyData','groups','apiKey','apiUrl','loaiproxy','proxyType','ngay','proxytk','proxymk','proxyIp',
  ];
  const stored = await browser.storage.local.get(keys);

  for (const k of keys) {
    if (stored[k] != null) state[k] = stored[k];
  }

  // Migration: groups cũ có proxyData riêng → strip, chỉ giữ sites
  state.groups = (state.groups || []).map(g => ({
    id:    g.id,
    name:  g.name,
    color: g.color,
    sites: g.sites || [],
  }));

  setupBlockListener();
  setupProxyListener();
  setupAuthListener();
}

// ─── Storage sync ─────────────────────────────────────────────────────────────

browser.storage.onChanged.addListener((changes) => {
  const keys = ['proxyData','groups','apiKey','apiUrl','loaiproxy','proxyType','ngay','proxytk','proxymk'];
  for (const k of keys) {
    if (changes[k] != null) state[k] = changes[k].newValue;
  }
});

// ─── Proxy helpers ────────────────────────────────────────────────────────────

function proxyRemainingMs() {
  if (!state.proxyData) return null;
  if (!state.proxyData.expiresAt) return Infinity;
  return new Date(state.proxyData.expiresAt).getTime() - Date.now();
}

function isExpired() {
  const ms = proxyRemainingMs();
  return ms !== null && ms !== Infinity && ms <= 0;
}

function buildProxyInfo() {
  const p      = state.proxyData;
  const isSocks = p.type === 'socks5';
  return {
    type:     isSocks ? 'socks' : 'http',
    host:     p.host,
    port:     Number(p.port),
    username: p.username || '',
    password: p.password || '',
    proxyDNS: isSocks, // chỉ SOCKS hỗ trợ proxyDNS
  };
}

function findGroupForHostname(hostname) {
  for (const group of state.groups) {
    for (const site of group.sites) {
      const s = site.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      if (s && (hostname === s || hostname.endsWith('.' + s))) return group;
    }
  }
  return null;
}

// ─── Kill switch ──────────────────────────────────────────────────────────────

function blockRequestHandler(details) {
  let hostname;
  try { hostname = new URL(details.url).hostname.toLowerCase(); }
  catch { return {}; }

  // IP check không bị block
  if (hostname === IP_CHECK_HOST) return {};

  const group = findGroupForHostname(hostname);
  if (!group) return {};

  const expired  = isExpired();
  const hasProxy = state.proxyData != null;

  if (hasProxy && !expired) return {}; // Proxy OK → cho đi

  // Xác định lý do
  let reason;
  if (!hasProxy)          reason = 'no_proxy';
  else if (state.isRenewing) reason = 'renewing';
  else if (expired)       reason = 'expired';
  else                    reason = 'error';


  // main_frame → trang lỗi có giải thích
  if (details.type === 'main_frame') {
    const params = new URLSearchParams({ reason, url: details.url, group: group.name });
    return { redirectUrl: `${browser.runtime.getURL('error.html')}?${params}` };
  }
  return { cancel: true };
}

function setupBlockListener() {
  if (browser.webRequest.onBeforeRequest.hasListener(blockRequestHandler)) {
    browser.webRequest.onBeforeRequest.removeListener(blockRequestHandler);
  }
  browser.webRequest.onBeforeRequest.addListener(
    blockRequestHandler,
    { urls: ['<all_urls>'] },
    ['blocking'],
  );
}

// ─── Proxy listener ───────────────────────────────────────────────────────────

function proxyRequestHandler(requestInfo) {
  let hostname;
  try { hostname = new URL(requestInfo.url).hostname.toLowerCase(); }
  catch { return { type: 'direct' }; }

  // IP check URL luôn đi qua proxy để đọc IP thực tế qua proxy
  if (hostname === IP_CHECK_HOST) {
    return (state.proxyData && !isExpired()) ? buildProxyInfo() : { type: 'direct' };
  }

  if (!findGroupForHostname(hostname)) return { type: 'direct' };

  if (state.proxyData && !isExpired()) return buildProxyInfo();
  return { type: 'direct' };
}

function setupProxyListener() {
  if (browser.proxy.onRequest.hasListener(proxyRequestHandler)) {
    browser.proxy.onRequest.removeListener(proxyRequestHandler);
  }
  browser.proxy.onRequest.addListener(proxyRequestHandler, { urls: ['<all_urls>'] });
  browser.proxy.onError.addListener(err => console.error('[vnproxy]', err.message));
}

// ─── Auth listener ────────────────────────────────────────────────────────────

function setupAuthListener() {
  browser.webRequest.onAuthRequired.addListener(
    (details) => {
      if (details.isProxy && state.proxyData?.username) {
        return { authCredentials: { username: state.proxyData.username, password: state.proxyData.password || '' } };
      }
      return {};
    },
    { urls: ['<all_urls>'] },
    ['blocking'],
  );
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiGet(params) {
  if (!state.apiKey) throw new Error('Chưa nhập API Key trong Cài đặt');
  const url = new URL(state.apiUrl || API_BASE_DEFAULT);
  url.searchParams.set('key', state.apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const resp = await fetch(url.toString());
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
  if (!text.trim()) return { maloi: 0 }; // một số endpoint trả body rỗng khi thành công
  try { return JSON.parse(text); }
  catch { throw new Error(`Response không phải JSON: "${text.slice(0, 500)}"`); }
}

function apiError(code) {
  const map = { 405:'API key sai', 404:'Thông số sai', 100:'Thiếu thông số', 103:'Số dư không đủ', 101:'Lỗi không xác định' };
  return map[String(code)] || `Lỗi mã ${code}`;
}

function safeFind(arr, pred) {
  const list = Array.isArray(arr) ? arr : (arr != null ? [arr] : []);
  return list.find(i => i != null && pred(i));
}

function firstValid(data) {
  const list = Array.isArray(data) ? data : (data != null ? [data] : []);
  const ok = list.find(i => i != null && i.maloi === 0 && i.proxy);
  if (ok) return ok;
  const first = list.find(i => i != null) ?? {};
  throw new Error(apiError(first.maloi) + (first.comen ? `: ${first.comen}` : ''));
}

function parseProxyEntry(item) {
  if (!item || item.maloi !== 0 || !item.proxy) {
    throw new Error(apiError(item?.maloi) + (item?.comen ? `: ${item.comen}` : ''));
  }
  const parts = item.proxy.split(':');
  if (parts.length < 2) throw new Error(`Định dạng proxy lạ: ${item.proxy}`);
  const expiresAt = item.time ? new Date(Number(item.time) * 1000).toISOString() : null;
  return {
    host:        parts[0],
    port:        Number(parts[1]),
    username:    item.user     || parts[2] || '',
    password:    item.password || parts[3] || '',
    type:        (item.type || '').toUpperCase() === 'SOCKS5' ? 'socks5' : 'http',
    expiresAt,
    idproxy:     item.idproxy,
    loaiproxy:   item.loaiproxy,
    purchasedAt: new Date().toISOString(),
  };
}

// ─── Business logic ───────────────────────────────────────────────────────────

async function buyProxy() {
  if (state.proxyData && !isExpired()) {
    throw new Error(`Proxy còn hiệu lực đến ${formatExpiry(state.proxyData.expiresAt)}. Không thể mua mới.`);
  }

  const buyRes = await apiGet({
    sukien: 'mua', loaiproxy: state.loaiproxy, quantity: 1,
    ngay: state.ngay, type: state.proxyType, proxytk: state.proxytk, proxymk: state.proxymk,
  });
  if (buyRes.maloi !== 0) throw new Error(apiError(buyRes.maloi));
  const orderCode = buyRes.order_code;

  let proxyData;
  try {
    const listRes = await apiGet({ sukien: 'listproxy', ma_don_hang: orderCode });
    proxyData = parseProxyEntry(firstValid(listRes));
  } catch (e) {
    const msg = `Đã mua thành công (order: ${orderCode}) nhưng không lấy được thông tin. Liên hệ nhà cung cấp.`;
    await browser.storage.local.set({ pendingOrderCode: orderCode });
    notify('⚠ Liên hệ nhà cung cấp', `Mã đơn ${orderCode}`);
    throw new Error(msg);
  }

  state.proxyData = proxyData;
  state.lastError = null;
  await browser.storage.local.set({ proxyData, pendingOrderCode: null });
  scheduleIpCheck();
  notify('Proxy đã mua thành công', `${proxyData.host}:${proxyData.port} (${proxyData.type.toUpperCase()}) — hết hạn ${formatExpiry(proxyData.expiresAt)}`);
  return proxyData;
}

async function renewProxy() {
  if (!state.proxyData?.idproxy) throw new Error('Không có idproxy để gia hạn.');
  const idproxy   = state.proxyData.idproxy;
  const loaiproxy = state.proxyData.loaiproxy || state.loaiproxy;

  const renewRes = await apiGet({ sukien: 'gia_han', loaiproxy, idproxy, ngay: state.ngay });
  const ok = safeFind(renewRes, r => r.maloi === 0);
  if (!ok) {
    const first = (Array.isArray(renewRes) ? renewRes : [renewRes]).find(i => i != null) ?? {};
    notify('⚠ Gia hạn thất bại', apiError(first.maloi));
    throw new Error(`Gia hạn thất bại: ${apiError(first.maloi)}`);
  }

  let proxyData;
  try {
    const listRes = await apiGet({ sukien: 'listproxy', loaiproxy, idproxy });
    proxyData = parseProxyEntry(firstValid(listRes));
  } catch (e) {
    notify('⚠ Liên hệ nhà cung cấp', `idproxy: ${idproxy} — gia hạn OK nhưng không đọc được thông tin`);
    throw new Error(`Gia hạn OK nhưng không lấy được thông tin. idproxy: ${idproxy}`);
  }

  // Giữ nguyên username/password (tham số đầu vào, không thay đổi sau gia hạn)
  proxyData.username = state.proxyData.username;
  proxyData.password = state.proxyData.password;

  state.proxyData = proxyData;
  state.lastError = null;
  await browser.storage.local.set({ proxyData });
  scheduleIpCheck();
  notify('Proxy đã gia hạn', `${proxyData.host}:${proxyData.port} — hết hạn ${formatExpiry(proxyData.expiresAt)}`);
  return proxyData;
}



async function loadAllProxies() {
  const ordersRes = await apiGet({ sukien: 'listorder' });
  const orders = Array.isArray(ordersRes) ? ordersRes.filter(o => o?.maloi === 0 && o.order_code) : [];
  const allProxies = [];
  for (const order of orders.slice(-20)) {
    try {
      const res = await apiGet({ sukien: 'listproxy', ma_don_hang: order.order_code });
      const list = Array.isArray(res) ? res : (res != null ? [res] : []);
      list.filter(p => p?.maloi === 0 && p.proxy).forEach(p => {
        p._order_code = order.order_code;
        allProxies.push(p);
      });
    } catch { /* bỏ qua */ }
  }
  return allProxies;
}

async function checkProxyIp() {
  if (!state.proxyData || isExpired()) return null;
  const resp = await fetch(`https://${IP_CHECK_HOST}?format=json`, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return data.ip || null;
}

let ipCheckTimer = null;
function scheduleIpCheck(delayMs = 3000) {
  clearTimeout(ipCheckTimer);
  state.proxyIp = null;
  ipCheckTimer = setTimeout(async () => {
    try { state.proxyIp = await checkProxyIp(); } catch { state.proxyIp = null; }
    if (state.proxyIp) browser.storage.local.set({ proxyIp: state.proxyIp }).catch(() => {});
  }, delayMs);
}

async function checkBalance() {
  const res = await apiGet({ sukien: 'listorder' });
  const list = Array.isArray(res) ? res : (res != null ? [res] : []);
  const first = list.find(i => i != null) ?? {};
  if (first.maloi && first.maloi !== 0) throw new Error(apiError(first.maloi));
  return list;
}

// ─── Message handler ──────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {

    case 'getState':
      return Promise.resolve({
        proxyData:   state.proxyData,
        groups:      state.groups,
        isRenewing:  state.isRenewing,
        lastError:   state.lastError,
        remainingMs: proxyRemainingMs(),
        proxyIp:     state.proxyIp,
      });

    case 'buyProxy':
      return wrapBuy(buyProxy);

    case 'renewProxy':
      return wrapAction(renewProxy);


    case 'clearProxy':
      state.proxyData = null;
      state.lastError = null;
      state.proxyIp   = null;
      clearTimeout(ipCheckTimer);
      return browser.storage.local.remove(['proxyData', 'proxyIp']).then(() => ({ ok: true }));

    case 'selectProxy': {
      const p = msg.proxy;
      const parts = (p.proxy || '').split(':');
      if (!parts[0] || !parts[1]) return Promise.resolve({ ok: false, error: 'Dữ liệu proxy không hợp lệ' });
      const proxyData = {
        host: parts[0], port: Number(parts[1]),
        username: p.user || parts[2] || '',
        password: p.password || parts[3] || '',
        type: (p.type || '').toUpperCase() === 'SOCKS5' ? 'socks5' : 'http',
        expiresAt: p.time ? new Date(Number(p.time) * 1000).toISOString() : null,
        idproxy: p.idproxy, loaiproxy: p.loaiproxy,
        purchasedAt: new Date().toISOString(),
      };
      state.proxyData = proxyData;
      state.lastError = null;
      scheduleIpCheck();
      return browser.storage.local.set({ proxyData }).then(() => ({ ok: true, data: proxyData }));
    }

    // Groups CRUD
    case 'getGroups':
      return Promise.resolve({ ok: true, data: state.groups });

    case 'createGroup': {
      const g = makeGroup(msg.data || {});
      state.groups.push(g);
      return browser.storage.local.set({ groups: state.groups }).then(() => ({ ok: true, data: g }));
    }

    case 'updateGroup': {
      const idx = state.groups.findIndex(g => g.id === msg.id);
      if (idx === -1) return Promise.resolve({ ok: false, error: 'Group không tìm thấy' });
      state.groups[idx] = { ...state.groups[idx], ...msg.data };
      return browser.storage.local.set({ groups: state.groups }).then(() => ({ ok: true }));
    }

    case 'deleteGroup':
      state.groups = state.groups.filter(g => g.id !== msg.id);
      return browser.storage.local.set({ groups: state.groups }).then(() => ({ ok: true }));

    case 'getValidProxies':
      return loadAllProxies()
        .then(list => {
          const now   = Date.now();
          const valid = list.filter(p => p.time && Number(p.time) * 1000 > now);
          return { ok: true, data: valid };
        })
        .catch(e => ({ ok: false, error: e.message }));

    case 'loadAllProxies':
      return loadAllProxies().then(d => ({ ok: true, data: d })).catch(e => ({ ok: false, error: e.message }));

    case 'checkProxyIp':
      return checkProxyIp()
        .then(async ip => {
          state.proxyIp = ip;
          if (ip) await browser.storage.local.set({ proxyIp: ip });
          return { ok: true, ip };
        })
        .catch(e => ({ ok: false, error: e.message }));

    case 'checkBalance':
      return checkBalance().then(d => ({ ok: true, data: d })).catch(e => ({ ok: false, error: e.message }));

    case 'saveSettings':
      return browser.storage.local.set(msg.settings).then(() => ({ ok: true }));

    default:
      return Promise.resolve({ ok: false, error: 'Unknown message type' });
  }
});

async function wrapAction(fn) {
  state.isRenewing = true;
  try { return { ok: true, data: await fn() }; }
  catch (e) { state.lastError = e.message; return { ok: false, error: e.message }; }
  finally { state.isRenewing = false; }
}

async function wrapBuy(fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { state.lastError = e.message; return { ok: false, error: e.message }; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatExpiry(iso) {
  if (!iso) return 'không rõ';
  try { return new Date(iso).toLocaleString('vi-VN'); } catch { return iso; }
}

function notify(title, message) {
  browser.notifications.create({
    type: 'basic', iconUrl: browser.runtime.getURL('icons/icon48.png'),
    title, message: String(message),
  }).catch(() => {});
}

init();
