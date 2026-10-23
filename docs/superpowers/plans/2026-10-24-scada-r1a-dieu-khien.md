# SCADA R1a · Điều khiển lõi — Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người vận hành ghi được một kênh OT qua `scada.commands.request → confirm` (TTL 60 s, 2FA theo mức), đi qua đúng `dispatch()` sẵn có. Mọi ô từ chối (kênh vào, ngoài dải, LOCAL, người thứ hai đang chọn, hết TTL, interlock thiếu dữ liệu) bị chặn ở đúng cổng và có dòng WORM. Đọc lại lệch hiện cho người vận hành.

**Architecture:**
- Thêm dữ liệu khai báo trên kênh. Tất cả đều mới và NULL = hành vi cũ: `channel_kind`, dải ghi, bước, mức tác động, tên hiển thị.
- Thêm một kênh chế độ cho mỗi máy.
- Cổng kênh/dải nằm trong `dispatchCore` và áp cho MỌI người gọi.
  - Cổng này không cần cờ, vì không có dữ liệu khai thì không có gì đổi.
  - Cổng chế độ (K2) cho người gọi cũ nằm sau cờ `SCADA_CONG_CHE_DO_ENABLED`, vì D3 "chưa khai ⇒ LOCAL" sẽ chặn mọi người gọi hiện có.
  - Đường HMI mới luôn kiểm chế độ.
- Router mới `scada.commands`:
  - Dòng chờ là `ai_pending_actions`, `tool='hmi.write_tag'`.
  - Băm payload bằng `otPayloadHash`.
  - Khoá chọn DB theo (adapter, tag).
  - Ghi nhận mọi lần thử vào bảng append-only `scada_command_attempts`.
  - Kết quả đẩy qua socket `scada:cmd` vào `user:{id}`.
- Giao diện: M12 (cấu hình kênh & chế độ), M4 (faceplate), M5 (hộp thoại lệnh).

**Tech Stack:** TypeScript, tRPC, drizzle + Postgres (migration viết tay), Socket.IO, React, vitest (+ DB `_test`), node-opcua / modbus-serial cho bench.

**Spec (thứ tự ưu tiên khi mâu thuẫn):**
1. Báo cáo đã duyệt `docs/superpowers/specs/2026-10-23-scada-thiet-ke-he-sinh-thai.html`: §2.2–2.4, §4.5–4.6, hàng R1 của lộ trình, D2–D5, D8–D9.
2. `docs/superpowers/specs/2026-10-23-scada-phan-tich-chi-tiet.md` §C.1 (mô hình kênh) và §C.5 (lệnh HMI).
3. Yêu cầu của phiên điều phối ngày 2026-10-24: K1–K11; M4/M5/M9/M12; các mục R0 hoãn lại.

---

## Tách R1 — ĐÃ DUYỆT (điều phối 2026-10-24)

Toàn bộ phạm vi R1 quá lớn cho một nhánh. Đề xuất tách ba phần. Mỗi phần có cổng nghiệm thu riêng, viết ra trước khi làm:

| Phần | Nội dung | Cổng nghiệm thu |
|---|---|---|
| **R1a · Điều khiển lõi** (kế hoạch này) | K1, K2, K4, K5, K6, K7, K8, K9 (hàng đợi trung tâm), K10, K11; M4, M5, M12 | Ma trận 6 ô của hàng R1. Mỗi ô bị từ chối đúng cổng và có dòng WORM. Đọc lại lệch hiện cho người vận hành. Đường vui đọc lại đúng trên OpenPLC bench có safety PLC mô phỏng. |
| **R1b · Nhật ký + nợ R0** | Xem chi tiết ngay dưới bảng. | Danh sách hàng mục 1-1, mỗi mục có test hoặc đo; M9 lọc phạm vi. |
| **R1c · Edge** (Q1 = hướng a2; lập kế hoạch SAU khi R1a gộp, không song song) | Lệnh HMI vào máy do edge sở hữu (Q1: a2 ký Ed25519 dùng một lần / a1 lượt orchestration 1 bước / c chỉ giám sát); K9 phía edge (STOP xếp hàng hiện trên M10); C4 (tag edge thiếu unit/deadband/samplingMs, `tsSource` gán sai); C7 (WAL: lỗi tạm 5xx giữ lại, 4xx bỏ) | Chọn sau khi có Q1 |

Nội dung R1b:
- M9 nhật ký `/scada/journal`, gồm cả nợ phạm vi của `commandLogRouter`.
- "connected" = lần đọc tốt đầu tiên.
- EIP `timeout_sp` + listener `'error'`.
- Hạn cho ingest treo; đưa `soLanChong` vào bộ đếm.
- Tắt sạch không ghi `disabled`.
- Lab "thử đọc một địa chỉ".
- Chip "Truyền thông n/m" trên thanh trên.
- C6: đọc khối Modbus.
- 12 mục backlog P2 trong báo cáo nghiệm thu R0, kể cả D11 cho `propose_interlock_rule`.
- Nhãn "sim" cho lệnh stub.
- Test heartbeat deadband 60 s.

R1b và R1c sẽ có kế hoạch riêng sau khi R1a được duyệt. R1b không phụ thuộc R1a trừ M9: M9 đọc `scada_command_attempts`, nên làm sau R1a.

## Quyết định — ĐÃ DUYỆT (điều phối 2026-10-24; điều chỉnh mục 4: STOP ghim miễn dải trong dispatch, kiểm nhất quán lúc cấu hình; mục 2/6/7: M5 nói lý do + cách xử lý; thêm ô nghiệm thu 8; R1c = hướng a2, lập kế hoạch SAU khi R1a gộp)

- **Q4 — vai trò:** `operator` được ghi kênh mức 1–3 khi có `machine_control.canEdit`. Mức 4–5 chỉ `ACTUATION_ROLES` (admin, supervisor, engineer). Theo C.5.
- **Q6/D5 — 2FA theo mức:** mức 1–3 không cần 2FA. Mức 4 cần bước 2FA của phiên (cache 10 ph như `requireFreshTotp`). Mức 5 cần TOTP mới mỗi lần. Áp **bất kể** `AUTH_2FA_BAT_BUOC` và `ACTUATION_STEPUP_2FA`. Người chưa đăng ký 2FA không bấm được mức 4–5.
- **K2 với lệnh interlock:** khi bật `SCADA_CONG_CHE_DO_ENABLED`, máy ở LOCAL từ chối cả lệnh do interlock phát, trừ STOP ghim. Lý do: người tại chỗ đang giữ quyền điều khiển.
- **Q3 — không miễn trừ safety:** giữ D9, không có miễn trừ safety cho máy chưa có safety PLC. Đường thật chỉ thông khi preflight safety OK.
- **Máy do edge sở hữu:** `request()` từ chối với `EDGE_CHUA_HO_TRO` cho tới R1c.
- **Không có công thức ra (C.7) trong R1:** `afterFormula === requested`. Giá trị lệch bước bị **từ chối** (`OFF_STEP`), không tự làm tròn.
- **Mức trên kênh dùng bộ `MucRuiRo` (1|3|4|5)** của `aiControlGate.ts:47`, không có mức 2. Kênh ra để trống mức ⇒ 5.

## Global Constraints

