# Pha 7 · Task 5 — **NGHIỆM THU SỐNG** (hai mục DDL vừa áp)

> **Trạng thái: ✅ XONG — CẢ BỐN MỤC BẮT BUỘC ĐẠT.** Xem §8 (bảng cổng ra) và §6.2 (**đường CHƯA ĐI**).
> Báo cáo được ghi **DẦN sau MỖI bước** (một lượt trước chết câm 93 phút và mất trắng).

- **Nhánh:** `feat/hmi-dep` · **HEAD:** `5036eb5c`
- **Ngày:** 2026-08-08
- **Đọc trước:** `docs/superpowers/reports/2026-08-08-vram-pha7-task5-migration-de-xuat.md`
- **Chủ dự án đã duyệt tường minh** lượt nghiệm thu sống này.

## Cái đang được chứng minh

| mục | điều đã đổi | câu phải chứng minh **SỐNG** |
|---|---|---|
| **A** | sổ mã OTP đã tiêu xuống DB (`totp_consumed`) | mã tiêu rồi ⇒ **chặn qua RESTART**; mã **mới** ⇒ **vẫn qua** |
| **B** | `vram_leases."identityTruncated"` (`jsonb`, KHÔNG `DEFAULT`) | hàng bị cắt mang cờ **THẬT trong DB**; ô **BIÊN** 160 ⇒ **không** khai cắt |
| **A** (dọn) | tự dọn theo lượt ghi | hàng quá hạn **RỜI BẢNG** — đo bằng `count(*)` |

---

## 0 · TIỀN ĐIỀU KIỆN — **ĐO ĐƯỢC**

| kiểm | kỳ vọng | ĐO ĐƯỢC | ĐẠT? |
|---|---|---|---|
| `git rev-parse --short HEAD` | `5036eb5c` | **`5036eb5c`** | ✅ |
| `git status --porcelain -- server/ client/` | rỗng | **rỗng** (0 dòng) | ✅ |
| `/api/health` | 200 | **200** | ✅ |
| máy chủ ứng dụng | đúng **MỘT** | **PID 19520** `node dist/index.js` (cha: 18892 `cross-env` ← 19660 `npm run start`) · start 10:43:09 | ✅ |
| `nvidia-smi memory.used` | — | **3.301 MiB** / 32.607 MiB | (nền) |

### 0.1 · Trạng thái DB THẬT lúc bắt đầu (`aoi_management`, vai `avi_app`, 20:47:04 UTC)

| đại lượng | giá trị **ĐO ĐƯỢC** |
|---|---|
| `SELECT count(*) FROM totp_consumed` | **0** |
| `vram_leases` | **4 hàng**, tất cả `processKey = all:19520:1786160624882` (đúng PID mới) |
| `vram_leases."identityTruncated"` của 4 hàng | **`[]` · `[]` · `[]` · `[]`** — **không** một `NULL` nào |
| cột `identityTruncated` | `jsonb` · `is_nullable = YES` · **`column_default = null`** |

★ **Đây đã là bằng chứng SỐNG đầu tiên, và nó không phải lời khai:** máy chủ đang chạy (PID **19520**,
dựng sau migration) **đã tự ghi** cờ `[]` vào **cả 4** hàng giấy phép của nó. Trước migration cột này
không tồn tại; ngay sau nó, đường GHI thật của mã sản xuất **đang khai** — không cần ai gọi tay.
Và `column_default = null` được xác nhận **trên DB đang chạy**, tức *"chưa biết"* vẫn là `NULL` chứ
không bị một `DEFAULT` biến thành *"khai không cắt"*.

---

## 1 · ĐƯỜNG ĐĂNG NHẬP 2FA THẬT — dựng được, và **một phát hiện phụ**

Tài khoản `supervisor1` (id **49**), mật khẩu **`Test@1234`** (`scripts/seed-test-data.mjs:83`),
2FA BẬT. Mã OTP sinh từ `users.two_factor_secret` bằng `speakeasy` — **đúng secret thật trong DB**.

### 1.1 · ⚠⚠ PHÁT HIỆN NGOÀI PHẠM VI (nợ **CÓ TRƯỚC**, không phải do Task 5)

Lượt chạy **đầu tiên** dùng nhầm mật khẩu `Admin@123` ⇒ `/api/auth/login` trả **401**
(`attemptsRemaining: 4`). **Nhưng `/api/auth/verify-2fa` ngay sau đó vẫn trả 200 và CẤP PHIÊN**
(`set-cookie` có mặt, `user.id = 49`).

