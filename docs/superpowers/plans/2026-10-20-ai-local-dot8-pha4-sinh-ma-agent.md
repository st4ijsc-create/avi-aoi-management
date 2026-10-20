# Đợt 8 · Pha 8.4 — `ai.sinh-ma` · luồng con · `ai.agent` · MCP · mô tả → luồng · Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Luồng sinh được mã PLC (ST) ĐÃ BIÊN DỊCH bằng vòng sửa lỗi có cấu trúc; luồng gọi được luồng khác (trực tiếp và
qua agent) mà hạng tác dụng phụ KHÔNG bị lách; luồng thành tool MCP; người mô tả bằng tiếng Việt ⇒ bản nháp luồng (không
bao giờ tự lưu/bật).

**Spec:** §3.7, §4.5, §4.6, §4.9, §4.10, §6 (8.4: "Mẫu #3 (PLC) đầu-cuối; mô tả → luồng ≥ 70 % bản nháp hợp lệ schema trên
20 mô tả, 0 bản nháp tự kích hoạt"). Nền: 8.0–8.3.

## Global Constraints
- KHÔNG chạm llama-server :8091 khi làm/kiểm: mọi lưới dùng hàm gọi AI GIẢ (`datHamGoiAi`, `datHamGoiAgent`).
- Mã sinh ra CHỈ được BIÊN DỊCH, trong container `st-rusty:1.0.7` (`--network none --read-only --cap-drop ALL`, tmpfs /tmp,
  không link, không chạy). KHÔNG bao giờ tải xuống thiết bị (node không import gì của đường OT/kỹ thuật).
- Hạng: hạng luồng = max(hạng node, hạng MỌI luồng con được tham chiếu — `luong.goi-con.flowId`, `ai.agent.luongCon[].flowId`).
  Id luồng con phải là chuỗi CỐ ĐỊNH (biểu thức ⇒ luồng không hợp lệ — id động lách được kiểm hạng). Kiểm khi LƯU
  (`luuPhienBan` đọc hạng phiên bản hoạt động của luồng con) và khi CHẠY (luồng con đổi phiên bản hoạt động sang hạng cao hơn
  ⇒ node từ chối). Độ sâu lồng ≤ 4; tự gọi chính mình ⇒ không hợp lệ.
- Chờ luồng con: CHỜ BỀN (`YeuCauCho` kind `luong-con`) — lượt con được TẠO TRONG CÙNG GIAO DỊCH với hàng chờ của cha (không
  có cửa sổ "con xong trước khi cha kịp chờ"); con đóng ⇒ `dongRun` trả lời hàng chờ của cha trong giao dịch đóng con. Cha
  bị huỷ/lỗi ⇒ con đang chạy bị huỷ theo. Mig 0404 thêm `luong-con` vào CHECK `kind` của `ai_flow_waits`.
- `ai.agent` / MCP: luồng con chạy ĐỒNG BỘ ngay trong lời gọi (`chayLuotDongBo`, chỉ nhặt mục của đúng lượt đó, trần thời
  gian) — vòng tool-calling không bền qua sập (một node idempotent; chạy lại = gọi lại model).
- Chữ (và suy luận) của model không bao giờ thành lệnh: chỉ `tool_calls` gốc, tên trong danh sách khai, tham số kiểm kiểu.
- MCP: công bố luồng BẬT, có `kich-hoat.mcp` không tắt, hạng `thuan`/`doc`; cần danh tính MCP như tool khác.
- Mô tả → luồng: model vai trò `code.software` qua Cổng AI; kết quả qua `FlowDefinitionSchema` (bỏ khoá lạ ⇒ không thể mang
  `activeVersion`/`enabled`) + `kiemLuong`; sai ⇒ hỏi lại MỘT lần kèm lỗi. KHÔNG ghi CSDL.

## Tasks
1. `server/services/flow/lib/bienDichST.ts` (+ `bien-dich-job.sh`, prelude đọc từ bộ đo 7.2) + node `ai.sinh-ma`
   (`nut/sinhMa.ts`). Lưới: trích khối mã; chẩn đoán; vòng sửa với model giả; Docker thật bắt lỗi cú pháp/tham chiếu.
2. `shared/flow/model.ts`: `luongConCuaNut`, `kiemLuong(..., { hangLuongCon })`. `dongCo.ts`: `hangLuongConTuDb`, chờ
   `luong-con`, `traLoiChoTx`, hook đóng con, huỷ con, `chayLuotDongBo`. Node `luong.goi-con` (`nut/luong.ts`). Mig 0404.
   Lưới DB: cha chờ ⇒ con xong ⇒ cha đi tiếp với đầu ra node cuối của con; con lỗi ⇒ cha lỗi; tấn công hạng (lưu + chạy).
3. Node `ai.agent` (`nut/agent.ts`): tool = luồng con khai báo + `tra_tai_lieu` (truy hồi KB sẵn có). Lưới: tool lạ bị bỏ,
   tham số sai kiểu ⇒ quan sát lỗi, chữ chứa "lệnh" không chạy gì, trần lượt, hạng agent = max luồng con.
4. `kich-hoat.mcp` (`kichHoat/mcp.ts`) + `mcpServer.ts`: `tools/list` thêm luồng công bố; `tools/call` ⇒ `batDauRun` + chạy
   đồng bộ có trần ⇒ đầu ra node cuối. Lưới: hạng `ngoai-ghi` không công bố, gọi được luồng `thuan`.
5. `server/services/flow/taoTuMoTa.ts` + `flow.taoTuMoTa` + nút "Từ mô tả" trong trình sửa (bản nháp lên canvas, chưa lưu).
   Bộ đo `scripts/ai-eval/mo-ta-luong/` (20 mô tả viết TRƯỚC, script chấm; kiểm thước với model giả đúng/rác).
6. Mẫu #3 `server/services/flow/mau/yeu-cau-plc.json` + lưới đầu-cuối (Docker): lần 1 ST lỗi cú pháp ⇒ RuSTy bắt ⇒ lần 2 qua
   ⇒ chờ duyệt ⇒ đồng ý ⇒ đóng gói.
7. Kiểm: tsc; vitest flow + census; ghim census khối "Đợt 8.4" có lý do.