- **Nơi làm và nhánh.** Làm trong worktree `D:\SOURCES\_scada_wt`, nhánh `feat/scada-r1a`, tạo từ `main` lúc bắt đầu thực thi. **Không** sửa cây chính `D:\SOURCES\avi-aoi-management`. **Không push.** Gộp main vào nhánh chỉ giữa hai task.
- **Commit.** Commit bằng pathspec, vì hook BG-124 chặn commit trần: `git commit -m "…" -- <tệp…>`. Cuối message ghi `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Migration.**
  - Dải **0431–0449**, viết tay `drizzle/04NN_*.sql` + `scripts/apply-migration-04NN.mjs` theo `scripts/apply-migration-0430.mjs`: `runMigration`, DDL bằng owner `aoi`, nghiệm thu bằng `avi_app`, `--test-only | --dev-only | --both`.
  - Áp **TEST** thoải mái. **DEV chỉ sau khi điều phối duyệt SQL**: gửi SQL + số đếm trước.
  - Không sửa `drizzle/meta/_journal.json`, không dùng `drizzle-kit generate`.
- **Cờ.** Cờ mới, mặc định OFF, thêm vào `.env.example` mỗi cờ một dòng mô tả:
  - `SCADA_COMMANDS_ENABLED`: router `scada.commands` và M4/M5.
  - `SCADA_CONG_CHE_DO_ENABLED`: cổng K2 trong `dispatch()` cho người gọi không phải HMI.
  - **Giữ OFF** `OT_CONTROL_ENABLED` và `AI_OT_CONTROL_ENABLED` trong `.env` (D9). Test và bench chỉ bật chúng **trong tiến trình test**.
- **Đường ghi.** **Không thêm đường ghi mới**: mọi lệnh tới thiết bị đi qua `dispatch()` (`server/services/ot/commandDispatcher.ts:715`). Không gọi driver `write*` từ code mới.
- **Ledger.** `command_log` vẫn là WORM. Mọi từ chối trong `dispatch()` đi qua `writeRejected` (`:2037`). Mọi từ chối trong `request()`/`confirm()` trước `dispatch()` là một dòng `scada_command_attempts`, không phải `command_log`.
- **Phạm vi.**
  - Mọi thủ tục nhận `adapterId`/`machineId` từ client phải kiểm lại phạm vi ở server: `idsTrongPhamVi("machine", phamViCua(ctx), {strict:true})`.
  - Adapter không gắn máy chỉ cho phạm vi toàn quyền.
  - "Không thấy" và "ngoài phạm vi" trả cùng một lỗi.
- **Census.** Mỗi thủ tục tRPC mới phải:
  - cập nhật GHIM của `server/routers/phamViDocCensus.test.ts` (~:861) và `server/routers/congGiayPhepAiCensus.test.ts` (~:516, `GHIM_MODULE_KHAC.MOD_OT_CONTROL`), kèm ghi chú `2026-10-2x · R1a …`;
  - đăng ký ở `server/routers.ts` và `server/_core/moduleAccessMap.ts` (`MOD.OT_CONTROL`);
  - có khoá i18n cho mọi `appError` literal (`appErrorParamsCoverage`) ở vi/en/zh.
- **Socket.** Chỉ `io.to(\`user:${id}\`).emit("scada:cmd", …)`. Không `io.emit`, không phòng mới (census `socketPhatCensus`/`socketPhongCensus`).
- **Test.**
  - Test DB: `npx vitest run -c vitest.db.config.ts <tệp>`. Test thường: `npx vitest run <tệp>`. Kiểu: `npm run check`. i18n: `npm run i18n:check`.
  - Người dùng test tạo bằng `taoNguoiDungTest`, không `insert(users)`.
- **Mỗi task.** Test viết trước, đỏ đúng chỗ → mã → xanh. **Đột biến ghi trong task phải làm đỏ ít nhất một test**: chạy, ghi kết quả vào message commit, hoàn tác. Sau đó commit.
- **Tệp và màu.** Không xoá tệp, không đổi tên công khai đang có người gọi. Màu chỉ dùng token ISA có sẵn (`--isa-*`, `--alarm-*`), không màu cứng.

## Review Focus

1. **Hai tab của cùng một người cùng `confirm` một `requestId`** ⇒ đúng một lần `dispatch()`, tab kia nhận `DA_XU_LY` (CAS `proposed→confirmed`). Test ở Task 9.
2. **Giữa `request` và `confirm`, máy chuyển LOCAL / tag bị tắt / adapter chuyển sang edge / khoá chọn hết hạn** ⇒ `confirm` từ chối đúng mã, khoá được nhả, có dòng attempts. Test ở Task 9.
3. **Ép kiểu trước khi băm và kiểm dải:** `"1"` / `1` / `true` cho bool; `"240.2"` cho float. Bước có sai số dấu phẩy động: `240.0` với bước `0.5` hợp lệ, `240.2` thì không. Giá trị đúng như nhau thì băm như nhau ở `request` và `dispatch`. Test ở Task 2.
4. **Bộ đệm tắt / giá trị cũ / chưa có mẫu** ⇒ bản xem trước ghi `current {v:null, q:"bad"}` kèm cảnh báo; chế độ = LOCAL (fail-closed); không ném lỗi. Test ở Task 4 và Task 8.
5. **Đọc lại lệch hoặc không đọc được trên đường HMI** ⇒ `acked_unverified`, M5 không tự đóng và hiện giá trị đọc được. Đường HMI luôn đọc lại, kể cả khi `OT_READBACK_ENABLED` tắt. Test ở Task 5 và Task 14.

---

### Task 1: Migration 0431 — kênh, chế độ máy, khoá chọn, nhật ký thử lệnh

**Files:**
- Create: `drizzle/0431_scada_kenh_lenh.sql`, `scripts/apply-migration-0431.mjs`
- Modify:
  - `drizzle/schema/ot.ts`: thêm cột vào `deviceTags`, thêm 3 bảng mới.
  - `.env.example`: thêm 2 cờ.
- Test: phần verify trong `apply-migration-0431.mjs` (a)(b)(c)

**Interfaces:**
- Produces: các cột và bảng dưới đây (drizzle: `deviceTags.channelKind`, `writeMin`, `writeMax`, `writeStep`, `actuationLevel`, `displayName`, `displayFormat`; bảng `scadaKenhCheDo`, `scadaKhoaChon`, `scadaCommandAttempts`).

SQL. Viết đúng tên cột này; NULL = hành vi cũ.

```sql
CREATE TYPE scada_channel_kind AS ENUM ('input','input_output','calculated','calculated_output','output');
ALTER TABLE device_tags
  ADD COLUMN IF NOT EXISTS channel_kind scada_channel_kind,
  ADD COLUMN IF NOT EXISTS display_name varchar(128),
  ADD COLUMN IF NOT EXISTS display_format varchar(64),
  ADD COLUMN IF NOT EXISTS write_min double precision,
  ADD COLUMN IF NOT EXISTS write_max double precision,
  ADD COLUMN IF NOT EXISTS write_step double precision,
  ADD COLUMN IF NOT EXISTS actuation_level smallint;
-- CHECK: actuation_level IN (1,3,4,5); write_min <= write_max khi cả hai khác NULL; write_step > 0 khi khác NULL
CREATE TABLE scada_kenh_che_do (            -- K2: một kênh chế độ cho mỗi máy
  machine_id integer PRIMARY KEY, adapter_id integer NOT NULL, tag_key varchar(128) NOT NULL,
  gia_tri_remote jsonb NOT NULL,            -- giá trị (đã chuẩn hoá) nghĩa là REMOTE
  updated_by integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE scada_khoa_chon (              -- K6: khoá chọn (adapter, tag) cho một người
  adapter_id integer NOT NULL, tag_key varchar(128) NOT NULL, user_id integer NOT NULL,
  request_id varchar(64) NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY (adapter_id, tag_key));
CREATE TABLE scada_command_attempts (       -- §C.5, append-only
  id bigserial PRIMARY KEY, request_id varchar(64), user_id integer NOT NULL,
  adapter_id integer, tag_key varchar(128), requested_value jsonb, after_formula jsonb,
  stage varchar(24) NOT NULL, outcome varchar(24) NOT NULL, reason_code varchar(64),
  command_log_ids bigint[], at timestamptz NOT NULL DEFAULT now());
-- WORM theo khuôn mig 0279 (REVOKE UPDATE, DELETE ON scada_command_attempts FROM avi_app; GRANT SELECT, INSERT; GRANT USAGE trên sequence)
-- + trigger BEFORE UPDATE OR DELETE ném lỗi (khuôn 0374) để cả owner cũng không sửa được qua đường ứng dụng
-- CHECK stage IN ('request','confirm','dispatch','huy'); outcome IN ('rejected','proposed','confirmed','dispatched','expired','cancelled')
```

- [ ] **Step 1: Viết** SQL (idempotent: `IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_object` cho TYPE/CHECK) và script áp. Verify gồm:
  - (a) mọi cột/bảng/CHECK tồn tại đúng kiểu;
  - (b) trong giao dịch hoàn tác: `actuation_level=2` bị CHECK từ chối (23514); `write_min>write_max` bị từ chối; `avi_app` `UPDATE`/`DELETE` trên `scada_command_attempts` bị từ chối (42501), `INSERT` được; verify QUYỀN bằng `has_table_privilege('avi_app', 'scada_command_attempts', 'UPDATE')` = false, `… 'DELETE'` = false, `… 'INSERT'` = true;
  - (c) `__applied_migrations` có 1 hàng.
- [ ] **Step 2: Chạy** `node scripts/apply-migration-0431.mjs --test-only`. Mong đợi: `applied + verified`.
- [ ] **Step 3: Sửa** `drizzle/schema/ot.ts` cho khớp (kiểu `actuationLevel: smallint().$type<1|3|4|5>()`). Thêm vào `.env.example`: `SCADA_COMMANDS_ENABLED=false`, `SCADA_CONG_CHE_DO_ENABLED=false`.
- [ ] **Step 4: Chạy** `npm run check`. Mong đợi: sạch.
- [ ] **Step 5: Đột biến:** bỏ trigger WORM ⇒ verify (b) đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(scada): mig 0431 kenh/che do may/khoa chon/nhat ky thu lenh (R1a T1)` -- các tệp trên. **Không áp DEV.**

### Task 2: `kenhScada.ts` — luật kênh thuần (loại kênh, mức, ép kiểu, dải, bước)

**Files:**
- Create: `server/services/scada/kenhScada.ts`
- Test: `server/services/scada/kenhScada.test.ts`

**Interfaces:**
- Consumes: kiểu hàng `deviceTags` (Task 1), `canonicalOtValue` (`server/services/ot/otActionBinding.ts:72`), `MucRuiRo` (`server/services/ot/aiControlGate.ts:47`).
- Produces:
  - `export type LoaiKenh = "input"|"input_output"|"calculated"|"calculated_output"|"output"`
  - `export function loaiKenh(tag: Pick<DeviceTag,"channelKind"|"writable">): LoaiKenh` — NULL ⇒ `writable ? "input_output" : "input"`
  - `export function laKenhGhi(tag): boolean` — `input_output | calculated_output | output`
  - `export function mucTacDongKenh(tag): MucRuiRo` — kênh ghi mà `actuationLevel` NULL ⇒ 5
  - `export type KetQuaGiaTri = { ok: true; giaTri: number|boolean|string } | { ok: false; ma: "TYPE_MISMATCH"|"OUT_OF_RANGE"|"OFF_STEP"; chiTiet: string; goiY?: number }` — `goiY` (chỉ với `OFF_STEP`) = bước hợp lệ gần nhất NẰM TRONG dải; chỉ là gợi ý, KHÔNG bao giờ tự thay giá trị (điều phối 2026-10-24, mục 7)
  - `export function kiemGiaTriGhi(tag: Pick<DeviceTag,"dataType"|"writeMin"|"writeMax"|"writeStep">, giaTri: unknown): KetQuaGiaTri` — ép kiểu chuẩn theo `dataType` trước, rồi kiểm dải và bước

- [ ] **Step 1: Test đỏ:**
  - `loaiKenh({channelKind:null, writable:true})==="input_output"`.
  - `mucTacDongKenh({channelKind:"output", actuationLevel:null})===5`.
  - bool: `kiemGiaTriGhi(bool, "1")` / `(bool, 1)` / `(bool, true)` đều cho `{ok:true, giaTri:true}`; `(bool, "x")` cho `TYPE_MISMATCH`.
  - float {min 240, max 250, step 0.5}: `"240.0"` cho `ok` với `giaTri===240`; `240.2` cho `OFF_STEP` với `goiY===240`; `249.9` với bước 0.5 cho `goiY===250`; `240.0` / `249.9` không bao giờ trả `ok` với giá trị đã làm tròn; `250.5` cho `OUT_OF_RANGE`; `239.9999999999` cho `OUT_OF_RANGE`; `245.00000000001` cho `ok` (dung sai bước `1e-9 × max(1,|step|)`).
  - int: `12.5` cho `TYPE_MISMATCH`.
  - Mọi cột NULL ⇒ chỉ ép kiểu.
  - Hai cách viết cùng một giá trị cho cùng `canonicalOtValue`.
- [ ] **Step 2: Chạy** `npx vitest run server/services/scada/kenhScada.test.ts`. Mong đợi: đỏ (module chưa có).
- [ ] **Step 3: Cài** các hàm trên. Hàm thuần, không đọc DB.
- [ ] **Step 4: Chạy lại.** Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** bỏ dung sai bước ⇒ ca `245.00000000001` đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(scada): kenhScada - loai kenh, muc tac dong, ep kieu/dai/buoc (R1a T2)`.

### Task 3: Cổng kênh + dải trong `dispatchCore` (K4, mọi người gọi)

**Files:**
- Modify: `server/services/ot/commandDispatcher.ts`, ngay sau khối tag found/enabled/writable (~:886-911).
- Test: `server/services/ot/commandDispatcher.kenh.r1a.db.test.ts`

**Interfaces:**
- Consumes: Task 2 `laKenhGhi`, `kiemGiaTriGhi`.
- Produces: mã từ chối mới trong `command_log.errorText`: `CHANNEL_READ_ONLY`, `TYPE_MISMATCH`, `OUT_OF_RANGE`, `OFF_STEP`. Giá trị đã ép kiểu thay giá trị thô **trước** khi băm/kiểm ràng buộc và trước driver.

Chốt:
- Áp cho mọi `triggeredBy`, kể cả lệnh interlock và Sparkplug.
- **STOP ghim ĐƯỢC MIỄN kiểm dải/bước** (điều phối 2026-10-24, mục 4: không phần mềm nào được chặn STOP đã ghim). Cổng dải đặt TRƯỚC cổng chế độ OT (để lệnh ngoài dải bị từ chối kể cả khi `OT_CONTROL_ENABLED` tắt), nên việc miễn dựa trên khớp **theo dữ liệu**: `isStopCommandType(commandType)` và giá trị khớp `stop_value` của tag qua `stopPinsFromTagRows` + `matchPinnedStop` (`stopPin.ts:137,104`). Phân loại đầy đủ (`classifyOtStop`, kể cả vân tay kết nối) vẫn chạy sau như cũ. Cổng kiểu kênh (`CHANNEL_READ_ONLY`) KHÔNG miễn: STOP ghim chỉ có trên tag ghi được. Tính nhất quán dải ↔ `stop_value` được kiểm LÚC CẤU HÌNH ở Task 12.
- Không cờ: cột mới đều NULL, nên hành vi cũ giữ nguyên.

- [ ] **Step 1: Test đỏ (DB thật):**
  - tag `channel_kind='input'` nhưng `writable=true` ⇒ `rejected CHANNEL_READ_ONLY`, 1 dòng `command_log`, driver 0 lần.
  - dải 240..250 + giá trị 251 ⇒ `OUT_OF_RANGE`.
  - bước 0.5 + 240.2 ⇒ `OFF_STEP`.
  - STOP ghim có `stop_value` ngoài dải (hàng ghi thẳng vào DB, mô phỏng dữ liệu cũ) ⇒ KHÔNG bị `OUT_OF_RANGE` (đi tiếp các cổng như trước); lệnh `stop` với giá trị KHÁC `stop_value` và ngoài dải ⇒ `OUT_OF_RANGE`.
  - mọi cột NULL ⇒ hành vi như trước: test hồi quy với một lệnh hitl hợp lệ đi tới `simulated`.
  - giá trị `"245"` cho float ⇒ driver nhận `245` (số).
  - lệnh hitl gắn `ai_pending_actions` có băm trên `245`, gửi `"245"` ⇒ vẫn khớp ràng buộc. Theo hướng ép kiểu trước khi băm, nếu `verifyActionBinding` so băm trên giá trị thô: ép kiểu ở cả `proposeAction`/`request` (Task 8) và `dispatch` để hai bên dùng cùng giá trị.
- [ ] **Step 2: Chạy** test. Mong đợi: đỏ.
- [ ] **Step 3: Cài** cổng bằng `writeRejected(…, "<MÃ>", chiTiet)`.
- [ ] **Step 4: Chạy lại**, kèm `npx vitest run server/services/ot` (hồi quy). Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** bỏ kiểm dải ⇒ ca 251 đỏ; bỏ miễn STOP ghim ⇒ ca STOP ghim đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(ot): dispatch kiem loai kenh + dai/buoc ghi cho moi nguoi goi (R1a T3, K4)`.

### Task 4: `cheDoMay.ts` + cổng K2 trong `dispatchCore` (có cờ)

**Files:**
- Create: `server/services/scada/cheDoMay.ts`
- Modify: `server/services/ot/commandDispatcher.ts`, trong CÙNG khối cổng sớm của Task 3 (sau kiểm tag, TRƯỚC cổng chế độ OT/nghiệm thu `writeSimulated` ~:928) — ruling R-1 của sổ cái: từ chối LOCAL phải là `rejected` kể cả khi `OT_CONTROL_ENABLED` tắt, nhất quán với cổng dải.
- Test: `server/services/scada/cheDoMay.test.ts`, `server/services/ot/commandDispatcher.cheDo.r1a.db.test.ts`

**Interfaces:**
- Consumes: `layGiaTri(adapterId, tagKey, now?)` (`server/services/scada/boDemHienTai.ts:302`, `GiaTriCoTuoi` có `v, q, ageMs, stale`), `boDemDangBat()`, `canonicalOtValue`, bảng `scada_kenh_che_do`.
- Produces:
  - `export type CheDo = { cheDo: "REMOTE"|"LOCAL"; lyDo: "remote"|"chua_khai"|"bo_dem_tat"|"chua_co_mau"|"chat_luong_xau"|"cu"|"khac_remote"; kenh?: {adapterId; tagKey} }`
  - `export async function cheDoMay(machineId: number | null, now?: number): Promise<CheDo>`
  - `export function congCheDoBat(): boolean` (`SCADA_CONG_CHE_DO_ENABLED === "true"`)
  - mã từ chối mới `MODE_LOCAL` (errorText `MODE_LOCAL: <lyDo>`)

Chốt:
- REMOTE **chỉ khi** máy đã khai, bộ đệm bật, có mẫu, `q==="good"`, `!stale`, và `canonicalOtValue(v)` bằng `gia_tri_remote`. Mọi trường hợp khác là LOCAL (D3, fail-closed).
- `machineId` null ⇒ LOCAL `chua_khai`.
- Cổng trong `dispatchCore` chỉ chạy khi `congCheDoBat()` **hoặc** `triggeredBy.tool === "hmi.write_tag"`. STOP ghim được miễn — khớp theo dữ liệu như Task 3 (`isStopCommandType` + `matchPinnedStop` trên hàng tag), vì cổng nằm trước phân loại STOP đầy đủ.

- [ ] **Step 1: Test đỏ:**
  - DB: cờ bật + máy chưa khai + `OT_CONTROL_ENABLED` TẮT ⇒ vẫn `rejected MODE_LOCAL` (không phải `simulated`).
  - unit (mock `layGiaTri`): bảy `lyDo`, mỗi lý do một ca.
  - DB:
    - cờ tắt + lệnh hitl thường ⇒ không có cổng (hồi quy).
    - cờ bật + máy chưa khai ⇒ `rejected MODE_LOCAL: chua_khai`, 1 dòng WORM, driver 0 lần.
    - cờ bật + STOP ghim ⇒ đi qua.
    - cờ bật + lệnh interlock ⇒ bị chặn (chốt "K2 với lệnh interlock").
    - `tool:"hmi.write_tag"` + cờ tắt ⇒ vẫn bị chặn.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** + `server/services/ot`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - `cheDoMay` coi `uncertain` là good ⇒ unit đỏ;
  - bỏ miễn STOP ghim ⇒ DB đỏ.
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `feat(scada): che do may LOCAL/REMOTE tu kenh khai bao + cong dispatch co co (R1a T4, K2/D3)`.

### Task 5: Đọc lại bắt buộc cho đường HMI (K7) + hạn hàng đợi trung tâm (K9)

**Files:**
- Modify:
  - `server/services/ot/commandDispatcher.ts`: `DispatchInput` (~:320) thêm `docLai?: "bat_buoc"`; truyền xuống lớp ghi.
  - `server/services/ot/otDeviceWrite.ts`: `executeOtDeviceWrite` (~:1113) nhận tuỳ chọn đọc lại; `PendingAdapterCommand` (~:375) thêm `enqueuedAt`.
- Test: `server/services/ot/otDeviceWrite.docLai.r1a.test.ts`, `server/services/ot/commandQueue.ttl.r1a.test.ts`

**Interfaces:**
- Produces: `DispatchInput.docLai?: "bat_buoc"`. Mã từ chối mới `QUEUE_EXPIRED`. Hằng `HAN_HANG_DOI_MAC_DINH_MS = 60_000`.

Chốt:
- `docLai:"bat_buoc"` ⇒ đọc lại kể cả khi `isOtReadbackEnabled()` tắt. Logic so giữ nguyên: `readbackMatches` và `quality==="good"`.
- Lệnh **không phải STOP** chờ trong hàng đợi lâu hơn `input.deadlineMs ?? HAN_HANG_DOI_MAC_DINH_MS`:
  - không bao giờ chạy;
  - kết quả `rejected QUEUE_EXPIRED`, ghi dòng kết quả cho dòng ý định đã có. Dùng đúng đường `failedResults`/kết quả của `reserveRealWrite`, không thêm đường ghi.
- STOP giữ không hạn (K9).
- Kiểm hạn lúc lệnh tới lượt chạy (`run`), không cần timer.

- [ ] **Step 1: Test đỏ:**
  - `OT_READBACK_ENABLED` tắt + `docLai:"bat_buoc"` ⇒ có `readTags`. Stub `simDatLoi({giaTri:{sp:245}})` ⇒ `acked_unverified`, `readBackValue=245`.
  - không `docLai` ⇒ như cũ (`acked`).
  - hàng đợi (fake timers, `OT_CMD_SERIALIZE_ENABLED=true`): lệnh B chờ sau lệnh A treo 61 s ⇒ B `QUEUE_EXPIRED`, driver ghi B 0 lần.
  - STOP chờ 120 s ⇒ vẫn chạy.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** + `server/services/ot`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - bỏ nhánh `bat_buoc` ⇒ ca đọc lại đỏ;
  - bỏ kiểm `enqueuedAt` ⇒ ca 61 s đỏ.
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `feat(ot): doc lai bat buoc cho duong HMI + han hang doi lenh thuong 60 s, STOP khong han (R1a T5, K7/K9)`.

### Task 6: `khoaChon.ts` — khoá chọn (K6)

**Files:**
- Create: `server/services/scada/khoaChon.ts`
- Test: `server/services/scada/khoaChon.db.test.ts`

**Interfaces:**
- Produces:
  - `export type KetQuaKhoa = { ok: true } | { ok: false; ma: "DANG_DUOC_CHON"; boiUserId: number; hetHanLuc: Date }`
  - `export async function giuKhoaChon(tx, a: { adapterId: number; tagKey: string; userId: number; requestId: string; hetHanLuc: Date }, now?: Date): Promise<KetQuaKhoa>` — `INSERT … ON CONFLICT (adapter_id, tag_key) DO UPDATE … WHERE scada_khoa_chon.expires_at <= now OR scada_khoa_chon.user_id = $userId RETURNING`; không có hàng trả về ⇒ đọc người giữ để báo
  - `export async function nhaKhoaChon(tx, a: { adapterId; tagKey; requestId }): Promise<void>` — chỉ xoá khi `request_id` khớp
  - `export async function conGiuKhoa(tx, a: { adapterId; tagKey; userId; requestId }, now?): Promise<boolean>`

Chốt:
- Cùng người, yêu cầu mới ⇒ ghi đè khoá của chính họ.
- Khoá hết hạn cùng TTL của yêu cầu (D4).

- [ ] **Step 1: Test đỏ (DB):**
  - A giữ ⇒ B nhận `DANG_DUOC_CHON {boiUserId:A}`.
  - A giữ, đã hết hạn ⇒ B giữ được.
  - A gọi lần hai ⇒ ok.
  - `nhaKhoaChon` với `requestId` cũ không xoá khoá mới.
  - Hai giao dịch song song A/B, 20 vòng ⇒ đúng một người thắng mỗi vòng.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại.** Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** bỏ điều kiện `WHERE` của `DO UPDATE` ⇒ ca B đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(scada): khoa chon (adapter, kenh) theo DB, het han cung TTL (R1a T6, K6)`.

### Task 7: Xác thực theo mức (K8 + D5) và sàn vai trò

**Files:**
- Create: `server/_core/xacThucTheoMuc.ts`
- Modify: `server/_core/trpc.ts` — chỉ **export** `verifyFreshTotp` (~:536) và đọc/ghi `stepUpVerifiedUntil` (~:526) qua hai hàm nhỏ, không đổi hành vi middleware cũ.
- Test: `server/_core/xacThucTheoMuc.test.ts`

**Interfaces:**
- Consumes: `MucRuiRo`, `ACTUATION_ROLES` (`trpc.ts:819`), `verifyFreshTotp`, `stepUpVerifiedUntil`.
- Produces:
  - `export function vaiTroDuocGhi(muc: MucRuiRo): readonly UserRole[]` — 1|3 ⇒ `operator, engineer, supervisor, admin`; 4|5 ⇒ `ACTUATION_ROLES`
  - `export async function kiemXacThucTheoMuc(ctx: { user; sessionToken? }, muc: MucRuiRo, totpCode?: string): Promise<{ ok: true; cach: "khong_can"|"phien"|"moi_lan" } | { ok: false; ma: "ROLE_FLOOR"|"TOTP_CHUA_DANG_KY"|"TOTP_CAN"|"TOTP_SAI" }>`

Chốt:
- Mức 1|3 ⇒ `khong_can`.
- Mức 4:
  - chưa đăng ký 2FA ⇒ `TOTP_CHUA_DANG_KY`;
  - cache phiên còn hạn ⇒ `phien`;
  - nếu không: cần `totpCode` đúng, rồi đặt cache 10 ph.
- Mức 5: luôn cần `totpCode` đúng, mã dùng một lần qua `verifyTotpOnce`.
- **Bỏ qua** `AUTH_2FA_BAT_BUOC` và `ACTUATION_STEPUP_2FA`.

- [ ] **Step 1: Test đỏ:**
  - ma trận mức × (đăng ký/chưa) × (cache/không) × (mã đúng/sai/thiếu);
  - mức 5 dùng lại cùng một mã ⇒ `TOTP_SAI`;
  - `AUTH_2FA_BAT_BUOC=0` không làm mức 4–5 đi qua;
  - `vaiTroDuocGhi(4)` không chứa `operator`.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** + test các middleware cũ (`server/_core/*stepUp*`, `*twoFactor*`) để chứng minh không đổi. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** mức 5 dùng cache phiên ⇒ đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(auth): xac thuc theo muc tac dong (1-3 khong, 4 phien, 5 TOTP moi lan) + san vai tro (R1a T7, K8/D5)`.

### Task 8: `scada.commands.request` (K1, K5)

**Files:**
- Create: `server/routers/scadaCommandsRouter.ts`, `server/services/scada/lenhHmi.ts` (logic, để router mỏng)
- Modify: `server/routers.ts`, `server/_core/moduleAccessMap.ts`, 2 tệp census, `client/src/i18n/locales/{vi,en,zh}.json`
- Test: `server/routers/scadaCommandsRouter.request.db.test.ts`

**Interfaces:**
- Consumes: Task 2 (`laKenhGhi`, `kiemGiaTriGhi`, `mucTacDongKenh`), Task 4 (`cheDoMay`), Task 6 (`giuKhoaChon`), Task 7 (`vaiTroDuocGhi`), `layGiaTri`, `otPayloadHash`/`withOtPayloadHash` (`otActionBinding.ts:102,142`), `isOtControlEnabled`, `isCommissioned`/`isCommissioningRequired`, `adapterOwnedByEdgeInTx`.
- Produces:
  - `scada.commands.request` (mutation)
    - input `{ adapterId: number; tagKey: string; value: number|boolean|string; lyDo: string(5..300); clientRequestId: string(uuid) }`. `lyDo` lưu vào `previewJson.lyDo` và vào dòng attempts.
    - output `{ requestId: string; expiresAt: string; preview: { machine: string; channel: string; unit: string|null; current: { v: number|boolean|string|null; q: "good"|"uncertain"|"bad"; ageMs: number|null }; requested: V; afterFormula: V; range: {min; max; step}|null; level: MucRuiRo; needsTotp: boolean; mode: "real"|"simulated"; simulatedReasons: string[]; route: "central"; warnings: string[] } }`
  - mã từ chối ở bước request (`scada_command_attempts.reason_code` + `appError`): `FEATURE_DISABLED`, `NOT_FOUND` (không thấy = ngoài phạm vi), `CHANNEL_READ_ONLY`, `TYPE_MISMATCH`, `OUT_OF_RANGE`, `OFF_STEP`, `MODE_LOCAL`, `DANG_DUOC_CHON`, `EDGE_CHUA_HO_TRO`, `ROLE_FLOOR`, `TOTP_CHUA_DANG_KY`. Lỗi `OFF_STEP` mang `goiY` trong `appError` params để M5 hiện.
  - socket `scada:cmd { requestId, status: "proposed", at }` vào `user:{id}`

Chốt:
- Thứ tự cổng:
  1. cờ `SCADA_COMMANDS_ENABLED`;
  2. phạm vi máy — "phạm vi control theo cây" (điều phối mục 1) = máy nằm trong `idsTrongPhamVi("machine", phamViCua(ctx), {strict:true})` (cây nhà máy → xưởng → line → trạm → máy). Hệ chưa có phạm vi control tách khỏi phạm vi xem (C.8 thuộc R4) ⇒ dùng phạm vi cây hiện có + `machine_control.canEdit`; ghi ruling;
  3. tag bật + `laKenhGhi`;
  4. `kiemGiaTriGhi`;
  5. vai trò `vaiTroDuocGhi(muc)` + `machine_control.canEdit`; mức ≥ 4 mà người gọi CHƯA đăng ký 2FA ⇒ `TOTP_CHUA_DANG_KY` ngay tại đây (từ chối sớm, có dòng attempts; `confirm` vẫn kiểm lại);
  6. edge ⇒ `EDGE_CHUA_HO_TRO`;
  7. `cheDoMay` = REMOTE;
  8. `giuKhoaChon`;
  9. tạo `ai_pending_actions`.
- Dòng `ai_pending_actions`:
  - `tool:"hmi.write_tag"`, `status:"proposed"`, `userId`, `expiresAt = now + 60 s`;
  - `idempotencyKey = "hmi:" + userId + ":" + clientRequestId`;
  - `argsJson = {adapterId, machineId, tagKey, value(đã ép kiểu), commandType:"write_tag"}`;
  - `previewJson` mang preview và `__otPayloadHash`, tính trên giá trị đã ép kiểu với cùng `commandType` mà Task 9 truyền vào `dispatch()`.
- Mỗi lần trượt ở bước 3–8 ⇒ một dòng `scada_command_attempts {stage:"request", outcome:"rejected", reason_code}`.
- Thành công ⇒ một dòng `outcome:"proposed"`.
- Cùng `clientRequestId` gửi lại ⇒ trả yêu cầu cũ, không tạo dòng mới.
- `mode`:
  - `simulatedReasons` gồm `OT_CONTROL_TAT` nếu `!isOtControlEnabled()`, `CHUA_NGHIEM_THU` nếu bắt buộc nghiệm thu mà chưa có.
  - Không đọc safety ở đây: safety do `dispatch()` quyết, preview ghi `warnings:["SAFETY_KIEM_LUC_GUI"]`.
- `current` lấy từ `layGiaTri`. Bộ đệm tắt hoặc không có mẫu ⇒ `{v:null, q:"bad", ageMs:null}` + `warnings:["KHONG_CO_GIA_TRI_HIEN_TAI"]`.
- `hmi.write_tag` **không** đăng ký vào registry tool AI.

- [ ] **Step 1: Test đỏ (DB):**
  - mỗi mã từ chối một ca, kèm đúng 1 dòng attempts với `reason_code` đúng;
  - ca thành công: `ai_pending_actions` đúng `tool`, băm, `expiresAt ≈ +60 s`; `scada:cmd proposed` tới đúng user;
  - viewer nhà máy B gọi adapter nhà máy A ⇒ `NOT_FOUND`, giống hệt ca adapter không tồn tại;
  - `operator` + kênh mức 4 ⇒ `ROLE_FLOOR`;
  - `clientRequestId` lặp ⇒ cùng `requestId`;
  - Review Focus 4: bộ đệm tắt ⇒ `MODE_LOCAL`, kèm preview chưa trả.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.** Đăng ký router cấp cao `scadaCommands` (ruling R-2: `scada.commands.*` trong kế hoạch = `trpc.scadaCommands.*`; `scada.kenh.*` = `trpc.scadaKenh.*`), theo cách `scadaDiag` được đăng ký (`routers.ts:~553`, `moduleAccessMap.ts:~86`). Thêm khoá i18n.
- [ ] **Step 4: Census:** chạy `npx vitest run server/routers/phamViDocCensus.test.ts server/routers/congGiayPhepAiCensus.test.ts server/routers/appErrorParamsCoverage.test.ts`. Mong đợi: đỏ đúng do thủ tục mới. Ghim lại theo số đo, kèm ghi chú ngày. Chạy lại. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - bỏ kiểm phạm vi ⇒ ca nhà máy B đỏ;
  - băm trên giá trị thô ⇒ ca băm đỏ.
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `feat(scada): scada.commands.request - ban xem truoc, khoa chon, ban ghi cho hmi.write_tag TTL 60 s (R1a T8, K1/K5)`.

### Task 9: `scada.commands.confirm` / `huy` / `trangThai` (K1, K6, K8, K9)

**Files:**
- Modify: `server/routers/scadaCommandsRouter.ts`, `server/services/scada/lenhHmi.ts`, census, i18n
- Test: `server/routers/scadaCommandsRouter.confirm.db.test.ts`

**Interfaces:**
- Consumes: Task 5 (`docLai:"bat_buoc"`), Task 6 (`conGiuKhoa`, `nhaKhoaChon`), Task 7 (`kiemXacThucTheoMuc`), `dispatch()` (`commandDispatcher.ts:715`).
- Produces:
  - `scada.commands.confirm` (mutation)
    - input `{ requestId: string; totpCode?: string(6) }`
    - output `{ status: CommandStatus | "rejected"; ok: boolean; simulated: boolean; reason?: string; commandLogIds: number[]; readBackValue?: unknown }`
  - `scada.commands.huy` (mutation) — input `{ requestId }`; chỉ chủ yêu cầu; `proposed→cancelled`, nhả khoá, attempts `stage:"huy"`.
  - `scada.commands.trangThai` (query) — input `{ requestId }`; chỉ chủ yêu cầu; trả dòng chờ + các dòng attempts + `command_log` theo `actionId`.
  - socket `scada:cmd { requestId, status, at, reason? }` cho mỗi chuyển trạng thái.
  - mã mới: `HET_HAN`, `DA_XU_LY`, `KHOA_MAT`, `TOTP_*` (từ Task 7).

Chốt — trình tự `confirm`:
1. Nạp dòng chờ. Không phải của người gọi ⇒ `NOT_FOUND`.
2. `expiresAt <= now` ⇒ CAS `proposed→expired`, nhả khoá, attempts `expired/HET_HAN`.
3. `kiemXacThucTheoMuc(ctx, muc, totpCode)` với `muc` lấy từ **tag hiện tại** (đọc lại DB, không tin preview).
4. Kiểm lại các cổng 3–7 của Task 8 trên dữ liệu **hiện tại**. Review Focus 2: chuyển LOCAL, tag tắt hoặc chuyển edge ⇒ từ chối, nhả khoá.
5. `conGiuKhoa` ⇒ nếu không còn: `KHOA_MAT`.
6. CAS `proposed→confirmed` (`UPDATE … WHERE status='proposed' RETURNING`). Không có hàng ⇒ `DA_XU_LY`.
7. `dispatch({ adapterId, machineId, commandType:"write_tag", writes:[{tagKey, value}], triggeredBy:{ kind:"hitl", tool:"hmi.write_tag", actionId: requestId, confirmedBy: userId, requestedBy: userId, requireBoundAction: true }, idempotencyKey: "hmi:" + requestId, docLai:"bat_buoc", deadlineMs: còn lại tới expiresAt })`.
8. Nhả khoá.
9. attempts `dispatched` kèm `command_log_ids`.
10. Phát `scada:cmd`.

Nếu `dispatch()` ném lỗi: attempts `dispatch/rejected` kèm mã, nhả khoá, trả lỗi. Không nuốt lỗi.

- [ ] **Step 1: Test đỏ (DB; stub; `OT_CONTROL_ENABLED=true` trong tiến trình; safety mock OK như `commandDispatcher.dot1b.db.test.ts:27-42`; `OT_COMMISSIONING_REQUIRED=false`):**
  - đường vui mức 3 ⇒ `acked_verified`, 1 ý định + 1 kết quả trong `command_log`, `ai_pending_actions.status` thành `executed`, khoá đã nhả.
  - đọc lại lệch (`simDatLoi({giaTri:{tag:245}})`) ⇒ `acked_unverified`, `readBackValue:245`.
  - hết TTL (đặt `expiresAt` về quá khứ) ⇒ `HET_HAN`, `dispatch` 0 lần.
  - Review Focus 1: hai `confirm` song song ⇒ một `ok`, một `DA_XU_LY`, đúng 1 ý định.
  - Review Focus 2, mỗi trường hợp một ca: máy chuyển LOCAL giữa hai bước; tag bị tắt; adapter chuyển sang edge.
  - mức 5 thiếu mã ⇒ `TOTP_CAN`, dòng chờ vẫn `proposed`.
  - interlock telemetry thiếu dữ liệu nhắm máy này ⇒ `rejected INTERLOCK_BLOCKED` có `thieu_du_lieu` trong `command_log`.
  - `OT_CONTROL_ENABLED` tắt ⇒ `simulated`, `simulated:true`.
  - `huy` ⇒ khoá nhả; người khác `huy` ⇒ `NOT_FOUND`.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Census + i18n** như Task 8. Chạy lại. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - bỏ CAS ⇒ ca song song đỏ;
  - dùng mức từ preview ⇒ thêm ca: đổi mức tag 3→5 giữa hai bước; ca này đỏ khi đột biến;
  - bỏ kiểm lại chế độ ⇒ ca LOCAL đỏ.
  - Hoàn tác cả ba.
- [ ] **Step 6: Commit** `feat(scada): scada.commands.confirm/huy/trangThai - CAS, kiem lai cong, 2FA theo muc, dispatch hitl hmi.write_tag doc lai bat buoc (R1a T9)`.

### Task 10: K11 + chặn `hmi.*` ở lõi AI

**Files:**
- Modify:
  - `server/services/aiCopilotActions.ts`: `confirmAction` (~:740) từ chối `tool.startsWith("hmi.")`, trước mọi CAS.
  - `server/routers/aiCopilotRouter.ts`: `confirmAction` (~:38).
  - `server/services/ot/aiControlGate.ts`: `kiemCongAi` (~:308) dùng `max(phanLoaiMuc(tool, tagKey), mucTacDongKenh(tag))` khi có tag.
  - `server/services/aiLocalTools/writeHandlers/machineControl.ts`: ~:468 `oldValue` lấy từ `layGiaTri`.
- Test: `server/services/aiCopilotActions.hmi.r1a.test.ts`, `server/routers/aiCopilotRouter.confirm.r1a.db.test.ts`, `server/services/ot/aiControlGate.kenh.r1a.test.ts`

**Interfaces:**
- Consumes: Task 2 `mucTacDongKenh`, Task 7 `kiemXacThucTheoMuc` + `vaiTroDuocGhi`.
- Produces: `copilot.confirmAction` thêm input tuỳ chọn `totpCode?: string(6)`.

Chốt:
- Với tool ghi OT (có `otWriteBinding`): `muc` = mức đã tính như trên.
  - Sàn vai trò `vaiTroDuocGhi(muc)`.
  - `kiemXacThucTheoMuc`. Theo `kiemCongAi`, AI vẫn bị chặn ≥ 4, nên thực tế chỉ còn sàn vai trò cho mức 1/3.
- Tool không ghi OT: hành vi giữ nguyên.

- [ ] **Step 1: Test đỏ:**
  - `confirmAction` với dòng `tool:"hmi.write_tag"` ⇒ từ chối, trạng thái không đổi;
  - người vai trò `viewer` xác nhận tool máy mức 3 ⇒ `ROLE_FLOOR`;
  - kênh mức 4 + tool mức 3 ⇒ `kiemCongAi` `MUC_QUA_CAO`;
  - tool không ghi OT ⇒ không đổi (hồi quy);
  - bản xem trước `set_machine_param` có `oldValue` từ bộ đệm.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** + `npx vitest run server/services/ot server/services/aiLocalTools` (hồi quy). Mong đợi: xanh.
- [ ] **Step 5: Đột biến:**
  - bỏ chặn `hmi.` ⇒ đỏ;
  - `kiemCongAi` bỏ mức kênh ⇒ đỏ.
  - Hoàn tác cả hai.
- [ ] **Step 6: Commit** `fix(ai): confirmAction chan hmi.*, san vai tro + xac thuc theo muc cho tool ghi OT, muc = max(tool, kenh); gia tri cu tu bo dem (R1a T10, K11/K5)`.

### Task 11: K10 — REST v1 lệnh thiết bị (D8)

**Files:**
- Modify: `server/api/v1/openapi.ts` (bỏ khối `"/api/v1/equipment/{id}/commands"` ~:376-391; bỏ schema `CommandRequest` ~:283 nếu không còn dùng), `server/api/v1/apiV1.test.ts` (~:280)
- Test: `server/api/v1/equipmentCommands.r1a.db.test.ts`

Chốt:
- Viết test xác nhận hành vi **thật** của route cho từng nhóm `commandType`, gồm cả STOP robot mà `robotStopExempt.dot1c.db.test.ts:151` đang dùng.
- **Không gỡ route.** Chỉ gỡ khỏi OpenAPI theo D8. Route vẫn chạy, tức không xoá mã có người gọi.
- Nếu test cho thấy một lệnh không phải STOP lọt tới thiết bị (không bị `NOT_CONFIRMED`): **dừng và báo**, không tự sửa.

- [ ] **Step 1: Test:**
  - lệnh ghi thường qua REST ⇒ bị từ chối với mã thật (dự kiến `NOT_CONFIRMED`), có dòng `command_log`;
  - STOP robot ⇒ ghi lại hành vi hiện có;
  - `GET /api/v1/openapi.json` không còn path này. Đỏ trước khi gỡ.
- [ ] **Step 2: Chạy.** Mong đợi: ca OpenAPI đỏ, ca từ chối xanh (đặc tả hiện trạng).
- [ ] **Step 3: Gỡ** khỏi OpenAPI.
- [ ] **Step 4: Chạy lại** + `server/api/v1`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** khôi phục path ⇒ ca OpenAPI đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `chore(api): REST v1 lenh thiet bi - test xac nhan luon bi tu choi, go khoi OpenAPI (R1a T11, K10/D8)`.

### Task 12: Router M12 `scada.kenh` — cấu hình kênh và kênh chế độ

**Files:**
- Create: `server/routers/scadaKenhRouter.ts`
- Modify: `server/routers.ts`, `moduleAccessMap.ts`, census, i18n, `server/services/ot/stopPin.ts` (`validateStopValue` / `datStopPin` ~:308: từ chối ghim ngoài dải/bước của tag)
- Test: `server/routers/scadaKenhRouter.db.test.ts`, `server/services/ot/stopPin.dai.r1a.db.test.ts`

**Interfaces:**
- Produces:
  - `scada.kenh.danhSach({ adapterId })` (query) → `Array<{ tagId; tagKey; dataType; unit; writable; loaiKenh: LoaiKenh; channelKindKhai: LoaiKenh|null; displayName; displayFormat; writeMin; writeMax; writeStep; actuationLevel: MucRuiRo|null; mucHieuLuc: MucRuiRo; laKenhCheDo: boolean }>`
  - `scada.kenh.capNhat({ tagId, patch: { channelKind?, displayName?, displayFormat?, writeMin?, writeMax?, writeStep?, actuationLevel? }, lyDo: string(5..300) })` (mutation)
  - `scada.kenh.cheDo.danhSach()` (query; các máy trong phạm vi + kênh chế độ + `cheDoMay` hiện tại)
  - `scada.kenh.cheDo.dat({ machineId, adapterId, tagKey, giaTriRemote, lyDo })` (mutation)
  - `scada.kenh.cheDo.go({ machineId, lyDo })` (mutation)

Chốt:
- Quyền:
  - query: `MOD_OT_CONTROL` + `machine_control.canView`;
  - mutation: `roleProcedure("admin","engineer").use(require2FA).use(moduleGate("MOD_OT_CONTROL"))` + `machine_control.canEdit`, giống `kySuProcedure` của `scadaDiagRouter.ts:46`.
- Kiểm phạm vi máy của adapter.
- Mỗi mutation ghi `recordAuditEvent` trong **cùng giao dịch** với thay đổi, có `before`/`after`/`lyDo`.
- Kiểm hợp lệ:
  - dải `min<=max`;
  - bước `>0`;
  - mức ∈ {1,3,4,5} hoặc null;
  - kênh chế độ phải là tag của adapter gắn **đúng máy đó**;
  - `giaTriRemote` ép kiểu theo `dataType`, dùng `kiemGiaTriGhi` không có dải.
  - **Nhất quán dải ↔ STOP ghim** (điều phối mục 4, đổi lấy việc STOP ghim được miễn dải trong `dispatch()`):
    - khai/đổi `writeMin`/`writeMax`/`writeStep` mà `stop_value` đang ghim của tag nằm ngoài dải mới hoặc lệch bước ⇒ từ chối `STOP_PIN_NGOAI_DAI` (không ghi gì, không audit lẻ);
    - ghim `stop_value` (đường `datStopPin` hiện có) ngoài dải/bước đang khai của tag ⇒ từ chối cùng mã. Dải NULL ⇒ không kiểm (hành vi cũ).
- Hạ mức (5→3) hoặc nới dải không cần người thứ hai trong R1a. Ghi rõ đây là mục R2 nếu điều phối muốn.

- [ ] **Step 1: Test đỏ:**
  - phạm vi: viewer B ⇒ `NOT_FOUND`;
  - `operator` sửa ⇒ `FORBIDDEN`;
  - audit trong cùng giao dịch: giao dịch lỗi thì không có audit lẻ;
  - kênh chế độ trỏ tag của máy khác ⇒ từ chối;
  - `danhSach` trả `mucHieuLuc=5` cho kênh ra không khai mức;
  - tag có `stop_value=0` đang ghim, khai dải 10..20 ⇒ `STOP_PIN_NGOAI_DAI`, cột không đổi;
  - tag có dải 10..20, ghim `stop_value=0` ⇒ `STOP_PIN_NGOAI_DAI`; ghim 10 ⇒ ok.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Census + i18n.** Chạy lại. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** bỏ kiểm "đúng máy" ⇒ đỏ; bỏ kiểm dải ở `datStopPin` ⇒ ca ghim 0 đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(scada): router M12 cau hinh kenh + kenh che do may, audit trong giao dich (R1a T12)`.

### Task 13: Màn M12 `/scada/config/channels`

**Files:**
- Create: `client/src/pages/ScadaKenh.tsx`, `client/src/components/scada/BangKenh.tsx`, `client/src/components/scada/KenhCheDoMay.tsx`
- Modify:
  - `client/src/App.tsx`: lazy + route trong `RouteGuard navHref="/scada/config/channels"`.
  - `client/src/lib/navigation.tsx`: mục `nav.scadaKenh`, `section:"connect"`, `requiredPermission:"machine_control"`, `engineerOriented:true`.
  - `shared/module-registry.ts`: thêm route vào module chứa `/scada/diag`.
  - i18n vi/en/zh.
- Test: `client/src/pages/ScadaKenh.dom.test.tsx`

Chốt:
- Bảng theo adapter. Mỗi hàng: loại kênh hiệu lực (+ "khai" / "suy từ writable"), dải, bước, mức hiệu lực (kênh ra không khai ⇒ "5 — mặc định đóng"), tên hiển thị.
- Sửa qua hộp thoại có lý do ≥ 5 ký tự, theo mẫu hộp thoại lý do của `ScadaDiag`.
- Khối "Kênh chế độ" theo máy: tag, giá trị REMOTE, chế độ hiện tại kèm lý do (`chua_khai` ⇒ "Chưa khai ⇒ coi như LOCAL").
- Nút sửa chỉ hiện cho engineer/admin + `canEdit`, cùng cổng với `coTheGanMayMqtt`.

- [ ] **Step 1: Test đỏ (DOM, mock trpc như `ScadaDiag.dom.test.tsx`):**
  - hàng kênh ra không khai mức hiện "5";
  - `operator` không thấy nút sửa;
  - lý do 3 ký tự ⇒ nút gửi khoá;
  - máy chưa khai hiện chữ khoá `scada.kenh.cheDo.chuaKhai`;
  - đổi locale `en` thì không còn chữ Việt.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** + census client (`navRouteGuardRoles`, `navLicenseFieldsCensus`, `engineeringNavRouteGuardParity`) + `npm run i18n:check`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** hiện nút sửa cho mọi vai ⇒ đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(scada): man M12 /scada/config/channels (R1a T13)`.

### Task 14: M4 faceplate + M5 hộp thoại lệnh

**Files:**
- Create:
  - `client/src/components/scada/Faceplate.tsx`
  - `client/src/components/scada/HopThoaiLenh.tsx`
  - `client/src/components/scada/ketQuaLenh.ts` (thuần: trạng thái → nhãn/tự đóng)
  - `client/src/hooks/useScadaCmd.ts` (nghe `scada:cmd`)
- Modify: `client/src/components/scada/NganTagAdapter.tsx` (nút "Faceplate" trên hàng tag ghi được), `client/src/pages/ScadaKenh.tsx` (nút mở faceplate), i18n
- Test: `client/src/components/scada/ketQuaLenh.unit.test.ts`, `client/src/components/scada/Faceplate.dom.test.tsx`, `client/src/components/scada/HopThoaiLenh.dom.test.tsx`

**Interfaces:**
- Consumes: `scada.commands.request/confirm/huy`, `scada.kenh.danhSach`, `scada.kenh.cheDo.danhSach`, `scadaDiag.tagCuaAdapter`; `useStepUpOtp` (`client/src/components/security/StepUpOtpDialog.tsx:65`) cho mã TOTP.
- Produces: `export function nhanKetQua(status: "acked_verified"|"acked_unverified"|"simulated"|"rejected"|"timeout"|"sent", ctx: { readBack?: unknown; reason?: string; requested: unknown }): { khoa: string; tuDongDongMs: number | null }`. Giá trị: `acked_verified` ⇒ 3000; mọi trạng thái khác ⇒ null (không tự đóng).

Chốt, bám báo cáo §4.5–4.6:
- **Faceplate:**
  - Chế độ máy: LOCAL ⇒ ẩn mọi lệnh, hiện "Đang điều khiển tại chỗ".
  - Giá trị kèm chất lượng/tuổi, dùng `hienChatLuong` / `dinhDangTuoi` có sẵn.
  - Dải và mức.
  - Ô nhập theo kiểu: số = ô nhập + dải; bool = hai nút có nhãn từ `displayFormat` `bool:Tắt,Bật`; enum `enum:A,B,C` = mỗi giá trị một nút.
  - Nút "Đổi…" mở M5.
  - Danh sách "Điều kiện cho phép" chạy khô để **R1b**. Ghi chú trong commit.
- **M5:**
  - Hiện đủ trường preview: máy, kênh, hiện tại, yêu cầu, sau công thức, dải, mức, cần TOTP, chế độ THẬT/MÔ PHỎNG + lý do, đường.
  - Đồng hồ đếm ngược tới `expiresAt`, hết giờ thì khoá nút gửi.
  - Lý do bắt buộc ≥ 5 ký tự, nhập ở faceplate trước khi gọi `request` (trường `lyDo` của Task 8), hiện lại trong M5.
  - Nút "Gửi (mô phỏng)" khi `mode:"simulated"`.
  - Cần TOTP ⇒ ô 6 số.
  - **Từ chối phải nói lý do và cách xử lý, không chỉ mã** (điều phối mục 2, 6, 7):
    - `TOTP_CHUA_DANG_KY` ⇒ "Lệnh mức 4–5 cần xác thực hai lớp; tài khoản của bạn chưa đăng ký" + liên kết tới trang đăng ký 2FA hiện có (tìm route trang bảo mật tài khoản trong `App.tsx`; nếu không có trang, dùng hướng dẫn chữ và ghi trong báo cáo);
    - `EDGE_CHUA_HO_TRO` ⇒ "Máy này do edge {mã} sở hữu — lệnh từ SCADA tới máy edge chưa được hỗ trợ (đợt R1c)";
    - `OFF_STEP` ⇒ "Giá trị phải theo bước {step}. Giá trị hợp lệ gần nhất: {goiY}" + nút điền `goiY` vào ô (người bấm vẫn phải gửi lại; KHÔNG tự làm tròn).
  - Kết quả theo `nhanKetQua`. `acked_unverified` hiện giá trị đọc lại và "kiểm tra tại máy". `rejected` hiện tên cổng → chữ người đọc (khoá i18n `scada.lenh.cong.<MÃ>`).
  - Đóng hộp thoại khi còn `proposed` ⇒ gọi `huy`.

- [ ] **Step 1: Test đỏ:**
  - unit `nhanKetQua`;
  - DOM faceplate: LOCAL ẩn nút; bool hai nút có nhãn;
  - DOM M5:
    - đếm ngược tới 0 ⇒ nút khoá;
    - `simulated` ⇒ chữ nút "Gửi (mô phỏng)";
    - `acked_unverified` ⇒ không tự đóng, có giá trị đọc lại;
    - `acked_verified` ⇒ tự đóng sau 3 s (fake timers);
    - đóng khi `proposed` ⇒ `huy` được gọi;
    - mức 5 ⇒ ô TOTP bắt buộc;
    - `TOTP_CHUA_DANG_KY` ⇒ có chữ hướng dẫn + liên kết đăng ký; `EDGE_CHUA_HO_TRO` ⇒ chữ tiếng Việt có mã edge; `OFF_STEP` ⇒ hiện `goiY`, bấm gợi ý chỉ điền ô, không gọi `request`;
    - locale `en` ⇒ không chữ Việt.
- [ ] **Step 2: Chạy.** Mong đợi: đỏ.
- [ ] **Step 3: Cài.**
- [ ] **Step 4: Chạy lại** + census client + i18n + `npm run check`. Mong đợi: xanh.
- [ ] **Step 5: Đột biến:** `acked_unverified` tự đóng 3 s ⇒ đỏ. Hoàn tác.
- [ ] **Step 6: Commit** `feat(scada): faceplate M4 + hop thoai lenh M5 (R1a T14)`.

### Task 15: Nghiệm thu R1a — ma trận ô + bench OpenPLC có safety PLC mô phỏng

**Files:**
- Create:
  - `server/services/scada/r1aNghiemThu.db.test.ts` (opt-in `SCADA_R1A_NGHIEM_THU=1`, như R0)
  - `scripts/scada-r1a-bench.ts`
  - `docs/superpowers/plans/2026-10-24-scada-r1a-bao-cao-nghiem-thu.md`
- Modify: `.env.example` nếu còn thiếu cờ.

Cổng (hàng R1 của báo cáo + ô 8 do điều phối thêm 2026-10-24): mỗi ô ⇒ **bị từ chối đúng cổng** và **có dòng WORM**. Đọc lại lệch hiện cho người vận hành.

| Ô | Kích thích | Cổng và mã mong đợi | Dòng WORM |
|---|---|---|---|
| 1 kênh vào | `channel_kind='input'` | `request`: `CHANNEL_READ_ONLY`. Kèm `dispatch` trực tiếp (tool AI): `CHANNEL_READ_ONLY` | attempts + `command_log` |
| 2 ngoài dải | 251 với dải 240..250 | `request`: `OUT_OF_RANGE`. Kèm `dispatch` trực tiếp: `OUT_OF_RANGE` | attempts + `command_log` |
| 3 LOCAL | kênh chế độ ≠ giá trị REMOTE | `request`: `MODE_LOCAL`. Có `SCADA_CONG_CHE_DO_ENABLED`: `dispatch` AI `MODE_LOCAL`. STOP ghim vẫn qua | attempts + `command_log` |
| 4 người thứ hai | B gọi `request` khi A đang giữ | `DANG_DUOC_CHON` | attempts |
| 5 hết TTL | `confirm` sau `expiresAt` | `HET_HAN`, `dispatch` 0 lần | attempts |
| 6 interlock thiếu dữ liệu | luật `telemetry_tag` bật, chặn, không có mẫu | `confirm` → `dispatch`: `INTERLOCK_BLOCKED (thieu_du_lieu)` | `command_log` |
| 7 đọc lại lệch | stub `giaTri` ghi đè | `acked_unverified`, `scada:cmd` mang `readBackValue` | `command_log` (ý định + kết quả) |
| 8 chưa có 2FA gửi mức 4 | người `engineer` chưa đăng ký 2FA, kênh mức 4 | `request`: `TOTP_CHUA_DANG_KY` (và `confirm` trên yêu cầu tạo trước khi bỏ đăng ký: cùng mã), `dispatch` 0 lần | attempts |

- [ ] **Step 1: Viết** `r1aNghiemThu.db.test.ts`. Dùng stub, `OT_CONTROL_ENABLED=true` **trong tiến trình**, safety theo mẫu `safetySimOnly.dot1c.db.test.ts`: một dòng `safety_plc_configs` backend `modbus` trỏ PLC giả trong tiến trình (`modbus-serial` `ServerTCP`), tức safety adapter mô phỏng như D9. Mỗi ô một `it`. Mỗi ô kiểm đúng mã **và** đếm đúng số dòng WORM tăng thêm.
- [ ] **Step 2: Chạy** `SCADA_R1A_NGHIEM_THU=1 npx vitest run -c vitest.db.config.ts server/services/scada/r1aNghiemThu.db.test.ts`. Mong đợi: xanh vì mọi task đã xong. Đỏ ⇒ quay về task sở hữu, không nới.
- [ ] **Step 3: Đột biến cấp hệ thống:**
  - tắt cổng dải trong `dispatch` ⇒ ô 2 phần `dispatch` đỏ;
  - bỏ `docLai:"bat_buoc"` ở `confirm` ⇒ ô 7 đỏ khi `OT_READBACK_ENABLED` tắt.
  - Ghi kết quả.
- [ ] **Step 4: Viết** `scripts/scada-r1a-bench.ts`, chạy tay, không vào CI.
  - Container `avi-openplc-bench`, Modbus `127.0.0.1:15502`; địa chỉ 1-based `holding:1..18` theo R0.
  - PLC safety giả trong tiến trình (mẫu `scripts/safety-plc-bench.ts:30`).
  - `startOt` qua seam `setAdapterSource` như `scripts/scada-r0-bench.ts`.
  - Gọi `scada.commands.request/confirm` qua tRPC caller, có admin `taoNguoiDungTest` trên `_test`.
  - Đo đường vui `acked_verified` (đọc lại đúng), ô 2, ô 3.
  - In bảng. Ghi phiên bản container. Trả container về trạng thái tìm thấy.
  - **Xác nhận trước trên bench rằng thanh ghi holding ghi được và đọc lại giữ giá trị** (runtime OpenPLC có ghi đè mỗi chu kỳ không). Nếu bị ghi đè, ghi rõ và dùng thanh ghi khác.
- [ ] **Step 5: Chạy bench.** Dán bảng vào báo cáo nghiệm thu. Không có Docker ⇒ ghi "chưa chạy bench" kèm lý do, **không** khai đạt.
- [ ] **Step 6: Chạy toàn bộ** `npx vitest run server/services/ot server/services/scada server/services/interlock server/routers/scada* server/_core client/src/components/scada client/src/pages/Scada*` + các tệp DB mới (riêng lẻ) + `npm run check`. Ghi số tệp/test.
- [ ] **Step 7: Commit** `test(scada): nghiem thu R1a - ma tran 8 o, bench OpenPLC + safety PLC mo phong, bao cao`.

---

## Bàn giao sau R1a (không làm trong kế hoạch này)

- Xong R1a ⇒ báo phiên điều phối để gộp. **Không push.**
- Migration 0431 lên **DEV**: gửi SQL + số đếm (`device_tags` số hàng; xác nhận 3 bảng mới chưa tồn tại) và chờ duyệt.
- Bật `SCADA_COMMANDS_ENABLED` ở dev thuộc phiên điều phối. `OT_CONTROL_ENABLED` / `AI_OT_CONTROL_ENABLED` giữ OFF (D9).
- Kế hoạch R1b viết ngay sau khi R1a được duyệt. R1c chờ Q1.