```
POST /api/auth/login    {username:"supervisor1", password:"Admin@123"}  → 401  ❌ sai mật khẩu
POST /api/auth/verify-2fa {userId:49, token:"141351"}                   → 200  ✅ + set-cookie
```

`server/_core/oauth.ts:380-408` đọc `userId` **thẳng từ body** và **không** kiểm rằng lượt gọi này
vừa qua bước mật khẩu. ⇒ Ai biết `userId` + một mã TOTP hợp lệ **đăng nhập được mà KHÔNG cần mật
khẩu** — 2FA không phải *yếu tố thứ hai* ở đây, nó là **yếu tố DUY NHẤT**.
⚠ **KHÔNG vá trong task này** (task ĐO). Ghi lại để chủ dự án định đoạt.
⚠ Lượt sai mật khẩu ấy **đã được lượt đăng nhập đúng ngay sau đó xoá sổ** (bộ đếm reset khi thành
công); không tài khoản nào bị khoá.

### 1.2 · Đối chứng: đường đăng nhập ĐẦY ĐỦ chạy đúng

| bước | ĐO ĐƯỢC |
|---|---|
| `POST /api/auth/login` (mật khẩu ĐÚNG) | **200** `{requires2FA:true, userId:49}` |
| `POST /api/auth/verify-2fa` (mã `140225`, nhịp 59538698) | **200** `{success:true}`, **có** `set-cookie` |
| `totp_consumed` ngay sau | **2 hàng**; hàng của mã này: `hash=64abeb1f…`, `luot=70ca4d2a-…` |

### 1.3 · ĐỐI CHỨNG CÙNG TIẾN TRÌNH — phát lại bị chặn (cơ chế Pha 6 còn sống)

Dùng **lại** mã `140225` sau **8 giây**, vẫn PID 19520:

| | ĐO ĐƯỢC |
|---|---|
| `/api/auth/verify-2fa` | **401** `{"error":"Mã xác thực không hợp lệ"}`, **KHÔNG** `set-cookie` |
| `totp_consumed` | vẫn **2 hàng**; `luot` của hàng ấy **KHÔNG đổi** (`70ca4d2a-…`) |

★ `luot` không đổi là bằng chứng của **đúng nhánh** `ON CONFLICT DO UPDATE … ELSE c."luot"`: kẻ đến
sau đọc được dấu của kẻ đến trước, chứ không phải mã bị từ chối vì một lý do khác.

⚠ Ca này **chưa** chứng minh điều Task 5 sinh ra để chứng minh — nó qua được **cả trước** migration.
Ca quyết định là §2 dưới đây.

---

## 2 · ⚠⚠ **MỤC BẮT BUỘC 1 + 2** — PHÁT LẠI QUA **RESTART** BỊ CHẶN · MÃ MỚI **VẪN QUA**

### 2.1 · Hình dạng của ca — và **ô đã thiếu ở mọi lượt trước**

Một lượt *"restart rồi dùng lại mã ⇒ 401"* **chưa chứng minh gì cả**: 401 cũng là câu trả lời cho một
mã **đã hết hạn**. Hai lý do, **một** mã lỗi. ⇒ Ca này mang thêm **một phép đo tại chỗ**:

```js
speakeasyStillValid = speakeasy.totp.verify({ secret, encoding:'base32', token, window: 1 })
```

chạy **cùng secret, cùng `window: 1`** mà máy chủ dùng, **tại đúng thời điểm gửi**.
***`speakeasyStillValid = true` + HTTP `401` ⇒ lượt từ chối đến từ SỔ, không thể đến từ "mã hết hạn".***

### 2.2 · Trình tự SỐNG — 25 giây, ba mốc đồng hồ thật

| # | lúc (UTC) | việc | PID máy chủ | ĐO ĐƯỢC |
|---|---|---|---|---|
| ① | `03:52:19.853` | `login` + `verify-2fa`, mã **`966701`** (nhịp **59538704**) | **32528** | **200** `{success:true}` + `set-cookie` · `totp_consumed` = **1 hàng**, `hash=e3e844fa…`, `luot=c1eb1dd6-…`, `expiresAt=20:54:19.801` |
| ② | `03:52:26.9 → 03:52:34.0` | **RESTART THEO PID** | 32528 → **11428** | `KILLED_APP 32528` · `KILLED_WRAP 6096` · `ALL_DOWN_MS=471` · **`HEALTH_AFTER_KILL=DOWN`** · `HEALTHY=True TOTAL_MS=7102` |
| ③ | `03:52:38.783` | **dùng LẠI đúng mã `966701`** | **11428** | **`speakeasyStillValid: true`** · `verify-2fa` → **`401`** `"Mã xác thực không hợp lệ"` · **KHÔNG** `set-cookie` |
| ④ | `03:52:45.002` | mã **MỚI `875922`** (nhịp **59538705**) | **11428** | **`200`** `{success:true}` + **có** `set-cookie` |

