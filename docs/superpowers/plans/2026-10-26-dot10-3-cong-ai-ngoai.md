# Đợt 10.3 — Cổng AI bên ngoài (B1–B4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một cổng duy nhất gọi Anthropic / OpenAI / Gemini / endpoint tương thích OpenAI, mặc định TẮT, bật theo nhà máy; mọi dữ liệu ra đi qua MỘT bộ che mới, trần chi phí đặt-trước nguyên tử, sổ WORM ý định + kết quả; Luồng không còn đường vòng HTTP/MCP tới host nhà cung cấp AI.

**Architecture:** Module `server/services/ai/ngoai/` — `cheDuLieu.ts` (bộ che), `phanLoai.ts` (mức dữ liệu + taint), `tranChiPhi.ts` (đặt-trước/kết toán trong DB), `soNgoai.ts` (sổ WORM), `khoaNgoai.ts` (khoá theo nhà máy), `cauHinhNgoai.ts` (bật/trần theo nhà máy), `mangNgoai.ts` (chính sách URL + fetch ghim IP, dùng lại `flow/nut/mangAnToan.ts`), `nhaCungCap/{anthropic,openai,gemini,openaiTuongThich,gia}.ts`, `congNgoai.ts` (bộ điều phối — điểm vào DUY NHẤT), `hostAiNgoai.ts` (danh sách chặn B4). Thứ tự lô theo kiem-dinh, dieu-phoi duyệt: (1) bộ che → (2) cổng + sổ + trần với nhà cung cấp GIẢ → (3) khoá / phạm vi → (4) nhà cung cấp thật → (5) B4.

**Tech Stack:** TypeScript, drizzle + SQL migration thủ công, tRPC, vitest, `node:http` máy chủ giả trong tiến trình, `fetch` (không thêm SDK).

**Spec:** `docs/superpowers/specs/2026-10-26-ai-local-chon-model-va-kiem-dinh-ngoai-design.md` §5 (B1–B4) + yêu cầu BẮT BUỘC của kiem-dinh (tin dieu-phoi 2026-10-26, mục A–F). Kế hoạch 10.1 (`2026-10-26-dot10-1-chon-model.md`) cung cấp `giaiChonModel` / `NguonModelNgoai` / `MucModel`.

## Global Constraints

- `AI_NGOAI_ENABLED` (env, đọc LÚC GỌI, chỉ `"true"` mới bật) **VÀ** `ai_ngoai_nha_may.batNgoai=true` của nhà máy CHỦ LUỒNG / người gọi — thiếu một ⇒ từ chối. Mặc định cả hai TẮT.
- KHÔNG gọi API thật của nhà cung cấp nào trong test (máy chủ giả trong tiến trình qua `datFetchNgoaiChoTest`); không có khoá thật trong repo / `.env` / test (khoá giả đúng định dạng, sinh trong test).
- AI ngoài không bao giờ gửi lệnh tới thiết bị; với `ai.agent` dùng model ngoài, tập tool CHỈ gồm luồng con hạng `thuan`/`doc` + `traTaiLieu`; mọi hạng `ngoai-ghi`/`ot` bị loại.
- `auto` KHÔNG BAO GIỜ chọn model ngoài. Lô này KHÔNG cài rơi dự phòng (lỗi ngoài ⇒ báo lỗi rõ); nếu sau này cài thì CHỈ chiều ngoài → Local, không bao giờ Local → ngoài.
- Luồng toàn cục (`factoryId IS NULL`) ⇒ từ chối model ngoài. `ngoai:<ncc>:<model>` của nhà máy tắt / ngoài phạm vi ⇒ NOT_FOUND.
- Ảnh / tệp đính kèm ⇒ cấm với model ngoài (`NGOAI_CAM_DINH_KEM`).
- Che ở MỘT điểm, SAU khi lắp xong toàn bộ yêu cầu; che cả lời lỗi của nhà cung cấp trước khi trả client / ghi lịch sử / sổ.
- Khoá chỉ giải mã BÊN TRONG nhà cung cấp (thunk `layKhoa()` gọi ngay trước `fetch`); không trả về client (chỉ 4 ký tự cuối), không vào log / sổ / lịch sử / gói xuất.
- URL: host công cộng bắt buộc `https`; đích nội bộ chỉ khi khai rõ `host:cổng` (`ai_ngoai_host_noi_bo`); metadata / link-local LUÔN cấm; cấm userinfo, scheme lạ, chuyển hướng; ghim IP; chuẩn hoá hostname (chữ thường, bỏ dấu chấm cuối, punycode `domainToASCII`, từ chối `@`); bỏ qua `HTTP(S)_PROXY`; trần 4 MB thân phản hồi, 120 s.
- Trần chi phí: đặt-trước nguyên tử (`UPDATE … WHERE … RETURNING`), theo nhà máy / ngày (UTC+7) / người / luồng / lượt + số lần / phút; retry vẫn tính; model không có bảng giá ⇒ bắt buộc trần token + số lần; DB đếm hỏng ⇒ từ chối.
- Sổ: hàng Ý ĐỊNH ghi TRƯỚC (ghi lỗi ⇒ không gọi) + hàng KẾT QUẢ sau; nguyên văn (nếu nhà máy bật) chỉ bản ĐÃ che, ở bảng riêng có hạn giữ.
- Migration CHỈ trong dải **0413–0416**; SQL gửi dieu-phoi trước khi áp DEV; áp bằng `scripts/apply-migration-NNNN.mjs` (`runMigration`), owner `aoi`.
- Mọi `throw` mới: `appError` hoặc lớp lỗi có mã (rawErrorCensus 462 không tăng). Thủ tục mới: `congGiayPhepAiCensus`, `phamViDocCensus`, `phamViGhiCensus` (ghi số mới + lý do + ngày).
- B4 là RÀO CHỐNG NHẦM, không chống người có quyền sửa luồng (ghi nguyên văn câu này vào đầu `hostAiNgoai.ts` và README vận hành).

