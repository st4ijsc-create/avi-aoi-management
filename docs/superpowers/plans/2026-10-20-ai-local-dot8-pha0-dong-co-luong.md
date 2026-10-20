# Đợt 8 · Pha 8.0 — Lõi động cơ Luồng AI (mô hình · biểu thức · hàng đợi bền · chạy lại sau sập) · Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Động cơ chạy một `FlowDefinition` (đồ thị node kiểu n8n) bền qua sập tiến trình: mỗi node ghi điểm lưu, worker
khác nhặt tiếp, node có tác dụng phụ không bị chạy hai lần.

**Architecture:** `shared/flow/` (thuần, dùng chung client/server): mô hình + kiểm hợp lệ + bộ đánh giá biểu thức
`{{ }}` an toàn (bộ phân tích riêng, KHÔNG `eval`/`Function`). `server/services/flow/`: hàng đợi Postgres
(`FOR UPDATE SKIP LOCKED` + lease), bộ thực thi đẩy-theo-dữ-liệu (node chạy khi có item đến cổng vào; node `merge`
chờ đủ cổng), sổ đăng ký node. Mig 0401.

**Spec:** `docs/superpowers/specs/2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md` §4.2–4.4, §6 (8.0).

## Điều chỉnh so với spec (trong quyền, có lý do)
- **Không di chuyển mã FOE sang `shared/flow`.** FOE thuộc workstream kỹ thuật (doc 80/81, phiên khác); chuyển tệp sẽ
  đụng census/lưới của họ. Ban đầu định IMPORT `orchestration/dag.ts#validateDag`, nhưng `shared/` không được phụ thuộc `server/` ⇒ kiểm chu trình (Kahn, ~15 dòng) viết lại trong `shared/flow/model.ts`.
  Bộ đánh giá điều kiện của FOE là điều kiện có CẤU TRÚC (không phải biểu thức chữ) ⇒ Luồng cần bộ biểu thức riêng.
- **Thực thi đẩy-theo-dữ-liệu**, không "đủ mọi phụ thuộc" (`readySet` của FOE): nhánh `if` chỉ một phía có item ⇒ node
  phía kia KHÔNG chạy (đúng ngữ nghĩa n8n), node `merge` mới chờ đủ.

## Global Constraints
- Dải migration 0400–0419 (0401 cho Luồng). DDL bằng owner `aoi` qua `scripts/apply-migration-0401.mjs`, nghiệm thu `avi_app`.
- Biểu thức: chỉ đường dẫn thuộc tính (`$json`, `$node("id").json`, `$input`, `$env` danh sách trắng, `$run`), hằng,
  toán tử số học/so sánh/logic/ba ngôi, hàm danh sách trắng; cấm truy cập `__proto__`/`constructor`/`prototype`; trần
  độ dài biểu thức 2.000 ký tự, độ sâu 64, thời gian không cần (không có vòng lặp trong ngôn ngữ).
- Mỗi node khai `tacDungPhu: "thuan"|"doc"|"ngoai-ghi"|"ot"` và `lapLai: "idempotent"|"atMostOnce"`.
- Không thêm Redis/BullMQ.

## Review Focus
1. Hai worker cùng nhặt một mục hàng ⇒ chỉ một chạy (SKIP LOCKED + lease) — lưới DB đồng thời.
2. Worker chết sau khi node `atMostOnce` BẮT ĐẦU nhưng trước khi ghi xong ⇒ KHÔNG chạy lại; bước thành `khong-ro`, run `loi` có lý do.
3. Biểu thức truy cập `constructor`/`__proto__` hoặc gọi hàm ngoài danh sách ⇒ lỗi biểu thức có thông điệp, không ném lỗi JS lạ.
4. Đồ thị có chu trình / nối tới node không tồn tại / không có node kích hoạt ⇒ `kiemLuong` từ chối, không lưu phiên bản.
5. Node ném lỗi ⇒ thử lại theo `retry` của node rồi mới `loi`; `khiLoi: "tiep-tuc"` ⇒ item lỗi đi cổng `loi`.

