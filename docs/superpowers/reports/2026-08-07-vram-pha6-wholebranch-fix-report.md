# Vá review TOÀN NHÁNH — Pha 6 · dải `8b066230..a38c8f3d`

> Yêu cầu: `docs/superpowers/reports/2026-08-07-vram-pha6-review-toan-nhanh.md`.
> Ràng buộc: §Global Constraints của `docs/superpowers/plans/2026-08-06-vram-pha6-backlog.md`
> (kế thừa toàn bộ của Pha 5).

- **Nhánh:** `feat/hmi-dep` · **HEAD trước:** `8b066230` · **HEAD sau:** `a38c8f3d` · **Ngày:** 2026-08-07
- **4 commit** · 12 file mã/lưới + 3 file locale + 1 file nền i18n

| Commit | Mục |
|---|---|
| `297da6dc` | 🔴 **C-2** — nửa VRAM của cùng một câu nay đứng trên bộ suy `server/**` |
| `65ecf2f7` | 🔴 **C-1** — payload sai HÌNH DẠNG thôi làm trắng cả `/ai-brain` |
| `1ada0526` | 🟠 **I-1** — `i18n:check` thôi mù theo cấu tạo + 33 nhãn `vramBroker.*` × 3 bản |
| `a38c8f3d` | 🟠 **I-2 + I-3 + I-4** — chặng cuối payload→mắt người đọc, và bảng chi phí đúng số |

---

## 0. Trạng thái cây

| Trục | KHI BẮT ĐẦU | KHI KẾT THÚC |
|---|---|---|
| `git log -1` | `8b066230` | `a38c8f3d` |
| Cổng — **14 đường**, `ls` kiểm **TRƯỚC KHI TIN** | 14/14 trên đĩa | **14/14 trên đĩa** |
| `npx vitest run <14 đường>` | ✅ 109 file / **1.861** ca | ✅ 109 file / **1.881** ca |
| `--sequence.shuffle.tests` | — | ✅ 109 file / **1.881** ca |
| `npm run check` (`tsc --noEmit`) | ✅ | ✅ |
| `npm run check:tests` | ✅ | ✅ |
| `npm run i18n:check` | ✅ *(và nó XANH VÌ LÝ DO SAI — xem I-1)* | ✅ *(nay có PASS B thật)* |
| `git status --porcelain server client shared drizzle scripts` | sạch | **sạch** |
| 243+ mục bẩn có trước (`knowledge/**` + docs) | — | **KHÔNG đụng**, không `git add -A` |
| Tiến trình PID 30108 | — | **KHÔNG đụng** |

⚠ **Cổng không đổi số đường:** `CONG` vẫn **14**, `FILE_CANH` vẫn **71** — cố ý. Toàn bộ lưới mới
được viết vào **file đã nằm trong cổng** (`server/routers/vramStepUpFreshness.test.ts` ·
`client/src/lib/vramReadSurface.unit.test.ts` · `server/services/aiLocalTools/vramPhrases.exhaustive.test.ts`),
nên `vramPha5Gate.test.ts` không phải sửa và **con số ghim vẫn canh đúng tập cũ**. Nếu có thêm một
file lưới mới thì hai con số ấy sẽ ĐỎ — đó là cơ chế, và nó đã được kiểm bằng chính lượt chạy cổng.

---

## 1. KHUÔN CHUNG — gọi tên trước, vá sau

> **Task 1, 2 và 5 ĐỀU dừng lời khai ở BIÊN PAYLOAD và đều gọi đó là "tới được người đọc".
> Chặng cuối — payload RA MÀN HÌNH — không task nào nhận.**

Đây là **một** khuyết điểm nhìn từ bốn phía, và nó là **cơ chế chung** của C-1, I-2 và I-3:

| Nhìn từ | Triệu chứng | Chặng bị đứt |
|---|---|---|
| **C-1** | một ô lệch hình dạng ⇒ **trắng cả trang** | payload → **màn hình** (không ai kiểm hình dạng ở nấc cuối) |
| **I-1** | 30/33 nhãn của chính bảng ấy chưa dịch | payload → **màn hình** (chữ tới nơi nhưng sai ngôn ngữ) |
| **I-2** | `truncatedIdentityWrites` có **0** người đọc | payload → **màn hình** và payload → **`textSummary`** |
| **I-3** | 424 byte/lượt · ≈298 KiB/giờ/panel · **0** lượt đọc | payload → **màn hình** và payload → **`textSummary`** |

**Hệ quả cho cách vá — luật của lượt này:** mỗi mục phải kết thúc ở **một bề mặt người thật nhìn**
(`VramBrokerPanel`) **hoặc** ở **chuỗi Agent thật đọc** (`textSummary`), **không** ở một ô payload.
Và **ca canh phải mang tên đúng phạm vi nó chứng minh** — *"tới được một ô"* thì đừng đặt tên là
*"tới được người đọc"* (lớp lỗi *"lưới XANH vì lý do sai"*, và nó **có tên** trong review).