## Review Focus

1. Khoá API nằm trong JSON lồng sâu / mảng / tên khoá viết hoa-thường lẫn lộn (`"Api_Key"`, `"x-api-key"`, `"Authorization": "Bearer …"`) trong kết quả tool ⇒ bị che (Task 1 vector `long-sau`).
2. Nhà cung cấp trả lỗi 400 nhắc lại nguyên văn prompt (có bí mật lọt qua che vì nằm trong `error.message`) ⇒ lỗi trả client đã che lại (Task 6 ca `loi-nhac-lai`).
3. Hai lượt đồng thời cùng nhà máy sát trần ⇒ chỉ một lượt giữ chỗ thành công (Task 4 ca `dong-thoi`).
4. Đổi giờ hệ thống quanh nửa đêm UTC+7 (23:59:59 → 00:00:00 +07) ⇒ bộ đếm sang ngày mới đúng múi (Task 4 ca `nua-dem`).
5. Luồng nhập từ gói xuất (gói mang `chonModel:"ngoai:…"`) sang nhà máy tắt ngoài ⇒ bật luồng / chạy đỏ-đóng, không âm thầm đổi sang Local (Task 8 ca `nhap-goi`).

---

## Phần 1 — Bộ che mới

### Task 1: `cheDuLieu.ts` — chuẩn hoá + che theo cấu trúc + vector

**Files:**
- Create: `server/services/ai/ngoai/cheDuLieu.ts`, `server/services/ai/ngoai/vectorChe.ts` (vector dùng chung cho lưới + kiem-dinh), `server/services/ai/ngoai/cheDuLieu.test.ts`

**Interfaces:**
- Produces:
  - `chuanHoaDeKhop(s: string): string` — NFKC; bỏ U+200B–U+200D, U+2060, U+FEFF, U+00AD, U+180E, U+202A–U+202E, U+2066–U+2069.
  - `interface TuDienNhay { tenNguoiDung: ReadonlySet<string>; tenKhach: ReadonlySet<string>; tenNhaMay: ReadonlySet<string> }`; `layTuDienNhay(db): Promise<TuDienNhay>` (users.username/name, customers.name, factories.name; đệm 5 phút).
  - `interface KetQuaChe<T> { giaTri: T; soTruongDaChe: number; theoLoai: Record<string, number> }`
  - `cheChuoi(s: string, tu: TuDienNhay): KetQuaChe<string>`
  - `cheGiaTri(v: unknown, tu: TuDienNhay): KetQuaChe<unknown>` — duyệt đệ quy object/mảng; chuỗi trông như JSON (`/^\s*[\[{]/`) ⇒ `JSON.parse` thử rồi duyệt và `stringify` lại; khoá khớp `TEN_KHOA_NHAY` ⇒ thay CẢ giá trị bằng `"[REDACTED_SECRET]"`; mọi chuỗi lá ⇒ `cheChuoi`.
  - `TEN_KHOA_NHAY: RegExp` khớp trên tên khoá đã `chuanHoaDeKhop` + bỏ `-_ .` + chữ thường: `password|passwd|pwd|pass|secret|token|apikey|xapikey|authorization|auth|cookie|session|privatekey|accesskey|clientsecret|connectionstring|connstr|dsn|credential|signature|bearer`.
  - Mẫu giá trị (thêm vào mẫu của `aiSafety.REDACT_PATTERNS`): khoá Anthropic `sk-ant-(api|admin)\d{2}-[A-Za-z0-9_-]{20,}`, OpenAI `sk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}`, Gemini/Google `AIza[0-9A-Za-z_-]{35}`, `Bearer\s+\S{16,}`, IPv4 nội bộ (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10) → `[REDACTED_IP]`, IPv6 ULA `fc00::/7` & link-local `fe80::/10` → `[REDACTED_IP]`, MAC `([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}` → `[REDACTED_MAC]`, nhãn `(user|username|login|uid)\s*[=:]\s*\S+` → giữ nhãn, che giá trị `[REDACTED_USER]`, email, số điện thoại (dùng lại `aiSafety`), từ trong `TuDienNhay` (khớp nguyên từ, không phân biệt hoa-thường) → `[REDACTED_NAME]`.
  - Chống chữ tách: trước khi khớp nhãn, tạo bản "gom" bỏ khoảng trắng/dấu chấm giữa các ký tự đơn (`p a s s w o r d` → `password`); nếu bản gom khớp nhãn + giá trị ⇒ che đoạn gốc tương ứng.

- [ ] **Step 1: Viết `vectorChe.ts`** — mảng `{ ten, dauVao, phaiKhongCon: string[], phaiConLai?: string[] }` gồm tối thiểu: `json-nhay` (`{"password":"P@ss","apiKey":"k"}`), `long-sau` (`{"a":[{"b":{"Api_Key":"x"}}],"headers":{"x-api-key":"y","Authorization":"Bearer abcdefghijklmnop1234"}}`), khoá giả 4 nhà cung cấp (sinh: `"sk-ant-api03-"+"A".repeat(95)`, `"sk-proj-"+"B".repeat(48)`, `"AIza"+"C".repeat(35)`, `"sk-"+"D".repeat(48)` cho tương thích), `ip-noi-bo` (`10.1.2.3`, `192.168.0.10`, `fe80::1`), `mac`, `user-nhan` (`user=engineer1`), `rong-0` (`pa​ssword=abc123`), `chu-tach` (`p a s s w o r d: hunter2`), `ten-khach` (từ điển có `ACME Co` ⇒ `"lỗi đơn ACME Co"`), `ip-cong-khai-giu-nguyen` (`8.8.8.8` CÒN LẠI), `ma-nguon-giu-nguyen` (`const x = 1;` CÒN LẠI).
- [ ] **Step 2: Test** `cheDuLieu.test.ts`: mỗi vector qua `cheGiaTri` ⇒ không chuỗi `phaiKhongCon` nào còn trong `JSON.stringify(kq.giaTri)`, mọi `phaiConLai` còn; `soTruongDaChe` > 0 với vector nhạy, = 0 với vector giữ nguyên. Ca đột biến: thay `cheChuoi` bằng hàm trả nguyên văn (`vi.spyOn`) ⇒ ít nhất 10 vector đỏ (tự kiểm trong test: đếm vector thất bại khi bỏ che ≥ 10).
- [ ] **Step 3: Chạy** `npx vitest run server/services/ai/ngoai/cheDuLieu.test.ts` — FAIL.
- [ ] **Step 4: Cài** `cheDuLieu.ts`.
- [ ] **Step 5: Chạy** — PASS. Commit `feat(ai-ngoai): bo che moi - chuan hoa NFKC/rong-0, che theo ten khoa JSON + gia tri, khoa 4 nha cung cap, IP noi bo, MAC, user=, tu dien ten`.

