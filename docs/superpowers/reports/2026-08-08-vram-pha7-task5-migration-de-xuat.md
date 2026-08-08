# Pha 7 · Task 5 — HAI MỤC CẦN DDL: **ĐỀ XUẤT MIGRATION** (soạn, chưa áp)

> **Trạng thái (cập nhật 2026-08-08, sau khi chủ dự án DUYỆT):** ✅ **BƯỚC 1–9 XONG.**
> Migration `0313` **ĐÃ ÁP** bằng owner `aoi` lên **cả hai** DB. Xem §5–§8 ở cuối báo cáo.
> ⚠⚠ §2.3(i) bên dưới có **MỘT CÂU SAI**, đã đính chính ở §6.1 — giữ nguyên văn bản gốc để
> lượt sau đọc được cả chẩn đoán lẫn phép bác bỏ.
> 
> ~~**Trạng thái:** ⏸ **DỪNG SAU BƯỚC 3 theo brief.** Bước 1–3 xong. Bước 4–9 **CHƯA LÀM** và
> **KHÔNG ĐƯỢC LÀM** trước khi chủ dự án duyệt **nội dung** migration dưới đây.
> **KHÔNG một câu DDL nào đã chạy** trong lượt này — kể cả trên `aoi_management_test`.~~

- **Nhánh:** `feat/hmi-dep` · **HEAD lúc bắt đầu:** `6c677a46`
- **Kế hoạch:** `docs/superpowers/plans/2026-08-07-vram-pha7-backlog.md` §"Task 5: HAI MỤC CẦN DDL"
- **Ngày:** 2026-08-08

---

## 0 · Hai mục, một câu

| | Mục | Câu bất biến bị vỡ | Vì sao cần DDL |
|---|---|---|---|
| **A** | Sổ mã OTP đã tiêu nằm **trong bộ nhớ** (`server/_core/totpOnce.ts`) | *"∀ lượt xác minh TOTP: một mã tiêu được **đúng một lần**"* (RFC 6238 §5.2) | Trạng thái phải **sống lâu hơn tiến trình** và **dùng chung giữa tiến trình** ⇒ bảng mới |
| **B** | Cờ *"đã cắt danh tính"* chỉ sống **trong bộ nhớ người ghi** (`vramSharedLedger.hangDaCat`) | *"∀ người đọc một hàng đã bị cắt: người ấy **biết** hàng đó mất chữ"* | Cờ phải đi **cùng dữ liệu** trong `vram_leases` ⇒ cột mới |

⚠ **B KHÔNG nới cột.** Đã đo và bác ở Pha 6 Task 5: `owner` dựng từ **đường dẫn tuyệt đối**
(`ocrService.ts:384` `onnx-ocr:${modelPath}` · `aiReranker.ts:503` `reranker:${modelPath}`), trần
đường dẫn Windows với `LongPathsEnabled=1` là **32.767** ⇒ *"không bề rộng nào đuổi kịp — nới cột
chỉ **DỜI CHỖ NÓI DỐI**"*. Đường đúng: **thêm cột cờ**.

---

## 1 · BƯỚC 1 — ĐO TRƯỚC: **HAI CA ĐỎ, TÁI LẬP ĐƯỢC**

Hai file dò tạm (`server/__tmp_pha7_task5_probeA.test.ts` · `…probeB.test.ts`) — **đã xoá sau khi đo**,
không commit. Kết quả: **4 ĐỎ / 2 XANH (đối chứng)**.

```
Test Files  2 failed (2)
     Tests  4 failed | 2 passed (6)
```

### 1.1 · Mục **A** — sổ OTP không sống qua restart, không dùng chung

| ca | phát biểu | kết quả | ý nghĩa |
|---|---|---|---|
| **A1** *(đối chứng XANH)* | trong **cùng** tiến trình, phát lại **bị chặn** | ✅ `{hopLe:false, phatLai:true}` | cơ chế Pha 6 **có chạy** — ca đỏ dưới đây không phải "mã hỏng" |
| **A2** ★★★ | mã đã tiêu, sau **restart**, phải **vẫn bị chặn** | ❌ `hopLe` = **`true`** | **LỖ**: `expected true to be false` |
| **A3** ★★★ | mã tiêu ở bản sao `ROLE=api` **A** phải bị chặn ở bản sao **B** | ❌ `hopLe` = **`true`** | **LỖ**: hai sổ riêng |

Chi tiết A2, đo được từng bước — **không suy đoán**:

```
tiến trình #1:  verifyTotpOnce(...) ⇒ hopLe = true        __soTotpSize() = 1
── RESTART (trạng thái module biến mất) ──
tiến trình #2:  __soTotpSize() = 0                        ← sổ RỖNG LẠI
                verifyTotpOnce(cùng mã, +30 s) ⇒ hopLe = true   ← ĐI QUA
```

`+30 s` vẫn nằm trong cửa sổ hợp lệ của `speakeasy` (`window: 1` ⇒ ~90 s), nên đây là một lượt
**phát lại thật**, không phải một mã đã hết hạn.

> ⚠ **Tiền đề brief KIỂM LẠI, VẪN ĐÚNG:** `.env` của hệ đang chạy **không đặt `ROLE`**
> (`grep -c "^ROLE=" .env` = **0**) ⇒ hôm nay **một** tiến trình ⇒ **lỗ A3 chưa mở**, lỗ **A2 đang mở**
> (mọi lượt restart/redeploy đều mở nó trong 120 s).

### 1.2 · Mục **B** — cờ cắt dừng ở biên tiến trình

| ca | phát biểu | kết quả |
|---|---|---|
| **B1** ★★★ | hàng A ghi bị cắt ⇒ **A biết**; **B đọc cùng hàng ấy** ⇒ hàng B cầm phải mang một ô cờ | ❌ `expected [] to not deeply equal []` |
| **B2** *(đối chứng XANH)* | **không** suy được "đã cắt" từ **độ dài** | ✅ đúng: cắt và không-cắt cho **cùng** độ dài 160 |
| **B3** ★★★ | mặt đọc của **B** phải khai `truncatedIdentityWrites > 0` | ❌ `expected 0 to be greater than 0` |

Chuỗi đo của **B1** — mọi bước TRƯỚC lời khẳng định cuối đều **XANH**, tức lỗ nằm **đúng chỗ nói**:

```
A (api:1001:boot-a) reserve(owner 345 ký tự) + syncSharedLedger()
   ⇒ sharedLedgerFact().truncatedIdentityWrites = 1        ← A BIẾT
   ⇒ hàng trên bảng: length(owner) = 160                   ← đã bị cắt thật
B (worker:2002:boot-b), sổ riêng, CÙNG bảng, syncSharedLedger()
   ⇒ B thấy hàng của A trong `foreignLeases`               ← đọc được
   ⇒ số ô của hàng khớp /cat|trunc|cut/i  =  []            ← ★ KHÔNG MỘT Ô NÀO
   ⇒ sharedLedgerFact().truncatedIdentityWrites = 0        ← B khai SẠCH cho một hàng CỤT
```

**B2 là ca then chốt của cả mục B**: nó chứng minh **không có đường vòng nào**. Một chuỗi dài **đúng
bằng** 160 **không** bị cắt; một chuỗi 161 bị cắt **thành** 160. Hai sự thật khác nhau, **một** độ
dài. ⇒ Người đọc **không thể** suy ra, buộc phải **được kể** ⇒ **buộc phải có cột**.

### 1.3 · Hai vật cản đã gỡ trên đường đo (ghi lại để lượt sau không mất giờ)

1. **`vi.resetModules()` của ca A đầu độc ca B.** `dungLaiTuSoCucBo()`
   (`vramSharedLedgerStore.ts:236`) nhập `./vramBroker` **MUỘN** (`await import`). Sau
   `vi.resetModules()`, lượt nhập muộn ấy nhận **một bản sao module MỚI, sổ RỖNG** ⇒ không ý định ghi
   nào được dựng ⇒ ca B đo nhầm thứ (`truncatedIdentityWrites = 0` vì **không có hàng nào**, chứ
   không phải vì lỗ). ⇒ **Hai mục phải nằm ở HAI FILE test.**
2. `reserve()` cần một **tick đã xuất bản** (`publishDecisionTick(__tickFieldsForTests(0,true), NOW)`),
   nếu không `headroomInputFromTick()` ném `Cannot read properties of undefined`.

