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
  - `cheGiaTri(v: unknown, tu: TuDienNhay): KetQuaChe<unknown>` — CHỈ cho cây DỮ LIỆU (nội dung tin nhắn đã parse JSON, kết quả tool, mô tả) — KHÔNG gọi trên trường giao thức (`maxTokens`, `nhietDo`, `model`) hay TÊN thuộc tính của schema tool (schema: che chuỗi `description`, giữ khoá + kiểu). Duyệt đệ quy object/mảng; chuỗi trông như JSON (`/^\s*[\[{"]/`, cả JSON stringify HAI lớp) ⇒ `JSON.parse` thử (tối đa 3 lớp) rồi duyệt và `stringify` lại; khoá khớp `laTenKhoaNhay` ⇒ thay CẢ giá trị (giữ kiểu: chuỗi ⇒ `"[REDACTED_SECRET]"`, số/bool ⇒ `null`); luật CẶP: object có `{name|key|header|field|param: <tên nhạy>, value|val|data: X}` ⇒ che `X`; mọi chuỗi lá ⇒ `cheChuoi`.
  - `laTenKhoaNhay(ten: string): boolean` — chuẩn hoá (`chuanHoaDeKhop` + bỏ `-_ .` + chữ thường) rồi tách theo đoạn (`_`, `-`, `.`, camelCase); NHẠY khi MỘT ĐOẠN hoặc toàn tên (đã gộp) BẰNG ĐÚNG một từ trong `password|passwd|pwd|secret|token|apikey|xapikey|authorization|cookie|session|privatekey|accesskey|secretaccesskey|clientsecret|connectionstring|connstr|dsn|credential|credentials|signature|bearer|pat|refreshtoken|accesstoken|idtoken` (neo đoạn — `DB_PASSWORD`, `MYSQL_PWD`, `AWS_SECRET_ACCESS_KEY`, `x-api-key` nhạy; `maxTokens`, `tokenCount`, `passed`, `passRate`, `password_policy_min_length`… KHÔNG nhạy nhờ danh sách ngoại lệ tường minh `NGOAI_LE_KHOA` = `maxtokens|tokencount|tokensin|tokensout|tokenizer|passed|passrate|passfail|sessionid?` — `sessionid` vẫn nhạy; ghi lý do từng mục).
  - Mẫu giá trị (thêm vào mẫu của `aiSafety.REDACT_PATTERNS`): khoá Anthropic `sk-ant-(api|admin)\d{2}-[A-Za-z0-9_-]{20,}`, OpenAI `sk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}`, Gemini/Google `AIza[0-9A-Za-z_-]{35}`, `Bearer\s+\S{16,}`, IPv4 nội bộ (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10) → `[REDACTED_IP]`, IPv6 ULA `fc00::/7` & link-local `fe80::/10` → `[REDACTED_IP]`, MAC `([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}` → `[REDACTED_MAC]`, nhãn `(user|username|login|uid)\s*[=:]\s*\S+` → giữ nhãn, che giá trị `[REDACTED_USER]`, email, số điện thoại (dùng lại `aiSafety`), từ trong `TuDienNhay` (khớp nguyên từ, không phân biệt hoa-thường) → `[REDACTED_NAME]`.
  - Chống chữ tách: trước khi khớp nhãn, tạo bản "gom" bỏ khoảng trắng/dấu chấm giữa các ký tự đơn (`p a s s w o r d` → `password`); nếu bản gom khớp nhãn + giá trị ⇒ che đoạn gốc tương ứng.
  - Nhãn dạng env/văn bản (khớp trên bản đã chuẩn hoá, KHÔNG dùng `\b` trước tên vì `_` là ký tự từ): `(^|[^A-Za-z0-9])([A-Z0-9_]*(PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?))\s*[=:]\s*\S+` (env, YAML `password: x` nhiều dòng, docker-compose); `Authorization:\s*Basic\s+[A-Za-z0-9+/=]{8,}`; query URL `[?&](token|api_key|apikey|access_token|key|password|secret)=[^&#\s]+` (che giá trị, giữ tên); giải mã phần trăm (`decodeURIComponent` an toàn) trước khi khớp nhãn (`%70assword=`).
  - Đồng chữ (confusable): chuẩn hoá một bảng ánh xạ Cyrillic/Hy Lạp → Latin cho các chữ trong từ khoá nhạy (`а→a, е→e, о→o, р→p, с→c, ѕ→s, і→i, ԁ→d, ν→v, к→k, т→t, у→y, х→x` …) CHỈ khi dò nhãn; giới hạn còn lại (đồng chữ ngoài bảng) ghi trong đầu tệp — luật GIÁ TRỊ (định dạng khoá) vẫn bắt khoá thật dù nhãn lách.
  - Từ điển tên: chỉ tên độ dài ≥ 4 ký tự và ngoài `TU_DUNG` (`admin`, `test`, `user`, `pass`, `root`, `demo`, `guest`, `system`, `factory`, `nha may` …); khớp bằng MỘT regex hợp nhất dựng lại khi đệm đổi (không vòng lặp từng tên); đệm 5 phút ⇒ tên vừa tạo có thể chưa che trong tối đa 5 phút — ghi giới hạn này ở đầu tệp và README vận hành.