## Phần 2 — Cổng + sổ + trần với nhà cung cấp GIẢ

### Task 2: Migration 0413–0416

**Files:**
- Create: `drizzle/0413_ai_ngoai_enum.sql`, `drizzle/0414_ai_ngoai_khoa_cau_hinh.sql`, `drizzle/0415_ai_ngoai_so_tran.sql`, `drizzle/0416_ai_ngoai_duyet_luong.sql`, `scripts/apply-migration-0413.mjs` … `-0416.mjs`
- Modify: `drizzle/schema/enums.ts:165` (thêm giá trị), `drizzle/schema/ai.ts:1434` (`aiApiKeys.factoryId`), `drizzle/schema/aiNgoai.ts` (mới, export từ `drizzle/schema/index`), `drizzle/schema/aiFlow.ts` (cột 0416)

**Nội dung (quyết định):**
- 0413 (KHÔNG giao dịch — `ALTER TYPE … ADD VALUE` không chạy chung giao dịch): `apikeyprovider` thêm `anthropic`, `gemini`, `openai_compat` (`IF NOT EXISTS`).
- 0414: `ai_api_keys.factoryId integer REFERENCES factories(id) ON DELETE RESTRICT`; `UPDATE ai_api_keys SET status='inactive' WHERE "factoryId" IS NULL` (hàng cũ / base64 legacy phải nhập lại); `CHECK ("factoryId" IS NOT NULL OR status <> 'active')` — tương đương NOT NULL cho mọi khoá dùng được mà không xoá dữ liệu cũ (DEV hiện 0 hàng). Bảng `ai_ngoai_nha_may(factoryId PK→factories, batNgoai bool false, choDuLieuVanHanh bool false, luuNguyenVan bool false, hanGiuNgay int 30 CHECK 1..365, tranTokenNgay bigint, tranTienNgayUsd numeric(12,4), tranTokenNguoiNgay bigint, tranTokenLuongNgay bigint, tranTokenLuot bigint, tranLanPhut int NOT NULL DEFAULT 20, capNhatBoi int, capNhatLuc timestamptz)`; `ai_ngoai_model(id serial, factoryId NOT NULL, nhaCungCap varchar(16), model varchar(96), nhan varchar(120), keyId int NOT NULL → ai_api_keys, giaVaoUsdTrieu numeric, giaRaUsdTrieu numeric, tranTokenLuot bigint, batModel bool false, UNIQUE(factoryId,nhaCungCap,model), CHECK ((giaVaoUsdTrieu IS NOT NULL AND giaRaUsdTrieu IS NOT NULL) OR tranTokenLuot IS NOT NULL))`; `ai_ngoai_host_noi_bo(factoryId, hostCong varchar(255), PRIMARY KEY(factoryId,hostCong))`.
- 0415: `ai_external_calls` (WORM — trigger `ai_external_calls_worm()` BEFORE UPDATE OR DELETE + BEFORE TRUNCATE, `REVOKE ALL … FROM avi_app; GRANT SELECT, INSERT`, theo khuôn `0431_scada_kenh_lenh.sql:90-115`): `id bigserial, factoryId int NOT NULL, loai varchar(8) CHECK in ('y-dinh','ket-qua'), yDinhId bigint, userId int, flowId varchar(64), runId varchar(64), tuDong bool NOT NULL, nhaCungCap varchar(16), model varchar(96), mucDich varchar(32), mucDuLieu varchar(12), soTruongDaChe int, bamNoiDung char(64), tokenVao int, tokenRa int, chiPhiUocUsd numeric(12,6), ketCuc varchar(12), maLoi varchar(48), taoLuc timestamptz DEFAULT now()`; `ai_external_call_noi_dung(callId bigint PK, factoryId int NOT NULL, noiDungDaChe text, hetHanLuc timestamptz NOT NULL)` (KHÔNG WORM — job xoá khi hết hạn); `ai_ngoai_dem(factoryId int, ngay date, khoa varchar(80), tokenGiu bigint DEFAULT 0, tienGiuUsd numeric(14,6) DEFAULT 0, PRIMARY KEY(factoryId,ngay,khoa))`; `ai_ngoai_dem_phut(factoryId int, phut timestamptz, so int DEFAULT 0, PRIMARY KEY(factoryId,phut))`.
- 0416: `ai_flow_versions` thêm `chuKyNgoai varchar(64)` (băm tập `{nhaCungCap,model}` của node dùng model ngoài) + `chuKyNgoaiDuyetBoi int`, `chuKyNgoaiDuyetLuc timestamptz`.

