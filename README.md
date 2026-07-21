# VN Proxy Manager

Firefox/Brave extension để quản lý proxy — mua, gia hạn, và tự động áp dụng proxy cho các site đã chọn.

## Trình duyệt hỗ trợ

| Browser | Manifest | Cơ chế proxy | Ghi chú |
|---|---|---|---|
| Firefox | `manifest.json` | `browser.proxy.onRequest` | SOCKS5 + HTTP, đầy đủ tính năng |
| Brave / Chrome | `manifest_chrome.json` | PAC script (`chrome.proxy.settings`) | Chỉ dùng **HTTP proxy** — SOCKS5 có auth không hoạt động |

> **Chrome/Brave**: khi mua proxy chọn giao thức **HTTP**. SOCKS5 với username/password thất bại do Chrome không pass credentials vào SOCKS5 handshake qua webRequest API.

---

## Mozilla Add-on Signing (Firefox)

Để ký extension qua [addons.mozilla.org/developers](https://addons.mozilla.org/developers) → Submit → "On your own" (self-distribution):

**Yêu cầu manifest_ff.json phải có:**
```json
"browser_specific_settings": {
  "gecko": {
    "strict_min_version": "128.0",
    "data_collection_permissions": {
      "required": ["none"],
      "optional": []
    }
  }
}
```

**Điều kiện để pass validation không có ERROR:**

| Yêu cầu | Chi tiết |
|---|---|
| `strict_min_version >= 142.0` | Desktop cần >=140, Firefox for Android cần >=142 — dùng 142 để cover cả hai |
| `data_collection_permissions` | Bắt buộc. `required` phải có ≥1 item — dùng `"none"` (không thu thập dữ liệu) |
| Icon dùng PNG | SVG gây lỗi path separator trên Windows khi zip |
| Không inline `<script>` | Tách toàn bộ JS ra file riêng |
| Không inline event handler | Không dùng `onclick=`, `onload=` trong HTML — dùng `addEventListener` trong JS |
| Không `innerHTML =` dynamic | Dùng `DOMParser.parseFromString('<body>'+html+'</body>', 'text/html')` |
| Không `createContextualFragment` | Cũng bị flag — dùng DOMParser thay thế |
| Không `insertAdjacentHTML` | Cũng bị flag — dùng DOMParser thay thế |
| Upload `.zip` lên AMO | Không upload `.xpi` khi submit để ký |

**Không còn warnings nào** khi dùng `strict_min_version: "142.0"`. Desktop 140+, Android 142+ — lấy max = 142.

**Build:** `.\build-ff.ps1` → tạo `dist\vnproxy_firefox.xpi` (đã là forward-slash, không cần đổi tên)

---

## Cài đặt (Development)

### Firefox
1. Mở `about:debugging` → **This Firefox** → **Load Temporary Add-on...**
2. Chọn `manifest.json`

### Brave / Chrome
1. Đổi manifest:
   ```
   copy manifest.json manifest_firefox.json
   copy manifest_chrome.json manifest.json
   ```
2. Mở `brave://extensions` hoặc `chrome://extensions`
3. Bật **Developer mode** → **Load unpacked** → chọn thư mục `vnproxy`
4. Khôi phục Firefox sau khi test:
   ```
   copy manifest_firefox.json manifest.json
   ```

---

## Tính năng

### Tab Status
- Trạng thái proxy: host:port, giao thức, proxy ID, thời gian còn lại (countdown)
- **IP qua proxy**: tự động kiểm tra sau mỗi lần thay đổi proxy, nút refresh thủ công
- **Mua proxy mới**: gọi API `mua` (2 bước: mua → listproxy lấy chi tiết). Không cho phép mua lại khi proxy còn hạn
- **Gia hạn**: gọi API `gia_han`, giữ nguyên username/password, cập nhật host/port/expiry từ response
- **Xóa**: xóa proxy khỏi extension (không ảnh hưởng tài khoản nhà cung cấp)
- **Tải từ tài khoản**: load proxy từ tất cả đơn hàng, chọn "Dùng" để set active, toggle HTTP ↔ SOCKS5 từng proxy

### Tab URLs
- Tổ chức domain thành groups (Shopping, Social, v.v.)
- **Tree view thống nhất**: tất cả groups trong một khung, click header để expand/collapse
- **Thêm domain**: nhập `shopee.vn, lazada.vn` → Enter (vào group đầu tiên), hoặc `@Shopping:shopee.vn, lazada.vn` (vào group cụ thể)
- **Autocomplete `@`**: gõ `@` → dropdown gợi ý group, điều hướng ↑↓, chọn Enter/click
- **Drag & drop**: kéo URL giữa groups hoặc sắp xếp trong group; kéo `⠿` trên header để đổi thứ tự group
- **Deduplication**: URL đã tồn tại ở group khác tự chuyển sang group mới nhất
- **Sửa tên group**: nhấn ✎ → inline edit → Enter lưu / Escape hủy
- Auto-save 250ms sau mỗi thay đổi

### Tab Tài khoản proxy
- API URL và API key: nhập và xác minh với nhà cung cấp proxy
- Cài đặt mua: loại proxy, giao thức (HTTP/SOCKS5), số ngày, username/password proxy

### Kill switch
- Domain trong bất kỳ group nào mà proxy down/hết hạn → **request bị block hoàn toàn**, không fallback qua IP thật
- Điều hướng bị block → trang lỗi giải thích lý do (hết hạn / chưa có proxy / đang gia hạn) + nút Thử lại

### Popup (toolbar icon)
- Countdown thời gian còn lại, host:port, giao thức, IP thực tế qua proxy
- Danh sách groups đang cấu hình

---

## API

**Base URL:** cấu hình trong tab Tài khoản proxy
**Auth:** `?key=YOUR_KEY` (query param)
**Method:** GET

| `sukien` | Mô tả |
|---|---|
| `mua` | Mua proxy → `{"maloi":0,"order_code":"KPD02896"}` |
| `listproxy` | Chi tiết proxy theo `ma_don_hang` hoặc `idproxy+loaiproxy` |
| `gia_han` | Gia hạn proxy theo `idproxy+loaiproxy+ngay` |
| `doi_proxy` | Đổi giao thức HTTP ↔ SOCKS5 |
| `listorder` | Liệt kê đơn hàng |

**Flow mua (2 bước):**
```
1. ?sukien=mua&loaiproxy=Viettel&quantity=1&ngay=1&type=HTTP&proxytk=user&proxymk=pass
   → {"maloi":0,"order_code":"KPD02896"}

2. ?sukien=listproxy&ma_don_hang=KPD02896
   → [{"idproxy":"7257868","proxy":"103.x.x.x:PORT:user:pass",
       "time":"1753375023","type":"HTTP","loaiproxy":"Viettel",...}]
```

`time` = Unix timestamp giây = thời điểm hết hạn proxy

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

### Proxy mechanism
- **Firefox**: `proxyDNS: true` → DNS query đi qua proxy, không lộ qua ISP
- **Chrome/Brave**: PAC script, DNS resolved locally trước khi gửi qua proxy

### IPv6 leak (SOCKS5 trên Firefox)
Nếu máy có IPv6, browser có thể dùng IPv6 trực tiếp bypass proxy (endpoint IPv6-only).

```powershell
# Tắt IPv6 trên Windows
Disable-NetAdapterBinding -Name "*" -ComponentID ms_tcpip6
# Bật lại
Enable-NetAdapterBinding -Name "*" -ComponentID ms_tcpip6
```

### WebRTC leak
WebRTC đọc thẳng từ network interface, bypass proxy.

```
about:config → media.peerconnection.enabled = false
```

### Kill switch
Mọi domain trong danh sách đều bị block khi proxy không hoạt động. Không có direct fallback.

---

## Cấu trúc files

```
vnproxy/
├── manifest.json            Firefox MV2
├── manifest_chrome.json     Chrome/Brave MV2
├── background.js            Firefox: proxy.onRequest + API + kill switch
├── background_chrome.js     Chrome/Brave: PAC script + API + kill switch
├── polyfill.js              Chrome compatibility (browser.* → chrome.*)
├── error.html               Trang lỗi khi proxy down/hết hạn
├── popup/
│   ├── popup.html
│   └── popup.js
├── options/
│   ├── options.html
│   └── options.js           3 tab: Status · URLs · Tài khoản proxy
└── icons/
    ├── icon.svg
    ├── icon48.png
    └── icon96.png
```
