# Đợt 8.5 — Node OT của Luồng AI ở CHẾ ĐỘ MÔ PHỎNG (kế hoạch ngắn)

Spec: `docs/superpowers/specs/2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md` §4.5 (nhóm OT), §4.6 (hạng `ot`),
§6 hàng 8.5. Thiết kế hàng rào: `docs/superpowers/specs/2026-09-06-ai-local-L7-thiet-ke-hang-rao-dieu-khien.md`.
Quyết định D4 của chủ dự án: Luồng chạm OT bản đầu **CHỈ đọc + đề xuất ở chế độ mô phỏng**.

## Ràng buộc cứng (không thương lượng trong pha này)

- Không gửi lệnh nào tới thiết bị/PLC/bộ mô phỏng; không bật `AI_OT_CONTROL_ENABLED`; không sửa `.env`; không ghi
  `parameter_guardrails` / `command_log` / cờ `writable` của tag.
- Chế độ mô phỏng là **HẰNG SỐ** trong mã (`CHE_DO_MO_PHONG = true`), không cờ env nào tắt được.
- Không sửa tệp FOE, không sửa `aiControlGate.ts` hay lưới của nó.

## Quyết định thiết kế

1. **Một hàm bao duy nhất** `server/services/flow/ot/congOtLuong.ts#kiemVaDeXuat()` — điểm DUY NHẤT trong
   `server/services/flow/**` chạm `aiControlGate` (`phanLoaiMuc` + `kiemCongAi`). Fail-closed: lệnh/tag/tham số không nhận
   ra ⇒ mức 5. Thêm lớp chặt hơn cổng chung cho riêng đường Luồng: tên lệnh khớp CHÍNH XÁC (không hạ chữ, không cắt khoảng
   trắng), tag phải đúng khuôn ASCII + chuẩn hoá NFKC/bỏ dấu nối rồi soi lại khuôn tag an toàn + phải TỒN TẠI trong
   `device_tags` của máy (đọc) — không thì mức 5.
   `kiemCongAi` được gọi với `env: {}` (cờ AI luôn coi là TẮT trên đường này), bộ đếm riêng, `tieuQuota: false` ⇒ kết quả
   KHÔNG BAO GIỜ là `choPhep: true`; nếu có ⇒ ném (bất biến).
2. **Đề xuất = hàng chờ duyệt của Luồng (`ai_flow_waits`, kind `duyet`)**, KHÔNG phải `proposeAction`. Lý do:
   - `proposeAction` cần một `Tool` ĐĂNG KÝ trong `toolRegistry` ⇒ tool ấy lộ ra cho model chat, và `confirmAction` chạy
     `tool.execute()` — tức là một ĐƯỜNG THỰC THI tồn tại theo cấu tạo; còn có nhánh tự trị D2 tự confirm.
   - Hàng `ai_pending_actions` gắn với MỘT người (người đề xuất = người duyệt, token = id); lượt Luồng chạy nền
     (cron/webhook/MCP) không có phiên người dùng.
   - Hàng chờ của Luồng: duyệt theo vai trên trang duyệt sẵn có (`flow.danhSachCho` / `flow.duyet`), có hạn, sống qua sập,
     và **không có hàm thực thi nào gắn vào** — đồng ý chỉ đẩy item sang cổng `dong-y` kèm
     `thucThi: { moPhong: true, daGui: false, ghiChu: "đã duyệt (mô phỏng) — không gửi", ketQuaGiaLap }`.
   Đánh dấu `nguon: "luong-ai"`, `moPhong: true` trên payload hàng chờ và trên item.
3. Node (tệp `server/services/flow/nut/ot.ts`):
   - `ot.doc-tag` (hạng `doc`, idempotent) — đọc qua `server/db/otTelemetry.ts#getLatestTelemetry` (CHỈ đọc); nguồn tiêm
     được cho lưới.
   - `ot.de-xuat-lenh` (hạng `ot`, `atMostOnce`) — tham số `may`/`lenh`/`tag`/`giaTri` (biểu thức) ⇒ `kiemVaDeXuat`.
     Mức 4–5 ⇒ lỗi node (không hàng chờ). Mức ≤ 3 ⇒ chờ duyệt (mô phỏng). Item ra `{ deXuatId, muc, ketQua }`.
   - `ot.de-xuat-luong` (hạng `ot`, `atMostOnce`) — `workflowId` + `version` của FOE workflow `active` (đọc bảng
     `orchestration_workflows`/`_versions`, không import động cơ FOE). Mức = max mức các bước `command` (cùng bảng tra);
     không gọi `startRun`.
4. `flowRouter`: bật phiên bản hạng `ot` ⇒ thủ tục MỚI `flow.batLuongOt` trên `deployProcedure.use(moduleGate("MOD_AI"))`
   + `meta.chanTruocStepUp` (admin + hạng `ot`, chặn TRƯỚC khi tiêu OTP). `datPhienBanHoatDong(bat: true)` và `chayTay`
   phiên bản `ot` chưa bật ⇒ từ chối (không còn là đường vòng). `duyet` gắn kết quả mô phỏng cho hàng chờ `luong-ai`.

## Lưới

- `server/services/flow/ot/congOtLuong.test.ts` — bộ đột biến ≥ 20 yêu cầu mức 4–5 ⇒ 0 đề xuất; ≥ 5 stop/pause ⇒ đề xuất.
- `server/services/flow/ot/otMoPhong.db.test.ts` — cùng bộ qua ĐỘNG CƠ thật, đếm `ai_flow_waits`; duyệt ⇒ "mô phỏng —
  không gửi"; `command_log` không đổi; `ot.doc-tag` nguồn giả; `ot.de-xuat-luong`.
- `server/services/flow/ot/otLuongCensus.test.ts` — census AST: 0 import/gọi đường thực thi trong `server/services/flow/**`;
  ∀ node hạng `ot` của sổ đăng ký gọi `kiemVaDeXuat`; chỉ `congOtLuong.ts` import `aiControlGate`; tự kiểm bộ quét bằng đột biến.
- `server/routers/flowRouterOt.db.test.ts` — quyền: engineer bị từ chối, admin không 2FA bị từ chối, thiếu OTP bị từ chối,
  admin + OTP được; `datPhienBanHoatDong`/`chayTay` không còn mở được luồng `ot`.
- Ghim census (khuôn "Đợt 8.x"): `phamViDocCensus`, `congGiayPhepAiCensus`, `deployStepUpFreshness`.