- [ ] **Step 1:** Viết 4 tệp SQL + 4 script apply (verify: enum có 3 giá trị; CHECK chặn `INSERT active` không factoryId; trigger WORM: owner `UPDATE/DELETE/TRUNCATE ai_external_calls` ⇒ lỗi 23514; `avi_app` INSERT được, UPDATE bị từ chối quyền).
- [ ] **Step 2:** Gửi SQL cho dieu-phoi; CHỜ duyệt rồi mới chạy `node scripts/apply-migration-0413.mjs --dev-only` … `-0416 --dev-only` và `--test-only`.
- [ ] **Step 3:** Cập nhật schema drizzle; `npx vitest run drizzle server/db` xanh.
- [ ] **Step 4: Commit** `feat(ai-ngoai): migration 0413-0416 (enum nha cung cap, khoa theo nha may, cau hinh, so WORM, bo dem tran, chu ky duyet luong)`.

### Task 3: Phân loại dữ liệu + taint (`phanLoai.ts`)

**Files:**
- Create: `server/services/ai/ngoai/phanLoai.ts`, `server/services/ai/ngoai/phanLoai.test.ts`, `server/services/ai/ngoai/phanLoaiNut.census.test.ts`
- Modify: `server/services/flow/dongCo.ts` (ghi `mucDuLieuLuot` vào ngữ cảnh lượt sau mỗi node), `server/services/flow/dangKyNut.ts` (`NguCanhChay.mucDuLieu(): MucDuLieu`)

**Interfaces:**
- Produces: `type MucDuLieu = "ky-thuat" | "van-hanh"`; `PHAN_LOAI_NGUON_NUT: Readonly<Record<string, MucDuLieu | "ke-thua">>` (MỌI node đăng ký phải có mục — census); `capNhatMucLuot(hienTai: MucDuLieu, loaiNut: string): MucDuLieu` (`van-hanh` thắng; node không có trong bảng ⇒ `van-hanh`); `mucChoBeMat(beMat: "chat" | "coding" | "agent-turn", coKetQuaToolVanHanh: boolean): MucDuLieu`.
- Quyết định (kiem-dinh B "taint theo item"): taint tính theo LƯỢT, đơn điệu — mọi node đã chạy trong lượt góp mức của nó; `Set`/`Code`/biểu thức `{{ }}` = `ke-thua` (không hạ mức). Chặt hơn theo-item (một nhánh vận hành làm cả lượt vận hành) — chọn vì `{{ }}` tham chiếu được mọi bước trước; ghi rõ trong đầu tệp. Bảng: `ky-thuat` = `kich-hoat.tay`, `kich-hoat.lich`, `ai.*` (kế thừa đầu vào ⇒ `ke-thua`); `van-hanh` = `du-lieu.so-lieu`, `ot.*`, `bao-tri.*`, `chon.*` (truy vấn DB), `ai.tra-tri-thuc`, `tich-hop.http-doc`, `tich-hop.mcp`, `kich-hoat.webhook`; mọi thứ khác ⇒ liệt kê tường minh trong bảng.

- [ ] **Step 1: Test** `phanLoai.test.ts`: chuỗi `[kich-hoat.tay, xu-ly.set, ai.tom-tat]` ⇒ `ky-thuat`; `[kich-hoat.tay, du-lieu.so-lieu, xu-ly.ma, ai.tom-tat]` ⇒ `van-hanh`; node lạ `x.y` ⇒ `van-hanh`; agent-turn có kết quả tool từ luồng con `van-hanh` ⇒ `van-hanh`. `phanLoaiNut.census.test.ts`: mọi `type` trong registry (`server/services/flow/nut/index.ts` sau khi nạp) có mục trong `PHAN_LOAI_NGUON_NUT`.
- [ ] **Step 2: Chạy** — FAIL. **Step 3: Cài.** **Step 4: Chạy** + `npx vitest run server/services/flow` — PASS.
- [ ] **Step 5: Commit** `feat(ai-ngoai): phan loai muc du lieu theo luot (van-hanh thang, nut la => van-hanh) + census nut`.

### Task 4: Trần chi phí đặt-trước nguyên tử (`tranChiPhi.ts`)

**Files:** Create `server/services/ai/ngoai/tranChiPhi.ts`, `server/services/ai/ngoai/tranChiPhi.db.test.ts`

**Interfaces:**
- Produces:
  - `ngayUtc7(d: Date): string` (YYYY-MM-DD theo +07:00).
  - `interface YeuCauGiuCho { factoryId: number; userId: number | null; flowId: string | null; runId: string | null; tokenUoc: number; tienUocUsd: number | null }`
  - `interface PhieuGiu { id: string; khoa: string[]; tokenUoc: number; tienUocUsd: number }`
  - `datTruoc(db, yc: YeuCauGiuCho, tran: TranNhaMay): Promise<PhieuGiu>` — MỘT giao dịch: `INSERT … ON CONFLICT DO UPDATE SET tokenGiu = ai_ngoai_dem.tokenGiu + $n WHERE ai_ngoai_dem.tokenGiu + $n <= $tran RETURNING` cho từng khoá `nha-may`, `nguoi:<id>`, `luong:<id>`, `luot:<runId>` có trần; cộng `ai_ngoai_dem_phut` phút hiện tại (≤ `tranLanPhut`); bất kỳ khoá không trả hàng ⇒ ROLLBACK + ném `LoiNgoai("NGOAI_VUOT_TRAN", khoa)`; lỗi DB ⇒ ném `LoiNgoai("NGOAI_DEM_HONG")`.
  - `ketToan(db, phieu: PhieuGiu, thuc: { tokenVao: number; tokenRa: number; tienUsd: number | null }): Promise<void>` — cộng chênh (có thể âm) vào cùng khoá.
  - `class LoiNgoai extends Error { constructor(readonly ma: MaLoiNgoai, readonly chiTiet?: string) }` (đặt ở `server/services/ai/ngoai/loi.ts`; `MaLoiNgoai` hợp các mã của kế hoạch này).
- Model không giá (`giaVaoUsdTrieu IS NULL`) ⇒ `tienUocUsd=null`, bắt buộc `tranTokenLuot` (CHECK 0414) và trần số lần.

