let cdTimer = null;

function setHTML(el, html) {
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  el.replaceChildren(...doc.body.childNodes);
}

function send(msg) { return browser.runtime.sendMessage(msg); }

function fmtMs(ms) {
  if (ms === null) return 'Chưa có proxy';
  if (ms === Infinity) return '∞';
  if (ms <= 0) return 'Đã hết hạn';
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}g ${m}p` : m > 0 ? `${m}p ${s}s` : `${s}s`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function refresh() {
  const st = await send({ type: 'getState' });
  render(st);
}

function render(st) {
  if (cdTimer) clearInterval(cdTimer);
  const container = document.getElementById('content');
  const p = st.proxyData;

  // Proxy status section
  let proxyHtml;
  if (!p) {
    proxyHtml = `<div class="proxy-block none">
      <div class="cd">Chưa có proxy</div>
      <div class="sub">Vào Cài đặt để mua hoặc chọn proxy</div>
    </div>`;
  } else {
    const ms = p.expiresAt ? new Date(p.expiresAt).getTime() - Date.now() : null;
    const cdClass = st.isRenewing ? '' : ms === null || ms === Infinity ? '' : ms <= 0 ? 'expired' : ms < 3600000 ? 'warn' : '';
    const badge = st.isRenewing ? '🔄 Đang gia hạn'
                : !p ? ''
                : ms === null || ms === Infinity ? '✓ Active'
                : ms <= 0 ? '✗ Hết hạn'
                : ms < 3600000 ? '⚠ Sắp hết'
                : '✓ Active';
    proxyHtml = `<div class="proxy-block">
      <div class="cd ${cdClass}" id="cdText">${fmtMs(ms === null ? Infinity : ms)}</div>
      <div class="proxy-addr">${esc(p.host)}:${p.port} <span class="proto">${(p.type||'').toUpperCase()}</span></div>
      ${st.proxyIp ? `<div class="proxy-ip">IP: ${esc(st.proxyIp)}</div>` : ''}
      <div class="expiry">${p.expiresAt ? `Hết hạn: ${new Date(p.expiresAt).toLocaleString('vi-VN')}` : ''}</div>
    </div>`;
  }

  // Groups section
  const groupsHtml = st.groups.length
    ? st.groups.map(g => `
      <div class="group-item${!g.enabled ? ' off' : ''}">
        <span class="gdot" style="background:${esc(g.color)}"></span>
        <span class="gname">${esc(g.name)}</span>
        <span class="gsites">${g.sites.length} site${g.sites.length !== 1 ? 's' : ''}</span>
      </div>`).join('')
    : '<div class="no-groups">Chưa có group nào</div>';

  setHTML(container, `
    ${proxyHtml}
    <div class="groups-section">
      <div class="groups-title">Groups</div>
      ${groupsHtml}
    </div>
  `);

  // Countdown
  if (p?.expiresAt) {
    cdTimer = setInterval(() => {
      const el = document.getElementById('cdText');
      if (!el) { clearInterval(cdTimer); return; }
      const ms = new Date(p.expiresAt).getTime() - Date.now();
      el.textContent = fmtMs(ms);
      el.className = `cd${ms <= 0 ? ' expired' : ms < 3600000 ? ' warn' : ''}`;
    }, 1000);
  }

}

document.getElementById('openSettings').addEventListener('click', e => {
  e.preventDefault();
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  } else {
    browser.runtime.openOptionsPage();
  }
  window.close();
});

refresh();
