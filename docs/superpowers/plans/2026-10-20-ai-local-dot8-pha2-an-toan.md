# Đợt 8 · Pha 8.2 — An toàn của Luồng AI: bí mật mã hoá · node chạy mã cách ly · bất biến không rò · Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Luồng dùng được khoá API/mật khẩu mà giá trị KHÔNG BAO GIỜ nằm trong định nghĩa luồng, lời nhắc model, bước,
sự kiện hay log; người viết luồng chạy được mã JS nhỏ mà mã đó không chạm mạng, đĩa, tiến trình của máy chủ.

**Spec:** §4.6 (luật 3, 6), §4.5 (node dữ liệu "mã"), §6 (8.2). Nền: 8.0–8.1.

## Global Constraints
- Bí mật: AES-256-GCM, khoá 32 byte từ `AI_FLOW_KHOA_BI_MAT` (base64) — vắng/không đủ 32 byte ⇒ mọi thao tác bí mật từ chối
  rõ ràng (fail-closed), luồng không dùng bí mật vẫn chạy. Mỗi bản mã có IV 12 byte ngẫu nhiên + tag + `phienBanKhoa`.
  Giá trị chỉ GHI (API không bao giờ trả lại). Giải mã chỉ trong lúc chạy node, chỉ vào đúng ô cần (tiêu đề HTTP).
- Node HTTP: `credentialRef` + `kieuXacThuc` (`bearer` | `header:<tên>` | `basic`) ⇒ động cơ giải mã, node đặt tiêu đề;
  tiêu đề `Authorization`/`Cookie` gõ tay vẫn bị cấm (8.1).
- Bất biến lưới: sau khi chạy luồng dùng bí mật, KHÔNG giá trị bí mật (và không base64 của nó) nào xuất hiện nguyên văn
  trong `ai_flow_steps` (input/output/error), `ai_flow_events`, `ai_flow_versions.definition`, stdout/stderr đã bắt.
- Node `du-lieu.ma` (JS): chạy trong Docker `node:24-alpine` (ảnh ghim digest), `--network none --read-only --memory 256m
  --pids-limit 64 --cpus 1 --cap-drop ALL --security-opt no-new-privileges`, người dùng không root, trần 10 s, đầu vào
  item qua stdin JSON, đầu ra JSON qua stdout (trần 1 MB), không truy cập `$env`. Ảnh thiếu ⇒ lỗi node rõ ràng (không lùi
  về chạy trong tiến trình). Hạng `thuan`, `idempotent`.
- Mig 0403 (`ai_flow_credentials`). Quyền: tạo/xoá bí mật = admin; liệt kê (không giá trị) = quyền sửa luồng.

## Tasks
1. `server/services/flow/biMat.ts` + mig 0403 + script áp: `taoBiMat`, `xoaBiMat`, `lietKeBiMat` (id, tên, loại, ngày —
   không giá trị), `giaiMaChoChay(id)` (nội bộ động cơ). Lưới: khứ hồi; IV khác nhau mỗi lần; sai tag ⇒ ném; thiếu khoá ⇒
   từ chối; xoay khoá (giải mã bằng `AI_FLOW_KHOA_BI_MAT_CU` theo `phienBanKhoa`).
2. Node HTTP dùng bí mật + **lưới bất biến không rò** (luồng thật trên DB `_test`, đích HTTP giả ghi lại tiêu đề nhận được).
3. `server/services/flow/nut/ma.ts` + `lib/chayMaCachLy.ts`: node `du-lieu.ma`. Lưới (cần Docker): biến đổi item đúng;
   `fetch`/`require('net')` ⇒ lỗi; ghi tệp ⇒ lỗi; vòng lặp vô hạn ⇒ hết giờ ≤ 12 s; in rác > 1 MB ⇒ lỗi; `process.env` rỗng.
4. API tRPC trong `flowRouter`: `biMatTao` (admin), `biMatXoa` (admin), `biMatDanhSach` — ghim census có lý do.