- [ ] **Step 1: Test** (DB `_test`): trần nhà máy 1000 token, giữ 600 ⇒ ok, giữ thêm 600 ⇒ `NGOAI_VUOT_TRAN` và tổng vẫn 600 (rollback mọi khoá); `dong-thoi`: 2 `datTruoc` 600 đồng thời trên trần 1000 ⇒ đúng 1 thành công; `nua-dem`: `ngayUtc7(new Date("2026-10-26T16:59:59Z"))==="2026-10-26"`, `…T17:00:00Z` ⇒ `"2026-10-27"`; `lan-phut`: `tranLanPhut=2` ⇒ lần 3 trong cùng phút bị từ chối; `ketToan` hoàn trả chênh âm; DB giả ném ⇒ `NGOAI_DEM_HONG`.
- [ ] **Step 2–4:** FAIL → cài → PASS. **Step 5: Commit** `feat(ai-ngoai): tran chi phi dat-truoc nguyen tu theo nha may/ngay UTC+7/nguoi/luong/luot + so lan/phut`.

### Task 5: Sổ WORM (`soNgoai.ts`)

**Files:** Create `server/services/ai/ngoai/soNgoai.ts`, `server/services/ai/ngoai/soNgoai.db.test.ts`; Modify `server/_core/backgroundJobs.ts` (job xoá `ai_external_call_noi_dung` hết hạn, mỗi giờ)

**Interfaces:**
- Produces: `ghiYDinh(db, h: HangYDinh): Promise<number /*id*/>`; `ghiKetQua(db, yDinhId: number, h: HangKetQua): Promise<void>`; `luuNoiDungNeuBat(db, callId, noiDungDaChe: string, cauHinh: { luuNguyenVan: boolean; hanGiuNgay: number }): Promise<void>`; `bamNoiDung(s: string): string` (sha256 hex của bản ĐÃ che).
- `HangYDinh = { factoryId: number; userId: number | null; flowId: string | null; runId: string | null; tuDong: boolean; nhaCungCap: string; model: string; mucDich: string; mucDuLieu: MucDuLieu; soTruongDaChe: number; bamNoiDung: string }`; `HangKetQua = { tokenVao: number; tokenRa: number; chiPhiUocUsd: number | null; ketCuc: "ok" | "loi" | "tu-choi"; maLoi?: string }`.

- [ ] **Step 1: Test:** `ghiYDinh` trả id; hàng có `factoryId`, `bamNoiDung` 64 hex; `luuNguyenVan=false` ⇒ không hàng nội dung; `true` ⇒ hàng với `hetHanLuc = taoLuc + hanGiuNgay`; job xoá chỉ xoá hàng hết hạn; UPDATE `ai_external_calls` bằng `avi_app` ⇒ lỗi quyền.
- [ ] **Step 2–4:** FAIL → cài → PASS. **Step 5: Commit** `feat(ai-ngoai): so WORM y-dinh + ket-qua, noi dung da che co han giu`.

### Task 6: `congNgoai.ts` — bộ điều phối với nhà cung cấp GIẢ

**Files:**
- Create: `server/services/ai/ngoai/congNgoai.ts`, `server/services/ai/ngoai/nhaCungCap/kieu.ts`, `server/services/ai/ngoai/nhaCungCap/gia.ts` (nhà cung cấp giả cho test), `server/services/ai/ngoai/congNgoai.test.ts`
- Modify: `server/services/flow/nut/agent.ts` (khi `chonModel` là ngoài: lọc tool — chỉ luồng con hạng `thuan`/`doc` + `traTaiLieu`; kết quả ngoài bọc `wrapUntrustedBlock` trước khi vào bước sau), `server/services/ai/chonModel/giaiChonModel.ts` (10.1: `loai:"ngoai"` ⇒ trả đích cho người gọi gọi `goiAiNgoai`; `auto` không bao giờ ra ngoài)

**Interfaces:**
- Produces (`nhaCungCap/kieu.ts`):
  - `interface TinNhanNgoai { vaiTro: "system" | "user" | "assistant" | "tool"; noiDung: string; tenTool?: string }`
  - `interface YeuCauNhaCungCap { model: string; tinNhan: TinNhanNgoai[]; congCu?: Array<{ ten: string; moTa: string; schema: unknown }>; maxTokens: number; nhietDo: number }`
  - `interface KetQuaNhaCungCap { noiDung: string; toolCalls: Array<{ ten: string; thamSo: unknown }>; tokenVao: number; tokenRa: number }`
  - `interface NhaCungCapAi { ma: "anthropic" | "openai" | "gemini" | "openai-compat"; goi(yc: YeuCauNhaCungCap, layKhoa: () => Promise<string>, mang: MangNgoai): Promise<KetQuaNhaCungCap> }`
- Produces (`congNgoai.ts`):
  - `interface YeuCauGoiNgoai { dich: { nhaCungCap: string; model: string }; tinNhan: TinNhanNgoai[]; dinhKem?: unknown[]; congCu?: YeuCauNhaCungCap["congCu"]; maxTokens: number; mucDich: string; ngu: { factoryId: number | null; userId: number | null; flowId: string | null; runId: string | null; tuDong: boolean; mucDuLieu: MucDuLieu } }`
  - `goiAiNgoai(yc: YeuCauGoiNgoai, dep?: PhuThuocCong): Promise<{ noiDung: string; toolCalls: KetQuaNhaCungCap["toolCalls"]; khongTinCay: true; tokenVao: number; tokenRa: number }>`
  - Thứ tự CỐ ĐỊNH (lưới canh thứ tự bằng nhật ký phụ thuộc giả): (1) `AI_NGOAI_ENABLED==="true"` lúc gọi; (2) `factoryId` khác null + `batNgoai` + model `batModel` của nhà máy ⇒ thiếu ⇒ `NGOAI_KHONG_TON_TAI` (map NOT_FOUND); (3) `dinhKem?.length` ⇒ `NGOAI_CAM_DINH_KEM`; (4) `mucDuLieu==="van-hanh" && !choDuLieuVanHanh` ⇒ `NGOAI_DU_LIEU_VAN_HANH`; (5) lắp toàn bộ yêu cầu (system, lịch sử, kết quả tool, schema tool, tên tệp) thành `YeuCauNhaCungCap`; (6) `cheGiaTri(yeuCauDaLap)` — ĐIỂM CHE DUY NHẤT; (7) `datTruoc`; (8) `ghiYDinh` (lỗi ⇒ hoàn chỗ + ném, KHÔNG gọi); (9) `nhaCungCap.goi` (mỗi lần thử lại ⇒ `datTruoc` lại); (10) `ketToan`; (11) `ghiKetQua`; lỗi nhà cung cấp ⇒ `cheChuoi(loi.message)` rồi mới ném/ghi.