Ba cách lượt này tuân thủ luật ấy:
1. Ca Agent tên **"…CÓ MẶT trong `textSummary`"** — chạy đúng đường thoát registry → handler →
   `textSummary`, và **nói thẳng** rằng chặng LLM *đọc* chuỗi ấy nằm ngoài tầm mọi lưới.
2. Ca client tên **"có ĐIỂM ĐỌC SẢN PHẨM trong mã render"** — và **nói thẳng** rằng repo có **0**
   file `*.test.tsx` nên *"pixel đã lên màn"* là **ô còn mở**, không phải ô được coi là đã đóng.
3. Cầu chì ∀ của C-1(b) **nói thẳng** rằng chuỗi bắt nguồn từ phần tử mảng (`.map((h) => h.reclaim.kind)`)
   nằm ngoài phạm vi.

---

## 2. 🔴 C-2 — mục nặng nhất: câu load-bearing sai ở DẠNG TỔNG QUÁT

**Commit `297da6dc`** · `server/routers/deployProcedureScan.ts` (+~250) ·
`server/routers/vramStepUpFreshness.test.ts` (+4 ca)

### Đã DÙNG LẠI bộ suy của Task 1b — KHÔNG viết bộ thứ ba

Xác nhận tường minh (yêu cầu của review): bản vá **không** tạo file bộ suy mới. Nó **mở rộng
`server/routers/deployProcedureScan.ts`** — chính hạ tầng Task 1b đã trả giá để học bài **R1b** —
và dùng lại nguyên các mảnh đã export/đã có ở đó:

| Mảnh dùng lại | Vai trò trong lượng từ mới |
|---|---|
| `moiFileTs()` (đệ quy `server/**`) | phạm vi quét — **không** dừng ở một thư mục, **không** ghim một file |
| `phanGiaiToi()` | danh tính module bằng **phép nối đường dẫn**, không bằng chính tả |
| `gocChuoi()` | định danh trái nhất của chuỗi `a.use(x).input(y)` |
| `laFileTest()` · `TEN_PHEP_SIET` · `TEN_SAN_DEPLOY` | phân đôi sản xuất/lưới · tên phép siết · tên sàn gốc |

`vramStepUpFreshness.test.ts` nhập **một** hàm: `quetLenhPhaHuyVram`. Không có bộ suy AST thứ ba.

### Hình dạng của lượng từ mới

> ***∀ mutation của BẤT KỲ `router({…})` nào dưới `server/**` mà với tới được một CƠ CHẾ PHÁ HUỶ
> VRAM: chuỗi thủ tục PHẢI chain `requirePerCallFreshTotp` — tại chỗ, HOẶC qua GỐC
> `deployProcedure`.***

**Tập cơ chế được SUY RA, không liệt kê** (đây là chỗ dễ tái diễn "phần tử thứ N+1" nhất):

1. **hạt giống** = ∀ hàm lệnh mà `VRAM_COMMAND_DESTRUCTIVE` phân loại PHÁ HUỶ → mọi định danh
   trong **thân** nó được **NHẬP từ một module KHÁC dưới `server/services/vram/**`**.
   Đo được hôm nay: đúng **2** — `vramPreempt.ts#preemptOwner` · `vramReconciler.ts#releaseStaleSharedRow`.
   (`byteRaApi`/`chungPhamVi` là hàm **cục bộ** của `vramCommands.ts` nên không lọt vào — đã đo.)
2. **tập phá huỷ** = **BAO ĐÓNG NGƯỢC** của hạt giống trên `server/**` — *ai gọi tới được cơ chế ấy*.
   Đo được: **21** nút.

⚠ **Vì sao bao đóng NGƯỢC chứ không XUÔI** — và đây là quyết định load-bearing: bao đóng **xuôi** từ
`vramPreemptCommand` sẽ nuốt cả `vramSharedLedgerStore` (mà **mọi** lượt đọc đi qua) ⇒ tập nở ra vô
nghĩa ⇒ lưới đòi step-up cho cả `state`. Bao đóng **ngược** từ một hạt giống nhỏ thì **bị chặn**, và
nó **fail-closed**: nở thêm nghĩa là **đòi thêm** OTP, không phải mở cửa.

⇒ `huyHoTieuThu` của W3 — hàm **MỚI**, **tên không khớp mẫu nào**, đặt ở **file khác**, gắn ở
**router khác** — **tự đưa mình vào tập** vì nó gọi `preemptOwner()`. Không ai phải nhớ khai gì.

### Ba cầu chì (đảo lượng từ thay vì im lặng bỏ sót)

