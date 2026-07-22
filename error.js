function setHTML(el, html) {
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  el.replaceChildren(...doc.body.childNodes);
}

const params  = new URLSearchParams(location.search);
const reason  = params.get('reason') || 'error';
const group   = params.get('group')  || '';
const origUrl = params.get('url')    || '';

const REASONS = {
  expiring: {
    badge: 'reason-expiring',
    icon:  '⚡',
    label: 'Proxy sắp hết hạn',
    desc:  'Proxy của group <span class="group-name">' + group + '</span> còn dưới 5 phút. Kết nối đã bị tạm chặn để tránh lộ IP.',
  },
  expired: {
    badge: 'reason-expired',
    icon:  '⏰',
    label: 'Proxy đã hết hạn',
    desc:  'Proxy của group <span class="group-name">' + group + '</span> đã hết hạn và chưa được gia hạn.',
  },
  renewing: {
    badge: 'reason-renewing',
    icon:  '🔄',
    label: 'Đang gia hạn proxy',
    desc:  'Proxy của group <span class="group-name">' + group + '</span> hết hạn và đang được gia hạn tự động.',
  },
  no_proxy: {
    badge: 'reason-no_proxy',
    icon:  '🚫',
    label: 'Chưa có proxy',
    desc:  'Group <span class="group-name">' + group + '</span> chưa được cấu hình proxy.',
  },
  error: {
    badge: 'reason-error',
    icon:  '⚠️',
    label: 'Proxy bị lỗi',
    desc:  'Proxy của group <span class="group-name">' + group + '</span> không hoạt động.',
  },
};

var info = REASONS[reason] || REASONS.error;
document.getElementById('icon').textContent        = info.icon;
document.getElementById('reasonBadge').className   = 'reason-badge ' + info.badge;
document.getElementById('reasonBadge').textContent = info.label;
setHTML(document.getElementById('desc'), info.desc);
document.getElementById('siteUrl').textContent     = origUrl || '(không rõ URL)';

if (reason === 'renewing') {
  document.getElementById('renewingNote').style.display = 'block';
  var secs = 60;
  var cd = document.getElementById('countdown');
  var timer = setInterval(function () {
    secs--;
    cd.textContent = secs;
    if (secs <= 0) {
      clearInterval(timer);
      if (origUrl) { window.location.href = origUrl; }
    }
  }, 1000);
}

function retryOriginal() {
  if (origUrl) { window.location.href = origUrl; }
  else { history.back(); }
}

document.getElementById('btnBack').addEventListener('click', function () {
  if (history.length > 1) { history.back(); } else { window.close(); }
});
document.getElementById('btnRetry').addEventListener('click', retryOriginal);
document.getElementById('btnSettings').addEventListener('click', function () {
  browser.runtime.openOptionsPage();
});
