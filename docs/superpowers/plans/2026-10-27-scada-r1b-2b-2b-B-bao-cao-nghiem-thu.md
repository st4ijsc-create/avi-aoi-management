# R1b-2b-2b Phần B — Báo cáo nghiệm thu (B-T12)

Ngày chạy: 2026-11-03. Cây: `_scada_ui_wt` @24c01c2d4 (main đã có B-T3 ở 4753ac21d). Bản :3000 được kiểm: BUILD-INFO commit 5263a601c (có B-T3 và C1–C5). Người chạy: scada-ui.

## 1. Task → commit → test → kết quả

| Task | Commit chính | Test | Đột biến | Rà soát |
|---|---|---|---|---|
| B-T1 i18n 429 thủ tục | c638e5a21, 72ac59238 | trpcErrors.gioiHanThuTuc.unit | có (commit) | scada-master |
| B-T2 DOM I-2 mức quá cao | 825c7781f | 6 tệp `*.mucQuaCao.dom` | có | — |
| B-T3 posture theo bước | 345076c4b, 24c01c2d4 | EngineeringHub.dom (51) | có, thêm ca count 0 | dieu-phoi (kiem-dinh tắt) |
| B-T4 ngăn tag không gọi khi thiếu quyền | f1b189116 | NganTagAdapter.quyenKenh.dom | có | — |
| B-T5 M12 tìm kiếm | 5f47a24a1 | BangKenh.timKiem.dom | có | — |
| B-T6 cảnh báo nguồn ứng viên | 98fa3b3bc | KenhCheDoMay.ungVien.dom | có | kiem-dinh ĐẠT |
| B-T7 chip n/m + che endpoint/lỗi | 0c122710e | ChipTruyenThong.dom, ScadaDiag.dom | có | kiem-dinh ĐẠT |
| B-T8 nhật ký lệnh | 94c4bb608, 23d74adf2 | ScadaNhatKy.dom | có | — |
| B-T9 Lab thử đọc | 479064e07, 761a42a8a | KhoiThuDocDiaChi.dom | có (b6, b12, b13) | kiem-dinh |
| B-T10 mở khoá TOTP | 2b92bb207 | Users.moKhoaTotp.dom | có | — |
| B-T11 điều kiện cho phép | 0b88062e8, 002e39e73 | Faceplate.dieuKien.dom | 5 đột biến sống của kiem-dinh đã ghim | kiem-dinh ĐẠT |

## 2. Phần máy (không cần :3000)
- Chạy lại 29 tệp test B-T1–B-T11: 3 lượt tuần tự, mỗi lượt 29/29 tệp, 493/493 ca xanh.
- Đột biến hệ thống: ChipTruyenThong gộp edge vào `tong` + ScadaNhatKy gắn "sim" theo `simulated` ⇒ 8 ca đỏ (3 ChipTruyenThong, 4 BangTruyenThong, 1 ScadaNhatKy). Hoàn tác bằng `git checkout --`, diff sạch, hai tệp xanh lại 30/30.
- `npm run i18n:check`: 0 lệch placeholder, 0 khoá mới thiếu, 0 vi phạm baseline (nợ đóng băng 332 có từ trước).
- `tsc --noEmit` (12 GB): mã 0. `tsc --noEmit -p tsconfig.tests.json` (check:tests, 12 GB): mã 0.
- `node scripts/luoi-truoc-gop.mjs --nang client/src`: lô thường 8178 ca, 0 đỏ, 0 tệp đỏ. Lô DB: `client/src` không có tệp `*.db.test.*` nên vitest báo "No test files found", script thoát mã 2 vì lô rỗng, không phải đỏ. Đã kiểm lại bằng lệnh tay.
- Ghi chú: lượt `vitest run client/src` đầu tiên có 1 ca đỏ ở `EngineeringWorkspace.workbench.dom.test.tsx` (không thuộc Phần B), chạy riêng 50/50 xanh, và lượt luoi-truoc-gop sau đó 0 đỏ ⇒ đỏ do tải.

## 3. Live trên :3000 (DEV, chỉ đọc, `engineer1` và `operator1`)
Không tạo đối tượng `BT12-` (dieu-phoi quyết định không tạo dữ liệu trên DEV). Danh sách `BT12-` rỗng. Không xác nhận thẻ duyệt, không gửi lệnh, không DỪNG MÁY, không đổi LOCAL/REMOTE.