### 1.4 · Quan sát phụ (không chặn, nhưng nên sửa lúc làm Bước 5)

`sharedLedgerIdentityCut.test.ts:342` đặt tên hằng là **`OWNER_365`** nhưng chuỗi thật dài **345**
(`9 + 22×14 + 28`). Con số **365** trong docstring là số đo **sản xuất** khác (`"reranker:"` + một
`modelPath` **356** ký tự). Cả hai đều **> 160** nên ca vẫn đúng, nhưng cái tên đang nói một con số
mà fixture không mang — đúng lớp *"một bản sao của một con số sẽ trôi khỏi bản gốc"*.

---

## 2 · BƯỚC 2 — ĐẾM BỀ MẶT

> ⚠ *"Đếm trước khi đổi một cơ chế dùng chung"* đã **lật quyết định BỐN lần**. Lượt này nó lật **một
> lần nữa** — xem §2.3.

### 2.1 · Bề mặt **A** — sổ OTP

**(a) `speakeasy.totp.verify` trong mã sản xuất — ĐẾM LẠI tại HEAD `6c677a46`: ĐÚNG 1.**

| file:dòng | ghi chú |
|---|---|
| `server/_core/totpOnce.ts:196` | **chủ duy nhất**, đúng như `totpReplayScan.test.ts` cưỡng chế |

Mọi lần xuất hiện khác trong `server/**` là **văn bản docstring** (`context.ts:26` · `trpc.ts:323/462/601`
· `vramRouter.ts:135`), không phải lời gọi. ⇒ Bất biến *"một chủ, không hai"* của Pha 6 **còn nguyên**.

**(b) Điểm gọi `verifyTotpOnce` — Task 6 khai 8 điểm / 4 file. ĐẾM LẠI: KHỚP.**