1. hạt giống rỗng / bao đóng không rộng hơn hạt giống / quét trúng < 200 file ⇒ **ĐỎ**;
2. một hàm lệnh phân loại PHÁ HUỶ mà **không đóng góp cơ chế nào** ⇒ **ĐỎ** (*"bộ suy KHÔNG thấy
   đường phá huỷ của nó"*);
3. `export * from "…vram…"` ở bất kỳ file nào ⇒ **ĐỎ** (bao đóng theo TÊN không còn đủ).

Cộng một lượt lọc cạnh giả trong đồ thị gọi — **tên ô** của object literal và **tên thuộc tính** của
`a.b` bị bỏ, nếu không thì chính `VRAM_COMMAND_DESTRUCTIVE` (`{ vramPreemptCommand: true }`) tự trở
thành một "nút phá huỷ".

### Đo được (bộ suy chạy trên cây sạch)

```
soFileDuyet  1.788
coChe        server/services/vram/vramPreempt.ts#preemptOwner
             server/services/vram/vramReconciler.ts#releaseStaleSharedRow
nutPhaHuy    21
mutation     server/routers/vramRouter.ts:181 preempt      siet=true (từ GỐC)
             server/routers/vramRouter.ts:191 releaseStale siet=true (từ GỐC)
mu           []   ← 0 ô mù
```

### Đột biến

| # | Hình dạng | Kết quả |
|---|---|---|
| **W3 nguyên văn** | `huyHoTieuThu(owner)` (gọi `preemptOwner`) thêm vào `server/services/vram/vramPreempt.ts`; gắn `huyManh` vào **`server/routers/aiModelRouter.ts`** trên `roleProcedure("admin","supervisor","engineer").use(require2FA)` — **không step-up nào** | 🔴 **ĐỎ**, chạy **hai lần** (sau `297da6dc` và lại trên cây cuối `a38c8f3d`) |
| **W3-neg** (không bắt nhầm) | `vramRetryDeferredCommand` (**không** phá huỷ) gắn vào **cùng router ấy**, **cùng sàn không step-up** | ✅ **XANH 24/24** — bản vá **không chặn hết** |

**Tên ca đỏ của W3 (nguyên văn):**

```
FAIL server/routers/vramStepUpFreshness.test.ts
  > ★★★ C-2 — lượng từ 'lệnh phá huỷ VRAM' chạy trên `server/**`, không trên một file
  > ★★★ BẤT BIẾN C-2 — ∀ mutation dưới `server/**` với tới cơ chế phá huỷ PHẢI chain `requirePerCallFreshTotp`
AssertionError: mutation với tới được cơ chế phá huỷ VRAM mà KHÔNG chain `requirePerCallFreshTotp`
  ⇒ OTP của một lượt khác (hoặc KHÔNG OTP nào) mở được cửa giết tiến trình:
  expected 'server/routers/aiModelRouter.ts:89 `h…' to be ''
```

Toàn cổng dưới đột biến: **1 failed | 108 passed (109)** · **1 failed | 1.880 passed (1.881)**.
Khôi phục bằng `git checkout HEAD -- <file>` ⇒ cây sạch, cổng xanh lại toàn phần.

---

## 3. 🔴 C-1 — `/ai-brain` chết, và xếp hạng KHÔNG dựa vào lệch phiên bản

**Commit `65ecf2f7`** · `client/src/lib/vramReadSurface.ts` ·
`client/src/components/ai/VramBrokerPanel.tsx` · `client/src/pages/AIBrainDashboard.tsx` ·
`client/src/lib/vramReadSurface.unit.test.ts` (20 → 31 ca)

### Vế (a) — payload sai hình dạng rơi vào **từ vựng ĐÃ CÓ**

`VramReadSurfaceQuery` nhận một ô **BẮT BUỘC** `shapeUsable` (không `?`, không mặc định) — đó là
cách **duy nhất** khiến `tsc` đi tìm **mọi** người tiêu thụ và bắt từng người trả lời. Quyết định:

```ts
if (q.hasData) return q.shapeUsable ? "ready" : "unreadable";
```

**Không** thêm phạm trù mới: câu đúng ở đây là *"chưa đọc được"*, và nó là câu **thật**. Cơ chế dựng
ra để nói *"tôi không đọc được"* (`VRAM_READ_SURFACE_NOTICE`) nay nói được **đúng lúc** nó không đọc
được, chứ không chỉ khi tRPC ném lỗi.

`vramStateShapeProblems(data)` trả **danh sách đường hỏng**, không phải một `boolean` câm — một lượt
điều tra cần biết **ô nào** lệch, và đó cũng là thứ ca đột biến khẳng định.

⚠ `AIBrainDashboard` cũng phải sửa, và lý do đáng ghi: nó viết `vb?.headroom.ceilingBytes` — dấu `?.`
che **một** nấc (`vb`), **không** che `headroom`. Cùng lỗ, khác chỗ.

### Vế (b) — đột biến KIỂU MỚI, và một ∀ suy TỪ MÃ RENDER

Review nói đúng chỗ đau: **cả bốn đột biến của Task 2 đều chạy TRONG hệ kiểu**. Nên bản vá thêm
**đúng loại đột biến còn thiếu** — người tiêu thụ **đã biên dịch trước** đọc payload mới/cũ:

- ca `★★★ ĐỘT BIẾN HÌNH DẠNG: payload CŨ (thiếu ô effective) ⇒ unreadable, TUYỆT ĐỐI không ready`
  dựng đúng payload trước Task 2 (`headroom.effectiveBytes`, không có `effective`).

Và vì một bảng đường viết tay là một danh sách (⇒ **có phần tử thứ N+1**), cầu chì **suy tập ra khỏi
mã**: mọi chuỗi truy cập bắt nguồn từ **biến giữ payload** (tìm trên CÂY: `const s = <query>.data`,
`const vb = <query>.data` — không đoán theo tên), rồi mọi **tiền tố TRUNG GIAN** (bị truy cập tiếp,
hoặc bị `...spread`) phải có mặt ở `VRAM_STATE_REQUIRED_PATHS` **hoặc** `VRAM_STATE_GUARDED_PATHS`
(kèm **lý do có chữ** — một cửa miễn trừ không lý do là một cửa).

### Đột biến

| # | Hình dạng | Ca đỏ |
|---|---|---|
| **M-C1a** | gỡ phép canh: `if (q.hasData) return "ready";` | 🔴 `★★★ ĐỘT BIẾN HÌNH DẠNG: payload CŨ (thiếu ô effective) ⇒ unreadable, TUYỆT ĐỐI không ready` — *expected 'ready' to be 'unreadable'*. Cổng: 1 failed / 108 passed |
| **M-C1b** | `shapeUsable: true` (hằng) ở panel — **biên dịch được**, khôi phục nguyên vẹn lỗi C-1 | 🔴 `★★★ VramBrokerPanel: ô shapeUsable PHẢI đến từ vramStateShapeUsable(...), không phải một hằng` — *expected 'true' to contain 'vramStateShapeUsable('* |
| **M-C1c** | thêm một truy cập sâu MỚI chưa khai (`s.tick.ageMs`) vào panel | 🔴 `★★★ VramBrokerPanel: mọi nút bị truy cập sâu / bị spread phải có ở BẮT BUỘC hoặc CÓ-CANH-RIÊNG` — *expected 'tick' to be ''* |
| **đối chứng dương** | ảnh chụp ĐỦ hình dạng | ✅ `ready`, 0 lỗi |
| **không bắt nhầm** | `foreign.known===false` · `lastReason===null` · `unverifiedReasons===null` (trạng thái **bình thường**) | ✅ vẫn `ready` — nếu không, `/ai-brain` sẽ nói *"chưa đọc được"* **mãi mãi** |

Cả ba khôi phục bằng `git checkout HEAD -- <file>`; cổng xanh lại toàn phần sau mỗi lượt.

---

## 4. 🟠 I-1 — `i18n:check` mù THEO CẤU TẠO (ba lỗ lượng từ), + 30 nhãn vắng

**Commit `1ada0526`** · `scripts/i18n-check.mjs` · `scripts/i18n-missing-baseline.json` (mới) ·
`client/src/i18n/locales/{vi,en,zh}.json`

### Con số đo lại (bằng chính công cụ đã ship, không bằng công cụ khác)

| | |
|---|---|
| khoá `vramBroker.*` được mã tham chiếu | **33** |
| có mặt ở cả ba locale trước bản vá | **3** (`commandError`, `readDenied`, `readUnreadable`) |
| **vắng ở CẢ BA** | **30** ✔ khớp bản khai của review |
| toàn repo: khoá được mã tham chiếu | **13.859** |
| toàn repo: vắng ở cả ba | **841** · vắng ở một phần: **20** (tất cả chỉ có `en`) |

### Ba lỗ, cả ba là **LƯỢNG TỪ SAI** — và cả ba đã đóng

1. lượng từ chạy trên **khoá CÓ TRONG FILE DỊCH** thay vì **khoá được MÃ tham chiếu** ⇒ khoá vắng
   ở cả ba là **vô hình tuyệt đối**. → **PASS B mới** quét `client/src/**/*.{ts,tsx}` (bỏ `*.test.*`)
   lấy `t("a.b")` **và** `key: "a.b"` khi `a` là một không-gian cấp một **có thật** (bảng hằng như
   `VRAM_READ_SURFACE_NOTICE` giữ khoá ở đó chứ không ở lời gọi `t(`).
2. `if (present.length < 2) continue` ⇒ dịch cho **đúng một** ngôn ngữ vẫn xanh. → **đã bỏ**; khoá
   chỉ có ở một locale nay được PASS B nói bằng câu đúng (`MISSING IN vi/zh`).
3. chỉ so **PLACEHOLDER**, **không bao giờ** so **SỰ CÓ MẶT**. → PASS B **là** phép so sự có mặt.

### Vì sao có một file NỀN, và vì sao nó KHÔNG phải một cửa miễn trừ

841 khoá thiếu là **nợ CÓ TRƯỚC của ~25 màn** (`approvalsInbox` 63 · `changeoverWizard` 54 ·
`cockpit` 50 · `synapse` 45 · `ncr` 42 …), không phải của lượt vá này. Bật cứng lên ⇒ cổng đỏ vĩnh
viễn ⇒ **không ai chạy nó nữa** (đúng cách một cổng chết). Nên nợ được **ĐẾM · GHI TÊN · ĐÓNG BĂNG**
ở `scripts/i18n-missing-baseline.json`, và nó là một **BÁNH CÓC hai chiều**:

- khoá **mới** thiếu, không có trong nền ⇒ **ĐỎ**;
- khoá **đã dịch xong** (hoặc đã gỡ khỏi mã) mà **còn** trong nền ⇒ **ĐỎ** (`BASELINE STALE`) ⇒ nền
  chỉ **thu hẹp được**, không phình được.

⚠ Nền ghi **TỪNG TÊN**, **không** phải một con số — vì *"hoán vị hai phần tử giữ nguyên TẬP"* là bài
học Pha 5 đã trả giá (hai cổng "độc lập" cùng canh TẬP thay vì ÁNH XẠ).
⚠ `--update-baseline` **cố ý** phải gõ tay: một lượt cập nhật nền là **quyết định phải nói ra**, và
nó hiện thành diff trong review.
⚠ **Giới hạn nói thẳng:** khoá dựng **động** (`` t(`a.${x}`) ``) nằm NGOÀI lượng từ này — ô còn mở.

### 33 nhãn `vramBroker.*` × **ba bản thật**

30 nhãn đang thiếu + **3** nhãn mới cho chặng cuối I-2/I-3 (`truncatedIdentityWrites` ·
`truncatedIdentityWarning` · `effectiveIsFlowing`). Sau lượt này nền còn **817 + 20**.

⚠ **Bất đối xứng mà review chỉ ra, nay đã cân:** mặt **Agent** của module này bị cưỡng chế **ba bản
thật** (`vramPhrases.exhaustive.test.ts`: `en` chỉ ASCII · `zh` có Hán tự · khuôn không rẽ nhánh);
mặt **người** trước bản vá có **0** phép canh — nay có **PASS B** cưỡng chế sự có mặt ở cả ba locale.

### Đột biến

| # | Hình dạng | Kết quả |
|---|---|---|
| **M-I1** (bắt buộc) | xoá **toàn bộ** khối `vramBroker` khỏi **cả ba** locale | 🔴 **ĐỎ**, `exit 1`, **31 NEW key(s) missing in all 3**, mỗi khoá gọi đích danh kèm file dùng nó |
| **M-I1b** (không bắt nhầm, một locale) | xoá **một** khoá (`vramBroker.preempt`) khỏi **riêng `en`** | 🔴 **ĐỎ**, `exit 1`, `MISSING IN en vramBroker.preempt` — đúng lỗ (2) mà bản cũ bỏ qua im lặng |
| **M-I1c** (bánh cóc) | **dịch xong** một khoá đang nằm trong nền (`aboutPage.stack.items`) | 🔴 **ĐỎ**, `BASELINE STALE … xoá nó khỏi i18n-missing-baseline.json` |
| đối chứng | cây sạch | ✅ `exit 0`, `0/0/0/0` |

---

## 5. 🟠 I-2 + I-3 — chặng cuối: payload → `textSummary` và payload → màn hình

**Commit `a38c8f3d`** · `server/services/aiLocalTools/vramPhrases.ts` · `vramTools.ts` ·
`vramPhrases.exhaustive.test.ts` (+2 ca) · `client/src/components/ai/VramBrokerPanel.tsx` ·
`client/src/lib/vramReadSurface.unit.test.ts` (+3 ca)

### I-2 — `truncatedIdentityWrites` nay có **hai** người đọc

- **Agent:** `CAU.foreignKnown` nhận thêm tham số `truncated` (× 3 bản thật) ⇒ con số đi trong
  **dòng chữ**, chỗ Agent thật sự đọc. Cộng một khoá **mới** `foreignTruncatedIdentity` — dòng
  **HÀNH ĐỘNG** khi con số ≠ 0, nói ra **hậu quả thật**: `preempt({owner})` gửi chuỗi của **mặt đọc**
  còn sổ giữ chuỗi **đã cắt** ⇒ hai chuỗi không khớp ⇒ hộ ấy **không thu hồi được**.
  ⚠ Phép rẽ nhánh nằm ở **call-site** (`vramTools.ts`), **không** trong khuôn câu — §A-AST cưỡng chế
  *"thân khuôn phải là một biểu thức chuỗi THUẦN, không rẽ nhánh"*.
- **Người:** một dòng `text-destructive` ở `VramBrokerPanel`, qua hai khoá dịch mới.

### I-3 — câu *"nó đang chảy"* nay đi **cùng** con số

- **Agent:** thêm vào `CAU.headroom` (vi/en/zh) — **đúng cái giá Task 2 đã tính** (*"3 chuỗi khuôn,
  0 khoá i18n mới"*). Lý do là thứ chính nhánh này đã đo: Agent **chỉ nhận `textSummary`**
  (`aiLocalKnowledgeService.ts:2351` đường stream · `:2070`/`:2396` đường không stream —
  `data.state` **không bao giờ** tới LLM), nên với Agent lượt đổi kiểu của Task 2 là **vô hình**.
- **Người:** một dòng dưới con số MiB, qua khoá `vramBroker.effectiveIsFlowing`.

### Ca canh — tên đúng phạm vi, giới hạn nói thẳng

| Ca | Nó chứng minh | Nó **KHÔNG** chứng minh (đã ghi trong ca) |
|---|---|---|
| `★★★ I-3 — con số dư địa hiệu lực ĐI KÈM câu 'nó đang chảy', ở CẢ BA ngôn ngữ` | chuỗi đi hết registry → handler → **`textSummary`** | LLM **đọc** chuỗi ấy |
| `★★★ I-2 — lời khai truncatedIdentityWrites CÓ MẶT trong textSummary` | như trên | như trên |
| `★★★ I-2: truncatedIdentityWrites có ĐIỂM ĐỌC SẢN PHẨM trong mã render` | có call-site sản phẩm | **pixel đã lên màn** (repo có **0** file `*.test.tsx`) |
| `★★★ I-3: câu 'ĐANG CHẢY' … đi QUA lớp dịch` | là **KHOÁ**, không phải câu viết tay | — |

⚠ Ba bản thật của hai khoá mới **không cần** ca riêng: §A của `vramPhrases.exhaustive.test.ts` đã
cưỡng chế *"∀ khoá có ba bản CÓ CHỮ · `en` chỉ ASCII · `zh` có Hán tự"*, và §B cưỡng chế
*"TẬP KHOÁ DÙNG ≡ TẬP KHOÁ KHAI"*. Máy móc đã có sẵn; lượt này chỉ đưa khoá vào.

---

## 6. 🟠 I-4 — bảng chi phí sai **cả hai** con số

**Commit `a38c8f3d`** · `server/_core/trpc.ts` (2 khối) · `server/routers/vramRouter.ts` (1 khối)

Đếm lại trên chuỗi **thật** của `vram.preempt`/`releaseStale`:

```
requireFreshTotp → requirePerCallFreshTotp (GỐC, Task 1b) → requirePermission
                 → requirePerCallFreshTotp (lần HAI, vramRouter.ts, Task 1)
```

`stepUpTotpMiddleware(false)` **không có** đường thoát sớm (`until` luôn `undefined`); mỗi
`verifyFreshTotp` = **1 `SELECT users` + 1 `speakeasy.totp.verify`**.

| | câu CŨ trong mã | sự thật |
|---|---|---|
| cache-miss | "hai lần" | **3** lượt verify |
| cache-hit | *(hàm ý 0 — "chỉ xảy ra trên đường cache-miss")* | **2** lượt verify |
| điều kiện | "chỉ trên đường cache-miss" | lượt verify thừa xảy ra ở **MỌI lượt gọi** |

**Không phải lỗi an ninh** (thừa theo chiều CHẶT). Nhưng ai đọc con số cũ để quyết *"có nên chain
per-call ở một sàn thứ ba không"* sẽ tính thiếu ~50 %, và một lượt điều tra hiệu năng thấy 3
`SELECT users` cho **một** lượt bấm nút sẽ không tìm ra lời giải thích đúng trong mã.

⚠ **Đính chính thứ HAI, sinh ra từ chính lượt vá này:** lý do giữ `.use()` ở `vramRouter.ts`
(*"gỡ nó đi là gỡ mất phép canh riêng"*) **KHÔNG CÒN ĐÚNG** sau C-2 — `quetLenhPhaHuyVram()` chấp
nhận phép siết đến **tại chỗ HOẶC qua GỐC**, nên hôm nay lượt `.use()` ấy là quyết định thuần về
**chi phí**. Câu ấy đã được ghi vào mã kèm cảnh báo **đừng trích lại câu cũ** — cùng khuôn mà Task
1b đã dùng khi bác lý do sai của Task 1 (điểm mạnh nhất của nhánh, §8 của review).

---

## 7. Mục **KHÔNG** sửa, kèm lý do

| Mục | Vì sao không đụng |
|---|---|
| **M-1** `stepUpVerifiedUntil` không quyết định kết quả lượt gọi nào | Review tự xếp *"ghi nhận, không phải lỗ"*; điểm dùng **đã được canh** (`deployStepUpFreshness.test.ts:537`). Gỡ nó là **nới** một phép canh — ngược chiều "chỉ THU HẸP". Vẫn nằm ở §6 nợ Pha 7. |
| **M-2** `vramEventLog.VARCHAR_LIMITS` liệt 5/7 cột | Review đo **không khai thác được hôm nay** (`resourceKind` không có trong `VramEventInput`; `wouldRefuse` là `boolean` → `String()` ≤ 5 < 8). Ngoài phạm vi yêu cầu (không nằm trong C/I). Nợ Pha 7 §6.6. |
| **M-3** 3 file test tự khai một pha nằm ngoài cổng | Đưa chúng vào cổng = **thêm đường** ⇒ `CONG` 14 → 17 và `FILE_CANH` đổi ⇒ chạm một quyết định về **phạm vi cổng** mà review không yêu cầu ở lượt này. Con số **không đổi** sau lượt vá (đã kiểm: cổng vẫn 14/71 xanh). |
| **M-4** bất biến máy chủ canh từ nửa client | Review tự xếp là **ghi nhận về VỊ TRÍ hàng rào**; hàng rào **CÓ** và W1 chứng minh nó có răng. Di chuyển nó là một lượt tái cấu trúc lưới, không phải một lỗ. |
| **M-5** `VRAM_BEFORE_AFTER_EVIDENCE` — câu tiếng Việt ghim cứng trên dây API | Cùng trục I-3, nhưng **đường vá đúng là gỡ hẳn ba ô ấy khỏi dây** (chúng nay đã có bản thay thế **có người đọc** ở cả `textSummary` lẫn panel). Gỡ ô khỏi payload là một **thay đổi phá vỡ thứ hai** ngay sau C-1 — chính lớp lỗi vừa vá. Ghi vào nợ Pha 7 như một lượt dọn **có kế hoạch**. |
| **restart PID 30108** để `/ai-brain` sống lại ngay | Ràng buộc **cấm giết tiến trình 30108**. Bản vá đóng **cơ chế** (payload lệch ⇒ nói "chưa đọc được" thay vì trắng trang); một lượt phát hành/khởi động lại vẫn cần thiết để bản đang phục vụ nhận mã mới — **việc của chủ dự án**. |
| **BA tuyến REST deploy không cần OTP** · **chống phát lại** · 9 thủ tục `canDelete` · 31 thủ tục `canView` | **Chờ chủ dự án** (đã treo từ Pha 5). Không cấp quyền nào, không đụng. |
| Nợ CÓ TRƯỚC: `canUseAgentic({role:"engineer"})` · flake `wiring.inprocess`/`visionControl.tools`/`vramReconciler.test.ts` · 16 file đỏ `server/routers/**` · 5 ca `server/services/programming/**` · 10 ca `server/services/ai/**` (`42501`) · `programmingRouter.safetyGuard.test.ts` | **Nợ có trước**, ghi để không ai nhận nhầm là hồi quy của lượt này. Không đụng. |

---

## 8. Đối chiếu LĂNG KÍNH — lượt vá này có tái diễn lớp lỗi nào không?

| Lớp lỗi | Lượt vá này |
|---|---|
| **"Cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"** | **Đã lường trước ở CẢ BA chỗ đẻ ra danh sách:** tập cơ chế C-2 **suy ra** từ thân hàm lệnh (không liệt kê) · bảng đường C-1 bị một ∀ **suy từ mã render** cưỡng chế · nền i18n ghi **từng tên** + bánh cóc hai chiều. |
| **LƯỢNG TỪ SAI** ("tồn tại" chỗ cần "với mọi") | Ba lỗ của `i18n:check` đóng bằng đúng phép đảo lượng từ; C-2 đổi từ *"file này"* sang *"∀ mutation dưới `server/**`"*. |
| **"Lưới XANH vì lý do sai"** | Mọi ca mới **được đặt tên đúng phạm vi nó chứng minh**, và **giới hạn được viết vào chính ca** (3 chỗ). |
| **"Hàng rào KHÔNG AI CANH"** | `shapeUsable` bị canh **theo GIÁ TRỊ** (không chỉ sự có mặt); nền i18n bị canh **hai chiều**. |
| **"Độc lập về NGUỒN ≠ độc lập về SAI LẦM"** | Bản vá C-2 **gộp về MỘT bộ suy** thay vì dựng bộ thứ ba — chính là lời giải của lớp lỗi này. |
| **"Docstring tự xưng là luật mà mâu thuẫn mã"** | I-4 sửa 3 khối, và ghi **cấm trích lại** câu cũ. |
| **"Cổng chạy glob rỗng ⇒ vitest im lặng"** | Cổng vẫn **14 đường tường minh**, `ls` kiểm trước **hai lần** (đầu + cuối). Không lưới mới nào nằm ngoài cổng ⇒ `CONG=14`/`FILE_CANH=71` không phải sửa. |
| **"Trả nợ ĐẺ RA nợ"** | Lượt này đẻ ra **hai** món và **cả hai đã được ghi ngay**: (1) nền i18n 817+20 phải thu hẹp dần; (2) ba ô `notAnInvariant`/`variesWith`/`beforeAfterEvidence` nay **thừa** trên dây (M-5) — gỡ chúng là một thay đổi phá vỡ, phải làm có kế hoạch. |

---

## 9. Nợ mang sang Pha 7 (cập nhật sau lượt vá)

**Đã đóng ở lượt này:** C-2 · C-1 (vế cơ chế) · I-1 · I-2 · I-3 · I-4.

**Còn mở / mới sinh:**
1. 🔴 **Một lượt khởi động lại tiến trình 30108** (hoặc một lượt phát hành) để bản đang phục vụ nhận
   mã mới — **việc của chủ dự án**, ràng buộc cấm đụng tiến trình.
2. 🟠 **Nền i18n `817 + 20`** — mỗi lượt sau phải **thu hẹp**, không được phình. ~25 màn đang nói
   tiếng Việt cho phiên `en`/`zh`.
3. 🟠 **M-5** — gỡ `notAnInvariant`/`variesWith`/`beforeAfterEvidence` + `VRAM_BEFORE_AFTER_EVIDENCE`
   khỏi payload (424 byte/lượt) **sau khi** bản client mới đã lên khắp nơi. Đây là một **thay đổi phá
   vỡ**; sau C-1 nó **hỏng theo chiều an toàn** (client mới thấy thiếu ô ⇒ *"chưa đọc được"*, không
   trắng trang), nhưng vẫn phải có kế hoạch.
4. 🟡 **M-2** — chĩa lượng từ ∀-cột sang `vram_events` (5/7 cột).
5. 🟡 **M-3** — 3 file test tự khai một pha còn ngoài cổng.
6. 🟡 Khoá i18n **dựng động** nằm ngoài lượng từ PASS B · chuỗi bắt nguồn từ **phần tử mảng**
   (`.map((h) => h.reclaim.kind)`) nằm ngoài cầu chì C-1(b) · repo vẫn **0** file `*.test.tsx`
   (không harness render ⇒ *"pixel đã lên màn"* không lưới nào chứng minh được).
7. Treo từ trước, **chờ chủ dự án**: BA tuyến REST deploy không cần OTP · không chống phát lại ·
   9 thủ tục `machine_control/canDelete` · 31 thủ tục `canView` · 6 tên module ngoài `PERMISSION_MODULES`.

---

## 10. Xác minh bằng `git show` (không tin `git status`, không tin trí nhớ)

```
297da6dc:server/routers/deployProcedureScan.ts        'quetLenhPhaHuyVram'              → 1
297da6dc:server/routers/vramStepUpFreshness.test.ts   'BẤT BIẾN C-2'                    → 1
65ecf2f7:client/src/lib/vramReadSurface.ts            'vramStateShapeUsable'            → 2
65ecf2f7:client/src/components/ai/VramBrokerPanel.tsx 'shapeUsable: vramStateShapeUsable' → 1
1ada0526:scripts/i18n-check.mjs                       'missingInAllLocales'             → 4
1ada0526:client/src/i18n/locales/en.json              'effectiveIsFlowing'              → 1
a38c8f3d:server/services/aiLocalTools/vramPhrases.ts  'foreignTruncatedIdentity'        → 1
a38c8f3d:server/routers/vramRouter.ts                 'cache-miss = 3'                  → 1
a38c8f3d:client/src/components/ai/VramBrokerPanel.tsx 'truncatedIdentityWarning'        → 1
```

---

## 11. Tuân thủ ràng buộc

✅ **COMMIT TRƯỚC, ĐỘT BIẾN SAU** — cả 7 đột biến (W3 ×2 · W3-neg · M-C1a/b/c · M-I1/b/c) đều chạy
**sau** commit của mục tương ứng.
✅ Khôi phục **duy nhất** bằng `git checkout HEAD -- <file>` · chạy lại **TOÀN BỘ** sau mỗi lượt.
✅ Cổng theo **ĐƯỜNG DẪN TƯỜNG MINH**, `ls` kiểm **TRƯỚC KHI TIN** (14/14, hai lần) · cộng một lượt
`--sequence.shuffle.tests`.
✅ `CONG=14` / `FILE_CANH=71` **không phải sửa** vì không sinh file lưới mới — đã kiểm bằng lượt chạy
`vramPha5Gate.test.ts` trong cổng.
✅ **KHÔNG** DDL/seed · **KHÔNG** `kb:sync` · **KHÔNG** trainer · **KHÔNG** cấp quyền nào ·
**KHÔNG** tự sinh sub-agent.
✅ **KHÔNG** đụng 243+ mục bẩn có trước · **KHÔNG** `git add -A` (mọi commit `git add` theo đường dẫn).
✅ **KHÔNG** đụng tiến trình PID 30108.
✅ Script tạm chỉ nằm trong thư mục scratchpad của phiên, không có file tạm nào trong repo.