- [ ] **Step 1: Viết `vectorChe.ts`** — mảng `{ ten, dauVao, phaiKhongCon: string[], phaiConLai?: string[] }` gồm tối thiểu: `json-nhay` (`{"password":"P@ss","apiKey":"k"}`), `long-sau` (`{"a":[{"b":{"Api_Key":"x"}}],"headers":{"x-api-key":"y","Authorization":"Bearer abcdefghijklmnop1234"}}`), khoá giả 4 nhà cung cấp (sinh: `"sk-ant-api03-"+"A".repeat(95)`, `"sk-proj-"+"B".repeat(48)`, `"AIza"+"C".repeat(35)`, `"sk-"+"D".repeat(48)` cho tương thích), `ip-noi-bo` (`10.1.2.3`, `192.168.0.10`, `fe80::1`), `mac`, `user-nhan` (`user=engineer1`), `rong-0` (`pa​ssword=abc123`), `chu-tach` (`p a s s w o r d: hunter2`), `ten-khach` (từ điển có `ACME Co` ⇒ `"lỗi đơn ACME Co"`), `ip-cong-khai-giu-nguyen` (`8.8.8.8` CÒN LẠI), `ma-nguon-giu-nguyen` (`const x = 1;` CÒN LẠI); THÊM (rà kiem-dinh): `env-tien-to` (`DB_PASSWORD=Sup3rSecret99`, `MYSQL_PWD=abc12345`, `AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG`), `cap-ten-gia-tri` (`[{"name":"DB_PASSWORD","value":"x9x9x9"}]`, `{"header":"Authorization","value":"Bearer zzzzzzzzzzzzzzzzz"}`), `basic` (`Authorization: Basic dXNlcjpwYXNzd29yZA==`), `query-url` (`https://h/x?token=abcd1234&api_key=efgh5678`), `yaml-nhieu-dong` (`db:\n  password: Sup3r\n  host: x`), `json-hai-lop` (`JSON.stringify(JSON.stringify({password:"p2p2p2"}))`), `cyrillic` (`pаssword=hunter22` với `а` U+0430), `fullwidth` (`ｐａｓｓｗｏｒｄ=hunter33`), `phan-tram` (`%70assword=hunter44`), `nhieu-dong` (bí mật ở dòng 3/5); và giữ nguyên (`phaiConLai`): `qc-pass` (`{"passed":12,"passRate":0.97}` — nguyên giá trị số), `max-tokens` (`{"maxTokens":512}` giữ number), `schema-tool` (schema có thuộc tính `token` — tên thuộc tính còn, kiểu còn), `tu-dung` (`"admin"`, tên nhà máy 2 ký tự `"A1"` KHÔNG bị thay).
- [ ] **Step 2: Test** `cheDuLieu.test.ts`: mỗi vector qua `cheGiaTri` ⇒ không chuỗi `phaiKhongCon` nào còn trong `JSON.stringify(kq.giaTri)`, mọi `phaiConLai` còn (kể cả KIỂU: `typeof kq.giaTri.maxTokens === "number"`); `soTruongDaChe` > 0 với vector nhạy, = 0 với vector giữ nguyên. Ca đột biến: thay `cheChuoi` bằng hàm trả nguyên văn (`vi.spyOn`) ⇒ ít nhất 10 vector đỏ (tự kiểm trong test: đếm vector thất bại khi bỏ che ≥ 10). Hiệu năng: từ điển 5 000 tên + văn bản 200 KB ⇒ `cheChuoi` < 200 ms.
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
- 0416: `ai_flow_versions` thêm `coNodeNgoai bool NOT NULL DEFAULT false`, `ngoaiDuyetBoi int`, `ngoaiDuyetLuc timestamptz`, `ngoaiTuDuyet bool NOT NULL DEFAULT false`, `ngoaiBamDuyet varchar(64)` (sha256 ĐỊNH NGHĨA ĐẦY ĐỦ đã chuẩn hoá lúc duyệt — cả đồ thị, không chỉ tập model) — MỖI phiên bản có node ngoài cần duyệt riêng VÀ lúc bật so `ngoaiBamDuyet` với băm định nghĩa hiện tại (rà kiem-dinh mục 7 / dieu-phoi: thêm nhánh `ot.doc` sau khi duyệt ⇒ băm lệch ⇒ duyệt lại).
- 0415 thêm: `ai_external_calls.ketCuc` gồm cả `'khong-ro'`? — KHÔNG (WORM không sửa được): hàng ý định mồ côi được đánh dấu bằng hàng `ket-qua` mới `ketCuc='khong-ro'` do job đối soát ghi.
- 0414 thêm: `ai_ngoai_host_noi_bo` chỉ admin TOÀN HỆ ghi (kiểm ở thủ tục, Task 8); mọi thay đổi cấu hình/khoá/host/duyệt ghi `audit_logs` (WORM sẵn có) với người + giá trị cũ/mới (Task 7–8).

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
- Quyết định (kiem-dinh B "taint theo item"): taint tính theo LƯỢT, đơn điệu — mọi node đã chạy trong lượt góp mức của nó; `Set`/`Code`/biểu thức `{{ }}` = `ke-thua` (không hạ mức). Chặt hơn theo-item (một nhánh vận hành làm cả lượt vận hành) — chọn vì `{{ }}` tham chiếu được mọi bước trước; ghi rõ trong đầu tệp. Bảng: `ky-thuat` = `kich-hoat.tay`, `kich-hoat.lich`, `ai.*` (kế thừa đầu vào ⇒ `ke-thua`); `van-hanh` = `du-lieu.so-lieu`, `ot.*`, `bao-tri.*`, `chon.*` (truy vấn DB), `ai.tra-tri-thuc`, `tich-hop.http-doc`, `tich-hop.mcp`, `kich-hoat.webhook`; node GIỮ TRẠNG THÁI QUA LƯỢT (biến luồng bền, bộ nhớ agent, đệm/khử trùng, `cho.*` đợi sự kiện — liệt kê khi cài bằng grep `luuTrangThai|bienLuong|boNho` trong `nut/`) ⇒ `van-hanh` (có thể mang dữ liệu lượt trước); mọi thứ khác ⇒ liệt kê tường minh trong bảng.
- Quyết định (rà kiem-dinh mục 4): CỔNG tự suy `mucDuLieu`, KHÔNG nhận từ người gọi. `YeuCauGoiNgoai.ngu` KHÔNG có trường `mucDuLieu`; thay bằng `nguonMuc: { loai: "luong"; ngu: NguCanhChay } | { loai: "be-mat"; beMat: "chat" | "coding" | "agent-turn"; ketQuaToolDaGhep: MucDuLieu[] }` — luồng: cổng gọi `ngu.mucDuLieu()` của engine (node không ghi đè được: `mucDuLieuLuot` là trường riêng của `dongCo`, node chỉ đọc); chat/coding/KB: nội dung DO SERVER GHÉP (ngữ cảnh KB, kết quả tool, dữ liệu số liệu) được phân loại TẠI ĐIỂM GHÉP (hàm ghép trả kèm mức), văn bản NGƯỜI DÙNG TỰ DÁN coi là `ky-thuat` — trách nhiệm người dùng, ghi vào spec §B2 + nhãn UI 10.4. Payload `kich-hoat.tay` (người chạy tự nhập) cũng là `ky-thuat` theo cùng quy tắc — ghi spec.
- Luồng con: `taint` của lượt con truyền LÊN lượt cha khi lượt con kết thúc (`dongCo` gộp `capNhatMucLuot(cha, con)`), kể cả khi con lỗi giữa chừng.