---

### Task 1: Mô hình + kiểm hợp lệ — `shared/flow/model.ts`
Zod: `FlowDefinition`, `NodeInstance` (id `^[a-zA-Z0-9_-]{1,64}$`, `type`, `typeVersion`, `parameters`, `retry?`,
`khiLoi?`, `disabled?`), `Connection` (`from:{node,port}`, `to:{node,port}`), `Item {json, binary?}`.
`kiemLuong(def, dangKy: (type) => KhaiBaoNode | undefined): { ok, loi: string[] }` — id duy nhất; type đã đăng ký;
cổng tồn tại theo khai báo; ≥ 1 node kích hoạt; không chu trình (`validateDag` trên cạnh); node `disabled` vẫn được nối.
Test: hợp lệ; trùng id; type lạ; cổng lạ; không trigger; chu trình.

### Task 2: Biểu thức — `shared/flow/bieuThuc.ts`
`danhGiaChuoi(mau: string, ngu: NguCanhBieuThuc): unknown` — chuỗi toàn `{{ x }}` ⇒ giá trị nguyên kiểu; lẫn chữ ⇒ nối
chuỗi. `danhGia(bieuThuc, ngu)`. Bộ tách từ + Pratt. Hàm: `len lower upper trim round floor ceil abs min max join
split contains startsWith toNumber toString isEmpty`. Lỗi ⇒ `LoiBieuThuc` (thông điệp tiếng Việt, vị trí).
Test: đường dẫn sâu/mảng; `$node("a").json.x`; toán tử + ưu tiên; ba ngôi; nối chuỗi; `$env` ngoài danh sách ⇒
undefined; `__proto__`/`constructor` ⇒ lỗi; gọi hàm lạ ⇒ lỗi; quá dài ⇒ lỗi; không dùng `eval`/`Function` (lưới quét mã).

### Task 3: Mig 0401 + schema + script áp
Bảng: `ai_flows`, `ai_flow_versions` (bất biến), `ai_flow_runs`, `ai_flow_steps` (UNIQUE run×node×lần), `ai_flow_events`,
`ai_flow_queue`, `ai_flow_waits`. CHECK trạng thái; GRANT `avi_app`.

### Task 4: Hàng đợi + động cơ — `server/services/flow/{hangDoi,dongCo,dangKyNut}.ts`
`batDauRun(flowId, version, itemsKichHoat) → runId` · `chayMotMuc(workerId) → boolean` (nhặt 1 mục, chạy node, trong MỘT
giao dịch: ghi bước + sự kiện + xếp mục cho node kế; node `atMostOnce`: ghi bước `dang-chay` + commit TRƯỚC khi chạy) ·
`phucHoiLeaseHetHan()`. Node thử nghiệm: `kich-hoat.thu-cong`, `du-lieu.dat`, `logic.neu`, `logic.gop`.
Test DB: luồng 4 node chạy xong đúng item; nhánh `neu` chỉ một phía; `gop` chờ đủ; **cổng 8.0**: worker "chết" giữa
chừng (lease hết hạn) ⇒ worker khác hoàn tất, node idempotent chạy lại với cùng khoá (đích giả khử trùng ⇒ 1 tác dụng),
node atMostOnce không chạy lại (bước `khong-ro`); hai worker đồng thời ⇒ mỗi mục chạy đúng một lần.

### Task 5: Bầu chủ kích hoạt — `server/services/flow/bauChu.ts`
`giuQuyenChu(ten) → { la: boolean, nha() }` bằng `pg_try_advisory_lock(hashtext(ten))` trên MỘT kết nối giữ riêng.
Test: hai bên giành ⇒ đúng một thắng; bên thắng nhả ⇒ bên kia giành được.