- [ ] **Step 1: Test** `congNgoai.test.ts` với `nhaCungCap/gia.ts` (ghi lại yêu cầu nhận được) + DB `_test`:
  - cờ env tắt ⇒ `NGOAI_TAT`, nhà cung cấp KHÔNG được gọi, không hàng sổ;
  - nhà máy tắt / `factoryId null` ⇒ `NGOAI_KHONG_TON_TAI`;
  - `dinhKem:[{}]` ⇒ `NGOAI_CAM_DINH_KEM`;
  - `mucDuLieu:"van-hanh"` + `choDuLieuVanHanh=false` ⇒ `NGOAI_DU_LIEU_VAN_HANH`;
  - mọi vector `vectorChe.ts` đặt lần lượt vào system / lịch sử / kết quả tool / schema tool / tên tệp ⇒ yêu cầu MÀ NHÀ CUNG CẤP GIẢ NHẬN không chứa chuỗi `phaiKhongCon` nào; đột biến bỏ bước (6) ⇒ ca này đỏ;
  - `loi-nhac-lai`: nhà cung cấp giả ném lỗi chứa `"sk-ant-api03-…"` ⇒ lỗi ném ra + hàng sổ `maLoi` không chứa khoá;
  - sổ không ghi được (db giả ném ở `ghiYDinh`) ⇒ nhà cung cấp KHÔNG được gọi và chỗ đã giữ được hoàn;
  - thử lại 2 lần ⇒ `ai_ngoai_dem` tăng 2 lần ước tính;
  - kết quả có `khongTinCay:true`; `auto` qua `giaiChonModel` không bao giờ ra `loai:"ngoai"` (ca bảng 50 câu hỏi ngẫu nhiên);
  - agent: `chonModel` ngoài + tool hạng `ngoai-ghi`/`ot` ⇒ không có trong `congCu` gửi đi; hạng `doc` + `traTaiLieu` có; phân loại THEO TỪNG LƯỢT: lượt 2 có kết quả tool từ luồng con `van-hanh` + `choDuLieuVanHanh=false` ⇒ lượt 2 dừng `NGOAI_DU_LIEU_VAN_HANH` (lượt 1 đã gửi vẫn hợp lệ);
- [ ] **Step 2–4:** FAIL → cài → PASS. **Step 5: Commit** `feat(ai-ngoai): cong AI ngoai (mot diem che sau khi lap, cam dinh kem, du lieu van hanh, so truoc goi, tran nguyen tu, che loi nha cung cap) + agent loc tool`.

## Phần 3 — Khoá và phạm vi

### Task 7: Khoá theo nhà máy (`khoaNgoai.ts`) + thủ tục admin

**Files:**
- Create: `server/services/ai/ngoai/khoaNgoai.ts`, `server/routers/aiNgoaiRouter.ts` (mount `aiNgoai`), `server/services/ai/ngoai/khoaNgoai.test.ts`, `server/services/ai/ngoai/khoaKhongLo.test.ts`
- Modify: `server/routers/aiSettingsRouter.ts` (`createApiKey` bắt buộc `factoryId`; provider mới), `server/routers.ts`, các census GHIM

**Interfaces:**
- Produces: `layKhoaChoNhaCungCap(db, keyId: number, factoryId: number): () => Promise<string>` — trả THUNK; giải mã (`decryptSecret`, `secretBox.ts:58`) chỉ khi thunk được gọi; khoá thuộc nhà máy khác / `status≠active` / legacy (không tiền tố `enc:v1:`) ⇒ `NGOAI_KHOA_KHONG_HOP_LE`.
- tRPC (`adminProcedure.use(moduleGate("MOD_AI"))`, phạm vi nhà máy qua `phamViCua(ctx)` + `nhaMayHopLe`): `aiNgoai.taoKhoa({ factoryId, nhaCungCap, ten, khoa })` ⇒ `{ id, cuoi4 }`; `aiNgoai.xoayKhoa({ id, khoa })`; `aiNgoai.thuHoiKhoa({ id })`; `aiNgoai.dsKhoa({ factoryId })` ⇒ `[{ id, ten, nhaCungCap, status, cuoi4 }]`. Ngoài phạm vi ⇒ NOT_FOUND.

- [ ] **Step 1: Test** `khoaNgoai.test.ts`: tạo ⇒ DB lưu `enc:v1:…`, trả `cuoi4`; thunk nhà máy khác ⇒ lỗi; thu hồi ⇒ thunk lỗi. `khoaKhongLo.test.ts`: khoá giả `"sk-ant-api03-"+"Z".repeat(95)` — chạy một lượt `goiAiNgoai` (nhà cung cấp giả nhận khoá qua thunk) rồi quét chuỗi khoá trong: mọi đầu ra tRPC `aiNgoai.*`/`aiSettings.*`, `ai_external_calls` + `ai_external_call_noi_dung`, sự kiện lịch sử chạy (`ai_flow_events`), gói xuất luồng (`flow.xuat`), log (spy `console.*` + logger) ⇒ 0 lần xuất hiện.
- [ ] **Step 2–4:** FAIL → cài → PASS; census GHIM cập nhật kèm lý do.
- [ ] **Step 5: Commit** `feat(ai-ngoai): khoa theo nha may - giai ma chi trong nha cung cap (thunk), admin tao/xoay/thu hoi, quet khong lo khoa`.