- [ ] **Step 1: Test** `phanLoai.test.ts`: chuỗi `[kich-hoat.tay, xu-ly.set, ai.tom-tat]` ⇒ `ky-thuat`; `[kich-hoat.tay, du-lieu.so-lieu, xu-ly.ma, ai.tom-tat]` ⇒ `van-hanh`; node lạ `x.y` ⇒ `van-hanh`; agent-turn có kết quả tool từ luồng con `van-hanh` ⇒ `van-hanh`; `khong-ha-muc`: node giả sau `ot.doc` cố gán `ngu.mucDuLieuLuot = "ky-thuat"` / trả `{ mucDuLieu: "ky-thuat" }` ⇒ `ngu.mucDuLieu()` vẫn `van-hanh` (trường chỉ-đọc, `Object.freeze`/getter); `luong-con`: cha `[kich-hoat.tay, goi-luong-con]` với con `[du-lieu.so-lieu]` ⇒ cha `van-hanh` sau khi con trả; con ném lỗi sau `du-lieu.so-lieu` ⇒ cha vẫn `van-hanh`; `giu-trang-thai`: mỗi node trong danh sách giữ trạng thái ⇒ `van-hanh`. `phanLoaiNut.census.test.ts`: mọi `type` trong registry (`server/services/flow/nut/index.ts` sau khi nạp) có mục trong `PHAN_LOAI_NGUON_NUT`.
- [ ] **Step 2: Chạy** — FAIL. **Step 3: Cài.** **Step 4: Chạy** + `npx vitest run server/services/flow` — PASS.
- [ ] **Step 5: Commit** `feat(ai-ngoai): phan loai muc du lieu theo luot (van-hanh thang, nut la => van-hanh) + census nut`.

### Task 4: Trần chi phí đặt-trước nguyên tử (`tranChiPhi.ts`)

**Files:** Create `server/services/ai/ngoai/tranChiPhi.ts`, `server/services/ai/ngoai/tranChiPhi.db.test.ts`

**Interfaces:**
- Produces:
  - `ngayUtc7(d: Date): string` (YYYY-MM-DD theo +07:00).
  - `interface YeuCauGiuCho { factoryId: number; userId: number | null; flowId: string | null; runId: string | null; tokenUoc: number; tienUocUsd: number | null }`
  - `interface PhieuGiu { id: string; khoa: string[]; tokenUoc: number; tienUocUsd: number }`
  - `datTruoc(db, yc: YeuCauGiuCho, tran: TranNhaMay): Promise<PhieuGiu>` — MỘT giao dịch, cho từng khoá `nha-may`, `nguoi:<id>`, `luong:<id>`, `luot:<runId>` có trần, MỘT câu lệnh kiểm CẢ nhánh chèn lẫn nhánh cập nhật, CẢ token lẫn tiền (rà kiem-dinh mục 1 — `INSERT … VALUES` trần không kiểm khi hàng chưa có):
    ```sql
    INSERT INTO ai_ngoai_dem ("factoryId", ngay, khoa, "tokenGiu", "tienGiuUsd")
    SELECT $factoryId, $ngay, $khoa, $n, $tien
    WHERE $n <= $tranToken AND ($tranTien IS NULL OR $tien <= $tranTien)
    ON CONFLICT ("factoryId", ngay, khoa) DO UPDATE
      SET "tokenGiu" = ai_ngoai_dem."tokenGiu" + EXCLUDED."tokenGiu",
          "tienGiuUsd" = ai_ngoai_dem."tienGiuUsd" + EXCLUDED."tienGiuUsd"
      WHERE ai_ngoai_dem."tokenGiu" + EXCLUDED."tokenGiu" <= $tranToken
        AND ($tranTien IS NULL OR ai_ngoai_dem."tienGiuUsd" + EXCLUDED."tienGiuUsd" <= $tranTien)
    RETURNING khoa
    ```
    `$factoryId` = `nhaMayTinhTran` (Task 6) — khoá `nguoi:`/`luong:`/`luot:` tách theo nhà máy (rà kiem-dinh: khoá chính `(factoryId, ngay, khoa)`); cộng `ai_ngoai_dem_phut` phút hiện tại bằng cùng mẫu `ON CONFLICT ("factoryId", phut)` (≤ `tranLanPhut`); bất kỳ khoá không trả hàng ⇒ ROLLBACK + ném `LoiNgoai("NGOAI_VUOT_TRAN", khoa)`; lỗi DB ⇒ ném `LoiNgoai("NGOAI_DEM_HONG")`. Trần tiền chỉ áp khi model có giá; model không giá ⇒ `$tien=0` và dựa trần token + số lần.
  - `uocTokenVao(yc: YeuCauNhaCungCap): number` — BI QUAN: `Math.ceil(Buffer.byteLength(JSON.stringify(yc), "utf8") / 2)` (≥ số token thật với mọi tokenizer đã biết, kể cả CJK/Việt có dấu ~1 token/2–3 byte); `tokenUoc = uocTokenVao + maxTokens`.
  - `ketToan(db, phieu: PhieuGiu, thuc: { tokenVao: number; tokenRa: number; tienUsd: number | null }): Promise<void>` — cộng chênh vào cùng khoá. Quyết định (rà mục 8): chênh ÂM (hoàn) CHỈ khi nhà cung cấp trả `usage` hợp lệ; KHÔNG hoàn khi yêu cầu đã rời máy mà không có `usage` (hết hạn, mất kết nối giữa chừng, 5xx sau khi gửi) — giữ nguyên ước tính. `huyGiuChuaGui(db, phieu)` hoàn TOÀN BỘ — chỉ gọi khi CHẮC CHẮN chưa gửi (lỗi trước `fetch`, `ghiYDinh` lỗi, kiểm URL lỗi).
  - `donDemCu(db, giuNgay = 90): Promise<number>` — xoá hàng `ai_ngoai_dem` cũ hơn `giuNgay` và `ai_ngoai_dem_phut` cũ hơn 1 giờ; job nền mỗi giờ (`backgroundJobs.ts`, Task 5).
  - `class LoiNgoai extends Error { constructor(readonly ma: MaLoiNgoai, readonly chiTiet?: string) }` (đặt ở `server/services/ai/ngoai/loi.ts`; `MaLoiNgoai` hợp các mã của kế hoạch này).
- Model không giá (`giaVaoUsdTrieu IS NULL`) ⇒ `tienUocUsd=null`, bắt buộc `tranTokenLuot` (CHECK 0414) và trần số lần.

