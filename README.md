# VN Proxy Manager

Browser extension để quản lý proxy — mua, gia hạn, và tự động áp dụng proxy cho các site đã chọn.

## Trình duyệt hỗ trợ

| Browser | Manifest | Cơ chế proxy | Ghi chú |
|---|---|---|---|
| Firefox | `manifest_ff.json` | `browser.proxy.onRequest` (MV2) | SOCKS5 + HTTP, đầy đủ tính năng |
| Brave / Chrome | `manifest_ch.json` | PAC script + declarativeNetRequest (MV3) | Chỉ dùng **HTTP proxy** |

> **Chrome/Brave**: SOCKS5 với username/password không hoạt động do Chrome không pass credentials qua SOCKS5 handshake. Chọn giao thức **HTTP** khi mua proxy.

---

## Cài đặt (Development)

### Firefox
1. Chạy `.\dev-ff.ps1` để set manifest Firefox
2. Mở `about:debugging` → **This Firefox** → **Load Temporary Add-on...**
3. Chọn `manifest.json`

### Brave / Chrome
1. Chạy `.\dev-ch.ps1` để set manifest Chrome MV3
2. Mở `brave://extensions` hoặc `chrome://extensions`
3. Bật **Developer mode** → **Load unpacked** → chọn thư mục

---

## Build & Deploy

```powershell
.\build-ff.ps1   # → dist/vnproxy_firefox.xpi  (Firefox)
.\build-ch.ps1   # → dist/vnproxy_chrome.zip   (Chrome Web Store)
```

---

## Tính năng

### Tab Status
- Trạng thái proxy: host:port, giao thức, proxy ID, thời gian còn lại
- **IP qua proxy**: kiểm tra IP thực tế, tự động cập nhật sau mỗi lần thay đổi proxy
- **Mua proxy mới**: kiểm tra proxy còn hạn trong tài khoản trước khi mua tránh mua trùng
- **Gia hạn**: giữ nguyên username/password, cập nhật host/port/expiry từ API
- **Tải từ tài khoản**: load proxy từ tất cả đơn hàng, chọn "Dùng" để set active

### Tab URLs
- Tổ chức domain thành groups
- **Tree view**: click header để expand/collapse
- **Thêm domain**: `shopee.vn, lazada.vn` → Enter, hoặc `@Shopping:shopee.vn, lazada.vn`
- **Autocomplete `@`**: gợi ý group hiện có khi gõ `@`
- **Drag & drop**: kéo URL giữa groups hoặc sắp xếp thứ tự; kéo `⠿` để đổi thứ tự group
- **Deduplication**: URL trùng tự chuyển sang group mới nhất
- Auto-save 250ms sau mỗi thay đổi

### Tab Tài khoản proxy
- API URL + API key: cấu hình và xác minh
- Cài đặt mua: loại proxy, giao thức (HTTP/SOCKS5), số ngày, username/password

### Kill switch
- Domain trong list mà proxy down/hết hạn → **block hoàn toàn**, không fallback về IP thật
- Chrome/Brave: kill switch kích hoạt **5 phút trước** khi proxy hết hạn để tránh gap leak
- Trang lỗi giải thích lý do + nút Thử lại

### Popup (toolbar icon)
- Countdown, host:port, giao thức, IP thực tế qua proxy
- Danh sách groups

---

## API

**Base URL:** cấu hình trong tab Tài khoản proxy  
**Auth:** `?key=YOUR_KEY`  
**Method:** GET

| `sukien` | Mô tả |
|---|---|
| `mua` | Mua proxy → `order_code` |
| `listproxy` | Chi tiết proxy theo `ma_don_hang` hoặc `idproxy+loaiproxy` |
| `gia_han` | Gia hạn proxy |
| `doi_proxy` | Đổi giao thức HTTP ↔ SOCKS5 |
| `listorder` | Liệt kê đơn hàng |

**Flow mua (2 bước):**
```
1. ?sukien=mua&loaiproxy=...&quantity=1&ngay=1&type=HTTP&proxytk=user&proxymk=pass
   → {"maloi":0,"order_code":"KPD02896"}

2. ?sukien=listproxy&ma_don_hang=KPD02896
   → [{"idproxy":"...","proxy":"IP:PORT:user:pass","time":"1753375023","type":"HTTP",...}]
```

`time` = Unix timestamp giây = thời điểm hết hạn

**Mã lỗi:**

| Mã | Nghĩa |
|---|---|
| 405 | API key sai |
| 404 | Thông số sai |
| 100 | Thiếu thông số |
| 103 | Số dư không đủ |
| 101 | Lỗi không xác định |

---

## Bảo mật & Privacy

### Checklist

| Biện pháp | Cách fix |
|---|---|
| IP leak | Proxy đang hoạt động ✓ |
| IPv6 leak | Tắt IPv6 ở OS |
| WebRTC leak | `about:config` → `media.peerconnection.enabled = false` |
| Timezone leak | Extension Chameleon hoặc `privacy.resistFingerprinting = true` |
| Language leak | Đổi browser language sang vi/en |

### IPv6 (Windows)
```powershell
Disable-NetAdapterBinding -Name "*" -ComponentID ms_tcpip6  # Tắt
Enable-NetAdapterBinding  -Name "*" -ComponentID ms_tcpip6  # Bật lại
```

### Proxy mechanism
- **Firefox**: `proxyDNS: true` → DNS đi qua proxy
- **Chrome/Brave**: PAC script, DNS resolved locally trước khi gửi qua proxy

### Kill switch
Không có direct fallback. Domain trong list luôn bị block khi proxy không hoạt động.

---

## Mozilla Add-on Signing

Submit lên [addons.mozilla.org/developers](https://addons.mozilla.org/developers) → "On your own":

**Yêu cầu `manifest_ff.json`:**
```json
"browser_specific_settings": {
  "gecko": {
    "strict_min_version": "142.0",
    "data_collection_permissions": { "required": ["none"], "optional": [] }
  }
}
```

**Pass conditions (không có error/warning):**

| Yêu cầu | Chi tiết |
|---|---|
| `strict_min_version >= 142.0` | Desktop 140+, Android 142+ |
| `data_collection_permissions.required` | Phải có ≥1 item — dùng `"none"` |
| Icon PNG | Không dùng SVG (Windows backslash lỗi archive) |
| Không inline `<script>` | Tách ra file `.js` riêng |
| Không inline event handler | Dùng `addEventListener` trong JS |
| Không `innerHTML` dynamic | Dùng `DOMParser.parseFromString` |
| Upload `.zip` | Không upload `.xpi` |

---

## Cấu trúc files

```
vnproxy/
├── manifest.json            Active manifest (dev, swap bằng dev-ff/dev-ch)
├── manifest_ff.json         Firefox MV2
├── manifest_ch.json         Chrome/Brave MV3
├── background.js            Firefox: proxy.onRequest + kill switch
├── background_chrome.js     Chrome/Brave: PAC + declarativeNetRequest
├── polyfill.js              Chrome compatibility (browser.* → chrome.*)
├── error.html / error.js    Trang lỗi khi proxy down
├── popup/
├── options/
├── icons/
├── build-ff.ps1             Build Firefox .xpi
├── build-ch.ps1             Build Chrome .zip
├── dev-ff.ps1               Swap sang Firefox manifest
└── dev-ch.ps1               Swap sang Chrome manifest
```
