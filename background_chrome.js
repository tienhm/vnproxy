/**
 * VN Proxy Manager – Background Service Worker (Chrome/Brave MV3)
 *
 * Khác MV2:
 *  - Stateless: không dùng in-memory state, mọi thứ load từ chrome.storage.local
 *  - Kill switch: declarativeNetRequest thay webRequest.onBeforeRequest blocking
 *  - Auth: webRequestAuthProvider + async listener
 *  - PAC: giữ nguyên chrome.proxy.settings (persist ở browser level)
 *  - declarativeNetRequest rules cũng persist ở browser level
 */

const API_BASE_DEFAULT  = 'https://app.2proxy.vn/api/proxyv2.php';
const IP_CHECK_HOST     = 'api.ipify.org';
const KS_RULE_BASE      = 100; // kill switch rule IDs bắt đầu từ đây
const KS_RULE_MAX_SITES = 200; // tối đa sites (mỗi site = 2 rules: redirect + block)
const GROUP_COLORS = ['#e94560','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function load(...keys) {
  return chrome.storage.local.get(keys.length === 1 ? keys[0] : keys);
}

async function save(obj) {
  return chrome.storage.local.set(obj);
}

// ─── Proxy helpers ────────────────────────────────────────────────────────────

function isExpired(proxyData) {
  if (!proxyData) return true;
  if (!proxyData.expiresAt) return false;
  return new Date(proxyData.expiresAt).getTime() <= Date.now();
}

function collectSites(groups) {
  const sites = new Set([IP_CHECK_HOST]);
  (groups || []).forEach(g => {
    (g.sites || []).forEach(s => {
      const clean = s.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      if (clean) sites.add(clean);
    });
  });
  return [...sites];
}

// ─── PAC script ───────────────────────────────────────────────────────────────

function buildPac(proxyData, groups) {
  const sites  = collectSites(groups);
  const p      = proxyData;

  if (!p || isExpired(p)) {
    return 'function FindProxyForURL(url, host) { return "DIRECT"; }';
  }

  const proxyStr = p.type === 'socks5'
    ? `SOCKS5 ${p.host}:${p.port}`
    : `PROXY ${p.host}:${p.port}`;

  const conditions = sites
    .map(s => `host == "${s}" || dnsDomainIs(host, ".${s}")`)
    .join(' ||\n      ');

  return `function FindProxyForURL(url, host) {
  if (${conditions}) return "${proxyStr}";
  return "DIRECT";
}`;
}

function setPacScript(pac) {
  return new Promise(resolve => {
    chrome.proxy.settings.set(
      { value: { mode: 'pac_script', pacScript: { data: pac } } },
      () => { if (chrome.runtime.lastError) console.error('[vnproxy] PAC:', chrome.runtime.lastError.message); resolve(); }
    );
  });
}

async function updatePacScript() {
  const stored = await load('proxyData', 'groups');
  await setPacScript(buildPac(stored.proxyData, stored.groups || []));
}

// ─── Kill switch (declarativeNetRequest) ─────────────────────────────────────
// Khi proxy không hợp lệ: redirect main_frame về error.html, block sub-resources
// Khi proxy hợp lệ: xóa tất cả kill switch rules

async function updateKillSwitchRules() {
  const stored    = await load('proxyData', 'groups');
  const proxyData = stored.proxyData;
  const groups    = stored.groups || [];

  // Xóa rules cũ bằng cách remove toàn bộ range IDs (không cần getDynamicRules)
  const removeIds = Array.from({ length: KS_RULE_MAX_SITES * 2 }, (_, i) => KS_RULE_BASE + i);

  if (!isExpired(proxyData) && proxyData) {
    // Proxy hợp lệ → xóa kill switch, không thêm gì
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules: [] });
    return;
  }

  // Proxy down/hết hạn → add redirect/block rules
  const reason   = !proxyData ? 'no_proxy' : 'expired';
  const errorUrl = chrome.runtime.getURL(`error.html?reason=${reason}`);
  const sites    = collectSites(groups).filter(s => s !== IP_CHECK_HOST);

  if (!sites.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules: [] });
    return;
  }

  const newRules = [];
  sites.slice(0, 99).forEach((site, i) => {
    // main_frame → redirect sang error page
    newRules.push({
      id:       KS_RULE_BASE + i * 2,
      priority: 1,
      action:   { type: 'redirect', redirect: { url: errorUrl } },
      condition: { urlFilter: `||${site}`, resourceTypes: ['main_frame'] }
    });
    // sub-resources → block
    newRules.push({
      id:       KS_RULE_BASE + i * 2 + 1,
      priority: 1,
      action:   { type: 'block' },
      condition: {
        urlFilter: `||${site}`,
        resourceTypes: ['sub_frame','xmlhttprequest','script','stylesheet','image','font','object','media','websocket','other']
      }
    });
  });

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules: newRules });
}