- [ ] **Step 1: Test** (DB `_test`): trần nhà máy 1000 token, giữ 600 ⇒ ok, giữ thêm 600 ⇒ `NGOAI_VUOT_TRAN` và tổng vẫn 600 (rollback mọi khoá); `dong-thoi`: 2 `datTruoc` 600 đồng thời trên trần 1000 ⇒ đúng 1 thành công; `nua-dem`: `ngayUtc7(new Date("2026-10-26T16:59:59Z"))==="2026-10-26"`, `…T17:00:00Z` ⇒ `"2026-10-27"`; `lan-phut`: `tranLanPhut=2` ⇒ lần 3 trong cùng phút bị từ chối; `ketToan` có `usage` hoàn trả chênh âm; DB giả ném ⇒ `NGOAI_DEM_HONG`; THÊM (rà kiem-dinh): `chen-vuot-tran` — hàng CHƯA có + `tokenUoc` 1500 > trần 1000 ⇒ `NGOAI_VUOT_TRAN` và `SELECT count(*)` khoá đó = 0 (đột biến: bỏ `WHERE` của nhánh `SELECT` ⇒ ca này đỏ — kiểm trong test bằng bản SQL đột biến chạy song song); `tran-tien`: trần tiền 1,00 USD, giữ 0,60 ⇒ ok, giữ 0,60 nữa ⇒ từ chối; hàng chưa có + 1,50 ⇒ từ chối, 0 hàng; `uoc-bi-quan`: văn bản 1 000 ký tự CJK (`"漢".repeat(1000)`) và 1 000 ký tự Việt có dấu ⇒ `uocTokenVao` ≥ 1 000 (≥ số ký tự); `khong-hoan-sau-gui`: `ketToan` với `usage` vắng ⇒ bộ đếm giữ nguyên ước tính; `huyGiuChuaGui` ⇒ về 0; `don-dem`: hàng 91 ngày bị xoá, 89 ngày còn; `tach-nha-may`: nhà máy A và B cùng `nguoi:7`, mỗi bên giữ 600 trên trần người 1000 ⇒ cả hai ok (bộ đếm RIÊNG), A giữ thêm 600 ⇒ từ chối, B không đổi. Mọi ca chạy trên DB `_test` THẬT (không mock SQL) — `chen-vuot-tran` phải bắt lỗi `ON CONFLICT` không khớp khoá. README vận hành: `uocTokenVao` bi quan 2–4× với tiếng Anh/mã ⇒ đặt trần có hệ số.
- [ ] **Step 2–4:** FAIL → cài → PASS. **Step 5: Commit** `feat(ai-ngoai): tran chi phi dat-truoc nguyen tu theo nha may/ngay UTC+7/nguoi/luong/luot + so lan/phut`.

### Task 5: Sổ WORM (`soNgoai.ts`)

**Files:** Create `server/services/ai/ngoai/soNgoai.ts`, `server/services/ai/ngoai/soNgoai.db.test.ts`; Modify `server/_core/backgroundJobs.ts` (mỗi giờ: xoá `ai_external_call_noi_dung` hết hạn; `donDemCu` Task 4; `doiSoatYDinhMoCoi`)

- Thêm (rà mục 8): `doiSoatYDinhMoCoi(db, quaPhut = 30): Promise<number>` — mọi hàng ý định không có hàng kết quả sau `quaPhut` phút ⇒ ghi hàng kết quả `ketCuc="khong-ro"`, `maLoi="MO_COI"` (WORM: chỉ CHÈN); KHÔNG hoàn bộ đếm.
- Thêm (rà mục 9): đọc `ai_external_call_noi_dung` chỉ qua `aiNgoai.xemNoiDung({ callId })` — `adminProcedure` + phạm vi nhà máy của hàng (ngoài ⇒ NOT_FOUND) + ghi `audit_logs` mỗi lần xem; mặc định `luuNguyenVan=false`.

**Interfaces:**
- Produces: `ghiYDinh(db, h: HangYDinh): Promise<number /*id*/>`; `ghiKetQua(db, yDinhId: number, h: HangKetQua): Promise<void>`; `luuNoiDungNeuBat(db, callId, noiDungDaChe: string, cauHinh: { luuNguyenVan: boolean; hanGiuNgay: number }): Promise<void>`; `bamNoiDung(s: string): string` (sha256 hex của bản ĐÃ che).
- `HangYDinh = { factoryId: number; userId: number | null; flowId: string | null; runId: string | null; tuDong: boolean; nhaCungCap: string; model: string; mucDich: string; mucDuLieu: MucDuLieu; soTruongDaChe: number; bamNoiDung: string }`; `HangKetQua = { tokenVao: number; tokenRa: number; chiPhiUocUsd: number | null; ketCuc: "ok" | "loi" | "tu-choi"; maLoi?: string }`.

- [ ] **Step 1: Test:** `ghiYDinh` trả id; hàng có `factoryId`, `bamNoiDung` 64 hex; `luuNguyenVan=false` ⇒ không hàng nội dung; `true` ⇒ hàng với `hetHanLuc = taoLuc + hanGiuNgay`; job xoá chỉ xoá hàng hết hạn; UPDATE `ai_external_calls` bằng `avi_app` ⇒ lỗi quyền; `mo-coi`: ý định 31 phút không kết quả ⇒ sau `doiSoatYDinhMoCoi` có hàng `khong-ro`, ý định 29 phút ⇒ không; chạy đối soát hai lần ⇒ không ghi trùng; `xem-noi-dung`: admin nhà máy B xem hàng nhà máy A ⇒ NOT_FOUND; người không phải admin ⇒ FORBIDDEN; xem hợp lệ ⇒ có hàng `audit_logs`.
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
  - `interface NhaCungCapAi { ma: "anthropic" | "openai" | "gemini" | "openai_compat"; goi(yc: YeuCauNhaCungCap, layKhoa: () => Promise<string>, mang: MangNgoai): Promise<KetQuaNhaCungCap> }`
