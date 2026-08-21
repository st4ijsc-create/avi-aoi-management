# Doc 52 — P0 Runbook: Siết danh tính máy (rotation khoá `mk_`) + Checklist go-live

> **TRẠNG THÁI: HƯỚNG DẪN CHO OWNER/OPS — CHƯA AI CHẠY CÁC BƯỚC NÀY.**
> Code + cờ + tooling đã sẵn trong repo (batch P0, doc 51 §7). Đây là phần P0 mà
> **code không tự làm được**: cần ra máy nạp khoá, phối hợp vendor, chọn thời điểm
> (giữa 2 ca), và xác nhận bằng mắt người.
>
> Quyết định đã chốt (doc 51 §8):
> **QĐ#1 — siết auth máy theo MIGRATION CÓ KIỂM SOÁT. KHÔNG flip tắt đột ngột.**
> **QĐ#6 — `INSPECTION_STORE_FORWARD_ENABLED=true` là BẮT BUỘC khi go-live.**
>
> Tham chiếu: doc 51 §4 (R1/R3/R7) · doc 51 §5.1/§5.6 · doc 45 (runbook W0 —
> cùng quy ước Mục đích → Lệnh → Verify → Rollback) · `.env.example` (mô tả cờ đầy đủ).

**Quy ước chung:**
- DB thật hiện tại: `postgresql://aoi:<mật-khẩu>@127.0.0.1:5434/aoi_management`
  (dòng `DATABASE_URL` đầu tiên không-comment trong `.env`).
- Mỗi mục: **Mục đích → Lệnh → Verify → Rollback**. Làm theo THỨ TỰ §3 a → f.
- **Nguyên tắc bao trùm:** *không bao giờ siết cờ khi chưa có bằng chứng máy nào
  còn bám đường yếu.* Bằng chứng, không phải niềm tin. Cả §3 là để dựng bằng chứng đó.

---

## 1. Bối cảnh — vì sao phải siết

Doc 51 xác minh **trên đĩa** (không tin mù kết quả agent) rằng danh tính máy đang thủng
ở 3 chỗ, cộng lại thành rủi ro **R1 — giả mạo máy tầm thường**:

| # | Lỗ | Bằng chứng | Hệ quả thực tế ở nhà máy |
|:--:|---|---|---|
| 1 | `machineApi.config` là **publicProcedure**, chỉ cần `serialNumber` là **trả `machine.apiKey` PLAINTEXT** | `hierarchyRouters.ts:706-722` ✔ | Serial in trên vỏ máy. Ai đọc được vỏ ⇒ có credential. |
| 2 | Đường **machineCode-only**: xác thực **không có bí mật nào cả** | `machineAuthService.ts:237-248` ✔ | Biết mã máy = **là** máy đó. Bỏ qua cả scope. |
| 3 | Khoá **shared plaintext** lưu at-rest, **mặc định BẬT**, bỏ qua scope | `machineAuthService.ts:53-55,219-231` ✔ | 1 khoá rò = cả dòng máy bị giả mạo. |

**Kẻ tấn công cần gì:** đứng trong LAN nhà máy + biết 1 mã máy. **Làm được gì:** bơm
inspection/NG giả → yield/OEE sai → dừng chuyền oan, hoặc **giấu hàng lỗi** cho qua.

