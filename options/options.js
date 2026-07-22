const GROUP_COLORS = ['#e94560','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];

function setHTML(el, html) {
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  el.replaceChildren(...doc.body.childNodes);
}

let groups  = [];
let cdTimer = null;

// ─── Tabs ─────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'proxy')  refreshProxy();
    if (tab.dataset.tab === 'groups') refreshGroups();
  });
});

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}

function send(msg) { return browser.runtime.sendMessage(msg); }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtMs(ms) {
  if (ms === null) return 'Chưa có proxy';
  if (ms === Infinity) return '∞';
  if (ms <= 0) return 'Đã hết hạn';
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}g ${m}p` : m > 0 ? `${m}p ${s}s` : `${s}s`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('vi-VN'); } catch { return iso; }
}

// ─── Tab Proxy ────────────────────────────────────────────────────────────────

async function refreshProxy() {
  const st = await send({ type: 'getState' });
  const p  = st.proxyData;
  const err = document.getElementById('proxyError');
  if (st.lastError) { err.style.display = 'block'; err.textContent = st.lastError; }
  else err.style.display = 'none';
  if (cdTimer) clearInterval(cdTimer);
  if (!p) {
    document.getElementById('countdown').textContent = 'Chưa có proxy';
    document.getElementById('countdown').className   = 'countdown-lg none';
    document.getElementById('expiryLabel').textContent = '';
    ['stAddr','stType','stId','stExpiry','stProxyIp'].forEach(id => document.getElementById(id).textContent = '—');
    return;
  }
  document.getElementById('stProxyIp').textContent = st.proxyIp || '—';
  document.getElementById('stAddr').textContent    = `${p.host}:${p.port}`;
  document.getElementById('stType').textContent   = (p.type||'—').toUpperCase();
  document.getElementById('stId').textContent     = p.idproxy || '—';
  document.getElementById('stExpiry').textContent = fmtDate(p.expiresAt);
  document.getElementById('expiryLabel').textContent = p.expiresAt ? `Hết hạn: ${fmtDate(p.expiresAt)}` : '';
  function tick() {
    const ms = p.expiresAt ? new Date(p.expiresAt).getTime() - Date.now() : null;
    const el = document.getElementById('countdown');
    el.textContent = fmtMs(ms === null ? Infinity : ms);
    el.className = st.isRenewing || ms === null || ms === Infinity ? 'countdown-lg'
                 : ms <= 0 ? 'countdown-lg expired' : ms < 3600000 ? 'countdown-lg warn' : 'countdown-lg';
  }
  tick();
  cdTimer = setInterval(tick, 1000);
}

document.getElementById('btnCheckIp').addEventListener('click', async () => {
  const el  = document.getElementById('stProxyIp');
  const btn = document.getElementById('btnCheckIp');
  el.textContent = 'Đang kiểm tra...'; btn.disabled = true;
  const res = await send({ type: 'checkProxyIp' });
  el.textContent = res.ok ? res.ip : `Lỗi: ${res.error}`;
  btn.disabled = false;
});

document.getElementById('btnBuy').addEventListener('click', async () => {
  setProxyBtns(true);

  // Kiểm tra xem còn proxy hợp lệ nào không trước khi mua mới
  const checkRes = await send({ type: 'getValidProxies' });
  if (checkRes.ok && checkRes.data.length > 0) {
    setProxyBtns(false);
    showValidProxiesModal(checkRes.data);
    return;
  }

  // Không còn proxy hợp lệ → mua mới
  await doBuyProxy();
  setProxyBtns(false);
});

async function doBuyProxy() {
  setProxyBtns(true);
  const res = await send({ type: 'buyProxy' });
  res.ok ? showToast('Mua proxy thành công') : showToast(res.error, 'error');
  await refreshProxy();
  setProxyBtns(false);
}

function showValidProxiesModal(list) {
  const modal  = document.getElementById('validProxiesModal');
  const title  = document.getElementById('validProxiesTitle');
  const table  = document.getElementById('validProxiesTable');

  title.textContent = `Còn ${list.length} proxy chưa hết hạn`;

  const rows = list.map((p, idx) => {
    const parts  = (p.proxy || '').split(':');
    const expiry = p.time ? new Date(Number(p.time) * 1000).toLocaleString('vi-VN') : '—';
    const remain = p.time ? Math.ceil((Number(p.time) * 1000 - Date.now()) / 3600000) : '—';
    return `<tr>
      <td>${esc(p.idproxy || '—')}</td>
      <td style="font-family:monospace">${esc(parts[0])}:${esc(parts[1])}</td>
      <td><span class="tag ${(p.type||'').toUpperCase()==='SOCKS5'?'tag-socks5':'tag-http'}">${esc(p.type||'HTTP')}</span></td>
      <td>${esc(expiry)}</td>
      <td style="color:#4ade80">${remain}h còn lại</td>
      <td><button class="btn btn-green btn-sm" data-use="${idx}">Dùng</button></td>
    </tr>`;
  }).join('');

  setHTML(table, `<table class="proxy-table">
    <thead><tr><th>ID</th><th>Host:Port</th><th>Type</th><th>Hết hạn</th><th>Còn lại</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`);

  table.querySelectorAll('button[data-use]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const p   = list[Number(btn.dataset.use)];
      const res = await send({ type: 'selectProxy', proxy: p });
      if (res.ok) {
        closeValidProxiesModal();
        showToast(`Đã chọn ${(p.proxy||'').split(':').slice(0,2).join(':')}`);
        refreshProxy();
      } else {
        showToast(res.error, 'error');
      }
    });
  });

  modal.style.display = 'block';
}

function closeValidProxiesModal() {
  document.getElementById('validProxiesModal').style.display = 'none';
}

document.getElementById('btnCancelBuy').addEventListener('click', closeValidProxiesModal);

document.getElementById('btnProceedBuy').addEventListener('click', async () => {
  closeValidProxiesModal();
  await doBuyProxy();
});

document.getElementById('validProxiesModal').addEventListener('click', e => {
  if (e.target === document.getElementById('validProxiesModal')) closeValidProxiesModal();
});
document.getElementById('btnRenew').addEventListener('click', async () => {
  if (!confirm('Xác nhận gia hạn proxy?')) return;
  setProxyBtns(true);
  const res = await send({ type: 'renewProxy' });
  res.ok ? showToast('Gia hạn thành công') : showToast(res.error, 'error');
  await refreshProxy(); setProxyBtns(false);
});
document.getElementById('btnClear').addEventListener('click', async () => {
  if (!confirm('Xóa proxy hiện tại?')) return;
  await send({ type: 'clearProxy' }); showToast('Đã xóa proxy'); refreshProxy();
});
function setProxyBtns(d) { ['btnBuy','btnRenew','btnClear'].forEach(id => { document.getElementById(id).disabled = d; }); }

document.getElementById('btnLoadAll').addEventListener('click', async () => {
  const btn = document.getElementById('btnLoadAll');
  btn.disabled = true; btn.textContent = 'Đang tải...';
  const res = await send({ type: 'loadAllProxies' });
  btn.disabled = false; btn.textContent = 'Tải tất cả đơn hàng';
  if (!res.ok) { showToast(res.error, 'error'); return; }
  renderProxyTable(res.data);
});

function renderProxyTable(list) {
  document.getElementById('proxyCountLabel').textContent = list.length;
  const wrap = document.getElementById('proxyTableWrap');
  if (!list.length) { setHTML(wrap, '<div class="empty-msg">Không có proxy nào</div>'); return; }

  const rows = list.map((p, idx) => {
    const parts   = (p.proxy||'').split(':');
    const expiry  = p.time ? new Date(Number(p.time)*1000).toLocaleString('vi-VN') : '—';
    const expired = p.time ? Date.now() > Number(p.time)*1000 : false;
    const tTag    = (p.type||'').toUpperCase() === 'SOCKS5' ? '<span class="tag tag-socks5">SOCKS5</span>' : '<span class="tag tag-http">HTTP</span>';
    const sTag    = expired ? '<span class="tag tag-exp">Hết hạn</span>' : '<span class="tag tag-ok">Active</span>';
    return `<tr>
      <td>${esc(p.idproxy||'—')}</td>
      <td>${esc(parts[0])}:${esc(parts[1])}</td>
      <td>${tTag}</td>
      <td>${esc(expiry)}</td>
      <td>${sTag}</td>
      <td>${!expired ? `<button class="btn btn-green btn-sm" data-use="${idx}">Dùng</button>` : ''}</td>
    </tr>`;
  }).join('');

  setHTML(wrap, `<table class="proxy-table">
    <thead><tr><th>ID</th><th>Host:Port</th><th>Type</th><th>Hết hạn</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`);

  // Dùng proxy
  wrap.querySelectorAll('button[data-use]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const p = list[Number(btn.dataset.use)];
      const res = await send({ type: 'selectProxy', proxy: p });
      if (res.ok) { showToast(`Đã chọn ${(p.proxy||'').split(':').slice(0,2).join(':')}`); refreshProxy(); }
      else showToast(res.error, 'error');
    });
  });
}

// ─── Tab Groups – Unified tree with drag-and-drop ────────────────────────────

const expandedIds = new Set();
let saveTimer = null;
let dragState      = null; // { gid, url } – URL drag
let dropPos        = null; // { gid, beforeUrl }
let groupDragState = null; // { gid } – group reorder drag

function normUrl(raw) {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => send({ type: 'saveSettings', settings: { groups } }), 250);
}

function parseTreeInput(text) {
  const m = text.match(/^@([^:]+):(.+)$/);
  if (m) return { groupName: m[1].trim(), urls: m[2].split(',').map(normUrl).filter(Boolean) };
  return { groupName: null, urls: text.split(',').map(normUrl).filter(Boolean) };
}

function newGroup(name) {
  return { id: 'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,4), name, color: GROUP_COLORS[groups.length % GROUP_COLORS.length], sites: [] };
}

function getOrCreateGroup(name) {
  if (!name) { if (!groups.length) groups.push(newGroup('Default')); return groups[0]; }
  const lower = name.toLowerCase();
  let g = groups.find(x => x.name.toLowerCase() === lower);
  if (!g) { g = newGroup(name); groups.push(g); }
  return g;
}

function addUrlsToGroup(target, urls) {
  let changed = false;
  for (const url of urls) {
    groups.forEach(g => { if (g.id===target.id) return; const i=g.sites.indexOf(url); if (i!==-1) { g.sites.splice(i,1); changed=true; } });
    if (!target.sites.includes(url)) { target.sites.push(url); changed = true; }
  }
  return changed;
}

async function refreshGroups() {
  const res = await send({ type: 'getGroups' });
  if (!res.ok) return;
  groups = res.data.map(g => ({ id: g.id, name: g.name, color: g.color, sites: g.sites || [] }));
  // Mặc định collapse tất cả khi load
  renderTree();
}

// ─── Render ───────────────────────────────────────────────────────────────────

function urlRowHtml(gid, s, i) {
  return `<div class="tree-url" draggable="true" data-gid="${esc(gid)}" data-url="${esc(s)}" data-i="${i}">
    <span class="drag-handle">⠿</span>
    <span class="url-txt">${esc(s)}</span>
    <button class="url-del" data-gid="${esc(gid)}" data-i="${i}">×</button>
  </div>`;
}

function renderTree() {
  const c = document.getElementById('groupTree');
  if (!groups.length) { setHTML(c, '<div class="empty-msg">Chưa có group nào. Nhập URL bên trên để bắt đầu.</div>'); return; }

  setHTML(c, groups.map(g => {
    const open = expandedIds.has(g.id);
    return `<div class="tree-group" data-gid="${esc(g.id)}">
      <div class="tree-hdr" data-gid="${esc(g.id)}">
        <span class="g-handle" draggable="true" data-gid="${esc(g.id)}" title="Kéo để sắp xếp">⠿</span>
        <span class="chevron${open?' open':''}">▶</span>
        <span class="g-name-text" data-gid="${esc(g.id)}">${esc(g.name)}</span>
        <input class="g-name-input" type="text" value="${esc(g.name)}" data-gid="${esc(g.id)}" />
        <span class="g-cnt" data-gid="${esc(g.id)}">${g.sites.length}</span>
        <button class="g-edit" data-gid="${esc(g.id)}" title="Sửa tên">✎</button>
        <button class="g-del"  data-gid="${esc(g.id)}" title="Xóa group">×</button>
      </div>
      ${open ? `<div class="tree-body" data-gid="${esc(g.id)}">
        ${g.sites.map((s,i) => urlRowHtml(g.id, s, i)).join('')}
        ${!g.sites.length ? '<div class="g-empty">Chưa có URL — kéo thả hoặc nhập ở trên</div>' : ''}
      </div>` : ''}
    </div>`;
  }).join(''));

  bindTree(c);
}

function bindTree(c) {
  // Toggle expand/collapse
  c.querySelectorAll('.tree-hdr').forEach(hdr => {
    hdr.addEventListener('click', e => {
      if (e.target.closest('.g-name-text, .g-name-input, .g-edit, .g-del')) return;
      const gid  = hdr.dataset.gid;
      const node = hdr.closest('.tree-group');
      const chev = hdr.querySelector('.chevron');
      if (expandedIds.has(gid)) {
        expandedIds.delete(gid);
        chev.classList.remove('open');
        node.querySelector('.tree-body')?.remove();
      } else {
        expandedIds.add(gid);
        chev.classList.add('open');
        const g = groups.find(x => x.id === gid);
        if (g) {
          const body = document.createElement('div');
          body.className = 'tree-body'; body.dataset.gid = gid;
          setHTML(body, g.sites.map((s,i) => urlRowHtml(gid, s, i)).join('') +
            (!g.sites.length ? '<div class="g-empty">Chưa có URL</div>' : ''));
          hdr.insertAdjacentElement('afterend', body);
          bindUrlRows(body);
          bindBodyDrop(body);
        }
      }
    });
    // Header as drop zone (append to end)
    bindHdrDrop(hdr);
  });

  // Edit button → toggle name editing
  c.querySelectorAll('.g-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const gid  = btn.dataset.gid;
      const hdr  = btn.closest('.tree-hdr');
      const text = hdr.querySelector('.g-name-text');
      const inp  = hdr.querySelector('.g-name-input');
      const isEditing = inp.style.display === 'block';
      if (isEditing) {
        commitName(gid, inp, text, btn);
      } else {
        text.style.display = 'none';
        inp.style.display  = 'block';
        inp.focus(); inp.select();
        btn.textContent = '✓';
        btn.title = 'Lưu tên';
      }
    });
  });

  c.querySelectorAll('.g-name-input').forEach(inp => {
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const hdr  = inp.closest('.tree-hdr');
        const text = hdr.querySelector('.g-name-text');
        const btn  = hdr.querySelector('.g-edit');
        commitName(inp.dataset.gid, inp, text, btn);
      }
      if (e.key === 'Escape') {
        const g    = groups.find(x => x.id === inp.dataset.gid);
        const hdr  = inp.closest('.tree-hdr');
        const text = hdr.querySelector('.g-name-text');
        const btn  = hdr.querySelector('.g-edit');
        if (g) inp.value = g.name;
        inp.style.display  = 'none';
        text.style.display = '';
        btn.textContent = '✎'; btn.title = 'Sửa tên';
      }
    });
    inp.addEventListener('blur', e => {
      if (e.relatedTarget?.classList.contains('g-edit')) return;
      const hdr  = inp.closest('.tree-hdr');
      const text = hdr.querySelector('.g-name-text');
      const btn  = hdr.querySelector('.g-edit');
      commitName(inp.dataset.gid, inp, text, btn);
    });
  });

  function commitName(gid, inp, text, btn) {
    const g = groups.find(x => x.id === gid); if (!g) return;
    const val = inp.value.trim();
    if (val) g.name = val;
    inp.value = g.name;
    text.textContent = g.name;
    inp.style.display  = 'none';
    text.style.display = '';
    btn.textContent = '✎'; btn.title = 'Sửa tên';
    scheduleSave();
  }

  // Delete group
  c.querySelectorAll('.g-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Xóa group này?')) return;
      groups = groups.filter(g => g.id !== btn.dataset.gid);
      expandedIds.delete(btn.dataset.gid);
      await send({ type: 'saveSettings', settings: { groups } });
      renderTree();
    });
  });

  // URL rows
  c.querySelectorAll('.tree-body').forEach(body => { bindUrlRows(body); bindBodyDrop(body); });

  // Group reorder drag
  c.querySelectorAll('.g-handle').forEach(handle => {
    handle.addEventListener('dragstart', e => {
      e.stopPropagation();
      groupDragState = { gid: handle.dataset.gid };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', handle.dataset.gid);
      setTimeout(() => handle.closest('.tree-group')?.classList.add('g-dragging'), 0);
    });
    handle.addEventListener('dragend', () => {
      groupDragState = null;
      c.querySelectorAll('.g-dragging,.gdrop-before,.gdrop-after')
        .forEach(el => el.classList.remove('g-dragging','gdrop-before','gdrop-after'));
    });
  });

  c.querySelectorAll('.tree-group').forEach(node => {
    node.addEventListener('dragover', e => {
      if (!groupDragState) return;
      if (groupDragState.gid === node.dataset.gid) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      c.querySelectorAll('.gdrop-before,.gdrop-after')
        .forEach(el => el.classList.remove('gdrop-before','gdrop-after'));
      const mid = node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2;
      node.classList.add(e.clientY < mid ? 'gdrop-before' : 'gdrop-after');
    });

    node.addEventListener('dragleave', e => {
      if (!groupDragState) return;
      if (!node.contains(e.relatedTarget)) {
        node.classList.remove('gdrop-before','gdrop-after');
      }
    });

    node.addEventListener('drop', e => {
      if (!groupDragState) return;
      e.preventDefault(); e.stopPropagation();
      const srcIdx = groups.findIndex(g => g.id === groupDragState.gid);
      const tgtIdx = groups.findIndex(g => g.id === node.dataset.gid);
      if (srcIdx === -1 || tgtIdx === -1 || srcIdx === tgtIdx) return;
      const isBefore = node.classList.contains('gdrop-before');
      const [moved]  = groups.splice(srcIdx, 1);
      const newIdx   = groups.findIndex(g => g.id === node.dataset.gid);
      groups.splice(isBefore ? newIdx : newIdx + 1, 0, moved);
      groupDragState = null;
      scheduleSave(); renderTree();
    });
  });
}

function bindUrlRows(body) {
  body.querySelectorAll('.url-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const g = groups.find(x => x.id === btn.dataset.gid); if (!g) return;
      g.sites.splice(Number(btn.dataset.i), 1);
      scheduleSave(); renderTree();
    });
  });

  body.querySelectorAll('.tree-url').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragState = { gid: row.dataset.gid, url: row.dataset.url };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.url);
      setTimeout(() => row.classList.add('dragging'), 0);
    });
    row.addEventListener('dragend', () => {
      dragState = null; dropPos = null;
      document.querySelectorAll('.dragging,.drop-before,.drop-after,.drag-over,.drop-target')
        .forEach(el => el.classList.remove('dragging','drop-before','drop-after','drag-over','drop-target'));
    });
    row.addEventListener('dragover', e => {
      if (!dragState || groupDragState) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      body.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before','drop-after'));
      const mid = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      if (e.clientY < mid) {
        row.classList.add('drop-before');
        dropPos = { gid: body.dataset.gid, beforeUrl: row.dataset.url };
      } else {
        row.classList.add('drop-after');
        const next = row.nextElementSibling?.dataset?.url;
        dropPos = { gid: body.dataset.gid, beforeUrl: next || null };
      }
      row.closest('.tree-group')?.classList.add('drag-over');
    });
    row.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      if (dragState && dropPos) doMove();
    });
  });
}

function bindBodyDrop(body) {
  body.addEventListener('dragover', e => {
    if (!dragState) return;
    if (e.target.closest('.tree-url')) return; // handled by url row
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    dropPos = { gid: body.dataset.gid, beforeUrl: null };
    body.classList.add('drop-target');
    body.closest('.tree-group')?.classList.add('drag-over');
  });
  body.addEventListener('dragleave', e => {
    if (!body.contains(e.relatedTarget)) {
      body.classList.remove('drop-target');
      body.closest('.tree-group')?.classList.remove('drag-over');
    }
  });
  body.addEventListener('drop', e => {
    e.preventDefault();
    if (dragState) { dropPos = dropPos || { gid: body.dataset.gid, beforeUrl: null }; doMove(); }
    body.classList.remove('drop-target');
  });
}

function bindHdrDrop(hdr) {
  hdr.addEventListener('dragover', e => {
    if (!dragState) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    dropPos = { gid: hdr.dataset.gid, beforeUrl: null };
    hdr.closest('.tree-group')?.classList.add('drag-over');
  });
  hdr.addEventListener('dragleave', e => {
    if (!hdr.contains(e.relatedTarget)) hdr.closest('.tree-group')?.classList.remove('drag-over');
  });
  hdr.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    if (dragState) { dropPos = { gid: hdr.dataset.gid, beforeUrl: null }; doMove(); }
  });
}

function doMove() {
  if (!dragState || !dropPos) return;
  const src = groups.find(g => g.id === dragState.gid);
  const dst = groups.find(g => g.id === dropPos.gid);
  if (!src || !dst) return;
  src.sites = src.sites.filter(s => s !== dragState.url);
  dst.sites = dst.sites.filter(s => s !== dragState.url);
  if (dropPos.beforeUrl) {
    const idx = dst.sites.indexOf(dropPos.beforeUrl);
    dst.sites.splice(idx !== -1 ? idx : dst.sites.length, 0, dragState.url);
  } else {
    dst.sites.push(dragState.url);
  }
  expandedIds.add(dropPos.gid);
  dragState = null; dropPos = null;
  scheduleSave(); renderTree();
}

// ─── Tree input + @group autocomplete ────────────────────────────────────────

function initTreeInput() {
  const input    = document.getElementById('treeInput');
  const dropdown = document.getElementById('acDropdown');
  let acIdx = -1;

  function getFilter() {
    const v = input.value, at = v.lastIndexOf('@');
    if (at === -1 || v.slice(at).includes(':')) return null;
    return v.slice(at + 1);
  }

  function showAc(filter) {
    const q = filter.toLowerCase();
    const matches = groups.filter(g => g.name.toLowerCase().includes(q));
    const create  = filter && !groups.find(g => g.name.toLowerCase() === q);
    if (!matches.length && !create) { hideAc(); return; }
    setHTML(dropdown, [
      ...matches.map(g => `<div class="ac-item" data-name="${esc(g.name)}"><span class="ac-dot" style="background:${esc(g.color)}"></span><span class="ac-name">${esc(g.name)}</span><span class="ac-count">${g.sites.length} site</span></div>`),
      ...(create ? [`<div class="ac-item ac-create" data-create="${esc(filter)}"><span class="ac-dot" style="background:#6b7280"></span><span class="ac-name">Tạo "<strong>${esc(filter)}</strong>"</span></div>`] : []),
    ].join(''));
    acIdx = -1; dropdown.classList.add('show');
    dropdown.querySelectorAll('.ac-item').forEach(item => {
      item.addEventListener('mousedown', e => { e.preventDefault(); pickAc(item); });
    });
  }

  function hideAc() { dropdown.classList.remove('show'); acIdx = -1; }

  function pickAc(item) {
    const name = item.dataset.name || item.dataset.create;
    const v = input.value, at = v.lastIndexOf('@');
    input.value = (at !== -1 ? v.slice(0, at) : '') + '@' + name + ':';
    hideAc(); input.focus();
  }

  function moveAc(dir) {
    const items = dropdown.querySelectorAll('.ac-item'); if (!items.length) return;
    items[acIdx]?.classList.remove('active');
    acIdx = (acIdx + dir + items.length) % items.length;
    items[acIdx]?.classList.add('active');
    items[acIdx]?.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => { const f = getFilter(); f !== null ? showAc(f) : hideAc(); });

  input.addEventListener('keydown', async e => {
    if (dropdown.classList.contains('show')) {
      if (e.key === 'ArrowDown')  { e.preventDefault(); moveAc(1);  return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); moveAc(-1); return; }
      if (e.key === 'Escape')     { hideAc(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const active = dropdown.querySelector('.ac-item.active');
        if (active) { e.preventDefault(); pickAc(active); return; }
      }
    }
    if (e.key !== 'Enter') return;
    hideAc();
    const raw = input.value.trim(); if (!raw) return;
    const { groupName, urls } = parseTreeInput(raw);
    if (!urls.length) return;
    const target = getOrCreateGroup(groupName);
    if (addUrlsToGroup(target, urls)) {
      expandedIds.add(target.id);
      await send({ type: 'saveSettings', settings: { groups } });
      renderTree();
    }
    input.value = '';
  });

  input.addEventListener('blur', () => setTimeout(hideAc, 150));
}

// ─── Export / Import ─────────────────────────────────────────────────────────

async function sha256(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

document.getElementById('btnExport').addEventListener('click', async () => {
  const payload = groups.map(g => ({ name: g.name, sites: g.sites }));
  const body    = JSON.stringify(payload);
  const sig     = await sha256(body);
  const output  = JSON.stringify({ _app: 'vnproxy', _sig: sig, groups: payload }, null, 2);
  const blob    = new Blob([output], { type: 'application/json' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = url; a.download = 'vnproxy-urls.json'; a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btnImport').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (err) {
    showToast('File không hợp lệ: ' + err.message, 'error');
    return;
  }

  // Verify signature
  if (!parsed._app || parsed._app !== 'vnproxy' || !parsed._sig || !Array.isArray(parsed.groups)) {
    showToast('File không được tạo từ extension này', 'error');
    return;
  }
  const expected = await sha256(JSON.stringify(parsed.groups));
  if (expected !== parsed._sig) {
    showToast('Checksum không khớp — file bị chỉnh sửa hoặc không hợp lệ', 'error');
    return;
  }

  const imported = parsed.groups;

  // Merge: với mỗi group trong file, tìm group cùng tên hoặc tạo mới
  let added = 0, merged = 0;
  for (const imp of imported) {
    if (!imp.name || !Array.isArray(imp.sites)) continue;
    const sites = imp.sites.map(s =>
      String(s).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
    ).filter(Boolean);
    if (!sites.length) continue;

    const existing = groups.find(g => g.name.toLowerCase() === imp.name.toLowerCase());
    if (existing) {
      // Merge vào group hiện có
      sites.forEach(s => { if (!existing.sites.includes(s)) existing.sites.push(s); });
      merged++;
    } else {
      // Tạo group mới
      groups.push(newGroup(imp.name));
      groups[groups.length - 1].sites = sites;
      added++;
    }
  }

  // Dedup toàn bộ (URL chỉ thuộc 1 group - group cuối cùng thắng)
  const seen = new Set();
  for (let i = groups.length - 1; i >= 0; i--) {
    groups[i].sites = groups[i].sites.filter(s => {
      if (seen.has(s)) return false;
      seen.add(s); return true;
    });
  }

  await send({ type: 'saveSettings', settings: { groups } });
  renderTree();
  showToast(`Import: ${added} group mới, ${merged} group được merge`);
});

// ─── Tab Account ──────────────────────────────────────────────────────────────

document.getElementById('saveAccount').addEventListener('click', async () => {
  await send({ type: 'saveSettings', settings: {
    apiUrl: document.getElementById('apiUrl').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
  }});
  showToast('Đã lưu');
});

document.getElementById('verifyKey').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { showToast('Nhập API key trước', 'error'); return; }
  await send({ type: 'saveSettings', settings: {
    apiUrl: document.getElementById('apiUrl').value.trim(),
    apiKey,
  }});
  const el = document.getElementById('verifyResult');
  el.style.display = 'block'; el.style.color = '#9ca3af'; el.textContent = 'Đang kiểm tra...';
  const res = await send({ type: 'checkBalance' });
  if (res.ok) { el.style.color = '#4ade80'; el.textContent = `✓ Key hợp lệ. Tổng đơn hàng: ${Array.isArray(res.data) ? res.data.length : 0}`; }
  else { el.style.color = '#f87171'; el.textContent = `✗ ${res.error}`; }
});

// ─── Tab Purchase ─────────────────────────────────────────────────────────────

document.getElementById('savePurchase').addEventListener('click', async () => {
  await send({ type: 'saveSettings', settings: {
    loaiproxy: document.getElementById('loaiproxy').value,
    proxyType: document.getElementById('proxyType').value,
    ngay:      Number(document.getElementById('ngay').value) || 1,
    proxytk:   document.getElementById('proxytk').value.trim(),
    proxymk:   document.getElementById('proxymk').value.trim(),
  }}); showToast('Đã lưu');
});

// ─── Load settings ────────────────────────────────────────────────────────────

async function loadSettings() {
  const s = await browser.storage.local.get([
    'apiUrl','apiKey','loaiproxy','proxyType','ngay','proxytk','proxymk',
  ]);
  document.getElementById('apiUrl').value    = s.apiUrl    || '';
  document.getElementById('apiKey').value    = s.apiKey    || '';
  document.getElementById('loaiproxy').value = s.loaiproxy || 'Viettel';
  document.getElementById('proxyType').value = s.proxyType || 'HTTP';
  document.getElementById('ngay').value      = s.ngay      || 1;
  document.getElementById('proxytk').value   = s.proxytk   || '';
  document.getElementById('proxymk').value   = s.proxymk   || '';
}

loadSettings();
refreshProxy();
refreshGroups();
initTreeInput();
