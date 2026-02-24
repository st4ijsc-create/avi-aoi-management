# Lỗi Browser Extension

## Nguyên nhân
Lỗi "A listener indicated an asynchronous response..." xuất hiện khi:
- Browser extension đang inject code vào trang của bạn
- Extension cố gắng giao tiếp nhưng connection bị đóng

## Các extension thường gây lỗi này:
- Grammarly
- LastPass / Password Managers
- Ad Blockers (AdBlock, uBlock Origin)
- React/Redux DevTools (khi chạy production build)
- Translation extensions
- Screenshot/Recording tools

## Cách kiểm tra:
1. Mở Chrome/Edge trong chế độ ẩn danh (Ctrl + Shift + N)
2. Truy cập http://localhost:3000/corporate-management
3. Nếu lỗi biến mất → Xác nhận là do extension

## Cách khắc phục:
1. **Disable extensions khi development** (khuyến nghị)
2. **Suppress lỗi** (chỉ ẩn warning, không fix gốc)
3. **Ignore** - lỗi không ảnh hưởng đến chức năng app