- Produces (`congNgoai.ts`):
  - `interface YeuCauGoiNgoai { dich: { nhaCungCap: string; model: string }; tinNhan: TinNhanNgoai[]; dinhKem?: unknown[]; congCu?: YeuCauNhaCungCap["congCu"]; maxTokens: number; mucDich: string; ngu: { userId: number | null; flowId: string | null; runId: string | null; tuDong: boolean; nhaMayNguoiGoi: number[]; nhaMayChuDuLieu: number[]; nguonMuc: NguonMuc } }` — KHÔNG có `factoryId`/`mucDuLieu` do người gọi khai (Task 3).
  - `nhaMayTinhTran(ngu): number` — luồng: nhà máy CHỦ LUỒNG; chat/coding/KB: nhà máy của dữ liệu đã ghép (`nhaMayChuDuLieu`), không có dữ liệu nhà máy nào ⇒ nhà máy MẶC ĐỊNH của người dùng (một và chỉ một; nhiều nhà máy không mặc định ⇒ `NGOAI_KHONG_TON_TAI`).
  - `goiAiNgoai(yc: YeuCauGoiNgoai, dep?: PhuThuocCong): Promise<{ noiDung: string; toolCalls: KetQuaNhaCungCap["toolCalls"]; khongTinCay: true; tokenVao: number; tokenRa: number }>`
  - `kiemToolCallTraVe(toolCalls, congCuDaCap: YeuCauNhaCungCap["congCu"]): KetQuaNhaCungCap["toolCalls"]` (rà mục 6) — mọi `ten` phải thuộc `congCuDaCap` và `thamSo` qua `schema` của tool đó (ajv, `additionalProperties:false`); trái ⇒ ném `LoiNgoai("NGOAI_TOOL_KHONG_CAP", ten)`, ghi sổ `ketCuc="tu-choi"`; bộ thực thi agent dừng vòng (không thử tool kế).
  - Thứ tự CỐ ĐỊNH (lưới canh thứ tự bằng nhật ký phụ thuộc giả): (1) `AI_NGOAI_ENABLED==="true"` lúc gọi; (2) xác định nhà máy (rà mục 3): tập `nhaMayChuDuLieu ∪ {nhaMayTinhTran}` — chủ dữ liệu KHÔNG xác định (nguồn ghép trả `null`) ⇒ `NGOAI_KHONG_TON_TAI`; MỌI nhà máy trong tập phải `batNgoai` + model `batModel` (một nhà máy tắt ⇒ `NGOAI_KHONG_TON_TAI`, map NOT_FOUND); người gọi phải thuộc phạm vi mọi nhà máy trong tập; (3) `dinhKem?.length` ⇒ `NGOAI_CAM_DINH_KEM`; (3b) TRẦN KÍCH THƯỚC trước khi che (rà kiem-dinh F): mỗi chuỗi lá ≤ 256 KB, tổng `JSON.stringify` yêu cầu ≤ 1 MB ⇒ vượt ⇒ `NGOAI_QUA_LON` (không che-rồi-gửi một phần); test `qua-lon` (một chuỗi 257 KB ⇒ từ chối, nhà cung cấp không được gọi); (4) cổng tự suy `mucDuLieu` từ `nguonMuc` (Task 3); `van-hanh` ⇒ MỌI nhà máy trong tập phải `choDuLieuVanHanh`, không ⇒ `NGOAI_DU_LIEU_VAN_HANH`; trần (bước 7) tính vào `nhaMayTinhTran`; (5) lắp toàn bộ yêu cầu (system, lịch sử, kết quả tool, schema tool, tên tệp) thành `YeuCauNhaCungCap`; (6) `cheGiaTri(yeuCauDaLap)` — ĐIỂM CHE DUY NHẤT; (7) `datTruoc`; (8) `ghiYDinh` (lỗi ⇒ hoàn chỗ + ném, KHÔNG gọi); (9) `nhaCungCap.goi` (mỗi lần thử lại ⇒ `datTruoc` lại); (10) `ketToan`; (11) `kiemToolCallTraVe`; (12) `ghiKetQua`; lỗi nhà cung cấp ⇒ `cheChuoi(loi.message)` rồi mới ném/ghi.

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
  - THÊM (rà kiem-dinh): `nha-may-cheo` — người thuộc {A,B}, A bật / B tắt, dữ liệu ghép từ B ⇒ `NGOAI_KHONG_TON_TAI`, nhà cung cấp KHÔNG được gọi; dữ liệu từ A ⇒ qua, bộ đếm `nha-may` của A tăng, của B không; dữ liệu trộn A+B (B bật nhưng `choDuLieuVanHanh=false`, dữ liệu vận hành) ⇒ `NGOAI_DU_LIEU_VAN_HANH`; nguồn ghép trả chủ `null` ⇒ từ chối;
  - `khong-tin-nguoi-goi`: kiểu TS không còn trường `mucDuLieu` (lưới `expectTypeOf`); luồng `[ot.doc, nut-gia]` mà `nut-gia` cố đặt mức `ky-thuat` ⇒ cổng vẫn thấy `van-hanh`;
  - `tool-tra-ve-la`: nhà cung cấp giả trả `toolCalls:[{ten:"ot_write"}]` rồi `[{ten:"xoa_luong"}]` rồi `[{ten:"tra_tai_lieu", thamSo:{q:1, them:"x"}}]` (sai schema) ⇒ cả ba `NGOAI_TOOL_KHONG_CAP`, bộ thực thi agent không gọi gì, vòng dừng, sổ có `ketCuc="tu-choi"`;
- [ ] **Step 2–4:** FAIL → cài → PASS. **Step 5: Commit** `feat(ai-ngoai): cong AI ngoai (mot diem che sau khi lap, cam dinh kem, du lieu van hanh, so truoc goi, tran nguyen tu, che loi nha cung cap) + agent loc tool`.

## Phần 3 — Khoá và phạm vi

### Task 7: Khoá theo nhà máy (`khoaNgoai.ts`) + thủ tục admin

**Files:**
- Create: `server/services/ai/ngoai/khoaNgoai.ts`, `server/routers/aiNgoaiRouter.ts` (mount `aiNgoai`), `server/services/ai/ngoai/khoaNgoai.test.ts`, `server/services/ai/ngoai/khoaKhongLo.test.ts`
- Modify: `server/routers/aiSettingsRouter.ts` (`createApiKey` bắt buộc `factoryId`; provider mới), `server/routers.ts`, các census GHIM

**Interfaces:**
- Produces: `layKhoaChoNhaCungCap(db, keyId: number, factoryId: number): () => Promise<string>` — trả THUNK; giải mã (`decryptSecret`, `secretBox.ts:58`) chỉ khi thunk được gọi; khoá thuộc nhà máy khác / `status≠active` / legacy (không tiền tố `enc:v1:`) ⇒ `NGOAI_KHOA_KHONG_HOP_LE`.
- tRPC (`adminProcedure.use(moduleGate("MOD_AI"))`, phạm vi nhà máy qua `phamViCua(ctx)` + `nhaMayHopLe`): `aiNgoai.taoKhoa({ factoryId, nhaCungCap, ten, khoa })` ⇒ `{ id, cuoi4 }`; `aiNgoai.xoayKhoa({ id, khoa })`; `aiNgoai.thuHoiKhoa({ id })`; `aiNgoai.dsKhoa({ factoryId })` ⇒ `[{ id, ten, nhaCungCap, status, cuoi4 }]`. Ngoài phạm vi ⇒ NOT_FOUND. Mọi thủ tục ghi (tạo/xoay/thu hồi) ghi `audit_logs` với người + giá trị cũ/mới (khoá chỉ dạng `cuoi4`, không bao giờ bản rõ/bản mã).
- Thunk đọc khoá TƯƠI mỗi lần gọi (không đệm giữa các lần thử lại) ⇒ xoay khoá giữa hai lần thử, lần sau dùng khoá mới; thu hồi giữa hai lần ⇒ lần sau `NGOAI_KHOA_KHONG_HOP_LE`.

