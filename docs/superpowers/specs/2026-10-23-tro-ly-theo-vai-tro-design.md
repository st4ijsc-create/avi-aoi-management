# Trợ lý lập trình theo VAI TRÒ — thiết kế ngắn (2026-10-23, do-model; chờ dieu-phoi duyệt TRƯỚC khi làm)

## 1. Hiện trạng (đo, không suy)

- Mọi lượt sinh chữ của trợ lý lập trình (`/api/ai/local-kb/stream`, `codingMode`) đi qua MỘT cửa: `aiCodingAgent.streamCodingModel`
  → `planInference({ task: tacVuModel(y.tacVu) })` → engine nhận `plan.decision.modelId` = model của **bộ định tuyến CỔNG**
  (`AI_CODE_ROUTER_ENABLED` ⇒ `GGUF_CODE_MODEL` = 35B; người dùng chọn "fast" ⇒ model nhanh). Hai người gọi: nhánh SINH MÃ
  (`aiLocalKnowledgeCodingSinhMa.ts:295`) và nhánh SỬA TỆP (`aiLocalKnowledgeCodingSua.ts:952`). Vòng kiểm biên dịch ST mới
  (e7220eb9e) sửa trên CHÍNH model của lượt sinh (`onUsage.modelId`).
- ⇒ dự án PLC trên trợ lý KHÔNG dùng `code.plc` (27B) — cùng lỗ "bài toán 1" mà tác nhân đã có (đã vá ở 86842fd44, mặc định bật 41d911789).
- Ngoài phạm vi thiết kế này: bộ chọn tool bằng LLM (`generateJSON` của vòng tool — lượt NGẮN, JSON ràng buộc, model nhanh là đúng),
  tạo khung, vòng tự-ghi (đi đường riêng của nó).

## 2. Đề xuất

**2.1 Chọn vai trò MỘT lần mỗi lượt hỏi**, ở `streamCodingAnswer` ngay sau khi phân giải gốc dự án (đã có `goc.goc`), DÙNG LẠI nguyên
`chonVaiTroTacNhan({ laDuAnPlc: laDuAnPlc(goc), cauHoi })` của tác nhân (PLC = `.st`/`.scl`/PLCopen tc6 trong cây 2 tầng, hoặc chữ câu hỏi
tầng 3 chọn `code.plc`; còn lại `code.software`). Không có bộ nhận diện thứ hai.

**2.2 Model** = `dinhTuyenVaiTro({ vaiTro, phamVi: { projectId }, ...nguCanhKhe() })` sau `lamMoiKheDangGiu()` (3e12e9d4f) — gán dự án >
global, khoá khe, khe đang giữ, dự phòng (`code.software` → 35B, dự phòng 27B đã gán ở chỉnh 2). Truyền xuống `streamCodingModel` qua một
trường MỚI `modelId?` của `YeuCauSinhChu`: có ⇒ engine nhận model này (gateway vẫn tính quota/safety/metrics, `record({ model })` ghi model
THẬT); vắng ⇒ y nguyên hôm nay. Cả hai người gọi (sinh mã, sửa tệp) nhận CÙNG model của lượt.

**2.3 Người dùng chọn thắng**: bộ chọn ở màn lập trình (`modelTask` "fast"/"code") ⇒ KHÔNG định tuyến vai trò (ý người dùng tường minh).
Chỉ "auto"/vắng mới định tuyến.

**2.4 Khoá khe** (như tác nhân, chỉnh 2): đích cuối là model khe nặng KHÁC model khe đang giữ trong khi khoá còn hạn ⇒ trả lời NÓI THẬT
("khe model đang bị khoá… thử lại khi nhả") qua `codingModelErrorMessage`-cùng-khuôn, KHÔNG gọi model, KHÔNG để engine từ chối giữa
luồng. Có dự phòng hợp lệ (vd 27B cho `code.software`) ⇒ chạy trên dự phòng.

**2.5 Minh bạch**: sự kiện `usage` (đã có) mang `modelId` thật; thêm `vaiTro` + `nguon` vào cùng sự kiện (ô thuần bổ sung; route `usage`
là danh sách TRẮNG ⇒ nối dây + lưới census/đi-ra-socket như `done.kiemBienDichST`).

**2.6 Cờ** `AI_TRO_LY_THEO_VAI_TRO`, mặc định TẮT ⇒ y nguyên từng byte. Bật mặc định chỉ sau cổng §3.

## 3. Cổng đo (đăng ký TRƯỚC khi chạy, vào spec §6)

- `mot-luot --config pipeline` trên CÙNG 24 bài ST #11 × 2 lượt, hai khối (cờ tắt ⇒ 35B; cờ bật ⇒ `code.plc` ⇒ 27B), một lần đổi model
  `-GiuKhoa` (như ablation tác nhân), vòng kiểm biên dịch `tro-ly` CÙNG trạng thái ở cả hai khối (theo kết quả A). Mỗi lượt kiểm
  `usage.vaiTro/modelId` đúng nhánh, sai ⇒ dừng.
- **Cổng (giống tác nhân): bật ≥ tắt + 2/24 · 2 = +4/48 VÀ trung vị thời gian ≤ 2×.** Đạt ⇒ đề xuất bật mặc định; không ⇒ giữ tắt.
- Lưu ý đo: `mot-luot` gửi `projectId: "repo"` (repo này — KHÔNG phải dự án PLC) ⇒ vai trò đến từ CHỮ câu hỏi (bài ST có "ST"/"FB" +
  ý định viết ⇒ `code.plc` tầng 3). Ghi rõ; nếu muốn đo cả nhánh "dự án PLC", thêm một gốc PLC vào `AI_REPO_SANDBOX_ROOTS` cho :3013.
- Lưới (TRƯỚC đo): (i) dự án có `.st` ⇒ engine nhận 27B, dự án TS ⇒ 35B; (ii) `modelTask` "fast" ⇒ không định tuyến; (iii) khoá giữ 27B +
  `code.software` có dự phòng 27B ⇒ chạy 27B; không dự phòng ⇒ nói thật, 0 lượt gọi model; (iv) cờ tắt ⇒ engine nhận `undefined` như cũ;
  (v) `usage` ra socket mang `vaiTro`. Đột biến cho từng vế.

## 4. Rủi ro

- Đổi khe ~60 s cho lượt đầu ở dự án PLC khi khe giữ 35B (đã biết từ tác nhân) — tương tác chờ lâu hơn; `tool_loop`/tiến độ đã có.
- Hai bề mặt (trợ lý + tác nhân) cùng kéo khe về 27B ở dự án PLC trong khi chat/KB của người khác cần 35B ⇒ hoán đổi qua lại; bộ lập
  lịch khe đã có lưu trú tối thiểu + ưu tiên tương tác — không thêm cơ chế mới ở đây.