| # | file:dòng | thủ tục | hậu quả nếu mã phát lại lọt |
|---|---|---|---|
| 1 | `server/_core/trpc.ts:347` | step-up cho **7** `deployProcedure` | chạy một lệnh triển khai / VRAM phá huỷ |
| 2 | `server/_core/oauth.ts:408` | 2FA lúc **đăng nhập** | **chiếm phiên** |
| 3 | `server/routers/twoFactorRouter.ts:149` | `enable` | |
| 4 | `server/routers/twoFactorRouter.ts:225` | `disable` | **tắt luôn 2FA** |
| 5 | `server/routers/twoFactorRouter.ts:312` | `verify` | |
| 6 | `server/routers/twoFactorRouter.ts:384` | `regenerateBackupCodes` | **đẻ 10 mã dự phòng** |
| 7 | `server/routers/userRouters.ts:266` | `verify2FA` (≡ #3) | |
| 8 | `server/routers/userRouters.ts:314` | `disable2FA` (≡ #4) | **tắt luôn 2FA** |

**8 điểm / 4 file — khớp đúng phép đếm Task 6.** ✅

**(c) ĐỌC/GHI chính cuốn sổ (`Map` `so`) — TOÀN BỘ nằm trong MỘT file.**

| thao tác | dòng | vai |
|---|---|---|
| `so.get(khoa)` | `totpOnce.ts:209` | ĐỌC — quyết định phát lại |
| `so.set(khoa, …)` | `totpOnce.ts:214` | GHI — tiêu mã |
| `so.delete(k)` (`donSo`) | `totpOnce.ts:161` | DỌN — mỗi lượt ghi |
| `so.size` (`__soTotpSize`) | `totpOnce.ts:225` | **chỉ test** |
| `so.clear()` (`__resetSoTotpChoTest`) | `totpOnce.ts:230` | **chỉ test** |

⇒ **5 điểm chạm, 1 file.** Đổi sổ sang DB **không** đụng 8 điểm gọi về mặt **ngữ nghĩa**.

**(d) Bề mặt TEST bị kéo theo** — cần biết trước để không bất ngờ ở Bước 5:

| file | dùng gì |
|---|---|
| `server/routers/totpReplay.test.ts` | `verifyTotpOnce` ×9 · `__soTotpSize` ×5 · `TOTP_HAN_SO_MS` ×2 |
| `server/routers/totpReplayScan.test.ts` | quét AST — khoá *"một chủ"* + *"bề mặt request"* |
| `server/routers/deployStepUpFreshness.test.ts` | `__resetSoTotpChoTest` |
| `server/routers/vramStepUpFreshness.test.ts` | `__resetSoTotpChoTest` ×2 |

### 2.2 · Bề mặt **B** — người đọc `owner` từ SỔ CHUNG

Đường đi của một `owner` **do TIẾN TRÌNH KHÁC ghi** (nên có thể đã bị cắt mà ta không biết):

```
vram_leases.owner  (DB)
  └─ vramSharedLedgerStore.selectAll()          :351  owner: r.owner
      └─ publishSharedLedgerReplica → dungBanSao :465  foreignLeases
          ├─(1) sharedLedgerFact().foreignHolders :320
          │      ├─(1a) vramBroker.ts:641          anhEmHo → kế hoạch từ chối/nhường chỗ
          │      └─(1b) vramReadModel.ts:1288      holders: …map(hoAnhEm) → :1266 owner: f.owner
          │             ├─ vramTools.ts:505        owner: C(h.owner)  → textSummary cho AGENT
          │             ├─ vramPhrases.ts:507      câu "Hộ …" ×3 ngôn ngữ
          │             └─ VramBrokerPanel.tsx:397 hiện cho NGƯỜI
          │                └─ :427  preempt.mutate({ owner: h.owner })   ★★★ LỆNH PHÁ HUỶ
          ├─(2) vramAdoption.ts:236                pidTuOwnerNhanNuoi(r.owner) → một số PID
          ├─(3) vramReconciler.ts:731/1441/1639    (đọc `processKey`, KHÔNG đọc `owner`)
          └─(4) vramRefusal.ts:325                 `${h.owner}@${key}` → câu từ chối
```

**⇒ 7 người đọc THẬT, 6 file** (không kể (3) vì nó không chạm `owner`):

| # | người đọc | file:dòng | hậu quả khi `owner` là một **danh tính CỤT** mà nó không biết |
|---|---|---|---|
| 1 | kế hoạch nhường chỗ | `vramBroker.ts:641` | chọn nạn nhân theo một cái tên không có thật |
| 2 | mặt đọc (server) | `vramReadModel.ts:1266` | phát tên cụt như tên thật |
| 3 | **Agent** | `vramTools.ts:505` | LLM nhận tên cụt vào `textSummary` rồi **lấy ra dùng lại** |
| 4 | câu ba thứ tiếng | `vramPhrases.ts:507` | in tên cụt cho người |
| 5 | **mặt NGƯỜI** | `VramBrokerPanel.tsx:397` | hiện tên cụt, không dấu hiệu |
| 6 | **★★★ LỆNH PHÁ HUỶ** | `VramBrokerPanel.tsx:427` | xem §2.3 |
| 7 | giải mã PID | `vramAdoption.ts:236` | xem §2.3 |
| 8 | câu từ chối | `vramRefusal.ts:325` | lý do từ chối mang tên cụt |

### 2.3 · ★★★ PHÉP ĐẾM LẬT MỘT KẾT LUẬN — hai đường mà mục B **KHÔNG** chỉ là "lời khai đẹp"

**(i) Danh tính cụt đi THẲNG vào lệnh phá huỷ.** `VramBrokerPanel.tsx:392` **GỘP** hai danh sách:

```tsx
{[...s.ledger.localHolders, ...(s.ledger.foreign.known ? s.ledger.foreign.holders : [])].map((h) => (
  …
  onClick={() => stepUp.guard((totpCode) => preempt.mutate({ owner: h.owner, totpCode }))}
```

Chú thích ngay trên dòng 396 viết *"⚠ owner KHÔNG cắt ngắn — danh tính đi thẳng vào lệnh"* — câu ấy
đúng cho hàng **CỤC BỘ**, và **SAI cho hàng ANH EM**: hàng anh em đã bị cắt **tại DB**, nên thứ đi vào
`vram.preempt` là một danh tính **đã mất chữ**, và **không người nào — vận hành viên hay Agent —
phân biệt được**. Đây chính là hợp đồng hai đầu mà `vramColumnLimits.ts` dựng ra để đóng, còn **hở
đúng ở đầu thứ ba: hàng do NGƯỜI KHÁC ghi.**

**(ii) `owner` là một chuỗi CÓ CẤU TRÚC MÁY ĐỌC, và một nhánh của nó dịch ra PID để GIẾT.**

```ts
// vramAdoption.ts:122
export function pidTuOwnerNhanNuoi(owner: string): number | null {
  const m = /#nhan-nuoi-pid=(\d+)$/.exec(String(owner));
```
```ts
// vramPreempt.ts:116-123  ("orphan-pid")
const pid = pidTuOwnerNhanNuoi(step.owner);
if (pid === null) return false;              // ← trung thực khi KHÔNG khớp
return await thuHoiHoNhanNuoi(pid);          // ← GIẾT tiến trình pid
```

Một phép cắt rơi **giữa cụm chữ số** biến `…#nhan-nuoi-pid=12345` thành `…#nhan-nuoi-pid=123` —
regex vẫn khớp (neo `$` vẫn thoả), và nó trả **một PID KHÁC**. Đây đúng hình dạng Critical của Pha 3
(*"GIẾT NHẦM tiến trình rồi BÁO CÁO THÀNH CÔNG"*).

> ⚠ **KHAI RÕ RANH GIỚI CỦA LỜI KHẲNG ĐỊNH NÀY — tôi CHƯA dựng được lượt khai thác:** `owner` nhận
> nuôi hôm nay dài ~34 ký tự (`sidecar:vision#nhan-nuoi-pid=NNNNN`), tức **cách trần 160 rất xa**, và
> tôi **chưa đo** được một đường nào ghép nó với một tiền tố dài. ⇒ (ii) là một **rủi ro cấu trúc**
> (một chuỗi máy-đọc đi qua một phép cắt im lặng), **không** phải một lỗ đang mở. (i) thì **đang mở**.

### 2.4 · Trạng thái DB THẬT (đọc, không ghi — `information_schema` + `pg_column_size`)

| đại lượng | giá trị |
|---|---|
| máy chủ | **PostgreSQL 17.10**, `timezone = Etc/UTC` |
| DB · vai đang nối | `aoi_management` · **`avi_app`** (⇒ **không** chạy DDL được, đúng GOTCHA) |
| `vram_leases` | **tồn tại**, **2 hàng**, `max(length(owner))` = **19**, 3 chỉ mục (`pkey` · `process_idx` · `updated_idx`) |
| `vram_events` | **4.582 hàng**, `max(length(owner))` = **54** |
| bề rộng cột | khớp **chính xác** `VRAM_LEASE_COLUMN_MAX` (200·96·32·64·160·32·16·32) |
| `users.id` | **`integer`** |
| bảng `public` | 395 · extension: `timescaledb`, `vector`, `pg_stat_statements`, `plpgsql` |
| migration mới nhất | `drizzle/0312_vram_leases.sql` ⇒ số kế tiếp **0313** |
| bộ chạy migration | `npm run db:push` → `scripts/migrate-standalone.mjs`, theo dõi bằng bảng `__applied_migrations`, **mỗi file chạy một lần** |

---

## 3 · BƯỚC 3 — **SQL ĐỀ XUẤT** (soạn, CHƯA CHẠY)

**MỘT** migration cho **cả A và B**: hai mục cùng một lượt duyệt, cùng một lượt áp, cùng một lượt
hoàn tác — tách ra là đẻ một trạng thái trung gian mà không ai canh.

### 3.1 · Nguyên văn — `drizzle/0313_totp_consumed_and_identity_truncated.sql`

```sql
-- ============================================================================
-- Migration 0313: (A) totp_consumed — sổ mã OTP đã tiêu, XUYÊN TIẾN TRÌNH
--                 (B) vram_leases."identityTruncated" — cờ cắt danh tính ĐI CÙNG DỮ LIỆU
-- (Pha 7 Task 5, docs/superpowers/plans/2026-08-07-vram-pha7-backlog.md)
--
-- ══════════════════════════════════════════════════════════════════════════
-- (A) VÌ SAO: sổ mã đã tiêu của Pha 6 (`server/_core/totpOnce.ts`) nằm TRONG
--     BỘ NHỚ. Đo được (Pha 7 Bước 1): sau một lượt restart, `__soTotpSize()`
--     về 0 và CÙNG một mã verify lại được `hopLe = true` trong khi nó vẫn
--     trong cửa sổ ~90 s của `speakeasy` ⇒ RFC 6238 §5.2 bị vi phạm ở MỌI lượt
--     redeploy. Và hai bản sao `ROLE=api` sẽ có HAI cuốn sổ.
--     ⇒ Sổ phải sống ở chỗ DUY NHẤT mà mọi tiến trình cùng thấy: DB.
--
-- ⚠ `tokenHash`, KHÔNG phải mã 6 số nguyên văn. Hai lý do, không phải khẩu vị:
--     1. bề rộng CỐ ĐỊNH THEO CẤU TẠO (sha-256 = 32 B) ⇒ `22001` là điều
--        KHÔNG THỂ, chứ không phải "đã chọn đủ rộng" (bài học 0311/`owner`);
--     2. không đưa một mã OTP CÒN HIỆU LỰC vào bảng và vào log truy vấn.
--     ⚠ Đây KHÔNG phải phép chống một kẻ đã đọc được DB (secret 2FA nằm ngay
--       `users.two_factor_secret` cùng DB). Nó chỉ bỏ plaintext ở nơi không
--       cần plaintext.
--
-- ⚠ KHOÁ CHÍNH GỒM `userId`: hai người dùng khác secret có thể tình cờ sinh
--   cùng 6 số, và chặn nhầm người thứ hai là một lỗi CÓ THẬT (chính docstring
--   của `totpOnce.ts` đã ghi).
--
-- ⚠ `luot` = DẤU CỦA LƯỢT GỌI. Nó có mặt vì MỘT lượt bấm nút chạy
--   `verifyTotpOnce` 2-3 LẦN (`_core/trpc.ts` khối I-4). Không có ô này, sổ
--   TỰ CHẶN MÌNH ở lượt verify thứ hai và giết 100 % lệnh VRAM/deploy.
--
-- ══════════════════════════════════════════════════════════════════════════
-- (B) VÌ SAO: `rowFromLease()` cắt NĂM ô danh tính và khai lượt cắt vào
--     `hangDaCat` — một `Set` TRONG BỘ NHỚ NGƯỜI GHI. Đo được (Bước 1): tiến
--     trình anh em đọc đúng hàng ấy thấy `owner` dài 160, KHÔNG một ô nào nói
--     nó đã mất chữ, và `truncatedIdentityWrites` của nó khai 0.
--     Và độ dài KHÔNG suy ra được: một chuỗi dài ĐÚNG BẰNG 160 thì KHÔNG bị
--     cắt, một chuỗi 161 bị cắt THÀNH 160 — hai sự thật, MỘT độ dài.
--
-- ⚠⚠ KHÔNG NỚI CỘT, và điều này đã được ĐO rồi BÁC ở Pha 6 Task 5: `owner`
--    dựng từ ĐƯỜNG DẪN TUYỆT ĐỐI (`ocrService.ts:384`, `aiReranker.ts:503`),
--    trần thật của nó là trần đường dẫn của HĐH (32.767 khi
--    `LongPathsEnabled=1`). Không bề rộng `varchar` nào đuổi kịp ⇒ nới cột chỉ
--    DỜI CHỖ NÓI DỐI. Thứ đóng được lớp lỗi là NÓI RA lượt cắt.
--
-- ⚠⚠⚠ BA GIÁ TRỊ, KHÔNG PHẢI HAI — cùng kỷ luật `TrangThaiTienTrinh`
--    (`vramAdoption.ts:70`: "song" | "chet" | "khong-biet"):
--      • NULL           = KHÔNG BIẾT — người ghi hàng này chưa biết cột này
--                         (tiến trình cũ trong cửa sổ triển khai).
--                         NGƯỜI ĐỌC TUYỆT ĐỐI KHÔNG ĐƯỢC ĐỌC THÀNH "sạch".
--      • '[]'           = người ghi khai: KHÔNG cắt ô nào.
--      • '["owner", …]' = đúng những ô đã bị cắt (khoá của
--                         `VRAM_LEASE_COLUMN_MAX`, đã bị ∀-A cưỡng chế khớp
--                         drizzle ở `sharedLedgerIdentityCut.test.ts`).
--    Ép về `boolean` là bỏ mất vế "KHÔNG BIẾT" và mở lại đúng cửa fail-open mà
--    migration này sinh ra để đóng.
--
-- ⚠ `jsonb` chứ không `text[]`: `vram_events.detail->>'truncatedFields'` đã là
--   một MẢNG CHUỖI jsonb từ Pha 2A (`vramEventLog.ts:261`) — cùng một hình
--   dạng lời khai cho cả hai bảng VRAM. Và `text[]` kéo theo GOTCHA
--   `col = ANY(${jsArray})` ⇒ 500 `42809` (memory drizzle-any-array-antipattern).
--
-- ⚠ `vram_events` KHÔNG cần cột này: `sanitizeVramEvent()` đã ghi
--   `detail.truncatedFields` vào cột `detail` jsonb sẵn có.
--
-- ══════════════════════════════════════════════════════════════════════════
-- ADDITIVE + IDEMPOTENT. Run by owner `aoi` (DDL convention — KHÔNG chạy bằng
-- role `avi_app`, sẽ lỗi 42501; đã kiểm 2026-08-08: current_user = avi_app).
-- Áp lên CẢ DB chính (`aoi_management`) LẪN DB test (`aoi_management_test`).
-- ⚠⚠ THỨ TỰ BẮT BUỘC: MIGRATION TRƯỚC, MÃ SAU. Xem §3.6 của báo cáo.
-- ROLLBACK: xem §3.5 của báo cáo
--           docs/superpowers/reports/2026-08-08-vram-pha7-task5-migration-de-xuat.md
-- ============================================================================

-- ── (A) sổ mã OTP đã tiêu ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "totp_consumed" (
  -- `users.id` là `integer` (đã kiểm information_schema, 2026-08-08).
  -- ⚠ CỐ Ý KHÔNG có FOREIGN KEY tới `users`: một lượt xoá người dùng KHÔNG
  --   được phép làm hỏng đường xác minh, và hàng ở đây tự chết sau <=120 s.
  "userId"    integer     NOT NULL,
  -- sha-256(`${userId}:${token}`) — 32 byte, bề rộng CỐ ĐỊNH theo cấu tạo.
  "tokenHash" bytea       NOT NULL,
  -- Dấu của LƯỢT GỌI (`randomUUID()` = 36 ký tự). 64 cho một lượt đổi hình
  -- dạng dấu mà không phải migrate lần hai; KHÔNG dùng kiểu `uuid` vì
  -- `verifyTotpOnce` nhận `luot?: string` từ người gọi ⇒ một chuỗi không phải
  -- UUID sẽ thành `22P02` lúc chạy thay vì một lỗi kiểu lúc biên dịch.
  "luot"      varchar(64) NOT NULL,
  -- `nowMs + TOTP_HAN_SO_MS` (120 s). `timestamp` KHÔNG múi giờ — cùng khuôn
  -- `vram_leases.acquiredAt/updatedAt`; máy chủ chạy timezone = Etc/UTC.
  "expiresAt" timestamp   NOT NULL,
  CONSTRAINT "totp_consumed_pkey" PRIMARY KEY ("userId", "tokenHash")
);

-- Chỉ mục cho LƯỢT TỰ DỌN (`DELETE … WHERE "expiresAt" <= $1`).
-- ⚠ Hôm nay bảng chỉ có vài chục hàng nên bộ lập lịch sẽ seq-scan và chỉ mục
--   này KHÔNG được dùng. Nó vẫn phải có, vì "bảng nhỏ" là HỆ QUẢ của việc phép
--   tự dọn đang chạy đúng — và một lưới đứng trên hệ quả của một thứ khác là
--   đúng lớp lỗi "an toàn là HỆ QUẢ của một thứ khác đang hỏng" (đã sáu lần).
CREATE INDEX IF NOT EXISTS "totp_consumed_expires_idx"
  ON "totp_consumed" ("expiresAt");

-- ── (B) cờ cắt danh tính đi CÙNG DỮ LIỆU ───────────────────────────────────
-- NULL = KHÔNG BIẾT (xem khối trên). KHÔNG đặt DEFAULT: một DEFAULT '[]' sẽ
-- biến "người ghi chưa biết cột này" thành "người ghi khai không cắt gì" —
-- tức tự tay dựng lại đúng lời nói dối mà cột này sinh ra để diệt.
ALTER TABLE "vram_leases" ADD COLUMN IF NOT EXISTS "identityTruncated" jsonb;
```

### 3.2 · Câu lệnh mà MÃ sẽ chạy (không phải DDL — nêu ở đây vì nó biện minh cho chỉ mục và chi phí)

**Tiêu một mã — MỘT câu, MỘT vòng, NGUYÊN TỬ:**

```sql
INSERT INTO "totp_consumed" AS c ("userId", "tokenHash", "luot", "expiresAt")
VALUES ($1, $2, $3, $4)
ON CONFLICT ("userId", "tokenHash") DO UPDATE
   SET "luot"      = CASE WHEN c."expiresAt" <= $5 THEN EXCLUDED."luot"      ELSE c."luot"      END,
       "expiresAt" = CASE WHEN c."expiresAt" <= $5 THEN EXCLUDED."expiresAt" ELSE c."expiresAt" END
RETURNING "luot";
```

`$3` = `luot` của ta · `$4` = `now + TOTP_HAN_SO_MS` · `$5` = `now`.

Phán quyết là **một phép so duy nhất**, và nó **khớp một-một** với `totpOnce.ts:208-215`:

| `RETURNING "luot"` | nghĩa | tương ứng bản trong bộ nhớ |
|---|---|---|
| **=** `$3` | ta vừa **chèn mới**, hoặc vừa **thu lại** một mục quá hạn, hoặc đây là lượt verify thứ N của **cùng** lượt gọi | `so.set(...)` / `cu.luot === luot` ⇒ `{hopLe:true}` |
| **≠** `$3` | một **lượt gọi KHÁC** đang giữ mã và mục còn sống | `{hopLe:false, phatLai:true}` |

⚠ Vì sao **một** câu chứ không phải `SELECT` rồi `INSERT`: hai câu là một **TOCTOU** — đúng cửa mà
hai tiến trình `ROLE=api` đi lọt, tức đúng lỗ A3 mà migration này sinh ra để đóng. `ON CONFLICT DO
UPDATE` khoá hàng nên hai lượt đồng thời **xếp hàng**, kẻ thua đọc được `luot` của kẻ thắng.

### 3.3 · Bảng: cột/bảng mới → kiểu → **vì sao kiểu ấy** → **chỉ mục nào, vì sao**

| bảng.cột | kiểu | vì sao **kiểu ấy** | chỉ mục |
|---|---|---|---|
| `totp_consumed."userId"` | `integer NOT NULL` | khớp **đo được** `users.id` = `integer`. **KHÔNG** khoá ngoại: xoá người dùng không được làm hỏng đường xác minh, và hàng tự chết ≤120 s | thành phần **1** của PK |
| `totp_consumed."tokenHash"` | `bytea NOT NULL` | sha-256 ⇒ **32 B cố định theo CẤU TẠO** ⇒ `22001` là điều **không thể**, khác hẳn `varchar(N)` phải "chọn đủ rộng". Cộng: không để một OTP còn hiệu lực ở dạng đọc được | thành phần **2** của PK |
| `totp_consumed."luot"` | `varchar(64) NOT NULL` | `randomUUID()` = 36; 64 để đổi hình dạng dấu không phải migrate lần hai. **Không** dùng `uuid`: API nhận `luot?: string` ⇒ chuỗi lạ sẽ là `22P02` lúc chạy | — |
| `totp_consumed."expiresAt"` | `timestamp NOT NULL` | cùng khuôn `vram_leases.acquiredAt/updatedAt`; máy chủ `Etc/UTC`. Giá trị do **ứng dụng** cấp (giữ được đường tiêm `nowMs` mà bộ lưới đang dùng) | `totp_consumed_expires_idx` |
| — khoá chính | `PRIMARY KEY ("userId","tokenHash")` | vừa là **khoá ngữ nghĩa** vừa là thứ `ON CONFLICT` cần. Khoá thay thế `serial` sẽ đẻ thêm một sequence + một chỉ mục **để không ai dùng** | `totp_consumed_pkey` |
| `totp_consumed` — chỉ mục dọn | btree `("expiresAt")` | vị từ duy nhất của lượt tự dọn. Hôm nay planner sẽ **không dùng** (bảng vài chục hàng) — có nó để chi phí dọn **không phụ thuộc** vào việc "bảng vẫn còn nhỏ", thứ vốn chỉ là **hệ quả** của phép dọn đang chạy đúng | ↑ |
| `vram_leases."identityTruncated"` | `jsonb` **NULL được** | **BA** giá trị: `NULL` = KHÔNG BIẾT · `[]` = khai không cắt · `["owner",…]` = khai đúng ô nào. `boolean` mất vế "không biết"; `varchar` CSV là một **danh sách** (lớp lỗi N+1); `text[]` kéo theo GOTCHA `= ANY(${jsArray})` → `42809`. `jsonb` **lặp lại tiền lệ** `vram_events.detail.truncatedFields` | **KHÔNG** — xem dưới |

**Vì sao (B) KHÔNG có chỉ mục:** lượt đọc **duy nhất** của bảng này là
`vramSharedLedgerStore.selectAll()` — `db.select().from(vramLeases)`, **không vị từ**. Đo được: bảng
có **2 hàng**, và cận trên của nó là số giấy phép đang sống của mọi tiến trình (hàng chục). Một chỉ
mục ở đây trả chi phí ghi cho **không một lượt đọc nào**.

### 3.4 · Ước lượng chi phí

**(A) Thêm bao nhiêu lượt ghi DB mỗi lần xác minh OTP?**

| | hôm nay | sau migration | thêm |
|---|---|---|---|
| lượt verify **được chấp nhận** | 1 `SELECT users` | 1 `SELECT users` + **1 upsert-RETURNING** + **1 `DELETE` dọn** = **3** | **+2** |
| lượt verify **bị chặn (phát lại)** | 1 `SELECT users` | 1 `SELECT users` + **1 upsert-RETURNING** = **2** | **+1** — không dọn vì **không có hàng mới** |

Quy ra **một lượt bấm nút**:

| đường | số lượt verify | câu lệnh hôm nay | sau | thêm |
|---|---|---|---|---|
| VRAM/deploy, **cache-miss** | 3 (`_core/trpc.ts` khối I-4) | 3 | 9 | **+6** |
| VRAM/deploy, **cache-hit** | 2 | 2 | 6 | **+4** |
| đăng nhập 2FA · `twoFactor.*` · `user.*2FA` | 1 | 1 | 3 | **+2** |

⚠ Cả hai câu thêm đều là **một hàng, khoá chính** (upsert) và **một quét trên bảng vài chục hàng**
(dọn). Lệnh deploy/VRAM vốn đã chạy `nvidia-smi` và `process.kill` — `+6` câu nhỏ **không** là bậc
chi phí đáng cân nhắc; đường **đông nhất** là đăng nhập và nó chỉ **+2**.

**(B) Bao nhiêu byte mỗi hàng?** — đo bằng `pg_column_size` trên DB thật, **không ước lượng**:

| giá trị `identityTruncated` | byte thêm / hàng | khi nào |
|---|---|---|
| `NULL` | **0** | ⚠ đúng vì **cả 2 hàng hiện có đã có `reclaimer` NULL** ⇒ null-bitmap **đã** hiện diện, và `ceil(15/8) = ceil(14/8) = 2` byte ⇒ bitmap **không** to thêm. (Một hàng **không có ô NULL nào** thì bitmap phải sinh ra ⇒ **+8** byte do MAXALIGN) |
| `'[]'::jsonb` | **8** | trường hợp **thường xuyên nhất** sau khi vá (không cắt gì) |
| `'["owner"]'::jsonb` | **17** | một ô bị cắt |
| cả **năm** ô | **62** | trường hợp xấu nhất |

Nền so sánh, đo trên hàng thật: `vram_leases` hiện **176 B** và **168 B**/hàng ⇒ xấu nhất **+37 %**
trên một bảng **2 hàng** (tổng **106.496 B**, gồm cả 3 chỉ mục). ⇒ **Chi phí byte không phải một biến
số của quyết định này.**

### 3.5 · Lượt HOÀN TÁC

```sql
-- ============================================================================
-- ROLLBACK migration 0313. ⚠⚠ CHẠY SAU KHI ĐÃ HOÀN NGUYÊN MÃ, KHÔNG TRƯỚC.
-- Chạy bằng owner `aoi`. Áp lên CẢ `aoi_management` LẪN `aoi_management_test`.
-- ============================================================================

-- (B) — an toàn tuyệt đối: cột chưa từng có ai đọc để quyết định.
ALTER TABLE "vram_leases" DROP COLUMN IF EXISTS "identityTruncated";

-- (A) — ⚠ MẤT DỮ LIỆU CÓ CHỦ Ý: mọi mã đang bị giữ sẽ dùng lại được trong
--     phần còn lại của cửa sổ <=120 s. Đây đúng bằng trạng thái TRƯỚC
--     migration (sổ trong bộ nhớ), nên nó KHÔNG mở thêm một lỗ nào — nhưng
--     phải nói ra, không để nó là một tác dụng phụ im lặng.
DROP TABLE IF EXISTS "totp_consumed";

-- ⚠ Rồi xoá dấu vết trong bảng theo dõi của `scripts/migrate-standalone.mjs`,
--   nếu không `npm run db:push` sẽ coi migration là "đã chạy" và KHÔNG chạy
--   lại được. ⚠⚠ TÊN CỘT CHƯA KIỂM — đọc `information_schema` TRƯỚC KHI CHẠY,
--   đừng đoán:
--     SELECT column_name FROM information_schema.columns
--      WHERE table_name = '__applied_migrations';
-- DELETE FROM "__applied_migrations" WHERE <cột tên file> = '0313_totp_consumed_and_identity_truncated.sql';
```

### 3.6 · RỦI RO · và **GÃY GÌ NẾU ÁP NHẦM THỨ TỰ**

**THỨ TỰ ĐÚNG — DUY NHẤT: ① migration → ② mã.** Vì migration là **thuần thêm** và mã cũ **không bao
giờ gọi tên** thứ mới, cửa sổ ①→② là **vô hại** (bảng `totp_consumed` nằm rỗng; cột mới toàn `NULL`).

**Nếu đảo ngược (mã trước, migration sau) — gãy gì:**

| mục | cái gãy | mức |
|---|---|---|
| **A** | mọi câu vào `totp_consumed` ném **`42P01`** (undefined_table) → `verifyFreshTotp` bắt và **fail-closed** ⇒ **100 % lượt đăng nhập 2FA và 100 % lệnh deploy/VRAM bị từ chối** | ⛔ **NGỪNG DỊCH VỤ** (an toàn theo chiều CHẶT, nhưng toàn phần) |
| **B — đường ĐỌC** | drizzle liệt kê **toàn bộ** cột ⇒ `selectAll()` sinh `SELECT … "identityTruncated" …` → **`42703`** ⇒ `syncSharedLedger` đếm một lượt hỏng, bản sao đọc **hoá cũ** ⇒ đường quyết định rơi vào `shared-ledger-stale` | ⚠ chặt hơn, nhưng **sổ chung ngừng hoạt động** |
| **B — đường GHI** | `insert().values()` cũng liệt kê cột mới ⇒ `42703` ⇒ `requeueSharedLedgerWrites()` **ném lại đúng hàng độc mỗi 60 s** ⇒ hỏng **VĨNH VIỄN**, `unsyncedWrites` không bao giờ về 0, và chỉ **một** dòng `console.warn` cho cả quãng hỏng (`keuMotLan`) | ⛔ **hỏng chết, gần như im lặng** — đúng hình dạng mà `vramColumnLimits.ts` đã ghi thành cảnh báo |

> ★ GOTCHA này **đã trả giá** ở Wave 3 và được ghi vào memory nguyên văn:
> *"drizzle liệt kê TOÀN BỘ cột ⇒ thêm cột chưa migrate thì **cả INSERT cũng vỡ**, chạy migration
> TRƯỚC deploy SAU."* Lượt này là **lần thứ hai** cùng một lớp lỗi chờ sẵn.

**Rủi ro khác — đã cân, và cách chặn:**

| # | rủi ro | chặn bằng |
|---|---|---|
| R1 | **`42501`** khi chạy DDL bằng `avi_app` (đã kiểm: `current_user` = `avi_app`) | Bước 4 chạy bằng owner **`aoi`** — ghi ngay trong header migration |
| R2 | Quên `aoi_management_test` ⇒ lưới *"xanh rỗng"* (GOTCHA Wave 4 nguyên văn) | Bước 4 áp **cả hai** DB; Bước 6/7 phải chạy trên DB test |
| R3 | Sổ **phình vô hạn** nếu phép tự dọn hỏng | §3.7 — cơ chế + ca đo được ở Bước 8 |
| R4 | `NULL` bị đọc thành **"không cắt"** ⇒ tái lập fail-open ở một chỗ mới | **không có `DEFAULT`**; Bước 6 phải có ca *"NULL ⇒ KHÔNG BIẾT, KHÔNG phải sạch"* |
| R5 | Ô **BIÊN**: `owner` dài **đúng bằng** 160 ⇒ **không** cắt ⇒ phải ghi `'[]'`, không phải `["owner"]` | Bước 6 đã yêu cầu ca này; vị từ đã có sẵn (`catChuoi().daCat`) — **đừng viết bản thứ hai** |
| R6 | Đổi `verifyTotpOnce` thành **`async`** ⇒ 8 điểm gọi phải `await` | **Đã kiểm cả 8**: tất cả nằm trong hàm `async` và đều đã có ≥1 `await` ⇒ chỉ thêm từ khoá. `totpReplayScan.test.ts` khoá *"một chủ"* nên không có điểm thứ 9 nấp đâu đó |
| R7 | Mã **đồng bộ** hoá **bất đồng bộ** ⇒ 9 lượt gọi ở `totpReplay.test.ts` + 3 file test khác phải đổi | biết trước, đã đếm ở §2.1(d) |
| R8 | Một lượt hỏng DB **giữa chừng** biến `verifyTotpOnce` thành fail-closed ⇒ không ai đăng nhập được | **CÓ CHỦ Ý** và phải khai: một sổ chống-phát-lại không đọc được mà vẫn cho qua là **fail-open**. Giữ fail-closed, và để lại một câu log **gọi đúng tên** chuyện đã xảy ra |

### 3.7 · Cơ chế **TỰ DỌN** của sổ A — *ai chạy, bao lâu một lần*

```sql
DELETE FROM "totp_consumed" WHERE "expiresAt" <= $1;   -- $1 = now
```

| câu hỏi | trả lời |
|---|---|
| **ai chạy?** | **chính lượt xác minh** — cùng tiến trình, cùng hàm `verifyTotpOnce`. **KHÔNG cron, KHÔNG scheduler, KHÔNG bầu chủ.** |
| **bao lâu một lần?** | **mỗi lượt xác minh ĐƯỢC CHẤP NHẬN** (khi `RETURNING "luot" = $3`), tức **đúng lúc bảng có thể to thêm**. Lượt bị chặn (phát lại) **không** dọn — nó không thêm hàng nào. |
| **vì sao hình dạng này?** | Nó là **bản dịch một-một** của `donSo(nowMs)` (`totpOnce.ts:161/215`), thứ chạy ngay sau `so.set()`. Tính chất được giữ nguyên và **chứng minh được**: ***bảng không thể lớn lên nếu không có một lượt ghi, và mỗi lượt ghi trả nó về đúng tập mục còn sống.*** Cận trên vẫn là `3 × (số người xác minh trong 120 s)`. |
| **vì sao KHÔNG cron?** | Một cron sống ở `ROLE=worker`. Đặt phép tự dọn ở đó là làm **sức khoẻ của sổ** thành **hệ quả của một tiến trình KHÁC còn sống** — đúng lăng kính *"an toàn là HỆ QUẢ của một thứ khác đang hỏng"* (đã sáu lần). Cộng: worker **không** phục vụ HTTP nên nó không bao giờ biết sổ đang bận hay rảnh. |
| **vì sao KHÔNG "chỉ dọn khi > N"?** | Chính docstring `donSo()` đã trả lời: một ngưỡng để lại tới N mục chết nằm lì sau khi lưu lượng dừng, và *"biến một tính chất **chứng minh được** thành một hằng số phải tin"*. |
| **ca đo được (Bước 8)** | bơm K mã ở K nhịp khác nhau ⇒ ghi lại đỉnh `count(*)`; nhảy đồng hồ qua `TOTP_HAN_SO_MS` ⇒ một lượt xác minh mới ⇒ `count(*)` **= 1**. Đây đúng khuôn ca đã có ở `totpReplay.test.ts:316-329` (`__soTotpSize()`), chỉ đổi nguồn đếm từ `Map.size` sang `SELECT count(*)`. **Dùng lại ca ấy, đừng viết ca thứ N+1.** |

---

## 4 · ⏸ DỪNG — CHỜ CHỦ DỰ ÁN DUYỆT

| bước | trạng thái |
|---|---|
| 1 · ĐO trước, hai ca ĐỎ | ✅ **xong** — 4 đỏ / 2 đối chứng xanh |
| 2 · ĐẾM bề mặt | ✅ **xong** — A: 8 điểm/4 file (khớp) · B: 8 người đọc/6 file, **hai** đường bị phép đếm lật |
| 3 · SOẠN SQL rồi DỪNG | ✅ **xong** — §3 |
| 4 · áp migration (cả 2 DB, owner `aoi`) | ⏸ **CHỜ DUYỆT** |
| 5 · cài mã | ⏸ |
| 6 · đối chứng dương | ⏸ |
| 7 · đột biến | ⏸ |
| 8 · sổ phải tự dọn | ⏸ |
| 9 · commit | ⏸ |

**Lượt này KHÔNG chạy một câu DDL nào** — không `db:push`, không `drizzle-kit`, không `psql` ghi.
Mọi lượt chạm DB đều là **ĐỌC** (`information_schema`, `pg_indexes`, `pg_column_size`, `count(*)`).
Máy chủ **PID 35216** không bị đụng tới. Hai file dò tạm đã **xoá**.

### Nhắc cho lượt sau (Bước 4-5)

1. DDL bằng owner **`aoi`** — đã kiểm hôm nay `current_user` = **`avi_app`** ⇒ sẽ **`42501`**.
2. Áp lên **cả** `aoi_management` **và** `aoi_management_test`.
3. **Migration TRƯỚC, mã SAU** — §3.6.
4. Sau migration, cập nhật `drizzle/schema/vram.ts` (`vramLeases`) **và** thêm bảng `totpConsumed`
   vào `drizzle/schema/`. Thiếu bước này thì `identityTruncated` có trong DB mà drizzle không biết,
   và ∀-A của `sharedLedgerIdentityCut.test.ts` (*"mọi cột `varchar`…"*) **không phủ cột `jsonb`**
   nên nó sẽ **không kêu** — một lỗ *"hàng rào không ai canh"* mới, sinh ra từ chính lượt trả nợ này.
   ⇒ Bước 5 phải **mở rộng ∀-A sang mọi cột**, không chỉ `varchar`.
5. Repo dùng gói **`postgres`** (v3), **không** phải `pg`; script ngoài repo **không resolve được**
   `node_modules` — đặt script tạm **trong** repo rồi xoá.

---

# PHẦN HAI — THỰC THI (Bước 4–9), sau khi chủ dự án duyệt

## 5 · BƯỚC 4 — MIGRATION ĐÃ ÁP, **owner `aoi`**, **cả hai DB**

File: `drizzle/0313_totp_consumed_and_identity_truncated.sql` (nguyên văn = §3.1, cộng một khối
`GRANT` được thêm sau khi **đo lại**, xem dưới).

**Xác nhận sau khi áp — đọc thẳng từ hai DB:**

| | `aoi_management` | `aoi_management_test` |
|---|---|---|
| `current_user` lúc chạy DDL | **`aoi`** ✅ | **`aoi`** ✅ |
| `to_regclass('public.totp_consumed')` | `totp_consumed` (**≠ NULL**) | `totp_consumed` (**≠ NULL**) |
| `vram_leases.identityTruncated` | `jsonb` · `is_nullable = YES` · **`column_default = null`** | idem |
| cột `totp_consumed` | `userId int` · `tokenHash bytea` · `luot varchar(64)` · `expiresAt timestamp` | idem |
| chỉ mục | `totp_consumed_pkey`, `totp_consumed_expires_idx` | idem |
| quyền `avi_app` | `SELECT, INSERT, UPDATE, DELETE` | idem |

⚠ **`column_default = null` là điều PHẢI kiểm, không phải điều hiển nhiên**: đó chính là *"KHÔNG
`DEFAULT '[]'`"* mà chủ dự án duyệt. Một `DEFAULT` lọt vào sẽ biến *"chưa biết"* thành *"khai không
cắt"* — và **không lưới nào bắt được**, vì nó nằm ở DB chứ không ở mã.

**Một câu tôi suýt viết sai, phép đo đã sửa:** header migration ban đầu định khai `GRANT` là *"không
có dòng này thì `42501`"*. Đo `pg_default_acl` trước khi viết: DB **có** default ACL
`{avi_app=arwd/aoi}` cho mọi bảng do `aoi` tạo ⇒ `GRANT` là dòng **làm rõ**, **không** cứu mạng. Giữ
lại (một vai khác `aoi` chạy lượt này sẽ tạo ra một bảng `avi_app` không đọc nổi), nhưng lý do được
viết **đúng**.

Tên cột bảng theo dõi migration — **đã kiểm, không đoán**: `__applied_migrations.filename`.

---

## 6 · BƯỚC 5 — MÃ

### 6.1 · ⚠⚠⚠ ĐÍNH CHÍNH — §2.3(i) của tôi **SAI**

Tôi đã khai ở Bước 2:

> *"(i) ĐANG MỞ — `VramBrokerPanel.tsx:392` GỘP hộ cục bộ với hộ anh em rồi `:427` bơm `h.owner`
> thẳng vào `preempt.mutate`."*

**Phép đọc lại ở Bước 5 bác bỏ câu ấy.** Nút *Thu hồi* chỉ render trong nhánh
`h.reclaim.kind === "reclaimable-here"`, và `hoAnhEm()` (`vramReadModel.ts`) **theo cấu tạo** chỉ
sinh ra `declared-by-owner-process` hoặc `no-reclaimer` — **không bao giờ** `reclaimable-here`.
⇒ **Mặt NGƯỜI không thể gửi một danh tính cụt đi.** Phép gộp là có thật; kết luận rút ra từ nó thì
không.

**Đường THẬT SỰ phơi nhiễm — và nó nặng hơn:** mặt **AGENT**. `vramTools.tomTat()` (dòng ~480) gộp
`localHolders` với `foreign.holders` rồi đưa `owner` của **cả hai** vào `textSummary`; docstring của
chính `vramTools` viết: *"`owner` là **DANH TÍNH** mà Agent lấy từ mặt đọc rồi truyền **thẳng** vào
`vram.preempt`"*. Với hộ anh em chuỗi ấy **đã bị cắt tại DB** ⇒ Agent gọi một lệnh phá huỷ bằng một
cái tên **không phải tên của ai cả**.

⇒ Bài học ghi lại: **hai mặt, hai mức phơi nhiễm — đừng gộp cho câu chuyện gọn hơn.** Cả hai nay có
ca riêng: một ca khoá tính chất cấu trúc của mặt người, một ca khoá `textSummary` của Agent.

### 6.2 · Những gì đã cài

| mục | nơi | điều đã đổi |
|---|---|---|
| **A** | `drizzle/schema/auth.ts` | bảng `totpConsumed` + kiểu `bytea` tuỳ biến |
| **A** | `server/_core/totpOnce.ts` | `verifyTotpOnce` → **`async`**; sổ xuống DB; tự dọn; fail-closed |
| **A** | 8 điểm gọi / 4 file | thêm `await` — **không** đổi ngữ nghĩa một điểm nào |
| **B** | `drizzle/schema/vram.ts` | `identityTruncated: jsonb` (nullable, **không** DEFAULT) |
| **B** | `vramSharedLedger.ts` | `SharedLeaseRow.identityTruncated`; `rowFromLease`/`rowFromBaseline` khai; `truncatedIdentityWrites` **cộng thêm hàng anh em**; **`unknownIdentityRows`** mới |
| **B** | `vramSharedLedgerStore.ts` | ghi/đọc cột; `docCoCat()` — **bản dịch DUY NHẤT** ba giá trị |
| **B** | `vramReadModel.ts` | `VramAgentHolderView.identityTruncated` (per-hàng) + `unknownIdentityRows` |
| **B** | `vramPhrases.ts` · `vramTools.ts` | hai câu × **3 ngôn ngữ**, vào **`textSummary`** |
| **B** | `VramBrokerPanel.tsx` + 3 locale | badge per-hàng + dòng tổng; 3 khoá i18n × 3 bản |

### 6.3 · Nợ **tôi tự khai ở Bước 3** — đã đóng

∀-A cũ lọc `columnType === "PgVarchar"` ⇒ cột `jsonb` mới **rơi ra ngoài theo cấu tạo**. Thêm lượng
từ đảo lại: ***∀ cột của `vram_leases` — MỌI KIỂU — phải có đúng một ô ở `SharedLeaseRow`***.
Đột biến **M7c** (thêm một cột `jsonb` thứ 16) chứng minh giá trị: **chỉ luật MỚI bắt được**.

### 6.4 · Hai cái bẫy đã trả giá — ghi lại nguyên văn

1. **`*/` trong docstring.** Chuỗi `**B1**/**B3**` chứa `*` `*` `/` ⇒ **đóng block comment** giữa
   chừng; `tsc` nôn ra 40 lỗi cú pháp trỏ vào những dòng **hoàn toàn không liên quan**. Xảy ra
   **hai** lần (`drizzle/schema/vram.ts`, `totpLedgerDurable.test.ts` với `**Pha 5**/Pha 6`).
   ⇒ Đã quét **toàn bộ** file đã sửa; chỉ còn `*/}` của JSX (hợp lệ).
2. **`await f({…}).hopLe` phân tích thành `await (f.hopLe)`.** Một lượt chèn `await` bằng văn bản
   thuần đẻ ra **7** điểm sai kiểu ở mã sản xuất + **4** ở test. `tsc` bắt hết — nhưng chỉ vì có
   `tsc`; một lượt "thêm await cho nhanh" **không có** phép kiểm kiểu là một lượt hỏng im lặng.

---

## 7 · BƯỚC 6–8 — ĐỐI CHỨNG DƯƠNG · ĐỘT BIẾN · TỰ DỌN

### 7.1 · Hai ca ĐỎ của Bước 1 nay **XANH** (cùng khuôn đo, câu trả lời ngược lại)

| ca | Bước 1 | Bước 7 |
|---|---|---|
| **A2** mã đã tiêu, qua **restart** | ❌ `hopLe = true` | ✅ `hopLe = false`, `phatLai = true` |
| **A3** hai bản sao `ROLE=api` | ❌ `hopLe = true` | ✅ `hopLe = false`, `phatLai = true` |
| **B1** hàng anh em mang cờ | ❌ `[]` (không ô nào) | ✅ `identityTruncated = ["owner"]` |
| **B3** mặt đọc anh em | ❌ `0` | ✅ `truncatedIdentityWrites = 1` |

⚠ **A2 chạy trên DB THẬT** (`aoi_management_test`), không phải một sổ giả — vì câu cần chứng minh
là *"trạng thái sống LÂU HƠN tiến trình"*, và một bảng giả trong bộ nhớ **chính là thứ vừa bị bác bỏ**.

### 7.2 · Đối chứng dương (Bước 6) — cái ĐÚNG vẫn đi qua

mã **mới** vẫn qua (kể cả sau restart) · **3 lượt verify cùng `luot`** đều qua (chuỗi thật của
`vram.preempt`) · hai người dùng cùng một mã 6 số **không chặn nhầm nhau** · mã sai **không ghi sổ**
· `owner` 54 ký tự ⇒ cờ `[]` · **ô BIÊN** dài **đúng bằng** 160 ⇒ **không** khai là đã cắt · hộ CỤC
BỘ giữ `owner` **nguyên vẹn** và khai `[]`.

### 7.3 · Bảng ĐỘT BIẾN (10 lượt)

| # | đột biến | kết quả | ca đỏ |
|---|---|---|---|
| **M1** | `rowFromLease` luôn khai `[]` (gỡ cờ lúc GHI) | ✅ **5 đỏ** | B1 · B3 · đường thoát mặt đọc · đường thoát Agent · ô BIÊN |
| **M2** | `docCoCat`: `null` → `[]` (gộp vế thứ ba) | ⚠ **SỐNG SÓT** → đã vá → **1 đỏ** | `docCoCat` — `null` ⇒ KHÔNG BIẾT |
| **M3** | `tieuMaTrongSo` luôn trả `luot` của ta | ✅ **10 đỏ** | A2 · A3 · phát lại cùng tiến trình · … |
| **M4** | bỏ `await donSo(nowMs)` | ✅ **1 đỏ** | *"đỉnh nhiều mục ⇒ kéo về ĐÚNG 1"* |
| **M5** | `hoAnhEm` luôn `identityTruncated: []` | ✅ **7 đỏ** | B1 · B3 · hai đường thoát · vế thứ ba |
| **M6** | `unknownIdentityRows` ghim `0` | ✅ **6 đỏ** | vế thứ ba + đường thoát của nó |
| **M7** | gỡ ô khỏi `SharedLeaseRow` | vitest XANH · **`tsc` ĐỎ (4 lỗi)** | cổng vẫn bắt (cổng gồm `npm run check`) |
| **M7b** | thêm cột `varchar` thứ 15 vào drizzle | ✅ **2 đỏ** | ∀-A cũ **và** luật mới |
| **M7c** | thêm cột **`jsonb`** thứ 16 | ✅ **1 đỏ — CHỈ luật MỚI** | ∀-A cũ **mù theo cấu tạo** |
| **M8** | khai `["owner"]` cho **mọi** hàng | ✅ **6 đỏ** | **không bắt nhầm** |

### 7.4 · ★★★ M2 — ĐỘT BIẾN SỐNG SÓT, và nó là **đúng cái lỗ vừa vá**

Đổi `docCoCat()` từ `return null` sang `return []` — tức **ép vế "KHÔNG BIẾT" thành "khai không cắt
gì"**, chính xác cái fail-open mà cả lượt này sinh ra để đóng — và **15/15 ca vẫn XANH**.

**Vì sao:** mọi ca dùng một gateway **GIẢ** trả thẳng `SharedLeaseRow`, nên **không ca nào đi qua
hàm ấy**; còn bản cài đặt drizzle thật thì `return null` ngay ở dòng `if (process.env.VITEST)`.
⇒ Mắt xích **DUY NHẤT** dịch cột DB → lời khai ba giá trị là một mắt xích **KHÔNG AI CANH**. Đúng
lớp *"lưới đi theo FILE, không theo ĐƯỜNG THOÁT"*, lần thứ N.
**Đã vá:** xuất `docCoCat` + **4 ca** (null/undefined ⇒ `null` · mảng chuỗi ⇒ chính nó · **giá trị
lạ** ⇒ `null` chứ không `[]` · trả bản **đông cứng**). Chạy lại M2 ⇒ **ĐỎ**.

### 7.5 · Bước 8 — sổ TỰ DỌN, **đo được**

| ô | phát biểu | kết quả |
|---|---|---|
| đỉnh → 1 | bơm 6 mã ở 6 nhịp ⇒ đỉnh > 1; nhảy qua hạn + **một** lượt ghi ⇒ `count(*) = 1` | ✅ |
| tính chất | 10 lượt **KHÔNG-ghi** (5 phát lại + 5 mã sai) ⇒ bảng **không lớn thêm một hàng** | ✅ |
| hình dạng | `totpOnce.ts` **không chứa** `setInterval(` · `setTimeout(` · `node-cron` · `cron.schedule` | ✅ |

⚠ Ô cuối **từng được viết sai**: bản đầu `spyOn(setTimeout)` và đòi *"không lần gọi nào"* — nó **đỏ
vì một lý do sai**, chính **driver `postgres`** dựng hẹn giờ cho lượt kết nối và `idle_timeout`
(**3** lượt gọi đo được). Phép canh ấy đo **thư viện**, không đo **luật của ta** ⇒ chuyển sang canh
**văn bản nguồn**, đúng chỗ luật sống.

### 7.6 · ★★★ LỚP LỖI **MỚI SINH RA TỪ CHÍNH LƯỢT TRẢ NỢ NÀY**

Sổ thôi là `Map` cấp module và thành **BẢNG DÙNG CHUNG**; vitest chạy các file test **SONG SONG**.
Cổng đầy đủ cho **6 ca đỏ mà chạy lẻ thì xanh** — hai cơ chế, cả hai đo được:

1. Phép **tự dọn** xoá **mọi** hàng `expiresAt <= now`. File khác gọi `verifyTotpOnce` với
   `Date.now()` **thật** (2026) ⇒ **quét sạch** hàng mang mốc hằng **2023** của `totpLedgerDurable`
   **giữa hai lời khẳng định** ⇒ A2/A3 đỏ vì một lý do **không liên quan gì**.
   ⇒ Mốc của file ấy nay **bám đồng hồ thật** (`Date.now() + 1h`).
2. `__soTotpSize()` đếm **toàn bảng** ⇒ `totpReplay` đòi *"còn ĐÚNG 1"* và thấy **2**.
   ⇒ `__soTotpSize(userIds)` **và** `__resetSoTotpChoTest(userIds)` đều **phải khai người dùng của
   mình**; bỏ trống là xoá/đếm cả bảng.

> ★ *"Trả nợ đẻ ra nợ"* — **lần thứ tư đo được**. Lần này nợ mới **không phải một lỗ an ninh** mà là
> một **lớp flake theo cấu tạo**: mọi trạng thái dời từ bộ nhớ tiến trình xuống một bảng dùng chung
> **đều** thừa hưởng nó. Ai dời cái tiếp theo phải đọc mục này trước.

### 7.7 · ★★ `vramPha5Gate` bắt được một lỗ THẬT ngay trong lượt này

`totpLedgerDurable.test.ts` — **lưới quyết định nhất của mục A** — nằm ở `server/routers/` và
**không đường nào của §Cổng kiểm chung phủ nó** ⇒ nó sẽ **không bao giờ chạy ở cổng**. Cổng bắt được
bằng **phép ghim SỐ** (`FILE_CANH` 75 → 76 ≠ 75 ⇒ đỏ).
⇒ Thêm đường vào §Cổng kiểm chung + file **tự khai `Pha 5`**. `CONG` **16 → 17**, `FILE_CANH`
**75 → 77**.

---

## 8 · CỔNG RA

| phép kiểm | kết quả |
|---|---|
| Cổng kiểm chung **17 đường** | **115/115 file · 1984/1984 ca XANH** |
| `npm run check` | sạch |
| `npm run check:tests` | sạch |
| `npm run i18n:check` | sạch (0 thiếu mới; nền 817+20 giữ nguyên) |
| `vramPha5Gate` | 12/12 (`CONG`=17, `FILE_CANH`=77) |

**Cổng ra của Task 5, đối chiếu nguyên văn kế hoạch:**
- (A) *"mã tiêu rồi ⇒ chặn qua restart **VÀ** qua tiến trình khác; mã mới ⇒ vẫn qua"* → **ĐẠT**
  (A2 · A3 · đối chứng dương, trên **DB thật**).
- (B) *"hàng bị cắt ⇒ **mọi** người đọc thấy cờ, kể cả tiến trình anh em"* → **ĐẠT** (B1 · B3 ·
  mặt đọc · mặt người · `textSummary` của Agent · vế thứ ba `null`).

**Commit:** `e55cb22a` (Bước 4–8) · `44af3aca` (vá đột biến sống sót + lớp flake mới).

### Còn nợ, khai rõ

- **Chưa nghiệm thu sống.** Mọi bằng chứng ở đây là DB test + lưới; **chưa** có một lượt đăng nhập
  2FA hay một lệnh `vram.preempt` thật nào chạy qua sổ mới trên máy chủ đang chạy (PID 35216 **không
  bị đụng tới**, chưa redeploy).
- **`aiLocalKnowledgeService`** — chưa kiểm lại rằng câu cảnh báo mới **không** bị cắt bởi trần độ
  dài của `textSummary` khi có nhiều hộ.
- Nợ **CÓ TRƯỚC**, không đụng: flake `visionControl.tools` · `wiring.inprocess` · 16 file đỏ
  `server/routers/**` · 10 ca `server/services/ai/**` (`42501`).