- [ ] **Step 1: Test** `khoaNgoai.test.ts`: tạo ⇒ DB lưu `enc:v1:…`, trả `cuoi4`; thunk nhà máy khác ⇒ lỗi; thu hồi ⇒ thunk lỗi. `khoaKhongLo.test.ts`: khoá giả `"sk-ant-api03-"+"Z".repeat(95)` — chạy một lượt `goiAiNgoai` (nhà cung cấp giả nhận khoá qua thunk) rồi quét chuỗi khoá trong: mọi đầu ra tRPC `aiNgoai.*`/`aiSettings.*`, `ai_external_calls` + `ai_external_call_noi_dung`, sự kiện lịch sử chạy (`ai_flow_events`), gói xuất luồng (`flow.xuat`), log (spy `console.*` + logger) ⇒ 0 lần xuất hiện. THÊM (rà mục 10): đường LỖI — nhà cung cấp giả ném `Error` có khoá trong `message` + `cause` + `stack`, gọi qua tRPC thật (`appRouter.createCaller`) ⇒ quét `TRPCError.message`, hàm `onError` của adapter tRPC (`server/_core/trpc.ts`), bản ghi pino (gắn `destination` ghi vào mảng thay vì spy), và `JSON.stringify(err, Object.getOwnPropertyNames(err))` của lỗi ném ra (thứ vitest in trong trace) ⇒ 0 lần; `audit_logs` của tạo/xoay ⇒ 0 lần. `xoay-giua-thu-lai`: nhà cung cấp giả lần 1 trả 503 và trong lúc đó `xoayKhoa` ⇒ lần 2 nhận khoá MỚI (giả ghi lại khoá nhận được); `thu-hoi-giua-thu-lai` ⇒ lần 2 `NGOAI_KHOA_KHONG_HOP_LE`, không gọi.
- [ ] **Step 2–4:** FAIL → cài → PASS; census GHIM cập nhật kèm lý do.
- [ ] **Step 5: Commit** `feat(ai-ngoai): khoa theo nha may - giai ma chi trong nha cung cap (thunk), admin tao/xoay/thu hoi, quet khong lo khoa`.

### Task 8: Cấu hình nhà máy + danh mục ngoài + phạm vi luồng + duyệt

**Files:**
- Create: `server/services/ai/ngoai/cauHinhNgoai.ts`, `server/services/ai/ngoai/cauHinhNgoai.test.ts`
- Modify: `server/routers/aiNgoaiRouter.ts` (`aiNgoai.cauHinh` đọc/ghi admin, `aiNgoai.dsModel`/`datModel`), `server/services/ai/chonModel/danhMuc.ts` (`NguonModelNgoai` thật = `cauHinhNgoai.layModelDaBat`), `server/routers/flowRouter.ts:361-375` (`datPhienBanHoatDong`: phiên bản có node dùng model ngoài ⇒ cần `ngoaiDuyetBoi` trên CHÍNH phiên bản đó và `ngoaiBamDuyet === bamDinhNghia(phiên bản)`), `server/routers/flowRouter.ts` thủ tục nhập gói, `server/routes/openaiGateway.ts` (rà mục 13: `model:"ngoai:…"` ⇒ `goiAiNgoai` — CÙNG cổng, không đường riêng; `nhaMayNguoiGoi`/`nhaMayTinhTran` = nhà máy của CHỦ API key; key không gắn nhà máy / chủ không xác định ⇒ 404 `model_not_found`; trả về OpenAI-format, `toolCalls` qua `kiemToolCallTraVe`)

**Interfaces:**
- Produces: `layCauHinhNhaMay(db, factoryId): Promise<CauHinhNhaMay | null>`; `layModelDaBat(factoryId: number | null): Promise<Array<{ nhaCungCap; model; nhan }>>` (null / `AI_NGOAI_ENABLED≠"true"` / `batNgoai=false` ⇒ `[]`); `coNodeNgoai(dinhNghia: DinhNghiaLuong): boolean`; `bamDinhNghia(dinhNghia: DinhNghiaLuong): string` (sha256 JSON chuẩn hoá — khoá sắp xếp, bỏ toạ độ vẽ `viTri`); `aiNgoai.duyetNgoai({ flowId, phienBan })` — SoD (rà mục 7): người duyệt ≠ người tạo phiên bản; admin TỰ duyệt được NHƯNG ghi `ngoaiTuDuyet=true` + `audit_logs` mức cao (`muc:"cao"`, sự kiện `ai-ngoai.tu-duyet`) và BỊ CẤM khi luồng có node `van-hanh` theo `PHAN_LOAI_NGUON_NUT` (mức tĩnh của đồ thị) ⇒ `NGOAI_TU_DUYET_VAN_HANH`.
- Quyền (rà mục 9): `aiNgoai.cauHinh.ghi` / `datModel` = admin trong phạm vi nhà máy; `aiNgoai.hostNoiBo.*` (ghi `ai_ngoai_host_noi_bo`) = admin TOÀN HỆ (`ctx.user.role==="admin"` + không giới hạn nhà máy — dùng hàm sẵn có `laAdminToanHe` nếu có, không thì thêm vào `server/_core/phamVi*.ts` theo mẫu sẵn); MỌI thủ tục ghi cấu hình / model / host / duyệt ghi `audit_logs` với người + giá trị CŨ/MỚI.

