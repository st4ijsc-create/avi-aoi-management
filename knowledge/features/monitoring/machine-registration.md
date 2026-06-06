# Đăng ký máy (Machine Registration)

## 1. Mục đích
Quản lý đăng ký máy AOI / AVI: phê duyệt yêu cầu đăng ký từ máy, từ chối, cấp / hủy API Key, gán máy vào Station, chỉnh sửa thông tin máy. Đây là điều kiện tiên quyết để máy có quyền gửi dữ liệu kiểm tra và ảnh lên hệ thống.

## 2. Vị trí truy cập
- URL: `/machine-registration`
- Menu: **Cấu hình › Quản lý máy › Đăng ký máy**
- File trang: `client/src/pages/MachineRegistration.tsx`

## 3. Quyền yêu cầu
- Permission key: `admin_system`
- Vai trò: Admin / IT.

## 4. Tiền điều kiện
- Cấu trúc nhà máy đã khai báo: Factory → Workshop → Line → **Station** (máy phải gán vào Station).
- Máy đã gửi **registration request** lên server (ví dụ qua firmware boot-up).
- Người dùng có quyền `admin_system`.

## 5. Các bước thao tác
1. Mở **Cấu hình › Quản lý máy › Đăng ký máy** hoặc truy cập `/machine-registration`.
2. Tab **Pending**: bảng các máy đang chờ phê duyệt với cột: Mã máy, Tên, Loại, Serial Number, Firmware, Ngày yêu cầu.
3. Phê duyệt máy:
   - Click **Approve** trên dòng máy.
   - Trong dialog: xác nhận / chỉnh sửa **Mã máy**, **Tên máy**, chọn **Station** từ dropdown.
   - Bấm **Approve** → hệ thống tạo bản ghi máy active, sinh **API Key** mới.
4. Từ chối đăng ký:
   - Click **Reject**, nhập **lý do từ chối** trong dialog, bấm **Reject**.
   - Máy bị xoá hoặc đánh dấu `rejected`.
5. Tab **All Machines**: danh sách máy đã active với cột Mã, Tên, Loại, Serial, Firmware, API Key (ẩn), Status, Created At.
6. Xem API Key:
   - Click **eye icon** trên dòng → API Key hiện 20 ký tự đầu.
   - Bấm **Copy** để copy vào clipboard (gửi cho team triển khai máy).
7. Chỉnh sửa máy:
   - Click **Edit** → dialog: cập nhật Mã máy, Tên, đổi Station → **Update**.
8. Hủy phê duyệt (revoke):
   - Click **Revoke** → xác nhận → máy quay lại trạng thái pending (hoặc bị disable, tùy cấu hình).
9. (Tuỳ chọn) Dùng ô **Search** lọc theo Mã máy / Tên máy.

## 6. Kết quả mong đợi
- Máy được phê duyệt xuất hiện ở tab **All Machines**, có API Key dùng được ngay với REST API máy.
- Máy bị từ chối không còn ở Pending, log audit ghi nhận lý do.
- Đổi Station thành công cập nhật `stations.id` của máy.
- Revoke chuyển máy về trạng thái không còn quyền gửi dữ liệu.

## 7. Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Không thấy máy ở tab Pending | Máy chưa gửi registration request; firmware lỗi; request bị reject trước đó | Kiểm tra firmware máy đã chạy registration; xem `machines.registrationStatus` trong DB |
| Phê duyệt thất bại | Station không tồn tại; máy đã được phê duyệt; lỗi DB | Đối chiếu Station list; kiểm tra `registrationStatus`; xem log server |
| API Key không hiển thị | Sinh key thất bại; quyền user thiếu | Bấm **Regenerate API Key**; kiểm tra quyền `admin_system` |
| Máy đã phê duyệt nhưng không gửi được dữ liệu | Sai API Key trên máy; bị Revoke; firewall chặn | Copy lại API Key từ trang này, cập nhật firmware máy; kiểm tra `registrationStatus = approved` |

## 8. API liên quan
- tRPC `machine.listPending` – danh sách máy chờ phê duyệt.
- tRPC `machine.list` – danh sách máy đã phê duyệt.
- tRPC `machine.approve` – phê duyệt + cấp API Key + gán Station.
- tRPC `machine.reject` – từ chối với lý do.
- tRPC `machine.update` – cập nhật thông tin máy / revoke.
- tRPC `station.list` – danh sách Station cho dropdown.
- REST `POST /api/machine/submit-inspection` – máy dùng `apiKey` để gửi kết quả.
- REST `POST /api/machine/upload-image` – máy upload ảnh measurement.
- Bảng DB: `machines`, `stations`.

## 9. Tính năng liên quan
- **Lịch sử kiểm tra** (`../inspection/history.md`) – dữ liệu máy gửi lên hiển thị tại đây.
- **Gói ảnh AOI** (`../inspection/aoi-packages.md`) – ZIP packages máy upload.
- **Quản lý Station / Line / Workshop** – tiền đề để có Station gán máy.
- **MQTT / Heartbeat máy** – theo dõi trạng thái online sau khi đăng ký.

## 10. Ví dụ thực tế
> IT triển khai máy AOI mới `AOI-LINE3-02` cho line 3:
> 1. Bật máy → firmware tự gửi registration request lên server.
> 2. Admin vào **Đăng ký máy**, tab **Pending** → thấy máy `AOI-LINE3-02` (Serial `SN-AOI-2024-0142`, Firmware `1.4.2`).
> 3. Click **Approve** → trong dialog: Mã máy `AOI-LINE3-02`, Tên `AOI Line 3 - Slot 2`, chọn Station `LINE3-ST02` → **Approve**.
> 4. Trang chuyển sang tab **All Machines** với máy mới. Click **eye icon** → copy API Key.
> 5. Gửi API Key cho kỹ thuật viên cấu hình lên máy.
> 6. Sau vài phút, vào **Lịch sử kiểm tra** lọc Machine Code = `AOI-LINE3-02` → thấy bản ghi đầu tiên = đăng ký thành công.