// ─── Auth listener (webRequestAuthProvider) ───────────────────────────────────

chrome.webRequest.onAuthRequired.addListener(
  (details) => {
    if (!details.isProxy) return Promise.resolve({});
    return chrome.storage.local.get('proxyData').then(stored => {
      const p = stored.proxyData;
      if (p?.username) return { authCredentials: { username: p.username, password: p.password || '' } };
      return {};
    });
  },
  { urls: ['<all_urls>'] },
  ['asyncBlocking']
);

// ─── Startup: sync PAC and kill switch rules ──────────────────────────────────

async function syncOnStartup() {
  await updatePacScript();
  await updateKillSwitchRules();
}

chrome.runtime.onStartup.addListener(syncOnStartup);
chrome.runtime.onInstalled.addListener(syncOnStartup);

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiGet(params) {
  const stored = await load('apiKey', 'apiUrl');
  if (!stored.apiKey) throw new Error('Chưa nhập API Key trong Cài đặt');
  const url = new URL(stored.apiUrl || API_BASE_DEFAULT);
  url.searchParams.set('key', stored.apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const resp = await fetch(url.toString());
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
  if (!text.trim()) return { maloi: 0 };
  try { return JSON.parse(text); }
  catch { throw new Error(`Response không phải JSON: "${text.slice(0, 500)}"`); }
}

function apiError(code) {
  const map = { 405:'API key sai', 404:'Thông số sai', 100:'Thiếu thông số', 103:'Số dư không đủ', 101:'Lỗi không xác định' };
  return map[String(code)] || `Lỗi mã ${code}`;
}

function safeFind(arr, pred) {
  return (Array.isArray(arr) ? arr : arr != null ? [arr] : []).find(i => i != null && pred(i));
}

function firstValid(data) {
  const list = Array.isArray(data) ? data : data != null ? [data] : [];
  const ok = list.find(i => i != null && i.maloi === 0 && i.proxy);
  if (ok) return ok;
  const first = list.find(i => i != null) ?? {};
  throw new Error(apiError(first.maloi) + (first.comen ? `: ${first.comen}` : ''));
}

function parseProxyEntry(item) {
  if (!item || item.maloi !== 0 || !item.proxy) throw new Error(apiError(item?.maloi));
  const parts = item.proxy.split(':');
  if (parts.length < 2) throw new Error(`Định dạng proxy lạ: ${item.proxy}`);
  return {
    host:        parts[0],
    port:        Number(parts[1]),
    username:    item.user     || parts[2] || '',
    password:    item.password || parts[3] || '',
    type:        (item.type || '').toUpperCase() === 'SOCKS5' ? 'socks5' : 'http',
    expiresAt:   item.time ? new Date(Number(item.time) * 1000).toISOString() : null,
    idproxy:     item.idproxy,
    loaiproxy:   item.loaiproxy,
    purchasedAt: new Date().toISOString(),
  };
}

// ─── Business logic ───────────────────────────────────────────────────────────

async function buyProxy() {
  const stored = await load('proxyData','loaiproxy','proxyType','ngay','proxytk','proxymk');
  if (stored.proxyData && !isExpired(stored.proxyData)) {
    throw new Error(`Proxy còn hiệu lực đến ${formatExpiry(stored.proxyData.expiresAt)}. Không thể mua mới.`);
  }

  const buyRes = await apiGet({
    sukien: 'mua', loaiproxy: stored.loaiproxy || 'Viettel', quantity: 1,
    ngay: stored.ngay || 1, type: stored.proxyType || 'HTTP',
    proxytk: stored.proxytk || '', proxymk: stored.proxymk || '',
  });
  if (buyRes.maloi !== 0) throw new Error(apiError(buyRes.maloi));
  const orderCode = buyRes.order_code;

  let proxyData;
  try {
    const listRes = await apiGet({ sukien: 'listproxy', ma_don_hang: orderCode });
    proxyData = parseProxyEntry(firstValid(listRes));
  } catch (e) {
    await save({ pendingOrderCode: orderCode });
    notify('⚠ Liên hệ nhà cung cấp', `Mã đơn ${orderCode}`);
    throw new Error(`Đã mua thành công (order: ${orderCode}) nhưng không lấy được thông tin. Liên hệ nhà cung cấp.`);
  }

  await save({ proxyData, pendingOrderCode: null });
  await updatePacScript();
  await updateKillSwitchRules();
  scheduleIpCheck();
  notify('Proxy đã mua thành công', `${proxyData.host}:${proxyData.port} (${proxyData.type.toUpperCase()}) — hết hạn ${formatExpiry(proxyData.expiresAt)}`);
  return proxyData;
}

async function renewProxy() {
  const stored = await load('proxyData','ngay','loaiproxy');
  if (!stored.proxyData?.idproxy) throw new Error('Không có idproxy để gia hạn.');
  const idproxy   = stored.proxyData.idproxy;
  const loaiproxy = stored.proxyData.loaiproxy || stored.loaiproxy || 'Viettel';

  const renewRes = await apiGet({ sukien: 'gia_han', loaiproxy, idproxy, ngay: stored.ngay || 1 });
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
    notify('⚠ Liên hệ nhà cung cấp', `idproxy: ${idproxy}`);
    throw new Error(`Gia hạn OK nhưng không lấy được thông tin. idproxy: ${idproxy}`);
  }

  proxyData.username = stored.proxyData.username;
  proxyData.password = stored.proxyData.password;
  await save({ proxyData });
  await updatePacScript();
  await updateKillSwitchRules();
  scheduleIpCheck();
  notify('Proxy đã gia hạn', `${proxyData.host}:${proxyData.port} — hết hạn ${formatExpiry(proxyData.expiresAt)}`);
  return proxyData;
}

