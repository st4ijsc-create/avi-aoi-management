# Đợt 8 · Pha 8.1 — Node lõi, vòng worker, API, kích hoạt · Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Luồng AI chạy được việc thật: kích hoạt (tay · lịch · webhook), node AI qua Cổng AI theo VAI TRÒ, HTTP danh
sách trắng, người duyệt (chờ dài), vòng worker bền, API tRPC; 3 mẫu luồng §5.3 (#1 AOI→RCA, #2 tài liệu→tri thức rút
gọn, #4 báo cáo ca) chạy đầu-cuối ×3.

**Spec:** §4.5, §4.7, §5.3, §6 (8.1). Nền: pha 8.0 (`shared/flow/*`, `server/services/flow/*`, mig 0401).

## Global Constraints
- Node AI KHÔNG gọi engine trực tiếp: `routeInference` (Cổng AI: che PII, audit `ai_llm_audit` task `flow_<node>`, hạn mức)
  + model theo VAI TRÒ (`resolveLogicalModel(vaiTro)`), mức ưu tiên lấy từ `settings.uuTien` của luồng (`chayVoiUuTien`).
- Đầu ra AI có tác dụng phụ phải qua `ai.trichXuat` (schema zod/JSON schema chặt) — `ai.llm` chỉ ra chữ.
- HTTP: chỉ host trong `AI_FLOW_HTTP_HOST_CHO_PHEP` (mặc định rỗng ⇒ từ chối mọi host); không theo chuyển hướng sang host
  khác; trần thân 1 MB; trần thời gian 30 s; node `ngoai-ghi`, `atMostOnce` (POST/PUT/DELETE) hoặc `doc`, `idempotent` (GET).
- Webhook: token theo luồng (bcrypt/sha256 băm lưu DB), so thời gian hằng; không có xác thực phiên.
- Lịch: chỉ tiến trình giữ quyền chủ (`giuQuyenChu("lich")`) bắn.
- Quyền: xem luồng = `ai_flow_view`/canView MOD_AI; sửa/lưu phiên bản = canEdit; kích hoạt hạng ≥ `ngoai-ghi` = admin (8.2 làm
  đủ ma trận + 2FA cho `ot`).

## Tasks
1. **Vòng worker** `server/services/flow/worker.ts`: `khoiChayWorkerLuong({ soLuong, nhipMs })` — N vòng `chayMotMuc`, ngủ
   khi hết việc, dừng gọn; khởi ở tiến trình worker (`server/worker.ts`) và ở API khi `AI_FLOW_WORKER_TRONG_API=true`.
   Bao `chayVoiUuTien` theo uuTien của run.
2. **Node AI** `server/services/flow/nut/ai.ts`: `ai.llm` (lời nhắc + hệ thống + vai trò + nghĩ bật/tắt) · `ai.trichXuat`
   (schema trường → JSON, thử lại 1 lần khi sai schema, sai nữa ⇒ lỗi) · `ai.phanLoai` (nhãn danh sách đóng) · `ai.tomTat`.
   Lưới: mock `routeInference`/engine — đúng vai trò, đúng audit task, schema sai ⇒ thử lại rồi lỗi.
3. **Node tích hợp + người** `nut/tichHop.ts`, `nut/nguoi.ts`: `tich-hop.http`, `nguoi.duyet` (tạo `ai_flow_waits` kind
   `duyet`, run ⇒ `cho-duyet`, API `duyet(runId,nodeId,dongY,lyDo)` ⇒ xếp node kế ở cổng `dong-y`/`tu-choi`; hết hạn ⇒ `het-han`).
4. **Kích hoạt** `kichHoat/lich.ts` (cron 5 trường qua `node-cron` validate, bầu chủ), `kichHoat/webhook.ts` (REST
   `POST /api/flow/webhook/:flowId` + header `x-flow-token`).
5. **API** `server/routers/flowRouter.ts`: `danhSach`, `chiTiet`, `luu` (phiên bản mới), `bat/tat`, `chayTay`, `lichSuChay`,
   `dongThoiGianChay` (bước + sự kiện), `duyet`, `danhMucNode` (khai báo cho Studio). Census REST/tRPC ghim lại có lý do.
6. **Mẫu luồng** `server/services/flow/mau/*.json` + lưới đầu-cuối (LLM giả tất định) ×3; đo sống 1 lượt với model thật.