### 2.3 · Vì sao đây là một cặp **KHÔNG CÃI ĐƯỢC**

| | mã `966701` (③) | mã `875922` (④) |
|---|---|---|
| nhịp | 59538704 | 59538705 — **kề nhau**, cả hai nằm trong `window: 1` |
| `speakeasy` chấp nhận tại thời điểm gửi? | **CÓ** (`true`) | **CÓ** (`true`) |
| tiến trình xử lý | PID **11428** (mới) | PID **11428** (**cùng một** tiến trình) |
| cách nhau | — | **6,2 giây** |
| **khác nhau ĐÚNG MỘT ĐIỀU** | đã tiêu **TRƯỚC** restart | chưa ai tiêu |
| kết quả | **401**, không phiên | **200**, có phiên |

⇒ Biến duy nhất là *"đã tiêu hay chưa"*, và **cuốn sổ ghi điều đó đã sống sót qua một cái chết tiến
trình có bằng chứng** (`HEALTH_AFTER_KILL=DOWN`, PID đổi 32528 → 11428).

**Hàng sổ đọc lại SAU restart — nguyên vẹn từng ô:**

```
userId    = 49
hash      = e3e844fa024993b736a1e7035998a1aefdae51e6745c39d1367c814b1f1448b8
luot      = c1eb1dd6-3c84-4f68-98a4-a33b9a725362   ← dấu do PID 32528 (ĐÃ CHẾT) đúc ra
expiresAt = 2026-08-07T20:54:19.801Z
```

`luot` là **dấu của một lượt gọi trong một tiến trình không còn tồn tại**. PID 11428 đọc được nó, so
với dấu của chính mình, thấy khác ⇒ **PHÁT LẠI**. Trước migration, `Map` cấp module chết theo tiến
trình nên lượt ③ sẽ **ĐI QUA** — đúng ca đỏ **A2** của Bước 1.

| mục bắt buộc | kết quả |
|---|---|
| **1 · A2 SỐNG — phát lại qua RESTART bị chặn** | ✅ **ĐẠT** |
| **2 · đối chứng DƯƠNG — mã mới vẫn qua** | ✅ **ĐẠT** |

