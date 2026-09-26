---
trang_thai: da_duyet
nguon: AI sinh tu ma nguon — CHU DU AN DA DUYET 2026-08-17
sinh_luc: 2026-08-17
route: /users
permission: admin_users
role: [admin]
module: CORE_ADMIN
license: CORE
nguoi_duyet: chu du an
ngay_duyet: 2026-08-17
do_day: day_du
o_trong: 1
---

> **THẺ VẬN HÀNH — ĐÃ DUYỆT** (chủ dự án, 2026-08-17). Dùng được làm căn cứ vận hành.
> Dòng nào ghi **CHƯA GHI LẠI** là quy trình nhà máy **chưa có tài liệu** — khi được hỏi đúng chỗ đó
> hãy trả lời thẳng là *chưa được ghi lại*, không suy đoán và không thay bằng tài liệu kỹ thuật nội bộ.

# Người dùng — xử lý sự cố & thao tác

## Thông tin đã xác minh từ mã nguồn
- **Đường dẫn**: `/users`
- **Menu**: Quản trị › Người dùng
- **Quyền yêu cầu**: `admin_users`
- **Vai trò giới hạn**: admin
- **Module / license**: `CORE_ADMIN` — CORE (luôn bật)
- **Router tRPC**: `userRouter` (server/routers/userRouters.ts, ~28 thủ tục)
- **Thao tác có thật ở backend**: `list`, `updateRole`, `delete`, `updateProfile`, `changePassword`, `setup2FA`, `verify2FA`, `disable2FA`, `get2FAStatus`, `getBackupCodesStatus`, `getSessions`, `revokeSession`, `revokeAllSessions`, `getMyAssignments` … (+2)

## Triệu chứng thường gặp

- Người dùng mới không đăng nhập được.
- Đổi vai trò rồi nhưng người dùng vẫn không thấy menu mới.
- Người dùng mất thiết bị 2FA, không vào được.
- Nghi ngờ tài khoản bị dùng trái phép.

## Nguyên nhân thường gặp

- Vai trò được nạp lúc đăng nhập — đổi vai trò xong người dùng phải đăng xuất/đăng nhập lại.
- Menu còn phụ thuộc license của module, không chỉ vai trò: đủ quyền nhưng module không có license thì vẫn không thấy.
- 2FA có bộ mã dự phòng (`getBackupCodesStatus`) — kiểm tra trước khi tính tới việc gỡ 2FA.
- Màn hình cần quyền `admin_users`.

## Các bước xử lý

- Mở `/users`, tìm tài khoản, đối chiếu vai trò hiện tại.
- Đổi vai trò nếu cần (`updateRole`), rồi yêu cầu người dùng đăng xuất và đăng nhập lại.
- Mất 2FA: kiểm tra trạng thái mã dự phòng trước; chỉ gỡ 2FA (`disable2FA`) khi đã xác minh danh tính người dùng.
- Nghi ngờ chiếm dụng: xem phiên đang mở (`getSessions`) và thu hồi phiên lạ (`revokeSession`), hoặc thu hồi tất cả (`revokeAllSessions`).
- ⬜ **CHƯA GHI LẠI** — thủ tục xác minh danh tính trước khi gỡ 2FA tại tổ chức này (ai xác nhận, ghi ở đâu)

## Cách xác nhận đã xong

- Người dùng đăng nhập lại và thấy đúng các mục menu của vai trò mới.
- Danh sách phiên chỉ còn phiên hợp lệ.
- Thao tác thay đổi vai trò/2FA có vết trong nhật ký kiểm toán (`/audit-logs`).