async function loadAllProxies() {
  const ordersRes = await apiGet({ sukien: 'listorder' });
  const orders = Array.isArray(ordersRes) ? ordersRes.filter(o => o?.maloi === 0 && o.order_code) : [];
  const all = [];
  for (const order of orders.slice(-20)) {
    try {
      const res = await apiGet({ sukien: 'listproxy', ma_don_hang: order.order_code });
      (Array.isArray(res) ? res : res ? [res] : []).filter(p => p?.maloi === 0 && p.proxy).forEach(p => {
        p._order_code = order.order_code; all.push(p);
      });
    } catch { /* skip */ }
  }
  return all;
}

async function checkBalance() {
  const res = await apiGet({ sukien: 'listorder' });
  const list = Array.isArray(res) ? res : res ? [res] : [];
  const first = list.find(i => i != null) ?? {};
  if (first.maloi && first.maloi !== 0) throw new Error(apiError(first.maloi));
  return list;
}

async function checkProxyIp() {
  const stored = await load('proxyData');
  if (!stored.proxyData || isExpired(stored.proxyData)) return null;
  const resp = await fetch(`https://${IP_CHECK_HOST}?format=json`, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return data.ip || null;
}

let ipCheckTimer = null;
function scheduleIpCheck(delayMs = 3000) {
  clearTimeout(ipCheckTimer);
  ipCheckTimer = setTimeout(async () => {
    try {
      const ip = await checkProxyIp();
      if (ip) chrome.storage.local.set({ proxyIp: ip });
    } catch { /* ignore */ }
  }, delayMs);
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch(e => sendResponse({ ok: false, error: e.message }));
  return true; // async sendResponse
});