⚠ **Đường ĐÃ ĐI:** `/api/auth/verify-2fa` (điểm gọi **#2/8**, đường *"chiếm phiên"*).
⚠ **Đường CHƯA ĐI ở ca này:** 7 điểm gọi còn lại (`_core/trpc.ts` step-up · `twoFactorRouter` ×4 ·
`userRouters` ×2) — xem §5.

---

## 3 · ⚠⚠ **MỤC BẮT BUỘC 3** — HÀNG BỊ CẮT MANG CỜ **THẬT TRONG DB** · và ô **BIÊN**

### 3.1 · Cảnh dựng — một **TIẾN TRÌNH ANH EM** thật, không phải một bảng giả

Một tiến trình `node` **RIÊNG** (`npx tsx`, **PID 35168**, `selfKey = all:35168:1786161345180`) ghi
vào **đúng bảng `vram_leases` của DB đang chạy**, qua **đúng đường ghi sản xuất**:

```
reserve()  →  syncSharedLedger()  →  rowFromLease()  →  gateway drizzle THẬT  →  vram_leases
```

Máy chủ ứng dụng lúc đó là **PID 11428** (`selfKey = all:11428:1786161152226`) ⇒ hai `selfKey` khác
nhau, **hai tiến trình thật**. Bước 1 của Task 5 đo ca này bằng một **bảng GIẢ trong bộ nhớ**; lượt
này là **bảng THẬT**.

⚠ **Khai rõ hai helper test đã dùng và VÌ SAO:** `publishDecisionTick(__tickFieldsForTests(0,true))`
— nhịp quyết định do vòng lặp nền của **máy chủ** xuất bản, tiến trình rời này không có vòng lặp ấy.
Chúng chỉ cấp **đầu vào cho phép quyết định NHẬN/TỪ CHỐI**; **không một byte nào** của đường GHI
(`rowFromLease` → `identityTruncated` → DB) đi qua chúng.

### 3.2 · ★★★ Hai hàng, **CÙNG `length(owner) = 160`**, **KHÁC lời khai**

Đọc lại bằng **một kết nối `postgres` KHÁC**, **SQL thô**, không qua mã của ta:

```sql
SELECT "leaseKey", length("owner"), "identityTruncated" FROM vram_leases WHERE "processKey" = 'all:35168:1786161345180';
```

| hàng | `owner` GỬI VÀO | `length(owner)` trong DB | `identityTruncated` trong DB | kỳ vọng | ĐẠT? |
|---|---|---|---|---|---|
| **A** | `reranker:C:\Users\Admin\models\…` — **345** ký tự (**> 160**) | **160** | **`["owner"]`** | `["owner"]` | ✅ |
| **B** *(ô **BIÊN**)* | `"b" × 160` — **đúng bằng** 160 | **160** | **`[]`** | `[]`, **không** khai cắt | ✅ |

★★★ **Đây là toàn bộ lý lẽ của mục B, đo được trên DB thật:** hai hàng có **cùng một** `length(owner)
= 160`; người đọc **không thể** suy ra hàng nào mất chữ. Chỉ **cột cờ** nói được — và nó **đang nói
đúng**, khác nhau ở đúng hai hàng ấy. Ô biên là ca chống *"bản vá khai cắt cho MỌI hàng"*.

### 3.3 · KHÔNG BẮT NHẦM — sổ **CỤC BỘ** giữ danh tính nguyên vẹn

| thước | ĐO ĐƯỢC |
|---|---|
| `snapshot().leases[A].request.owner.length` | **345** (=== chuỗi gốc, `true`) |
| `sharedLedgerFact().truncatedIdentityWrites` (mặt đọc của **người ghi**) | **1** |
| `sharedLedgerFact().unknownIdentityRows` | **0** |

⇒ Chỉ **bản CÔNG BỐ** bị cắt; mặt LỆNH của chính tiến trình ấy vẫn cầm tên đầy đủ.

### 3.4 · ★★ VẾ THỨ BA — `NULL` phải đọc thành **KHÔNG BIẾT**, không thành *"sạch"*

Đây là rủi ro **R4** mà chủ dự án đã duyệt *"KHÔNG đặt `DEFAULT`"* để đóng. Không đi đường này thì
`column_default = null` chỉ là một dòng `information_schema`, chưa phải một hành vi.

Dựng một hàng đúng hình dạng **tiến trình CŨ** (INSERT **không nêu tên cột** `identityTruncated` ⇒
nó ở `NULL`), rồi để **mặt đọc sản xuất** đọc:

| thước | ĐO ĐƯỢC | nghĩa |
|---|---|---|
| `"identityTruncated" IS NULL` trên hàng vừa dựng | **`true`** | không `DEFAULT` nào biến nó thành `[]` — **xác nhận trên DB đang chạy** |
| `unknownIdentityRows` | **1** | mặt đọc **thấy** một hàng nó **không biết** |
| `truncatedIdentityWrites` | **0** | và **không** khai nhầm nó là "đã cắt" |
| hộ anh em có xuất hiện ở `foreignHolders`? | **có** | hàng vẫn đọc được, chỉ là lời khai của nó là *"chưa biết"* |

⇒ **`NULL` KHÔNG bị ép về `[]`.** Đúng ba giá trị, không hai.

| mục bắt buộc | kết quả |
|---|---|
| **3 · B sống — hàng bị cắt mang cờ THẬT trong DB · ô BIÊN 160 không khai cắt** | ✅ **ĐẠT** |

**Dọn:** cả 3 hàng dựng trong §3 đã **XOÁ** (`DELETE … RETURNING` trả **2** + **1**). Xem §6.

---

## 4 · ⚠⚠ **MỤC BẮT BUỘC 4** — SỔ **TỰ DỌN** TRÊN DB THẬT, **SỐ ĐO KHÔNG PHẢI LỜI KHAI**

### 4.1 · Bơm — **3 mục, 2 người dùng, 3 nhịp khác nhau**

| hàng | `userId` | `expiresAt` (UTC) |
|---|---|---|
| 1 | **49** (`supervisor1`) | `20:54:19.801` |
| 2 | **49** | `20:54:44.946` |
| 3 | **51** (`engineer1`) | `20:55:51.351` |

### 4.2 · ★★ Ô QUYẾT ĐỊNH — **quá hạn HẾT mà vẫn CÒN NGUYÊN** (không cron, không hẹn giờ)

```sql
SELECT now() at time zone 'utc', count(*), count(*) FILTER (WHERE "expiresAt" <= now() at time zone 'utc') FROM totp_consumed;
```

| lúc | `count(*)` | số hàng **quá hạn** |
|---|---|---|
| **`20:56:37.466`** | **3** | **3** — *tất cả* |

★ Hàng sớm nhất đã quá hạn **137 giây** mà **vẫn nằm trong bảng**. ⇒ **Không** một cron / scheduler /
`setInterval` nào dọn nó. Nếu bỏ ô này, một lượt "count giảm" có thể là công của một nhịp nền nào đó
và ta sẽ **quy công nhầm cơ chế**.

### 4.3 · Hai lượt, một biến — và bảng **rời** đúng lúc nó phải rời

| # | việc | HTTP | `count(*)` **trước** | `count(*)` **SAU** | nguồn đo |
|---|---|---|---|---|---|
| (a) | mã **SAI** `000000` (`speakeasyStillValid: false`) | **401** | **3** | **3** | `SELECT count(*) FROM totp_consumed` |
| (b) | **MỘT** lượt xác minh **ĐƯỢC CHẤP NHẬN** (mã `507643`) | **200** | **3** | **1** | idem |

Sau (b), bảng còn **đúng một** hàng — và đó là hàng **vừa sinh ra** (`expiresAt = 20:58:53.541`,
`userId = 49`). **Cả 3 hàng quá hạn đã RỜI BẢNG.**

⇒ Cả hai vế của tính chất được chứng minh **bằng số**:
- *"bảng không lớn lên nếu không có một lượt GHI"* — (a): 401 ⇒ không thêm hàng, và **không** dọn;
- *"mỗi lượt GHI trả bảng về đúng tập mục còn sống"* — (b): **3 → 1**.

| mục bắt buộc | kết quả |
|---|---|
| **4 · sổ TỰ DỌN trên DB thật, đo bằng `count(*)`** | ✅ **ĐẠT** |

⚠ **KHÔNG một dòng `[TotpOnce]` nào trong log máy chủ** (`grep -c "TotpOnce"` = **0**) ⇒ không lượt
nào rơi vào nhánh **fail-closed** (`SỔ MÃ ĐÃ TIÊU KHÔNG HỎI ĐƯỢC` / `Không có kết nối DB`) và không
lượt **tự dọn** nào hỏng. Mọi lượt 401 ở trên là phán quyết **của sổ**, không phải của một sự cố.
`grep -c "SỔ CHUNG (\`vram_leases\`) KHÔNG ĐỒNG BỘ"` = **0** ⇒ đường ghi sổ chung cũng sạch.

---

## 5 · `nvidia-smi` TRƯỚC / SAU — và **vì sao con số này KHÔNG phải kết quả của lượt nghiệm thu**

| mốc | `memory.used` | ghi chú |
|---|---|---|
| **TRƯỚC** (bắt đầu, PID 19520) | **3.301 MiB** / 32.607 | máy chủ vừa dựng, **chưa** nạp model sâu |
| trước lượt ghi sổ chung §3 | **21.947 MiB** | |
| **SAU** (kết thúc, PID 11428) | **21.961 MiB** | |

⚠⚠ **Chênh +18.660 MiB KHÔNG do lượt nghiệm thu gây ra, và nó truy được tới từng hộ** — sổ chung
sau cùng nói ra nguyên nhân:

| hộ | MiB |
|---|---|
| `gguf:Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL` | **18.538** |
| `reconciler:baseline` | 1.387 |
| `gguf:Qwen3-Embedding-0.6B-f16` | 1.138 |
| `gguf-embed-ctx:Qwen3-Embedding-0.6B-f16` | 526 |
| `cuda-backend` | 432 |

Log máy chủ xác nhận: `[aiGgufEngine] Model loaded in 30594ms: Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL`
+ `deep model warm OK`. ⇒ **Lượt RESTART của §2 làm máy chủ chạy lại nghi thức warm** mà PID 19520
(máy chủ ban đầu) chưa chạy tới lúc ta chụp nền. **Không** lượt nào của Task 5 cấp/nhả byte GPU.

⚠ Lượt VRAM duy nhất của lượt này (§3) xin **1 MiB × 2** rồi **xoá hàng** — nó là một lượt ghi **SỔ**,
không phải một lượt cấp phát trên card. ⇒ **Không có lượt thu hồi VRAM nào để đo `nvidia-smi` trước/sau.**

★ Phụ đề đáng ghi: lượt restart để lại 4 hàng **MỒ CÔI** của PID 32528, và cơ chế Pha 3 **tự dọn
đúng** — log có 4 dòng `DỌN HÀNG MA khỏi sổ chung … tiến trình "all:32528:…" đã CHẾT`, và bảng cuối
chỉ còn hàng của PID **11428**. Không phải điều Task 5 đo, nhưng nó chạy **thật** trong lượt này.

---

## 6 · ⚠⚠ ĐƯỜNG **ĐÃ ĐI** và ĐƯỜNG **CHƯA ĐI**

> *"Nghiệm thu sống chỉ chứng minh ĐÚNG ĐƯỜNG MÌNH VỪA ĐI"* — Wave 2 để lọt **40 %** đề xuất vô hình
> vì không viết mục này ra.

### 6.1 · ĐÃ ĐI (có số đo trong báo cáo này)

| # | đường | ở đâu |
|---|---|---|
| 1 | `POST /api/auth/verify-2fa` — điểm gọi **#2/8** của `verifyTotpOnce` | §1, §2, §4 |
| 2 | sổ OTP sống qua **cái chết tiến trình có bằng chứng** (`HEALTH_AFTER_KILL=DOWN`, PID 32528→11428) | §2 |
| 3 | `ON CONFLICT DO UPDATE` giữ `luot` của kẻ đến trước | §1.3, §2.3 |
| 4 | tự dọn theo **lượt ghi được chấp nhận** trên bảng thật | §4 |
| 5 | `reserve()` → `syncSharedLedger()` → gateway **drizzle THẬT** → `vram_leases` (tiến trình anh em) | §3 |
| 6 | `rowFromLease()` cắt `owner` **và khai** `["owner"]` xuống DB | §3.2 |
| 7 | ô **BIÊN** 160 ⇒ `[]` | §3.2 |
| 8 | `docCoCat()` đọc `NULL` ⇒ **KHÔNG BIẾT** (`unknownIdentityRows = 1`) | §3.4 |
| 9 | đường **GHI mặc định** của máy chủ đang chạy khai `[]` cho **cả 4** hàng của nó | §0.1 |

### 6.2 · ⚠ CHƯA ĐI — khai rõ, không lấp

| # | đường CHƯA chạy sống | vì sao / mức |
|---|---|---|
| C1 | **7/8 điểm gọi `verifyTotpOnce` còn lại**: `_core/trpc.ts` step-up (7 `deployProcedure`) · `twoFactorRouter.{enable,disable,verify,regenerateBackupCodes}` · `userRouters.{verify2FA,disable2FA}` | ⚠ Sổ là **một** (cùng bảng, cùng hàm), nên rủi ro **thấp** — nhưng *"cái gì LIỆT KÊ thì có phần tử N+1"* đã đúng **chín** lần. Đường **nguy nhất chưa đi**: `twoFactor.disable` (**tắt luôn 2FA**) và `regenerateBackupCodes` |
| C2 | **chuỗi `luot` 2–3 lượt verify / MỘT lượt bấm nút** (khối I-4 `_core/trpc.ts`) — thứ mà nếu sai sẽ **giết 100 % lệnh VRAM/deploy** | ⚠ **Chưa chạy sống một lần nào.** `/api/auth/verify-2fa` chỉ verify **MỘT** lần/request nên đường này **không** được lượt này chạm. Đây là **lỗ hổng lớn nhất của lượt nghiệm thu** |
| C3 | `vram.preempt` / `releaseStale` **thật** kèm `totpCode` | không dựng được từ mặt NGƯỜI (nợ **F1** của Pha 4: `VramBrokerPanel` **không gửi `totpCode`**); dựng bằng HTTP thì đi vào C2 — **để lại cho lượt sau** |
| C4 | **hai bản sao `ROLE=api`** cùng lúc (lỗ **A3**) | `.env` không đặt `ROLE` ⇒ topo một tiến trình; A3 **chỉ có bằng chứng lưới**, chưa có bằng chứng sống |
| C5 | `owner` **> 160 do MÁY CHỦ THẬT sinh ra** (đường dẫn model dài) | §3 dựng owner bằng tiến trình phụ; đường sản xuất (`ocrService`/`aiReranker`) **chưa** sinh chuỗi > 160 trên máy này (`max(length(owner))` thật = **43**) |
| C6 | hàng `NULL` do **một tiến trình cũ THẬT** ghi | §3.4 **mô phỏng** bằng `INSERT` thiếu cột. Đúng hình dạng, nhưng không phải một binary cũ thật |
| C7 | `textSummary` của **Agent** mang câu cảnh báo cắt danh tính | nợ tự khai ở Task 5 (`aiLocalKnowledgeService` — trần độ dài) — **vẫn còn** |
| C8 | lượt **thu hồi VRAM thật** (`nvidia-smi` trước/sau nhả byte) | không nằm trong bốn mục bắt buộc; §3 chỉ ghi **sổ**, không cấp phát card |

---

## 7 · DỌN — theo PID, và **còn đúng MỘT máy chủ**

### 7.1 · Tiến trình

| lượt | đã tắt (THEO PID) | đã dựng | ghi chú |
|---|---|---|---|
| **restart THỬ** (đo thời gian, trước ca thật) | `19520` (app) + `18892` (cross-env) + `19660` (npm) | **32528** | ⚠ xem 7.2 |
| **restart CỦA CA §2** | `32528` (app) + `6096` (cross-env) | **11428** | `ALL_DOWN_MS=471` · `HEALTH_AFTER_KILL=DOWN` · `HEALTHY=True TOTAL_MS=7102` |

**Trạng thái cuối — đếm được:**

```
node dist/index.js        → PID 11428  (cha 37028 = cross-env)     ← ĐÚNG MỘT
cross-env …dist/index.js  → PID 37028
tiến trình tsx/tạm còn sót → KHÔNG CÓ
/api/health               → 200
```

### 7.2 · ⚠⚠ MỘT LỖI CỦA TÔI — vị từ khớp tiến trình **QUÁ RỘNG**, giết nhầm 12 sidecar MCP

Bản đầu của script restart khớp `CommandLine -match 'dist[\\/]index\.js'`. Vị từ ấy **cũng khớp**
`…\@upstash\context7-mcp\dist\index.js` và `…\data-agent-kit-starter-pack\mcp\dist\index.js` ⇒ lượt
restart THỬ đã tắt **12 tiến trình sidecar MCP** của công cụ (playwright / context7 / data-agent-kit)
ngoài máy chủ ứng dụng.

- **Không** tiến trình nào của **dự án** bị ảnh hưởng; **không** dữ liệu nào bị đụng.
- Vị từ đã **siết ngay**: khớp **NGUYÊN VĂN** `CommandLine.Trim() -eq 'node dist/index.js'` ⇒ lượt
  restart của ca §2 chỉ bắt đúng **1** app + **1** wrapper (`KILL_TARGETS app=32528 wrappers=6096`).
- ★ Ghi ra vì nó đúng lớp lỗi mà chính chuỗi pha này đã trả giá **nhiều lần**: *một vị từ "gần đúng"
  trên một chuỗi CÓ CẤU TRÚC*, cùng họ với `pidTuOwnerNhanNuoi` ở §2.3(ii) của báo cáo Task 5.

### 7.3 · Dữ liệu

| việc | ĐO ĐƯỢC |
|---|---|
| hàng §3 dựng vào `vram_leases` | **3** (2 của tiến trình anh em + 1 hàng `NULL`) — **đã xoá hết** (`DELETE … RETURNING` = 2 + 1) |
| `vram_leases` cuối | **5 hàng**, đều của **PID 11428** + `vram:baseline`; **0** hàng `identityTruncated IS NULL` |
| `totp_consumed` cuối | **1 hàng** (mục còn sống của lượt xác minh cuối; nó **tự chết** ≤120 s) |
| DDL / seed / `kb:sync` / cấp quyền | **KHÔNG lượt nào** |
| mã sản xuất | **KHÔNG sửa một dòng** — `git status --porcelain -- server/ client/` **rỗng**, HEAD vẫn `5036eb5c` |
| file tạm | 4 file `__tmp_pha7ns_*` (trong repo, vì gói `postgres` chỉ resolve từ `node_modules` của repo) — **đã xoá**; `git status` không còn mục nào |

---

## 8 · BẢNG CỔNG RA — bước → kỳ vọng → ĐO ĐƯỢC → ĐẠT/HỎNG

| # | bước | kỳ vọng | **ĐO ĐƯỢC** | |
|---|---|---|---|---|
| 0 | tiền điều kiện | HEAD `5036eb5c`, `server/`+`client/` sạch, health 200, 1 máy chủ | `5036eb5c` · rỗng · **200** · PID 19520 | ✅ |
| 0.1 | cột mới trên DB **đang chạy** | `jsonb`, nullable, **không** DEFAULT | `jsonb` · `YES` · **`column_default = null`** | ✅ |
| 0.2 | đường GHI mặc định đã khai | 4 hàng của máy chủ mang cờ | **`[]` × 4**, 0 `NULL` | ✅ |
| 1 | đăng nhập 2FA thật | 200 + phiên | `login` 200 `{requires2FA}` → `verify-2fa` **200** + `set-cookie` | ✅ |
| 2 | phát lại **cùng** tiến trình | 401 | **401**, `luot` giữ nguyên | ✅ |
| **3** | ⚠⚠ **phát lại qua RESTART** | **401** trong khi mã **còn hợp lệ** | `speakeasyStillValid: true` + **401**, không phiên; hàng sổ mang `luot` của PID **đã chết** | ✅ **ĐẠT** |
| **4** | ⚠⚠ **đối chứng DƯƠNG** | mã **mới** vẫn qua | mã `875922`, **6,2 s** sau, **cùng** PID 11428 ⇒ **200** + phiên | ✅ **ĐẠT** |
| **5** | ⚠⚠ **B — `owner` 345 (>160)** | `["owner"]` trong DB | `length(owner)=160`, **`identityTruncated = ["owner"]`** (SQL thô, kết nối khác) | ✅ **ĐẠT** |
| **6** | ⚠⚠ **B — ô BIÊN 160** | **`[]`**, không khai cắt | `length(owner)=160`, **`identityTruncated = []`** | ✅ **ĐẠT** |
| 7 | B — không bắt nhầm | sổ cục bộ nguyên vẹn | `owner.length = 345`, `=== ` chuỗi gốc | ✅ |
| 8 | B — vế thứ ba `NULL` | đọc thành **KHÔNG BIẾT** | `unknownIdentityRows = 1`, `truncatedIdentityWrites = 0` | ✅ |
| 9 | tự dọn — **không cron** | quá hạn vẫn còn nếu không ai ghi | `20:56:37`: `count = 3`, **quá hạn = 3** (hàng sớm nhất quá hạn **137 s**) | ✅ |
| 10 | tự dọn — mã SAI | không ghi, không dọn | **401**, `count` **3 → 3** | ✅ |
| **11** | ⚠⚠ **tự dọn — một lượt ghi** | quá hạn **rời bảng** | **200**, `count` **3 → 1** | ✅ **ĐẠT** |
| 12 | không fail-closed ngầm | 0 dòng `[TotpOnce]` | `grep -c` = **0**; `SỔ CHUNG … KHÔNG ĐỒNG BỘ` = **0** | ✅ |
| 13 | dọn tiến trình | 1 máy chủ | PID **11428**, health **200**, 0 tsx sót | ✅ |

### 8.1 · BỐN MỤC BẮT BUỘC

| mục | kết quả |
|---|---|
| **1 · A2 SỐNG — phát lại qua RESTART bị chặn** | ✅ **ĐẠT** |
| **2 · đối chứng DƯƠNG — mã mới vẫn qua** | ✅ **ĐẠT** |
| **3 · B sống — cờ THẬT trong DB + ô BIÊN 160** | ✅ **ĐẠT** |
| **4 · sổ TỰ DỌN trên DB thật, đo bằng `count(*)`** | ✅ **ĐẠT** |

---

## 9 · NỢ MỞ RA / CÒN LẠI

| # | mục | mức |
|---|---|---|
| **N1** | ⚠⚠ `/api/auth/verify-2fa` **cấp phiên mà KHÔNG cần bước mật khẩu** (`oauth.ts:380-408` đọc `userId` thẳng từ body) — đo được ở §1.1 | 🟠 **nợ CÓ TRƯỚC**, **không** do Task 5. Chờ chủ dự án định đoạt — task này **ĐO**, không chữa |
| **N2** | ⚠⚠ **C2** — chuỗi `luot` 2–3 lượt verify / một lượt bấm nút **chưa chạy sống lần nào**; hỏng đường này ⇒ **100 % lệnh VRAM/deploy chết** | 🟠 lỗ lớn nhất của lượt nghiệm thu |
| **N3** | 7/8 điểm gọi `verifyTotpOnce` chưa chạy sống (nguy nhất: `twoFactor.disable`, `regenerateBackupCodes`) | 🟡 |
| **N4** | **A3** (hai bản sao `ROLE=api`) chỉ có bằng chứng **lưới** | 🟡 topo hiện tại một tiến trình |
| **N5** | `aiLocalKnowledgeService` — câu cảnh báo cắt danh tính có bị trần `textSummary` cắt không (nợ tự khai ở Task 5) | 🟡 **vẫn còn** |
| **N6** | Nợ **F1** Pha 4 — `VramBrokerPanel` không gửi `totpCode` ⇒ C3 không dựng được từ mặt NGƯỜI | 🟡 có trước |

---

> **Trạng thái cuối: ✅ CẢ BỐN MỤC BẮT BUỘC ĐẠT.**
> Không sửa một dòng mã sản xuất · không DDL/seed/`kb:sync`/cấp quyền · HEAD vẫn `5036eb5c` ·
> `server/`+`client/` sạch · còn **đúng một** máy chủ (**PID 11428**, health **200**).