- [ ] **Step 1: Test:** `AI_NGOAI_ENABLED` tắt ⇒ danh mục 10.1 không có mục ngoài; bật + nhà máy A bật ⇒ có; người nhà máy B ⇒ không và `giaiChonModel("ngoai:…")` ⇒ NOT_FOUND; luồng toàn cục chạy node ngoài ⇒ `NGOAI_LUONG_TOAN_CUC`; bật luồng có node ngoài chưa duyệt ⇒ từ chối; duyệt bởi chính người tạo (không admin) ⇒ từ chối; MỖI phiên bản mới (kể cả chỉ đổi nhắc lệnh) ⇒ phải duyệt lại; `them-nhanh-sau-duyet`: duyệt phiên bản rồi sửa định nghĩa thêm nhánh `ot.doc` (cùng tập model) ⇒ băm lệch ⇒ bật từ chối; đổi chỉ toạ độ node ⇒ băm không đổi; `tu-duyet`: admin tự duyệt luồng thuần kỹ thuật ⇒ được, `ngoaiTuDuyet=true` + `audit_logs` `muc:"cao"`; admin tự duyệt luồng có `du-lieu.so-lieu` ⇒ `NGOAI_TU_DUYET_VAN_HANH`; `host-noi-bo`: admin chỉ của nhà máy A ghi host ⇒ FORBIDDEN, admin toàn hệ ⇒ được + audit; `audit-cau-hinh`: đổi `tranTokenNgay` 1000→2000 ⇒ hàng audit có cũ 1000, mới 2000; `v1-ngoai`: API key của người nhà máy A (bật) + `model:"ngoai:anthropic:m"` ⇒ nhà cung cấp giả được gọi qua `goiAiNgoai` (spy) và sổ có hàng; key không gắn nhà máy ⇒ 404 `model_not_found`, giả không được gọi; `model` khớp regex nhưng không bật ⇒ 404; `nhap-goi`: nhập gói có `chonModel:"ngoai:…"` vào nhà máy tắt ⇒ bật luồng từ chối và chạy thử ⇒ NOT_FOUND (không đổi sang Local); cờ đọc LÚC GỌI: bật luồng khi cờ bật, tắt cờ, chạy ⇒ `NGOAI_TAT`.
- [ ] **Step 2–4:** FAIL → cài → PASS (+ `npx vitest run server/routers/flowRouter server/services/flow ensus`).
- [ ] **Step 5: Commit** `feat(ai-ngoai): cau hinh/bat theo nha may chu luong, danh muc ngoai, luong toan cuc tu choi, duyet moi phien ban + bam do thi, tu duyet audit cao, host noi bo chi admin toan he`.

## Phần 4 — Nhà cung cấp thật

### Task 9: `mangNgoai.ts` + 4 bản cài

**Files:**
- Create: `server/services/ai/ngoai/mangNgoai.ts`, `server/services/ai/ngoai/nhaCungCap/{anthropic,openai,gemini,openaiTuongThich}.ts`, tests `mangNgoai.test.ts`, `nhaCungCap/*.test.ts`
- Modify: `.env.example` (khối `AI_NGOAI_ENABLED=false` + chú thích: bật theo nhà máy ở màn quản trị, khoá KHÔNG qua .env)

**Interfaces:**
- Produces: `interface MangNgoai { goiJson(url: string, init: { method: "POST"; headers: Record<string, string>; body: string }): Promise<{ status: number; json: unknown }> }`; `taoMangNgoai(chinhSach: { hostNoiBo: ReadonlySet<string> }): MangNgoai` — `kiemUrlNgoai` (chuẩn hoá + luật Global Constraints) → `kiemDichDen` (`mangAnToan.ts:107`) → `fetchGhim` (:133, không theo chuyển hướng, không proxy) → `docThanCoTran(r, 4*1024*1024)` (:173), hạn 120 s; `datFetchNgoaiChoTest(f | null)`.
- Base URL cố định trong từng bản cài: Anthropic `https://api.anthropic.com/v1/messages` (header `x-api-key`, `anthropic-version: 2023-06-01`), OpenAI `https://api.openai.com/v1/chat/completions` (`Authorization: Bearer`), Gemini `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` (header `x-goog-api-key`, KHÔNG để khoá trong URL), tương thích: `endpoint` của khoá + `/chat/completions`. Model mặc định KHÔNG cứng trong mã (lấy từ `ai_ngoai_model`).
- Rà mục 11: TLS dùng mặc định Node (CA hệ thống) — CẤM `rejectUnauthorized:false` / `NODE_TLS_REJECT_UNAUTHORIZED` trong `server/services/ai/ngoai/**` (lưới grep); `endpoint` tương thích chạy lại `kiemUrlNgoai` + `kiemDichDen` MỖI LẦN gọi (không đệm kết quả lúc lưu khoá); `model` chèn vào ĐƯỜNG DẪN (Gemini) qua `kiemTenModelDuongDan(m: string): string` — chỉ `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, cấm `..`, rồi `encodeURIComponent`; trái ⇒ `NGOAI_MODEL_KHONG_HOP_LE`.

- [ ] **Step 1: Test** `mangNgoai.test.ts` (DNS giả `datPhanGiaiDns`): `http://api.openai.com` ⇒ từ chối (công cộng phải https); `https://user:p@x.com` ⇒ từ chối; `ftp://`, `file://` ⇒ từ chối; `https://169.254.169.254/` và `https://[fe80::1]/` ⇒ từ chối kể cả có khai; `https://API.OpenAI.COM./v1` chuẩn hoá thành `api.openai.com`; host phân giải ra `10.0.0.5` không khai ⇒ `DICH_NOI_BO`; khai `llm.local:8000` ⇒ cho `http://llm.local:8000`; phản hồi 302 ⇒ lỗi (không theo); `HTTPS_PROXY=http://127.0.0.1:9` đặt trong test ⇒ vẫn tới máy chủ giả (proxy bị bỏ qua); thân 5 MB ⇒ lỗi trần; `tls` (máy chủ `node:https` cục bộ với chứng chỉ sinh trong test bằng `selfsigned`/`node:crypto` — nếu repo chưa có thư viện sinh chứng chỉ, dùng tệp PEM cố định trong `__fixtures__` sinh một lần bằng openssl và GHI ngày hết hạn): tự ký ⇒ từ chối, hết hạn ⇒ từ chối, sai tên (CN `khac.local`) ⇒ từ chối; `grep-tls`: không tệp nào dưới `server/services/ai/ngoai/` chứa `rejectUnauthorized` hay `NODE_TLS_REJECT_UNAUTHORIZED`; `endpoint-doi-dns`: khoá tương thích `https://llm.x.vn` — lần 1 phân giải công cộng ⇒ qua, đổi DNS giả sang `10.0.0.9` (không khai) ⇒ lần 2 `DICH_NOI_BO`; `gemini-model`: `"../v1/x"`, `"a?b"`, `"a#b"`, `"a%2fb"`, `"a/b"` ⇒ `NGOAI_MODEL_KHONG_HOP_LE`, `"gemini-2.5-pro"` ⇒ URL đúng. `nhaCungCap/*.test.ts` (máy chủ giả `node:http` qua `datFetchNgoaiChoTest`): mỗi bản cài gửi đúng khuôn (header khoá đúng chỗ, model, messages/contents, max tokens), đọc `usage` → `tokenVao/tokenRa`, `tool_use`/`tool_calls`/`functionCall` → `toolCalls`, 4xx/5xx ⇒ `LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI")` với thông điệp đã qua `cheChuoi`.
- [ ] **Step 2–4:** FAIL → cài → PASS. **Step 5: Commit** `feat(ai-ngoai): mang ngoai (https bat buoc, cam metadata/userinfo/redirect/proxy, ghim IP, tran) + 4 nha cung cap (fetch, khong SDK)`.