### Task 8: Cấu hình nhà máy + danh mục ngoài + phạm vi luồng + duyệt

**Files:**
- Create: `server/services/ai/ngoai/cauHinhNgoai.ts`, `server/services/ai/ngoai/cauHinhNgoai.test.ts`
- Modify: `server/routers/aiNgoaiRouter.ts` (`aiNgoai.cauHinh` đọc/ghi admin, `aiNgoai.dsModel`/`datModel`), `server/services/ai/chonModel/danhMuc.ts` (`NguonModelNgoai` thật = `cauHinhNgoai.layModelDaBat`), `server/routers/flowRouter.ts:361-375` (`datPhienBanHoatDong`: luồng có node dùng model ngoài ⇒ cần `chuKyNgoaiDuyetBoi ≠ người tạo phiên bản` hoặc admin có ghi; `chuKyNgoai` lệch phiên bản đã duyệt ⇒ cần duyệt lại), `server/routers/flowRouter.ts` thủ tục nhập gói

**Interfaces:**
- Produces: `layCauHinhNhaMay(db, factoryId): Promise<CauHinhNhaMay | null>`; `layModelDaBat(factoryId: number | null): Promise<Array<{ nhaCungCap; model; nhan }>>` (null / `AI_NGOAI_ENABLED≠"true"` / `batNgoai=false` ⇒ `[]`); `chuKyNgoaiCuaLuong(dinhNghia: DinhNghiaLuong): string | null` (sha256 tập `ncc:model` sắp xếp; không node ngoài ⇒ null); `aiNgoai.duyetNgoai({ flowId, phienBan })` (SoD: người duyệt ≠ người tạo phiên bản, trừ admin — ghi audit).

- [ ] **Step 1: Test:** `AI_NGOAI_ENABLED` tắt ⇒ danh mục 10.1 không có mục ngoài; bật + nhà máy A bật ⇒ có; người nhà máy B ⇒ không và `giaiChonModel("ngoai:…")` ⇒ NOT_FOUND; luồng toàn cục chạy node ngoài ⇒ `NGOAI_LUONG_TOAN_CUC`; bật luồng có node ngoài chưa duyệt ⇒ từ chối; duyệt bởi chính người tạo (không admin) ⇒ từ chối; đổi `model` trong phiên bản mới ⇒ `chuKyNgoai` đổi ⇒ phải duyệt lại; `nhap-goi`: nhập gói có `chonModel:"ngoai:…"` vào nhà máy tắt ⇒ bật luồng từ chối và chạy thử ⇒ NOT_FOUND (không đổi sang Local); cờ đọc LÚC GỌI: bật luồng khi cờ bật, tắt cờ, chạy ⇒ `NGOAI_TAT`.
- [ ] **Step 2–4:** FAIL → cài → PASS (+ `npx vitest run server/routers/flowRouter server/services/flow ensus`).
- [ ] **Step 5: Commit** `feat(ai-ngoai): cau hinh/bat theo nha may chu luong, danh muc ngoai, luong toan cuc tu choi, duyet SoD + chu ky model ngoai`.

## Phần 4 — Nhà cung cấp thật

### Task 9: `mangNgoai.ts` + 4 bản cài

**Files:**
- Create: `server/services/ai/ngoai/mangNgoai.ts`, `server/services/ai/ngoai/nhaCungCap/{anthropic,openai,gemini,openaiTuongThich}.ts`, tests `mangNgoai.test.ts`, `nhaCungCap/*.test.ts`
- Modify: `.env.example` (khối `AI_NGOAI_ENABLED=false` + chú thích: bật theo nhà máy ở màn quản trị, khoá KHÔNG qua .env)

**Interfaces:**
- Produces: `interface MangNgoai { goiJson(url: string, init: { method: "POST"; headers: Record<string, string>; body: string }): Promise<{ status: number; json: unknown }> }`; `taoMangNgoai(chinhSach: { hostNoiBo: ReadonlySet<string> }): MangNgoai` — `kiemUrlNgoai` (chuẩn hoá + luật Global Constraints) → `kiemDichDen` (`mangAnToan.ts:107`) → `fetchGhim` (:133, không theo chuyển hướng, không proxy) → `docThanCoTran(r, 4*1024*1024)` (:173), hạn 120 s; `datFetchNgoaiChoTest(f | null)`.
- Base URL cố định trong từng bản cài: Anthropic `https://api.anthropic.com/v1/messages` (header `x-api-key`, `anthropic-version: 2023-06-01`), OpenAI `https://api.openai.com/v1/chat/completions` (`Authorization: Bearer`), Gemini `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` (header `x-goog-api-key`, KHÔNG để khoá trong URL), tương thích: `endpoint` của khoá + `/chat/completions`. Model mặc định KHÔNG cứng trong mã (lấy từ `ai_ngoai_model`).