| Bước | Kết quả |
|---|---|
| Bản chạy | ĐẠT: dist có `dieuKienChoPhep`, `tomTatTruyenThong`, `thuDocDiaChi`, `nhatKy`; bundle có `posture-stop-qua-han-buoc`. |
| 1 chip (B-T7) | ĐẠT một phần: engineer1 thấy "Truyền thông 0/15" ở `/scada/diag` và `/scada/config/channels`, bấm ⇒ `/scada/diag`. API: ketNoi 0, khac 15, tong 15, edge 0. operator1 (không canView) không có chip. Không kiểm được ca edge, ca lỗi và endpoint/lỗi bị che: DEV không có adapter edge, không có adapter lỗi (cả 15 "Đã tắt", `loi` rỗng). |
| 2 UnifiedDeviceMonitor | CHƯA LÀM live ("thử kết nối lỗi" không chạy). Có DOM test. |
| 3 nhật ký (B-T8) | KHÔNG CÓ DỮ LIỆU: `/scada/journal` có 0 bản ghi trên DEV; bộ lọc hiện đủ 15 máy. Nhãn "sim", MOT_PHAN, phạm vi operator, "tải thêm": chỉ dựa DOM test; đợi Pha 0 (_sim). |
| 4 Lab (B-T9) | ĐẠT một phần: engineer1 thấy khối "Thử đọc một địa chỉ (Lab)" với chữ "Chỉ đọc — không ghi xuống thiết bị", ô địa chỉ, kiểu dữ liệu, lý do ≥ 5. KHÔNG bấm Đọc (ghi audit vào DEV). Kết quả thành công/timeout/no_sample, adapter edge, operator không có khối: chưa xác minh live. |
| 5 faceplate (B-T11) | KHÔNG CÓ DỮ LIỆU: chưa khai kênh/tag ghi được có dải. Chỉ dựa DOM test; đợi Pha 0. |
| 6–7 M12 (B-T5/6) | Hộp "Đặt kênh chế độ" mở được, chọn tag good_count/line_speed/reject_count/torque không hiện cảnh báo nguồn (API `canhBaoNguon` null ở mọi máy). Cảnh báo nguồn và tìm kiếm không dấu: chưa xác minh live. Không lưu. |
| 8 B-T4 | ĐẠT: operator1 (không `machine_control.canView`) mở `/scada/diag`: không có lệnh `scadaKenh.danhSach` nào (xem mục 4 về `scadaKenh.cheDo.danhSach`). |
| 9 B-T3 | ĐẠT trong giới hạn count 0 (DEV có 0 dòng STOP_QUA_HAN): dòng "STOP HMI bị từ chối vì quá hạn (24 h): 0", khối danh sách bước ẩn; vi/en/zh đổi đúng; quay lại tab khi dữ liệu quá 10 s ⇒ 1 request `oversight.posture`, trong 10 s ⇒ không có, không polling. Danh sách theo bước và `khongGhiSo`: chỉ dựa DOM test. |
| 10 429 (B-T1) | KHÔNG XÁC MINH B-T1 live. Bắn 423 request đọc `scadaDiag.tomTatTruyenThong` bằng phiên engineer1 thì nhận HTTP 429 từ limiter chung (300/phút, Retry-After 10 s, thân "Too many requests"). Đó là limiter Express, không phải lỗi `TRPC_GIOI_HAN_THU_TUC` của thủ tục mà B-T1 dịch ⇒ không có toast "thử lại sau N giây". Dừng ngay ở lần 429 đầu. |
| 11 B-T2 | Không làm live (cần AI_OT_CONTROL, ngoài phạm vi); đã ghim bằng DOM test. |
| 12 B-T10 | Chưa xác minh live — chủ dự án có thể tự xem. |

## 4. Quan sát và giới hạn
- `scadaKenh.cheDo.danhSach` vẫn bị gọi ở `/scada/diag` và `/scada/journal` khi người dùng không có `machine_control.canView` ⇒ 403 ×3 trong ~10 s, lỗi ra console (operator1). Không phải thủ tục B-T4 ghim. Backlog (việc nhỏ sau B-T12): chặn query theo quyền ở client + thêm test.
- Chip "m" đếm adapter có `is_enabled=true` (hợp đồng C2), nên DEV hiện 0/15 dù bảng ghi cả 15 là "Đã tắt" (trạng thái chạy, không phải cờ bật). Đúng hợp đồng nhưng có thể gây hiểu nhầm; cần chủ dự án quyết nhãn.
  - **Đã xử lý 2026-11-04 (quyết định chủ dự án):** chip đổi nhãn `0/15` → "Truyền thông N nối · M tắt" (+ nối lại / mất / edge khi > 0); hợp đồng C2 giữ nguyên. Commit c84786850 (nhánh feat/scada-chip-bat-tat), chờ kiem-dinh. Mục "1 chip" ở bảng live trên đây phản ánh nhãn cũ.
- Phần live còn thiếu dữ liệu (nhật ký, kênh/tag ghi được, adapter lỗi/edge, STOP_QUA_HAN): ghi "không có dữ liệu trên DEV — đợi Pha 0 (_sim, :3071)".

## 5. LOGIC · DỮ LIỆU · VẬN HÀNH
- LOGIC: 29 tệp test Phần B xanh 3/3 lượt, đột biến hệ thống đỏ 8 ca, tsc và check:tests mã 0, i18n sạch.
- DỮ LIỆU: không ghi gì vào DEV, không tạo `BT12-`, không hàng WORM; Lab không bấm Đọc.
- VẬN HÀNH: :3000 đúng bản; phiên làm việc dùng seed `operator1` và `engineer1` (không 2FA, không admin); gây một đợt 429 HTTP ~423 request trong khoảng 1 phút từ một nguồn (có thể chạm người dùng cùng IP ≤ 10 s).