async function handleMessage(msg) {
  switch (msg.type) {

    case 'getState': {
      const s = await load('proxyData','groups','proxyIp');
      const p = s.proxyData;
      const remaining = !p ? null : !p.expiresAt ? Infinity : new Date(p.expiresAt).getTime() - Date.now();
      return { proxyData: p, groups: s.groups || [], remainingMs: remaining, proxyIp: s.proxyIp || null, isRenewing: false, lastError: null };
    }

    case 'buyProxy':   return wrapBuy(buyProxy);
    case 'renewProxy': return wrapAction(renewProxy);

    case 'clearProxy':
      await chrome.storage.local.remove(['proxyData', 'proxyIp']);
      await updatePacScript();
      await updateKillSwitchRules();
      return { ok: true };

    case 'selectProxy': {
      const p = msg.proxy;
      const parts = (p.proxy || '').split(':');
      if (!parts[0] || !parts[1]) return { ok: false, error: 'Dữ liệu proxy không hợp lệ' };
      const proxyData = {
        host: parts[0], port: Number(parts[1]),
        username: p.user || parts[2] || '', password: p.password || parts[3] || '',
        type: (p.type || '').toUpperCase() === 'SOCKS5' ? 'socks5' : 'http',
        expiresAt: p.time ? new Date(Number(p.time) * 1000).toISOString() : null,
        idproxy: p.idproxy, loaiproxy: p.loaiproxy,
        purchasedAt: new Date().toISOString(),
      };
      await save({ proxyData });
      await updatePacScript();
      await updateKillSwitchRules();
      scheduleIpCheck();
      return { ok: true, data: proxyData };
    }

    case 'getGroups': {
      const s = await load('groups');
      return { ok: true, data: s.groups || [] };
    }

    case 'createGroup': {
      const s = await load('groups');
      const groups = s.groups || [];
      const g = { id: 'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,5), name: 'Group mới', color: GROUP_COLORS[groups.length % GROUP_COLORS.length], sites: [], ...(msg.data||{}) };
      groups.push(g);
      await save({ groups });
      await updatePacScript();
      await updateKillSwitchRules();
      return { ok: true, data: g };
    }

    case 'updateGroup': {
      const s = await load('groups');
      const groups = s.groups || [];
      const idx = groups.findIndex(g => g.id === msg.id);
      if (idx === -1) return { ok: false, error: 'Group không tìm thấy' };
      groups[idx] = { ...groups[idx], ...msg.data };
      await save({ groups });
      await updatePacScript();
      await updateKillSwitchRules();
      return { ok: true };
    }

    case 'deleteGroup': {
      const s = await load('groups');
      const groups = (s.groups || []).filter(g => g.id !== msg.id);
      await save({ groups });
      await updatePacScript();
      await updateKillSwitchRules();
      return { ok: true };
    }

    case 'saveSettings':
      await save(msg.settings);
      if ('proxyData' in msg.settings || 'groups' in msg.settings) {
        await updatePacScript();
        await updateKillSwitchRules();
      }
      return { ok: true };

    case 'getValidProxies':
      return loadAllProxies()
        .then(list => ({ ok: true, data: list.filter(p => p.time && Number(p.time)*1000 > Date.now()) }))
        .catch(e => ({ ok: false, error: e.message }));

    case 'loadAllProxies':
      return loadAllProxies().then(d => ({ ok: true, data: d })).catch(e => ({ ok: false, error: e.message }));

    case 'checkBalance':
      return checkBalance().then(d => ({ ok: true, data: d })).catch(e => ({ ok: false, error: e.message }));

    case 'checkProxyIp':
      return checkProxyIp()
        .then(async ip => { if (ip) await save({ proxyIp: ip }); return { ok: true, ip }; })
        .catch(e => ({ ok: false, error: e.message }));

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

async function wrapAction(fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: e.message }; }
}

async function wrapBuy(fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatExpiry(iso) {
  if (!iso) return 'không rõ';
  try { return new Date(iso).toLocaleString('vi-VN'); } catch { return iso; }
}

function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon48.png'), title, message: String(message) });
}