## Phần 5 — B4 chặn đường vòng

### Task 10: `hostAiNgoai.ts` + áp lúc LƯU và lúc GỌI

**Files:**
- Create: `server/services/ai/ngoai/hostAiNgoai.ts`, `server/services/ai/ngoai/hostAiNgoai.test.ts`, `server/services/ai/ngoai/duongVong.census.test.ts`
- Modify: `server/services/flow/nut/tichHop.ts:89-119` (`goi`: sau `kiemDichDen` gọi `chanHostAiNgoai(url, dich)`), `server/services/flow/nut/mcpKhach.ts:131-143` (lúc nạp danh sách `AI_FLOW_MCP_CHO_PHEP` và lúc gọi), `server/services/flow/kiemLuong.ts` (lúc LƯU: URL tĩnh trong tham số node http/mcp ⇒ từ chối `DICH_LA_AI_NGOAI`), `docs/AI_FLOW_SECURITY_OPERATIONS.md` (đoạn "rào chống nhầm, không chống người có quyền sửa luồng")

**Interfaces:**
- Khảo sát 2026-10-26: điểm gọi ra ngoài của Luồng chỉ có `tich-hop.http-*` và `tich-hop.mcp`; `tich-hop.thong-bao` là thông báo NỘI BỘ, webhook là kích hoạt VÀO; tool của `ai.agent` là luồng con (đi qua chính các node trên) ⇒ census bên dưới canh nếu sau này thêm node email/webhook-ra.
- Produces: `DANH_SACH_HOST_AI_MAC_DINH: readonly string[]` = `anthropic.com`, `openai.com`, `generativelanguage.googleapis.com`, `aiplatform.googleapis.com`, `openai.azure.com`, `openrouter.ai`, `api.groq.com`, `api.mistral.ai`, `bedrock-runtime.*.amazonaws.com` (mẫu), `api.together.xyz`, `api.together.ai`, `api.deepseek.com`, `api.cohere.com`, `api.cohere.ai`, `api.x.ai`, `api.perplexity.ai`, `api.fireworks.ai` (khớp hậu tố theo nhãn); mở rộng bằng env `AI_NGOAI_HOST_CHAN_THEM` (phẩy) + mọi `endpoint` khoá `openai_compat` + `ai_ngoai_host_noi_bo`; `laHostAiNgoai(hostname: string): boolean` (sau chuẩn hoá); `chanHostAiNgoai(url: URL, dich?: DichDen): Promise<void>` — ném `LoiHttpLuong("…", "DICH_LA_AI_NGOAI")` nếu host khớp HOẶC `dich.ip` thuộc tập IP đã ghim của các host tương thích đã khai.

- [ ] **Step 1: Test** `hostAiNgoai.test.ts`: `https://api.anthropic.com/x`, `https://API.OPENAI.COM./v1`, `https://foo.openai.azure.com`, `https://bedrock-runtime.us-east-1.amazonaws.com`, `https://openrouter.ai/api` ⇒ chặn; `https://example.com` ⇒ qua; host tương thích khai `llm.nha-may.vn` + phân giải 203.0.113.7 ⇒ URL `https://khac.vn` phân giải 203.0.113.7 ⇒ chặn (so IP). Node `tich-hop.http-gui` URL `https://api.openai.com/v1/chat/completions` ⇒ LƯU luồng bị từ chối và CHẠY (URL từ biểu thức) bị từ chối `DICH_LA_AI_NGOAI`; MCP máy chủ khai `https://api.anthropic.com/mcp` ⇒ nạp từ chối. `duongVong.census.test.ts` (rà mục 12 — TOÀN `server/`, trừ `*.test.ts`/`__fixtures__`): quét AST (`typescript` API, như census W22) mọi điểm gọi nguyên thuỷ ra mạng — `fetch(`, `http.request`/`http.get`, `https.request`/`https.get`, `undici` (`request`/`fetch`/`Agent`/`Pool`), `axios`, `net.connect`/`net.createConnection`, `tls.connect`, `new WebSocket(` — mỗi điểm phải thuộc MỘT trong: (a) hàm có gọi `chanHostAiNgoai(`; (b) bên trong `server/services/ai/ngoai/mangNgoai.ts` (chính cổng); (c) `MIEN_TRU` với lý do một dòng (đích cố định nội bộ: llama-server `127.0.0.1:8091`, Postgres, PLC/OT driver, SMTP nội bộ…) — số điểm và số miễn trừ GHIM; điểm mới không thuộc nhóm nào ⇒ đỏ. `KB_FETCH` (`server/services/ai/knowledge*`): đặt sau `chanHostAiNgoai` nếu URL do người dùng cấp; nếu chỉ đọc nguồn cố định cấu hình bởi admin ⇒ `MIEN_TRU` có lý do — quyết lúc cài sau khi đọc mã, ghi vào báo cáo. `chi-http-mcp-co-url`: duyệt registry node — chỉ `tich-hop.http-*` và `tich-hop.mcp` được có tham số tên khớp `/^(url|endpoint|baseUrl|host|uri|dich)$/i`; node khác có ⇒ đỏ.
- [ ] **Step 2–4:** FAIL → cài → PASS. **Step 5: Commit** `feat(ai-ngoai): B4 chan duong vong - danh sach host AI (gom aggregator) + host tuong thich + so IP ghim, ap luc luu va luc goi, MCP luc nap va luc goi, census diem goi ra ngoai`.

### Task 11: Lưới trọn + bàn giao

- [ ] `npx vitest run server/services/ai server/services/flow server/routers server/routes ensus` xanh (kể cả khi :8091 đầy — không lưới nào chạm mạng thật).
- [ ] Gửi dieu-phoi + kiem-dinh: tip, danh sách mã lỗi `MaLoiNgoai`, `vectorChe.ts` (cho đột biến của kiem-dinh), thủ tục `aiNgoai.*` (cho 10.4 luong-ui) + GHI CHÚ BÀN GIAO 10.4 (rà mục 13): khi người dùng chọn model ngoài trong màn lập trình/extension, mặc định BỎ tool ghi/chạy (`ghi_tep`, `chay_lenh`, `ap_diff`…) khỏi tập cấp — chỉ đọc + tra tài liệu, bật lại phải là hành động tường minh; việc vận hành §8 spec (tạo khoá ở màn quản trị, bật cờ + nhà máy, quyết "dữ liệu vận hành", đặt trần).