**Vì sao KHÔNG flip tắt ngay (QĐ#1).** Tắt đột ngột = mọi máy chưa rotate nhận 401
giữa ca = **dừng sản xuất**. Rủi ro chữa bệnh lớn hơn bệnh. Nên P0 xây **cơ chế siết
có kiểm soát**, còn *thời điểm* siết do người quyết định — sau khi báo cáo + telemetry
chứng minh an toàn.

---

## 2. Cái gì đã thay đổi trong code (P0 batch này)

1. **Cờ 3 nấc** thay cho bật/tắt nhị phân: `allow` → `read-only` → `deny`
   (`server/services/machineAuthService.ts`). Nấc `read-only` là điểm mấu chốt: nó
   **chặn ngay đường GHI** (ingest giả — rủi ro thật) trong khi **giữ đường ĐỌC**
   (máy chưa rotate vẫn poll được cấu hình), nên lỗi hiện ra dạng 401-ghi **dễ chẩn
   đoán** thay vì máy mất tích.
   → Giá trị cũ `false` **giữ nguyên nghĩa cũ = `deny`**. Deployment nào đang đặt
   `MACHINE_SHARED_KEY_ALLOWED=false` **không hề bị nới lỏng** sau khi nâng cấp.
2. **Telemetry warn-then-deny**: MỖI lần dùng đường yếu (kể cả bị **TỪ CHỐI**) đều
   ghi `machineId + method + endpoint + outcome` vào bộ đếm trong tiến trình
   (`getWeakAuthUsage()`, **chính xác, không throttle**) + phát metric Prometheus
   `avi_aoi_security_events_total{type="machine_weak_auth_allowed|denied"}`.
   Dòng log người-đọc vẫn throttle 10 phút/máy để không ngập log.
   → *Trước đây chỉ có `console.warn` throttle: throttle **VỨT BỎ** bằng chứng và
   một dòng warn thì **không truy vấn được**. Không có bộ đếm này thì "migration có
   kiểm soát" chỉ là khẩu hiệu.*
3. **Báo cáo rotation**: `scripts/machine-key-rotation-report.mjs` — nhìn xuyên cả
   đội máy, **sống sót qua restart** (đọc DB), trả lời "máy nào phải rotate trước
   khi flip".
4. **Thông báo 401 chẩn đoán được**: khi bị chặn, lỗi **gọi tên máy** + chỉ đúng cách
   sửa (nạp khoá `mk_` qua header) thay vì "Invalid API key" chung chung.

---

## 3. Quy trình rotation — từng bước

### a. Chạy báo cáo: ai còn bám đường yếu?

**Mục đích.** Dựng danh sách máy phải xử lý. **Không làm bước này = bay mù.**

**Lệnh.**
```bash
node scripts/machine-key-rotation-report.mjs
# tuỳ chọn:
node scripts/machine-key-rotation-report.mjs --all              # xem cả máy OK/IDLE
node scripts/machine-key-rotation-report.mjs --active-days=14   # nới cửa sổ "còn chạy"
node scripts/machine-key-rotation-report.mjs --json > rotation.json
```

**Đọc kết quả.**

| Verdict | Nghĩa | Việc phải làm |
|---|---|---|
| `BLOCKING` | Máy **đang chạy** + còn đường yếu ⇒ flip cờ = **chết máy** | Rotate NGAY (bước b) |
| `WARN` | Nghi ngờ / cần dọn (vd máy đã retired **vẫn còn credential** — doc 51 §5.1) | Dọn, không chặn flip |
| `OK` | Đã **chứng minh** dùng `mk_` | — |
| `IDLE` | Không traffic trong cửa sổ ⇒ flip không ảnh hưởng NGAY | Xác minh máy còn dùng không |

**Exit code:** `0` = không máy BLOCKING (an toàn flip) · `1` = còn phải rotate · `2` = lỗi.

⚠️ **Báo cáo này là SUY LUẬN, không phải nhật ký.** DB không lưu "phương thức auth"
(bảng mới = migration = ngoài phạm vi P0). Script suy ra từ: `api_keys.lastUsedAt` chỉ
bump khi dùng khoá `mk_`, còn `machines.lastHeartbeat` bump ở **mọi** đường ⇒ *heartbeat
mới hơn lastUsedAt quá dung sai = traffic đó không đi bằng `mk_`*. Giới hạn: throttle
60s + lệch đồng hồ (bù bằng `--tolerance-min`, mặc định 5); không phân biệt được
shared-key vs machineCode-only. **Muốn chính xác 100% theo từng đường + từng endpoint:
dùng telemetry LIVE ở bước d — hai nguồn này bổ sung cho nhau, đừng bỏ nguồn nào.**

**Rollback.** Chỉ đọc, không đổi gì.

---

### b. Cấp khoá `mk_` cho từng máy

**Mục đích.** Mỗi máy một credential riêng, **băm SHA-256 at-rest**, có scope
least-privilege, revoke được **độc lập** (khoá shared rò = phải đổi cả dòng máy).

**Lệnh.** Qua UI (wizard onboarding AOI) hoặc tRPC `machineApi.issueKey`:
```jsonc
// machineApi.issueKey — CHỈ admin
{ "machineId": 42, "name": "AOI-L1-01 primary" }
// scopes mặc định: ["ingest:write","equipment:read","edge:sync"]
// → trả về { plaintextKey: "mk_<48 hex>", ... }  ⚠️ HIỆN ĐÚNG MỘT LẦN, không lưu lại được
```
- **Chép ngay** plaintext vào cấu hình máy. Mất = `rotateKey` cấp lại (không "xem lại" được).
- Máy chỉ ĐỌC cấu hình (không ingest)? Cấp hẹp hơn: `{"scopes":["equipment:read"]}`.
- Khuyến nghị đặt `expiresAt` (doc 51 §5.6 P3: khoá vĩnh viễn là nợ kỹ thuật).

**Verify.** `machineApi.listKeys({machineId})` → thấy `keyPrefix` + `isActive:true`.
Bảng `api_keys` **chỉ chứa hash** — plaintext không nằm ở đâu trong DB.

**Rollback.** `machineApi.revokeKey({keyId})` — khoá chết tức thì.

---

### c. Cấu hình máy: gửi khoá qua **HEADER**, không nhét body

**Mục đích.** Đây là bước **vendor/firmware phải làm** — và là bước hay bị bỏ sót
nhất, vì **mọi tài liệu API cũ đều dạy nhét key vào body** (doc 51 §9.3 mục 2).
Header còn sửa luôn 2 lỗi khác: key trong body **rò vào log**, và rate-limit `/api`
fallback theo IP ⇒ 100 máy sau 1 NAT chung 1 bucket 300/phút (doc 51 R6).

**Lệnh (phía máy).** Một trong hai header — server nhận cả hai:
```http
POST /api/trpc/machineApi.submitInspection
Authorization: Bearer mk_3f9c...                # ưu tiên
# hoặc:
X-API-Key: mk_3f9c...
```
```csharp
// C# client:
http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", mkKey);
```
```python
# Python client:
session.headers["X-API-Key"] = mk_key
```
Bỏ `apiKey` / `machineCode` khỏi body. Thứ tự ưu tiên server đọc:
`headerKey` → `apiKey` (body) → `machineCode`.

**Verify (từng máy, ngay sau khi nạp).**
```bash
# 1. Máy gửi 1 request thật → server phải nhận diện method="machine-key":
psql "$DATABASE_URL" -c "SELECT \"keyPrefix\", \"lastUsedAt\" FROM api_keys
                          WHERE \"machineId\"=42 AND \"isActive\"=true;"
# lastUsedAt phải MỚI (≤60s độ trễ do throttle ghi). Còn NULL = máy CHƯA dùng khoá.
# 2. Chạy lại báo cáo → máy đó chuyển sang OK:
node scripts/machine-key-rotation-report.mjs --all
```

**Rollback.** Chưa siết cờ ở bước này ⇒ máy vẫn chạy được bằng đường cũ. Cấu hình
sai là **an toàn** ở giai đoạn này — đó chính là lý do rotate TRƯỚC, flip SAU.

---

### d. Verify telemetry: **không còn ai** đi đường yếu

**Mục đích.** Cửa ải cuối trước khi siết. Báo cáo (a) là suy luận từ DB; telemetry
là **quan sát trực tiếp**. Phải sạch **cả hai**.

**Lệnh / Verify.**
```bash
# 1. Metric Prometheus (cần METRICS_ENABLED=true):
curl -s localhost:3000/metrics | grep machine_weak_auth
# KỲ VỌNG: không có dòng nào, HOẶC counter allowed ĐỨNG YÊN suốt ≥1 CA ĐẦY ĐỦ.
#   type="machine_weak_auth_allowed" còn tăng ⇒ CÒN máy đi đường yếu → QUAY LẠI (b).
#   type="machine_weak_auth_denied"  tăng     ⇒ đã có gì đó bị chặn → xem log ngay.

# 2. Log có cấu trúc (pino) — chỉ đúng máy + endpoint:
grep MachineAuth logs/*.log | tail -50
# → {"machineId":42,"machineCode":"AOI-L1-01","method":"shared-key",
#    "endpoint":"submitInspection","outcome":"allowed","doc":"51-P0"}
```
⚠️ **Quan sát đủ MỘT CA ĐẦY ĐỦ (≥8h), không phải 5 phút.** Máy chỉ chạy 1 model/ca,
hoặc chỉ sync điểm đo lúc đổi lot, sẽ **không lộ diện** trong cửa sổ ngắn. Bộ đếm
reset khi restart server — mốc quan sát tính từ lần boot gần nhất.

**Rollback.** Chỉ đọc.

---

### e. FLIP cờ ở production (2 chặng — **đây là bước có rủi ro**)

**Mục đích.** Đóng lỗ R1 thật sự.

**Điều kiện tiên quyết — đủ CẢ 4, không thiếu cái nào:**
- [ ] `machine-key-rotation-report.mjs` exit code **0** (không máy BLOCKING).
- [ ] `machine_weak_auth_allowed` **đứng yên ≥1 ca đầy đủ**.
- [ ] Chọn **giữa 2 ca / giờ thấp điểm**, có người trực + **liên lạc được vendor**.
- [ ] `INSPECTION_STORE_FORWARD_ENABLED=true` (§6) — máy 401 thì WAL **không cứu**
      được (401 là lỗi vĩnh viễn, không phải transient), nhưng nếu phải lùi/restart
      thì WAL giữ dữ liệu trong lúc app khởi động lại.

**Lệnh — chặng 1: `read-only` (khuyến nghị: chạy ≥1-2 ngày).**
```bash
# .env production:
MACHINE_SHARED_KEY_ALLOWED=read-only
MACHINE_CODE_ONLY_ALLOWED=read-only
# restart app
```
> Chặn **ngay** ingest giả mạo (rủi ro thật), nhưng máy sót vẫn poll được cấu hình
> và **kêu to** ở đường ghi thay vì chết câm. Đây là lưới an toàn của bạn — **đừng
> bỏ qua chặng này để nhảy thẳng sang `deny`.**

**Verify chặng 1.**
```bash
curl -s localhost:3000/metrics | grep machine_weak_auth_denied   # kỳ vọng: 0 / không tăng
grep '"outcome":"denied"' logs/*.log                              # kỳ vọng: rỗng
# Có denied ⇒ máy đó BỊ SÓT ở bước (a)/(d) → RA MÁY NẠP KHOÁ (log ghi rõ machineCode).
# Sản xuất: yield/sản lượng trên dashboard vẫn chạy bình thường (không hụt máy nào).
```

**Lệnh — chặng 2: `deny` (sau khi chặng 1 sạch).**
```bash
# .env production:
MACHINE_SHARED_KEY_ALLOWED=deny
MACHINE_CODE_ONLY_ALLOWED=deny
# restart app
```

**Verify chặng 2.**
```bash
# 1. Không máy nào bị chặn:
curl -s localhost:3000/metrics | grep machine_weak_auth   # kỳ vọng: không tăng
# 2. Smoke NGƯỢC — đường yếu PHẢI chết (chứng minh cờ đã ăn, không chỉ "trông có vẻ"):
curl -X POST localhost:3000/api/trpc/machineApi.checkPointsVersion \
     -H 'content-type: application/json' -d '{"machineCode":"AOI-L1-01"}'
#    → KỲ VỌNG 401 "machineCode-only authentication is disabled..."
#    Nếu vẫn 200 ⇒ cờ CHƯA ăn: sai chính tả giá trị (xem log ERROR "[MachineAuth]
#    ... không hợp lệ"), sai file .env, hoặc app chưa restart.
# 3. Đường đúng vẫn sống: 1 máy thật submit inspection → 200 + row vào product_inspections.
```

**Rollback → xem §4.**

---

### f. Dọn khoá shared plaintext (sau khi `deny` đã ổn định ≥1 tuần)

**Mục đích.** Còn `machines.apiKey` trong DB = còn credential plaintext at-rest chờ rò.

**Điều kiện tiên quyết (doc 56 Đ0-A / GAP-1 — kênh Socket.io).** Socket realtime
(`machine:sync_started` / `machine:confirm_mapping`) từng chỉ so plaintext
`machines.apiKey` — NULL cột này khi socket chưa nhận khoá `mk_` là **vỡ presence
máy đang chạy**. **CHỈ chạy bước f sau khi:** `SOCKET_MACHINE_AUTH_MODE=log` ghi
nhận **0 mismatch ≥1 tuần trên fleet thật** (xem `getSocketMachineAuthMismatches()`
/ log `[SocketMachineAuth]`) **VÀ** đã chuyển `SOCKET_MACHINE_AUTH_MODE=enforce` —
tức socket sync_started/confirm_mapping đã xác thực được bằng khoá `mk_`.

**Lệnh.**
```sql
-- Xem trước máy nào còn (báo cáo cột SHARED=yes):
SELECT id, code, "lifecycleStatus" FROM machines WHERE "apiKey" IS NOT NULL;
-- Dọn (SAU khi deny chạy ổn định — đây là điểm KHÔNG QUAY LẠI được):
UPDATE machines SET "apiKey" = NULL WHERE "apiKey" IS NOT NULL;
```

**Verify.** `node scripts/machine-key-rotation-report.mjs --all` → dòng
"còn machines.apiKey plaintext" biến mất. Sản xuất không đổi.

**Rollback.** ⚠️ **KHÔNG có** — key plaintext đã xoá là mất. Đó là mục đích. Chỉ làm
bước này khi `deny` đã chạy êm ≥1 tuần. Cần lùi? Cấp khoá `mk_` mới (bước b) —
**đừng bao giờ tái tạo khoá shared**.

---

## 4. Kế hoạch LÙI (rollback) — nếu máy chết

> **Ưu tiên số 1: cho sản xuất chạy lại. Điều tra sau.** Lùi cờ **không** làm mất dữ
> liệu và **không** đảo ngược việc rotate — khoá `mk_` đã cấp vẫn dùng tốt ở mọi nấc cờ.

| Triệu chứng | Nguyên nhân nhiều khả năng | Xử lý |
|---|---|---|
| **Vài máy** 401 sau flip | Sót ở bước (a)/(d) | Log ghi rõ `machineCode`. Cấp khoá cho đúng máy đó (bước b). Gấp quá thì lùi 1 nấc (`deny`→`read-only`; nếu vẫn chết thì →`allow`) + restart, rồi rotate tử tế. |
| **Toàn bộ** máy 401 ngay sau restart | Sai giá trị cờ / sai file `.env` / vendor push đồng loạt bản build cũ | Đặt cả 2 cờ về `allow` + restart ⇒ **về đúng hành vi trước P0**. Kiểm log ERROR `[MachineAuth] ... không hợp lệ`. |
| Máy 401 **ngắt quãng** | Máy có nhiều đường/luồng, mới sửa một phần | `read-only` (giữ đường đọc sống) + ép vendor sửa hết luồng ghi. |
| Cờ đặt rồi mà đường yếu **vẫn qua** | Giá trị sai chính tả → **tự quay về mặc định `allow`** (cố ý: typo không được phép làm chết chuyền) | Xem log ERROR `[MachineAuth]`, chỉ nhận `allow`/`read-only`/`deny` (hoặc `true`/`false`). |

**Lệnh lùi (một dòng, luôn an toàn):**
```bash
# .env production → khôi phục hành vi trước P0:
MACHINE_SHARED_KEY_ALLOWED=allow
MACHINE_CODE_ONLY_ALLOWED=allow
# restart app. Telemetry vẫn chạy (không mất khả năng quan sát) → dùng nó để
# tìm ĐÚNG máy còn sót, rồi thử lại §3.e.
```

---

## 5. Đánh đổi đã biết (nói thẳng)

1. **Thông báo 401 làm lộ "khoá này TỪNG hợp lệ"** cho người đang cầm khoá đó
   (oracle nhỏ). **Chấp nhận:** họ đã có khoá và không dùng được vào việc gì; đổi lại
   kỹ thuật viên vendor đọc *"máy AOI-L1-01: shared key đã bị tắt, dùng khoá mk_"*
   là sửa được ngay, thay vì đi săn nhầm một cái khoá không phải nguyên nhân. Khoá
   **không** hợp lệ vẫn nhận `"Invalid API key"` chung chung — không có oracle mới.
2. **Giá trị cờ sai chính tả → mặc định `allow`, không fail-closed.** Cố ý (QĐ#1:
   typo không được làm chết chuyền), và không bao giờ **nới** hơn mức để trống cờ.
   Bù lại bằng log ERROR **một lần** + smoke NGƯỢC ở §3.e (verify chặn thật). **Luôn
   verify cờ đã ăn — đừng tin là nó đã ăn.**
3. **Đường yếu bị chặn khi KHÔNG khai scope** (fail-closed) — kể cả ở `read-only`.
   Người gọi quên khai scope thì không được ngầm giữ quyền GHI.
4. **Bộ đếm telemetry sống trong RAM, mất khi restart.** Bù bằng báo cáo DB (bền qua
   restart) + metric Prometheus (aggregator giữ lịch sử). Nhật ký per-request bền
   trong DB = bảng mới = migration ⇒ để P2 (doc 51 §5.6 "audit đường máy chính").
5. **Đường yếu bị chặn thì WAL không cứu.** 401 là lỗi **vĩnh viễn**, không transient
   ⇒ store-forward (đúng thiết kế) **không** đệm. Nên rotate là bắt buộc, WAL không
   phải lưới an toàn cho việc này.

---

## 6. Checklist GO-LIVE

> Ký từng dòng. Dòng nào chưa ✓ = **chưa go-live**.

### 6.1 Danh tính máy (doc 51 R1 / QĐ#1)

> **Trạng thái ở MÔI TRƯỜNG DEV, đo ngày 2026-08-21.** Production vẫn phải ký lại
> từ đầu — mọi ô ✓ dưới đây chỉ nói về `.env` dev và CSDL dev.

- [x] `node scripts/machine-key-rotation-report.mjs` → exit **0**, BLOCKING = 0.
      *Đo 2026-08-21: "✓ AN TOÀN ĐỂ FLIP — không máy nào đang chạy còn bám đường yếu."*
- [~] Mọi máy đang chạy có khoá `mk_` **và đã dùng thật** (`lastUsedAt` mới).
      *41/41 máy đang dùng ĐÃ CÓ khoá (cấp 23 khoá còn thiếu ngày 2026-08-21).*
      ⚠ **Nửa sau CHƯA đạt:** không máy nào từng dùng khoá — nhịp tim cuối của cả đội
      là **2026-07-19, cách 33 ngày**, 0 bản ghi kiểm tra trong 7 ngày. Đội máy đang
      đứng, nên "đã dùng thật" không thể xác nhận cho tới khi chúng chạy lại.
- [x] Máy retired/decommissioned **không còn** credential.
      ⚠ *Ô này TỪNG ĐỎ vì chính đợt cấp khoá 2026-08-21: script không kiểm vòng đời nên
      cấp cả cho `SN-ST4I-TRIAL-WELD-20260818` (`retired`/`rejected`). Báo cáo trên tố
      ra, khoá đã bị revoke, và script nay BỎ QUA máy retired/decommissioned/rejected.*
- [x] `MACHINE_SHARED_KEY_ALLOWED=deny` + `MACHINE_CODE_ONLY_ALLOWED=deny` — **ở dev**.
      *`SHARED_KEY=false` vốn đã là `deny` từ trước; `CODE_ONLY` đặt ngày 2026-08-21.*
- [x] `MACHINE_CONFIG_EXPOSE_APIKEY=false` — mặc định OFF trong mã
      (`hierarchyRouters.ts:658` đòi `=== "true"`), và **không có trong `.env`** ⇒ tắt.
- [x] Smoke NGƯỢC — chạy live 2026-08-21 trên `:3000`, qua **tRPC
      `machineApi.submitInspection`**:
      · `machineCode` trần ⇒ **401** *"machineCode-only authentication is disabled for
        `ingest:write` on this server"* — tức CHÍNH SÁCH từ chối.
      · cùng thủ tục + `apiKey: mk_…` ⇒ **`{"success":true,"inspectionId":…}`**, ghi
        thật một bản ghi kiểm (đã xoá sau khi đo).

      ⚠ **LƯỢT SMOKE ĐẦU TIÊN CỦA TÔI ĐÚNG KẾT QUẢ NHƯNG SAI LÝ DO — đừng lặp lại.**
      Tôi gọi `POST /api/v1/ingest/inspection` với `machineCode` trong body và nhận
      401 *"Missing API key"*. Trông như bằng chứng, thật ra không phải: `/api/v1/**`
      có middleware ĐÒI header khoá, nên request bị chặn **trước khi** chạm
      `machineAuthService` — cờ `MACHINE_CODE_ONLY_ALLOWED` không hề được thi hành
      trong lượt đó. Bằng chứng: metric `machine_weak_auth_*` **không nhích một mẫu
      nào**. Đường yếu `machineCode`-only sống ở **tRPC `machineApiRouters`**; phải
      smoke ở đó.

- [~] `machine_weak_auth_denied` = 0 suốt ≥1 ca sau flip.
      ⚠ **ĐÍNH CHÍNH lời khai trước của tôi trong chính tài liệu này:** tôi từng ghi ô
      này *"KHÔNG THỂ ĐẠT vì telemetry chỉ nằm trong `Map` bộ nhớ"* — **SAI**. Cái
      `Map` (`machineAuthService.ts:348`) chỉ là sổ CHI TIẾT theo từng máy (dễ mất, có
      chủ ý). Bản thân ô checklist gọi đích danh **`machine_weak_auth_denied`**, và đó
      là một **counter Prometheus BỀN**:
      `avi_aoi_security_events_total{type="machine_weak_auth_denied", mode="machine-code"}`
      — đã đo live, nó nhích đúng khi đường yếu bị từ chối. `METRICS_ENABLED=true`,
      `GET /metrics` trả 200.
      ⇒ Ô này **ký được**, chỉ còn thiếu phần "suốt ≥1 ca": cần một ca có lưu lượng
      thật. Đội máy đang đứng (nhịp tim cuối cách 33 ngày) nên chưa quan sát được.

      ⚠ Bẫy khi đọc số: cầu nối metric nạp **lười** (`import()` động, xem
      `emitWeakAuthMetric`). Lượt weak-auth ĐẦU TIÊN sau mỗi lần restart **không được
      đếm** — đo live thấy 2 lượt bị từ chối mà counter chỉ lên 1. Sổ `Map` trong bộ
      nhớ mới là con số CHÍNH XÁC; metric là con số BỀN. Đọc cả hai, đừng đọc một.
- [ ] `machines.apiKey` đã dọn (§3.f) — **17 máy còn plaintext**, chờ flip ổn định ≥1 tuần.

### 6.2 Bền dữ liệu — **QĐ#6 BẮT BUỘC** (doc 51 R7)
- [ ] **`INSPECTION_STORE_FORWARD_ENABLED=true` trong `.env` production.**
      *Để `false` = mất dữ liệu kiểm khi DB sập. Không thương lượng.*
- [ ] Đã chỉnh bound theo dung lượng đĩa thật (payload **có ảnh base64** — nặng):
      `INSPECTION_STORE_FORWARD_MAX` · `_MAX_BYTES` (mặc định 512 MiB) · `_MAX_AGE_MS` (72h).
- [ ] Đĩa chứa WAL còn trống ≥ `_MAX_BYTES` × 2.
- [ ] **SMOKE-TEST REPLAY WAL — bắt buộc, làm trên staging/Full-Sim:**
  ```bash
  # 1. App đang chạy, ingest bình thường. Hạ DB:
  docker compose stop postgres        # (hoặc dừng service PG)
  # 2. Máy (hoặc curl) gửi 1 inspection → KỲ VỌNG 200 + {success:true, queued:true, submissionId:"..."}
  #    ⚠️ Nhận 500/401 ⇒ cờ CHƯA bật hoặc creds sai — DỪNG, sửa trước khi go-live.
  # 3. Xác nhận đã đệm xuống đĩa:
  wc -l ./data/inspection-store-forward.jsonl        # ≥1 dòng
  curl -s localhost:3000/api/observability/health    # thấy depth store-forward > 0
  # 4. Dựng DB lại:
  docker compose start postgres
  # 5. Trong ~15-30s (INTERVAL_MS + backoff) worker replay → KỲ VỌNG:
  #    - depth về 0
  #    - ĐÚNG 1 row trong product_inspections (KHÔNG trùng)
  #    - .dead.jsonl KHÔNG có entry mới
  psql "$DATABASE_URL" -c "SELECT count(*) FROM product_inspections
                            WHERE \"serialNumber\"='<serial-smoke-test>';"   -- = 1
  # 6. Test idempotency (kịch bản mạng chập chờn — doc 51 R2/CASE#1):
  #    máy retry ĐÚNG payload đó sau khi DB khoẻ → vẫn = 1 row.
  ```
- [ ] Test replay đã chạy **sau lần deploy cuối** (không phải "hồi tháng trước rồi").

### 6.3 Liên quan (chủ sở hữu khác — xem doc 51 §7 P0)
- [ ] MQTT topic ACL: `MQTT_TOPIC_ACL_ENABLED=true`, đã chạy `MQTT_TOPIC_ACL_WARN_ONLY=true`
      tới khi log sạch, rồi mới `false` để cưỡng chế (R3).
- [ ] Idempotency LIVE: unique index trên `product_inspections` đã áp (R2).
- [ ] `serialNumber` đã siết `min(1)` (CASE #8).
- [ ] Retire máy → tự revoke khoá (doc 51 §5.1).

---

## 7. Bảng cờ — mặc định dev vs production

| Cờ | Giá trị hợp lệ | **Dev** | **Production** | Ghi chú |
|---|---|:--:|:--:|---|
| `MACHINE_SHARED_KEY_ALLOWED` | `allow` \| `read-only` \| `deny` (nhận `true`/`false` kiểu cũ) | `false`(=deny) *(ship)* | **`deny`** | ⚠️ **Mặc định TRONG CODE khi bỏ trống = `allow`** (tương thích ngược); nhưng `.env.example` **ship sẵn `false`** (W0.4/doc35) ⇒ cài mới an toàn ngay. Hệ đang chạy máy chưa rotate thì tự đặt `allow` rồi đi hết §3. `false` = `deny` (nghĩa cũ **giữ nguyên** — không hệ nào bị nới lỏng khi nâng cấp). |
| `MACHINE_CODE_ONLY_ALLOWED` | như trên | `allow` *(để trống)* | **`deny`** | Đường **không có bí mật**. Để trống = `allow` — cố ý: tắt thẳng là chết máy đang chạy + demo/Full-Sim. |
| `MACHINE_CONFIG_EXPOSE_APIKEY` | `true` \| `false` | `false` | **`false`** | R1: endpoint public trả apiKey plaintext. `true` chỉ dùng tạm trong cửa sổ migration. |
| `INSPECTION_STORE_FORWARD_ENABLED` | `true` \| `false` | `false` | **`true`** | **QĐ#6 — BẮT BUỘC go-live.** Bỏ trống → theo `OT_STORE_FORWARD_ENABLED`. |
| `MQTT_TOPIC_ACL_ENABLED` | `true` \| `false` | `true` | **`true`** | R3: hiện **không có ACL nào**. |
| `MQTT_TOPIC_ACL_WARN_ONLY` | `true` \| `false` | `true` | **`false`** | Warn-only ≥1 tuần → log sạch → `false` (cưỡng chế thật). |
| `MACHINE_INGEST_RATE_LIMIT_PER_MIN` | số (0 = tắt) | `600` | `600` | Per-key khi dùng `mk_`; per-machine ở đường yếu. |
| `METRICS_ENABLED` | `true` \| `false` | `true` | **`true`** | Không có nó thì **mất metric weak-auth** ⇒ không verify được §3.d. |

**Ma trận nấc siết** (cùng bộ giá trị cho cả 2 cờ auth máy):

| Nấc | Ingest GHI (`ingest:write`, `edge:sync`, không khai scope) | ĐỌC (`equipment:read`) | Dùng khi |
|---|:--:|:--:|---|
| `allow` | ✅ + telemetry | ✅ + telemetry | Trước/đang rotate (mặc định) |
| `read-only` | ❌ 401 + telemetry | ✅ + telemetry | **Chặng 1** — chặn ingest giả, giữ đường đọc |
| `deny` | ❌ 401 + telemetry | ❌ 401 + telemetry | **Chặng 2** — rotation xong (đích) |

---

## 8. Tham chiếu nhanh

| Cần gì | Ở đâu |
|---|---|
| Máy nào phải rotate? | `node scripts/machine-key-rotation-report.mjs` |
| Ai đang đi đường yếu ngay lúc này? | `curl -s :3000/metrics \| grep machine_weak_auth` · `getWeakAuthUsage()` |
| Cấp / xoay / thu hồi khoá | tRPC `machineApi.issueKey` / `rotateKey` / `revokeKey` |
| Logic auth + cờ | `server/services/machineAuthService.ts` |
| Mô tả cờ đầy đủ | `.env.example` (mục "machine credentials" + "store-and-forward") |
| Bối cảnh audit + bằng chứng | `docs/ECOSYSTEM/51_AVI_AOI_MACHINE_API_AUDIT_AND_UPGRADE_PLAN_2026-07-13.md` |
| Runbook hạ tầng W0 (cùng quy ước) | `docs/ECOSYSTEM/45_W0_OWNER_RUNBOOK_2026-07-12.md` |