- [ ] **Step 1: Test** `mangNgoai.test.ts` (DNS giả `datPhanGiaiDns`): `http://api.openai.com` ⇒ từ chối (công cộng phải https); `https://user:p@x.com` ⇒ từ chối; `ftp://`, `file://` ⇒ từ chối; `https://169.254.169.254/` và `https://[fe80::1]/` ⇒ từ chối kể cả có khai; `https://API.OpenAI.COM./v1` chuẩn hoá thành `api.openai.com`; host phân giải ra `10.0.0.5` không khai ⇒ `DICH_NOI_BO`; khai `llm.local:8000` ⇒ cho `http://llm.local:8000`; phản hồi 302 ⇒ lỗi (không theo); `HTTPS_PROXY=http://127.0.0.1:9` đặt trong test ⇒ vẫn tới máy chủ giả (proxy bị bỏ qua); thân 5 MB ⇒ lỗi trần. `nhaCungCap/*.test.ts` (máy chủ giả `node:http` qua `datFetchNgoaiChoTest`): mỗi bản cài gửi đúng khuôn (header khoá đúng chỗ, model, messages/contents, max tokens), đọc `usage` → `tokenVao/tokenRa`, `tool_use`/`tool_calls`/`functionCall` → `toolCalls`, 4xx/5xx ⇒ `LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI")` với thông điệp đã qua `cheChuoi`.
- [ ] **Step 2–4:** FAIL → cài → PASS. **Step 5: Commit** `feat(ai-ngoai): mang ngoai (https bat buoc, cam metadata/userinfo/redirect/proxy, ghim IP, tran) + 4 nha cung cap (fetch, khong SDK)`.

## Phần 5 — B4 chặn đường vòng

### Task 10: `hostAiNgoai.ts` + áp lúc LƯU và lúc GỌI

**Files:**
- Create: `server/services/ai/ngoai/hostAiNgoai.ts`, `server/services/ai/ngoai/hostAiNgoai.test.ts`, `server/services/ai/ngoai/duongVong.census.test.ts`
- Modify: `server/services/flow/nut/tichHop.ts:89-119` (`goi`: sau `kiemDichDen` gọi `chanHostAiNgoai(url, dich)`), `server/services/flow/nut/mcpKhach.ts:131-143` (lúc nạp danh sách `AI_FLOW_MCP_CHO_PHEP` và lúc gọi), `server/services/flow/kiemLuong.ts` (lúc LƯU: URL tĩnh trong tham số node http/mcp ⇒ từ chối `DICH_LA_AI_NGOAI`), `docs/AI_FLOW_SECURITY_OPERATIONS.md` (đoạn "rào chống nhầm, không chống người có quyền sửa luồng")

**Interfaces:**
- Khảo sát 2026-10-26: điểm gọi ra ngoài của Luồng chỉ có `tich-hop.http-*` và `tich-hop.mcp`; `tich-hop.thong-bao` là thông báo NỘI BỘ, webhook là kích hoạt VÀO; tool của `ai.agent` là luồng con (đi qua chính các node trên) ⇒ census bên dưới canh nếu sau này thêm node email/webhook-ra.
- Produces: `DANH_SACH_HOST_AI_MAC_DINH: readonly string[]` = `anthropic.com`, `openai.com`, `generativelanguage.googleapis.com`, `aiplatform.googleapis.com`, `openai.azure.com`, `openrouter.ai`, `api.groq.com`, `api.mistral.ai`, `bedrock-runtime.*.amazonaws.com` (mẫu), `api.together.xyz`, `api.together.ai`, `api.deepseek.com`, `api.cohere.com`, `api.cohere.ai`, `api.x.ai`, `api.perplexity.ai`, `api.fireworks.ai` (khớp hậu tố theo nhãn); mở rộng bằng env `AI_NGOAI_HOST_CHAN_THEM` (phẩy) + mọi `endpoint` khoá `openai_compat` + `ai_ngoai_host_noi_bo`; `laHostAiNgoai(hostname: string): boolean` (sau chuẩn hoá); `chanHostAiNgoai(url: URL, dich?: DichDen): Promise<void>` — ném `LoiHttpLuong("…", "DICH_LA_AI_NGOAI")` nếu host khớp HOẶC `dich.ip` thuộc tập IP đã ghim của các host tương thích đã khai.

- [ ] **Step 1: Test** `hostAiNgoai.test.ts`: `https://api.anthropic.com/x`, `https://API.OPENAI.COM./v1`, `https://foo.openai.azure.com`, `https://bedrock-runtime.us-east-1.amazonaws.com`, `https://openrouter.ai/api` ⇒ chặn; `https://example.com` ⇒ qua; host tương thích khai `llm.nha-may.vn` + phân giải 203.0.113.7 ⇒ URL `https://khac.vn` phân giải 203.0.113.7 ⇒ chặn (so IP). Node `tich-hop.http-gui` URL `https://api.openai.com/v1/chat/completions` ⇒ LƯU luồng bị từ chối và CHẠY (URL từ biểu thức) bị từ chối `DICH_LA_AI_NGOAI`; MCP máy chủ khai `https://api.anthropic.com/mcp` ⇒ nạp từ chối. `duongVong.census.test.ts`: quét `server/services/flow/**` và `server/services/ai/agent/**` (trừ test) — mọi hàm chứa `kiemDichDen(` / `fetchGhim(` / `fetch(` phải gọi `chanHostAiNgoai(` trong cùng hàm hoặc nằm trong `MIEN_TRU` có lý do (đếm GHIM).
- [ ] **Step 2–4:** FAIL → cài → PASS. **Step 5: Commit** `feat(ai-ngoai): B4 chan duong vong - danh sach host AI (gom aggregator) + host tuong thich + so IP ghim, ap luc luu va luc goi, MCP luc nap va luc goi, census diem goi ra ngoai`.

### Task 11: Lưới trọn + bàn giao

- [ ] `npx vitest run server/services/ai server/services/flow server/routers server/routes ensus` xanh (kể cả khi :8091 đầy — không lưới nào chạm mạng thật).
- [ ] Gửi dieu-phoi + kiem-dinh: tip, danh sách mã lỗi `MaLoiNgoai`, `vectorChe.ts` (cho đột biến của kiem-dinh), thủ tục `aiNgoai.*` (cho 10.4 luong-ui), việc vận hành §8 spec (tạo khoá ở màn quản trị, bật cờ + nhà máy, quyết "dữ liệu vận hành", đặt trần).
