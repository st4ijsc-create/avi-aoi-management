# NGHIỆM THU SỐNG — Pha 5 · module điều phối VRAM

**Nhánh:** `feat/hmi-dep` · **HEAD:** `ebfec4a5` · **Ngày đo:** 2026-08-07
**Kịch bản:** §9 của `docs/superpowers/reports/2026-08-06-vram-pha5-review-toan-nhanh.md` (14 bước)
**Lượt cấp quyền:** `docs/superpowers/reports/2026-08-06-vram-pha5-cap-quyen.md` (ĐÃ CHẠY, không cấp lại)

> ⚠ Task này **ĐO**, không chữa. Không một dòng mã sản xuất nào được đổi để một lượt nghiệm thu qua.
> ⚠ Báo cáo **ghi DẦN** — mỗi mục viết ngay sau khi đo xong.

---

## 0. Baseline — đo TRƯỚC khi đụng vào bất cứ thứ gì

| kiểm | lệnh | kết quả |
|---|---|---|
| HEAD | `git rev-parse --short HEAD` | **`ebfec4a5`** ✅ |
| cây sản xuất sạch | `git status --porcelain -- server/ client/` | **rỗng** ✅ |
| commit HEAD | `git log -1 --format=%ci` | `2026-08-06 23:39:39 +0700` |

### 0.1 Hệ ĐANG CHẠY trước lượt đo (đo bằng `netstat` + `Get-CimInstance`, không đoán)

| thành phần | giá trị |
|---|---|
| tiến trình ứng dụng | **PID 32368** — `node dist/index.js`, `NODE_ENV=production`, LISTENING `0.0.0.0:3000` |
| chuỗi cha | `pnpm start` (PID 32952) → PID 7228 → `cross-env` PID 33704 → **PID 32368** |
| khởi động lúc | `8/7/2026 6:06:39 AM` |
| artefact `dist/index.js` | `8/7/2026 5:56:34 AM` · 10.580.250 B |
| artefact `dist/public/index.html` | `8/7/2026 5:56:32 AM` |
| `dist/index.js` có chuỗi `vram_control`? | **3 lần** ⇒ bản dựng này **đã** mang mã Pha 5 |
| `dist/public/assets/index-DN8l8I8M.js` có `vram_control`? | **CÓ** |

⇒ Máy chủ đang chạy **có vẻ** đã ở `ebfec4a5`, nhưng **không chứng minh được** cây lúc dựng có sạch
không ⇒ **vẫn dựng lại từ đầu** (đúng nhịp 1 + nhịp 3 của brief).

### 0.2 Cấu hình ĐANG CHẠY (`.env`)

| khoá | giá trị | dòng |
|---|---|---|
| `DATABASE_URL` | `postgresql://avi_app:***@127.0.0.1:5434/aoi_management` | 10 |
| `PORT` | `3000` | 14 |
| `AI_TOOL_LLM_FALLBACK` | `1` | 208 |
| `AI_AGENTIC_ENABLED` | `1` | 448 |
| `ACTUATION_STEPUP_2FA` | **`true`** | 568 |
| `RBAC_SCOPED_ADMIN` | **KHÔNG CÓ** (mặc định OFF) — ⇒ M-3 của review **chưa sống** | — |

### 0.3 GPU baseline — TRƯỚC mọi thao tác

```
nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv
⇒ 32607 MiB tổng · 3239 MiB đang dùng · 28952 MiB trống       (2026-08-07, trước khi tắt server cũ)
```

---

## 1. NHỊP 1 + NHỊP 3 — dựng lại và khởi động lại (việc của lượt này)

⚠ Brief chia ba nhịp (máy chủ → cấp quyền → client). **Nhịp 2 đã xong** (lượt cấp quyền ghi thẳng DB,
không qua giao diện) ⇒ thứ tự ba nhịp **không còn ràng buộc** ở lượt này; `npm run build` dựng **cả
hai** (vite → `dist/public`, esbuild → `dist/index.js`) nên nhịp 1 và nhịp 3 đi cùng một lượt.

| việc | lệnh | kết quả ĐO ĐƯỢC |
|---|---|---|
| tắt máy chủ cũ **theo PID** | `taskkill /F /PID 32952 /T` | 6 tiến trình trong cây bị tắt (32952→13780→7228→29592→33704→**32368**); cổng 3000 **giải phóng** |
| GPU sau khi tắt | `nvidia-smi` | **3.239 → 1.025 MiB** (ứng dụng cũ giữ ~2.214 MiB) |
| dựng lại | `npm run build` | ✅ `vite build` **✓ built in 33,52s** · `dist/index.js` **10,1 MB** · `dist/worker.js` 4,5 MB · `dist/edgeGatewayMain.js` 3,6 MB |
| khởi động lại | `npm run start` (`NODE_ENV=production node dist/index.js`) | **PID 30108** · `Server running on http://localhost:3000/` |

### ★ Một phép đo bất ngờ: bản dựng client **KHÔNG ĐỔI MỘT BYTE**

Tên chunk chính sau lượt dựng lại vẫn là **`index-DN8l8I8M.js`** — **y hệt** bản đang phục vụ trước
lượt đo (§0.1). Tên chunk của Vite là **hash nội dung** ⇒ đây là bằng chứng đo được rằng **client
đang chạy trước lượt này ĐÃ là mã `ebfec4a5`**, không phải một bản cũ. Nhịp 3 vì thế là **xác nhận**,
không phải một lượt nâng cấp.

### Nền VRAM lúc khởi động (log máy chủ, nguyên văn)

```
[vram] nền thiết bị: 1018 MiB (thiết bị 1018 − đã commit 0 − anh em 0, thước "smi", chế độ "local")
[vram] SỔ CHUNG CHƯA ĐỌC ĐƯỢC ⇒ nền 1018 MiB chụp theo công thức CỤC BỘ (Pha 2B) …
[vram] "cuda-backend" KHÔNG CÓ CĂN CỨ NÀO để ước lượng … Ước lượng = 0.
```

⇒ Nền **1.018 MiB** — **sạch**, không có server dev nào sót lại (đối chiếu Pha 4: nền bẩn 11.830 MiB).

---

## 2. Tài khoản + cách đăng nhập (đo, không đoán)

`scripts/seed-test-data.mjs:81-84` khai bốn tài khoản seed, **mật khẩu `Test@1234`, 2FA BẬT**.
Đăng nhập bằng **`username`** (cả hai tài khoản `email = null`), qua `POST /api/auth/login` →
`{requires2FA:true}` → `POST /api/auth/verify-2fa` với **TOTP sinh từ `users.two_factor_secret`**
(cột thật tên `two_factor_secret`, **không** phải `twoFactorSecret`).

| user | id | vai | 2FA | đăng nhập | `vram_control` (đo lại từ DB) |
|---|---|---|---|---|---|
| `supervisor1` | 49 | `supervisor` | BẬT | ✅ | `canCreate=true`, **`canDelete=true`** |
| `engineer1` | 51 | `engineer` | BẬT | ✅ | `canCreate=true`, **`canDelete=false`** |
| `operator1` | 48 | `operator` | BẬT | ✅ | *(không có hàng)* |
| `maint1` | 50 | `maintenance` | BẬT | ✅ | *(không có hàng)* |

⇒ **Grant còn nguyên** sau lượt dựng lại + khởi động lại. **Không cấp lại gì**, **không đổi mật khẩu
nào**, **không tắt 2FA của ai**.

---

## 3. Bước 0 — `vram_control` có trong danh mục quyền của bản ĐANG PHỤC VỤ

⚠ `permissions.getAvailableModules` là **`adminProcedure`**, và tôi **không có mật khẩu của một tài
khoản admin thật**. Ràng buộc *"đừng đoán, đừng đổi mật khẩu"* ⇒ **không gọi sống thủ tục này**.
Thay bằng một phép đo **trên chính artefact đang chạy** (thủ tục là một `query(() => [ …mảng hằng… ])`
— **không đọc DB**, nên nội dung nó trả về **chính là** literal trong bundle):

```
node -e "…dist/index.js…"  ⇒  chuỗi "vram_control" xuất hiện 3 lần
literal danh mục tại offset 4.928.164:
  { category: "machine_control", moduleName: "vram_control",
    displayName: "Điều phối VRAM (thu hồi)", displayNameEn: "VRAM Broker (reclaim)",
    displayNameZh: "显存调度（回收）", description: "Ra lệnh cho bộ điều phối VRAM: …" }
```

| bước | kỳ vọng | ĐO ĐƯỢC | chấm |
|---|---|---|---|
| **0** | `getAvailableModules` trả một hàng `moduleName='vram_control'` | hàng **có trong bundle đang phục vụ**, đủ ba ngôn ngữ tên hiển thị | ⚠ **ĐẠT GIÁN TIẾP** — **chưa gọi sống** (thiếu phiên admin) |

**Bước 1–2 (cấp quyền):** ĐÃ CHẠY ở lượt riêng, **không lặp lại**. Đo lại bằng `SELECT` (§2): đúng 2
hàng, đúng bit ⇒ **ĐẠT**.
**Bước 3 (2FA):** đo được là **đã BẬT sẵn** cho cả bốn tài khoản ⇒ **ĐẠT**, không phải bật gì.
**Bước 4 (deploy client):** §1 ⇒ **ĐẠT** (và hash chunk chứng minh client vốn đã ở `ebfec4a5`).

---

## 4. ★★ MỤC BẮT BUỘC 3 — `engineer1` gọi **THẲNG** tRPC ⇒ **403**, đúng cổng, đúng bit

Không qua UI. `POST /api/trpc/vram.preempt?batch=1`, cookie phiên THẬT của `engineer1`, **kèm OTP
TƯƠI** sinh từ `two_factor_secret` (để lượt này **vượt qua** `requireFreshTotp` và chạm **đúng** cổng
RBAC — nếu không có OTP thì lượt sẽ chết ở cổng SAI, đúng bẫy Pha 4 đã mắc).

| # | lượt | HTTP | câu **ĐO ĐƯỢC** (nguyên văn) |
|---|---|---|---|
| **B3** | `engineer1` → **`vram.preempt`** `{owner:"gguf:Qwen3-Embedding-0.6B-f16", totpCode: 911640}` | **403** | `FORBIDDEN` — **"Bạn không có quyền delete cho module \"vram_control\""** |
| **B3b** | `engineer1` → **`vram.releaseStale`** + OTP tươi | **403** | `FORBIDDEN` — **"…quyền delete cho module \"vram_control\""** |
| **B3c** | `engineer1` → `vram.preempt` **KHÔNG** `totpCode` | **403** | cùng câu quyền (cache step-up còn hiệu lực — xem M-4 dưới) |
| **B3d** | `engineer1` → **`vram.retryDeferred`** (`canCreate=1`) | **200** | `outcome:"refused"`, `reason:"no-defer-chain-in-this-process"`, `hostedHere:true` ⇒ **QUA hết cổng, lệnh CHẠY** |

### ⇒ **C-1 KHÔNG SỐNG trên bản đang chạy — ĐẠT.**
Câu từ chối gọi đích danh **`vram_control`** và **`delete`**. `engineer1` có `canCreate=true` và
`canDelete=false`; nếu bản hoán vị `canDelete`↔`canCreate` đã ship thì B3 sẽ **THÀNH CÔNG** (đi thẳng
vào thân thủ tục giết tiến trình) và B3d sẽ **403**. **Quan sát được là ngược lại ở CẢ HAI ĐẦU** —
tức lượt này neo được **ánh xạ**, không chỉ tập.

### ★ M-4 quan sát được SỐNG (cache step-up 10 phút, không phải "OTP tươi")
B3c **không có `totpCode`** mà **vẫn qua** `requireFreshTotp` — vì B3 vừa nạp cache
`stepUpVerifiedUntil` cho **cùng `sessionToken`**. Đúng điều M-4 của review nói: *"OTP tươi"* là
**nói quá**; cơ chế thật là cache 10 phút dùng chung cho **mọi** `deployProcedure`.

---

## 5. ★★ MỤC BẮT BUỘC 2 (nửa tRPC) — bị từ chối **VÀ KHÔNG BYTE NÀO ĐỔI**

Đo hai đầu quanh **cả bốn** lượt B3/B3b/B3c/B3d:

| thước | TRƯỚC | SAU | chênh |
|---|---|---|---|
| `ledger.localBytes` | **2.197.463.040** | **2.197.463.040** | **0** |
| danh sách hộ (owner=bytes, sắp xếp) | `cuda-backend=452595712 \| gguf-embed-ctx:…=551575552 \| gguf:…=1193291776` | **y hệt** | **0** |
| số hộ | 3 | 3 | 0 |
| `nvidia-smi memory.used` | **3.243 MiB** | **3.243 MiB** | **0** |
| `headroom.rawBytes` | 30.919.254.016 | 30.919.254.016 | **0** |
| `headroom.effectiveBytes` | 30.589.722.022 | 30.163.081.566 | −426.640.456 ⚠ |

### ⚠ Ô `effectiveBytes` lệch — và tôi **KHÔNG** nhận nó là tác dụng phụ, vì đã đo CHỨNG CỨ

Chạy **chứng cứ đối chứng**: 9 lượt đọc `vram.state` liên tiếp trong **40 giây**, **KHÔNG một lệnh
nào** ở giữa:

| t | `effectiveBytes` | `rawBytes` | `charges.staleMargin` | `charges.sharedLedgerMargin` | `foreign.ageMs` |
|---|---|---|---|---|---|
| t+0s | **30.725.037.092** | 30.919.254.016 | **100.292.346** | **93.924.578** | **59** |
| t+5s … t+40s (8 lượt) | **28.771.770.368** | 30.919.254.016 | 1.073.741.824 | 1.073.741.824 | 5.088 → 40.342 |

⇒ `effectiveBytes` là **hàm của `foreign.ageMs`** — hai khoản phạt biên leo từ ~0 lên trần
1.073.741.824 B trong vòng ~5 giây sau mỗi nhịp đồng bộ sổ chung (chu kỳ 60 s). Lượt đọc rơi vào
**điểm nào của chu kỳ** quyết định con số. **`rawBytes` — đại lượng phụ thuộc SỔ — không nhúc nhích
ở bất kỳ lượt nào.**

⇒ **Kết luận ĐO ĐƯỢC: KHÔNG byte nào đổi.** Bất biến đúng là `rawBytes` + `localBytes` + danh sách
hộ + `nvidia-smi`, **không phải** `effectiveBytes`. (Pha 4 dùng `effectiveBytes` làm bằng chứng
"không đổi" và **may mắn** trúng — ở đây nó **sẽ cho kết luận SAI**.)

---

## 6. Bước 9 — `operator` bị chặn ở **cả hai** mặt · phụ: `maintenance`

| lượt | HTTP | câu ĐO ĐƯỢC | cổng nào chặn |
|---|---|---|---|
| `operator1` → `vram.state` | **403** | *"Bạn không có quyền view cho module \"machine_control\""* | `requirePermission` (mặt ĐỌC) |
| `operator1` → `vram.preempt` | **403** | *"Required role: admin or supervisor or engineer"* | **role-floor** |
| `operator1` → `vram.retryDeferred` | **403** | *"Required role: …"* | **role-floor** |
| `maint1` → `vram.state` | **200** | trả trạng thái THẬT | *(có `machine_control/canView` từ 2026-07-10)* |
| `maint1` → `vram.retryDeferred` | **403** | *"Required role: …"* | **role-floor** (maintenance **ngoài** `ACTUATION_ROLES`) |

⇒ **ĐẠT.** ⚠ Ghi thêm một điều kịch bản **không** hỏi: `maint1` (maintenance) **ĐỌC ĐƯỢC** trạng thái
VRAM — không do lượt cấp Pha 5, mà do hàng `machine_control/canView` có sẵn từ 2026-07-10 (§I-4).

---

## 7. Bước 14 — bề rộng `owner` (I-2 có đang sống không?)

| thước | câu | ĐO ĐƯỢC | ngưỡng | chấm |
|---|---|---|---|---|
| sổ chung DB — **lúc bắt đầu** (hệ vừa khởi động) | `SELECT max(length(owner)), count(*) FROM vram_leases` | **39** ký tự / **4** hàng | 160 | ✅ |
| sổ chung DB — **lúc kết thúc** (sau khi model nạp thật) | cùng câu | **54** ký tự / **6** hàng | 160 | ✅ |
| mặt đọc `state.ledger.localHolders[].owner` | `max(length)` | **39** | 160 | ✅ |
| qua Agent (`get_vram_state`) | `reranker:D:\SOURCES\16.AI\bge-reranker-v2-m3-Q8_0.gguf` | **52** | 160 | ✅ |

⇒ **I-2 KHÔNG sống.** Dài nhất **54/160**, còn dư **106** ký tự.

⚠ **Nhưng đây là một đại lượng ĐANG CHẢY, không phải một hằng số:** cùng một hệ, cùng một ngày, đo
hai lần được **39** rồi **54** — nó lớn lên khi có model mới nạp. ⇒ *"hôm nay 54 nên an toàn"* **không
phải** một kết luận bền. Nợ I-2 **chưa đóng, chỉ chưa nổ**: `owner` của `onnx-ocr:` dựng từ **đường
dẫn tuyệt đối** và hộ đó **không sống** trong lượt đo này (⇒ đường CHƯA đi, xem N6).

---

## 8. ★★ MỤC BẮT BUỘC 4 — ca hồi quy RAG (bước 10). **Kết quả TÁCH LÀM HAI.**

### 8.1 Kho — đo bằng chính file trên đĩa (không tin manifest)

| thước | ĐO ĐƯỢC |
|---|---|
| `knowledge/programming/manifest.json` khai | `totalChunks: 91678` (delta 29.440 · mitsubishi 26.361 · omron 17.511 · fanuc 11.735 · zmotion 4.164 · UR 2.467) |
| đếm tay 6 file `chunks.jsonl` | **91.678** ✅ khớp manifest |
| phân bố theo `lang` | **`en` 91.392 · `vi` 237 · `zh` 49** |
| `PROG_KB_ENABLED` | `true` (`.env:708`) |
| số chunk chứa chuỗi **`AL.E42`** | **0** — và 0 chunk chứa token `E42` |
| mã lỗi Delta thật trong kho | `AL500` · `AL022` · `AL062` · `AL380` · `AL006` … (dạng `AL0xx`/`AL5xx`) |

⇒ **Con số `237` của review được xác nhận từng chữ số.** ⚠ Và một điều review **không** biết:
**`AL.E42` KHÔNG TỒN TẠI trong kho.** ⇒ câu *"không tìm thấy"* là câu **ĐÚNG**, **không** phải triệu
chứng hồi quy. Nếu chấm mục này bằng *"Agent có trả lời được mã lỗi không"* thì **chấm sai** —
phải chấm bằng **kho nào bị quét**.

### 8.2 Chữ ký hồi quy — đo SỐNG qua tRPC `aiProgrammingKb.search`, phiên THẬT `supervisor1`

Cùng một câu hỏi tiếng Việt, **chỉ khác một tham số `lang`**:

| lượt | kho quét | `semanticUsed` | `lang` của 8 chunk trả về | **tài liệu hạng 1** | điểm |
|---|---|---|---|---|---|
| `lang` **KHÔNG đặt** | **91.678** | `true` | **`en` × 8** | ★ **Mitsubishi — "MELSERVO J4 error codes" p.65** | **0,668** |
| `lang: "vi"` | **237** | `true` | `vi` × 8 | 🔴 **Fanuc — "KAREL Reference Manual" p.879** (ngôn ngữ lập trình robot, **KHÔNG** phải bảng mã lỗi servo) | 0,470 |

⇒ **Chữ ký hồi quy hiện ra rõ ràng và ĐO ĐƯỢC:** tiêm `lang='vi'` **đổi vendor và đổi loại tài liệu**
— từ *bảng mã lỗi servo Mitsubishi* sang *sách tra cứu ngôn ngữ KAREL của Fanuc*. Đây chính là
*"trích sai vendor"* mà kịch bản cảnh báo.

### 8.3 Bản vá CÓ SỐNG — đo trên **registry sản xuất THẬT** + **`argsWithAuthCtx` THẬT**

Chạy `argsWithAuthCtx(tool, args, {user:{id:49,role:"supervisor"}, lang:"vi"})` với đúng registry
đã nạp của mã sản xuất (không mock, không test double):

| tool | `shape` có ô `lang`? | `laOEnumNgonNguHienThi(shape.lang)` | **`lang` SAU khi tiêm** |
|---|---|---|---|
| **`lookup_error_code`** | ✅ có | **`false`** (`z.string().min(1).max(16)`) | ★ **`undefined` — KHÔNG BỊ TIÊM** |
| **`retrieve_programming_kb`** | ✅ có | **`false`** | ★ **`undefined` — KHÔNG BỊ TIÊM** |
| `get_vram_state` | ✅ có | **`true`** (`z.enum(["vi","en","zh"])`) | `"vi"` — **tiêm ĐÚNG** |
| `list_products` | ✅ có | **`true`** | `"vi"` — tiêm đúng |
| `get_machine_status` | ✗ không | `false` | `undefined` |

⇒ **Vị từ phân biệt ĐÚNG hai ô TRÙNG TÊN**: ô *bộ lọc tài liệu* **không** bị đụng, ô *ngôn ngữ hiển
thị* **được** điền. **Bản vá Task 4 SỐNG.** Nếu nó chết, hai dòng đầu sẽ ra `"vi"` và mọi câu hỏi
tiếng Việt sẽ rơi vào 237 chunk như §8.2 dòng 2.

### 8.4 🔴 NHƯNG: **đường Agent NL KHÔNG VỚI TỚI ĐƯỢC tool** ⇒ mục này **CHƯA NGHIỆM THU END-TO-END**

Lượt sống, `POST /api/ai/local-kb/stream`, phiên THẬT `supervisor1`, câu hỏi **nguyên văn của kịch
bản**: *"Cho tôi biết mã lỗi servo AL.E42 nghĩa là gì và cách xử lý?"*

| quan sát | ĐO ĐƯỢC |
|---|---|
| `meta.intent` / `meta.language` | `definition` / **`vi`** ✅ |
| **tool ĐÃ CHẠY** | 🔴 **`get_today_stats`** — *"Sản lượng hôm nay (2026-08-07): 0 sản phẩm"* |
| trích dẫn | `knowledge/domain/aoi-troubleshooting.md`, `docs/ECOSYSTEM/37_…md` ⇒ **kho VẬN HÀNH (6.776 chunk)**, **KHÔNG PHẢI** kho lập trình |
| `lookup_error_code` có chạy không | **KHÔNG. Một lần cũng không.** |
| câu trả lời | tiếng Việt, và **đúng sự thật**: *"không có thông tin cụ thể về mã AL.E42… Mã lỗi của Delta có dãy từ AL001 đến AL503"* |

**Cơ chế, truy được bằng mã:** `intentClassifier.extractArgsForTool()` có **41 `case`** và
**KHÔNG một `case` nào** cho 8 tool của `readToolsProgramming` ⇒ tham số bắt buộc (`code` / `query`)
**không bao giờ được trích** ⇒ `safeParse({})` hỏng ⇒ rơi sang LLM fallback ⇒ chọn tool khác.

⇒ Đây **đúng** F2 của Pha 4 và **đúng** mục 12 của §10 review toàn nhánh (*"bộ phân loại không định
tuyến câu hỏi mã lỗi tới `lookup_error_code`"*) — **vẫn MỞ nguyên ở `ebfec4a5`**, không phải lỗi Pha 5.

### 8.5 Chấm mục bắt buộc 4

| vế | chấm |
|---|---|
| kho quét là **91.678**, không phải 237, khi tool chạy | ✅ **ĐẠT** (§8.3 — cơ chế; §8.2 — chữ ký) |
| bản vá Task 4 **sống** trên bản đang chạy | ✅ **ĐẠT** |
| Agent **hỏi bằng tiếng Việt** ⇒ **tool tra mã lỗi chạy** ⇒ trích đúng tài liệu vendor | 🔴 **CHƯA NGHIỆM THU** — tool **không với tới được** từ đường NL |

⚠ **Ghi thẳng:** mục bắt buộc 4 **không đạt trọn vẹn**. Nó đạt ở **cơ chế** (đo được, hai cách độc
lập), **không** đạt ở **đường end-to-end** — và lý do là một khuyết tật **có trước Pha 5**, không phải
một hồi quy của Pha 5.

---

## 9. Bước 11 + 12 — Agent gọi `get_vram_state` bằng **ba ngôn ngữ**

Lượt sống, `POST /api/ai/local-kb/stream`, phiên THẬT `supervisor1`. `get_vram_state` **CÓ** trong
`extractArgsForTool` nên đường NL với tới được (khác hẳn §8.4).

| lượt | `meta.language` | tool | `title` | `textSummary` | dòng đầu |
|---|---|---|---|---|---|
| `"trạng thái vram"` | `vi` | `get_vram_state` | **Trạng thái bộ điều phối VRAM** | **4.433** ký tự | *"Dư địa hiệu lực: 22.385 MiB (thô 24.433 MiB) · trần 32.607 MiB · đang dùng 7.150 MiB."* |
| `"显存状态"` | `zh` | `get_vram_state` | **VRAM 调度器状态** | **3.325** ký tự | *"有效余量：22,385 MiB（原始 24,433 MiB）· 上限 32,607 MiB · 已用 7,150 MiB。规划新模型加载时一律以"有效余量"为准…"* |
| `"vram status"` **KHÔNG** kèm `context.uiLanguage` | **`en`** | `get_vram_state` | 🔴 **Trạng thái bộ điều phối VRAM** | 4.375 | 🔴 **RƠI VỀ TIẾNG VIỆT** |
| `"vram status"` **CÓ** `context.uiLanguage:"en"` | `en` | `get_vram_state` | ✅ **VRAM broker state** | **5.866** ký tự | *"Effective headroom: 22,385 MiB (raw 24,433 MiB) · ceiling 32,607 MiB · in use 7,150 MiB. Size any new model load against the EFFECTIVE number, never the raw one."* |

⇒ **Ba ngôn ngữ CÓ THẬT và khác nhau** (4.433 / 3.325 / 5.866 ký tự, ba tiêu đề khác nhau) — bước 12
**ĐẠT**. Ô `owner`/`processKey`/`leaseKey` **NGUYÊN VẸN** ở cả ba: không ký tự `…` nào trong payload,
và `owner` dài nhất — `reranker:D:\SOURCES\16.AI\bge-reranker-v2-m3-Q8_0.gguf` (**52** ký tự) — ra
đủ, kể cả đường dẫn tuyệt đối.

### 🟠 Phát hiện của lượt sống: **HAI BỘ DÒ NGÔN NGỮ TRẢ LỜI KHÁC NHAU CHO CÙNG MỘT CÂU**

Với `"vram status"` **không** kèm `uiLanguage`: `meta.language = "en"` (bộ dò của **câu trả lời**)
nhưng bản tóm tắt tool ra **tiếng Việt**. Gốc rễ đọc được ở mã:

```ts
// aiLocalKnowledgeApi.ts:92-96 — buildExecCtx (NGÔN NGỮ CỦA TOOL)
const lang = /[一-鿿]/.test(question) ? "zh" : /[À-ỹ]/.test(question) ? "vi" : context?.uiLanguage ?? "vi";
```
Tiếng Anh **không có chữ viết riêng để nhận ra** — không Hán tự, không dấu ⇒ rơi vào nhánh mặc định
**`"vi"`**. Hai ngôn ngữ *nhận ra được bằng CHỮ VIẾT* (`zh`, `vi`) chạy đúng; ngôn ngữ thứ ba **phụ
thuộc hoàn toàn vào việc người gọi có gửi `uiLanguage` hay không**.

⚠ **Bào chữa công bằng, đã kiểm:** giao diện thật **CÓ** gửi (`AIChatPage.tsx:323` và
`AILocalChatBubble.tsx:538` đều đặt `uiLanguage: i18n.language`) ⇒ **người dùng thật không gặp lỗi
này**. Nó cắn **người gọi API/Agent** không đặt trường ấy. Ghi vào sổ, **không** phải mục chặn.

⇒ **Bước 11 ĐẠT CÓ ĐIỀU KIỆN**: ba ngôn ngữ ra ba câu khác nhau **khi ngôn ngữ được nêu**; câu tiếng
Anh **rơi về tiếng Việt** nếu chỉ dựa vào chữ viết của câu hỏi.

---

## 10. Bước 5 — `supervisor1` trên màn `/ai-brain` (TỰ CHỤP · TỰ ĐỌC)

Trình duyệt Chromium thật, đăng nhập THẬT (`supervisor1` / `Test@1234` → **màn 2FA hiện ra** → nhập
TOTP thật `483021` → vào `/control-tower`), rồi mở `/ai-brain`. **Locale giao diện: English.**

**Ảnh `p5-01-supervisor-panel.png` — tôi tự chụp, tự `Read`, đọc bằng mắt** (ảnh **KHÔNG trắng**;
4.703 ký tự văn bản trong `body`):

| kỳ vọng bước 5 | ĐO ĐƯỢC trên màn |
|---|---|
| menu **hiện** mục | ✅ Sidebar: `AI Home · AI Chat · Management Insight · **AI Brain**`; breadcrumb `AI › Agent Operations › AI Brain`; góc dưới **"Chị Hương (Quản đốc)"** |
| panel hiện **SỐ THẬT**, không phải câu từ chối | ✅ **"Bộ điều phối VRAM (số ĐANG CƯỠNG CHẾ)"** — **23.388 MiB / 32.607 MiB**, `basis: attributable`, huy hiệu **`tin cậy`** |
| — | thẻ VRAM: **7.0 GB / 31.8 GB** · *"theo broker (số đang cưỡng chế)"* |
| hộ có tên thật | ✅ **6 hộ cục bộ**: `cuda-backend` 432 MiB · `gguf:Qwen3-Embedding-0.6B-f16` **1.138 MiB** · `gguf-embed-ctx:…` 526 MiB · `gguf:Qwen3-4B-Instruct-2507-UD-Q4_K_XL` **5.030 MiB** · `cuda-backend:reranker` 0 MiB · `reranker:D:\SOURCES\16.AI\bge-reranker-v2-m3-Q8_0.gguf` 0 MiB |
| nút phá huỷ | ✅ **2 nút `Thu hồi (gguf-idle-model)` — BẬT** (`disabled=false`, đo bằng DOM) |
| nút thử lại | ✅ 6 nút `Thử lại ngay`, **1 BẬT** (`cron:kb-sync`) / **5 KHOÁ** — đúng `vramRetryButtonDisabled` |
| câu mặt đọc | ✅ bốn câu `translateVram*` render **bằng tiếng Anh** (đúng locale) — *"…only what the RESPONDING PROCESS can see…"*, *"No numeric field was blocked…"*, *"…it declares itself a LOWER BOUND…"*, *"The responding process CONFIRMS it hosts this holder."* |

⇒ **Bước 5 ĐẠT.**

### 🟡 Quan sát phụ (KHÔNG phải hồi quy Pha 5): **panel trộn hai ngôn ngữ**
Locale = English, nhưng nhãn của panel vẫn **cứng tiếng Việt**: *"Bộ điều phối VRAM (số ĐANG CƯỠNG
CHẾ)"*, *"Đang giữ theo sổ · cục bộ …"*, *"Hộ nền (background)"*, *"Thu hồi"*, *"Thử lại ngay"*,
*"không lệnh nào với tới"*, *"tin cậy"* — trong khi các câu `translateVram*` **đúng** tiếng Anh.
⇒ Hai nguồn chuỗi, hai vòng đời i18n. Ghi sổ, không chặn.

---

## 11. ★★★ MỤC BẮT BUỘC 1 — `supervisor1` THU HỒI THẬT · `nvidia-smi` TRƯỚC/SAU

**Lượt sống:** bấm nút `Thu hồi (gguf-idle-model)` **thứ 2** trên màn `/ai-brain` (đã xác minh bằng
DOM rằng nút ấy thuộc hàng `gguf:Qwen3-4B-Instruct-2507-UD-Q4_K_XL`, **5.030 MiB**).

### Hộp thoại step-up 2FA **BẬT LÊN THẬT** — F1 của Pha 4 **ĐÃ ĐƯỢC VÁ**
Ngay sau lượt bấm, `role="dialog"` hiện: **"Xác thực 2 bước để triển khai — Nhập mã OTP 6 số từ ứng
dụng xác thực để xác nhận lệnh triển khai/điều khiển."** Nhập TOTP thật `092570` → Enter.

⚠ Pha 4 §F1 ghi: *"hai nút phá huỷ của panel VRAM KHÔNG BẤM ĐƯỢC với BẤT KỲ vai nào"* vì panel không
gửi `totpCode` và không dùng `StepUpOtpDialog`, và phải mở cửa sổ step-up **bằng một lời gọi NGOÀI
màn**. **Ở `ebfec4a5` điều đó không còn đúng**: người vận hành bấm nút → hộp thoại OTP bật → lệnh
chạy, **toàn bộ trong màn hình**.

### Số đo — HAI THƯỚC ĐỘC LẬP

| thước | **TRƯỚC** | **SAU** | **chênh** |
|---|---|---|---|
| ★ **`nvidia-smi memory.used`** | **8.365 MiB** | **3.328 MiB** | ★ **−5.037 MiB THẬT SỰ RỜI CARD** |
| `nvidia-smi memory.free` | 23.826 MiB | 28.863 MiB | **+5.037 MiB** |
| `vram.state.ledger.localBytes` | **7.471.886.336** | **2.197.463.040** | **−5.274.423.296 B = −5.030 MiB** |
| số hộ trong sổ cục bộ | **6** | **5** | hộ `gguf:Qwen3-4B-Instruct-2507-UD-Q4_K_XL` **RỜI SỔ** |
| thẻ VRAM trên màn | **7.0 GB** | **2.1 GB** | (đọc bằng mắt trên ảnh) |
| dư địa trên panel | 23.388 MiB | **27.431 MiB** | +4.043 MiB |
| Hot models | 2 / 4 | **1 / 4** | −1 |

⇒ Hai thước độc lập khớp trong **7 MiB** (5.037 thiết bị vs 5.030 sổ). **★ MỤC BẮT BUỘC 1 ĐẠT.**

### Câu kết cục — đọc được nguyên văn trên màn (`translateVramPreemptCommand`, locale `en`)

> **"Reclaimed holder gguf:Qwen3-4B-Instruct-2507-UD-Q4_K_XL: its lease has left the ledger
> (leaseLeftLedger: true) — that is the evidence, not freedBytes."**

⇒ Bằng chứng mà hệ **tự khai** là `leaseLeftLedger`, **không phải** `freedBytes` — đúng hợp đồng
`preempt` tự đặt ra.

**Ảnh:** `p5-02-supervisor-reclaimed.png` (5 hộ, `cục bộ 2.096 MiB`, 1 nút `Thu hồi` còn lại) ·
`p5-03-reclaim-sentence-and-stepup.png` (hộp thoại step-up + dư địa 27.431 MiB) — **cả hai tôi tự
chụp và tự đọc**.

### ★ Quan sát: **giao diện HỎI OTP MỖI LẦN, dù máy chủ KHÔNG đòi**
Lượt bấm **thứ hai** (trong cửa sổ cache 10 phút của §4/M-4) **vẫn** bật hộp thoại OTP. ⇒ `stepUp
.guard` của client hỏi **theo từng lượt bấm**, **hẹp hơn** máy chủ. Đó là chiều **AN TOÀN** — nhưng
nó cũng có nghĩa: **cache 10 phút của máy chủ vẫn mở** cho bất kỳ lời gọi tRPC trực tiếp nào (§4 B3c
đã chứng minh), giao diện chỉ **che** nó chứ không đóng. *(Lượt bấm thứ hai đã **Cancel** — không
thu hồi model nhúng, vì nó đang phục vụ RAG.)*

---

## 12. Bước 7 + ★★ MỤC BẮT BUỘC 2 — `engineer1` trên màn thật

Đăng xuất `supervisor1` (`auth.logout` ⇒ `{success:true}`), đăng nhập `engineer1` (2FA thật, TOTP
`440262`) → vào `/engineering-home` → mở `/ai-brain`.

**Ảnh `p5-04-engineer-panel-greyed.png` — tự chụp, tự đọc** (5.522 ký tự trong `body`, **không trắng**):

| kỳ vọng bước 7 | ĐO ĐƯỢC |
|---|---|
| panel hiện **SỐ THẬT** | ✅ **27.431 MiB / 32.607 MiB**, `basis: attributable`, `tin cậy`, 5 hộ có tên; góc dưới **"Anh Minh (Kỹ sư TĐH)"** |
| hai nút phá huỷ **XÁM** | ✅ nút `Thu hồi (gguf-idle-model)` **`disabled = true`** (đo bằng DOM), và **nhìn thấy mờ** trên ảnh; lớp CSS chứa `disabled:pointer-events-none` |
| nút *Thử lại ngay* **BẬT** ở `cron:kb-sync` | ✅ **1/6 BẬT** — đúng hộ `cron:kb-sync` (*"The responding process CONFIRMS it hosts this holder."*); 5 hộ `unreachable` **KHOÁ** |
| nút `releaseStale` | **0 nút** — topology **MỘT tiến trình** ⇒ `foreign.holders = []` ⇒ không hàng nào có `leaseKey` (đúng cấu trúc Pha 4 §6.1) |

### ★ MỤC BẮT BUỘC 2 — lượt bấm + chứng minh **KHÔNG TÁC DỤNG PHỤ**

Lượt bấm THẬT trên nút phá huỷ của `engineer1` (`b.click()` **và** một `MouseEvent` bubbling —
cả hai đường mà một cú bấm chuột đi qua):

| quan sát | kết quả |
|---|---|
| `button.disabled` | **`true`** |
| ngoại lệ | không |
| **hộp thoại OTP có bật không** | **KHÔNG** |
| thông báo/toast | **KHÔNG** |
| lượt gọi mạng `vram.preempt` | **KHÔNG CÓ** (console 0 lỗi 403) |

**Sổ TRƯỚC / SAU lượt bấm — đo hai đầu:**

| thước | TRƯỚC | SAU | chênh |
|---|---|---|---|
| `ledger.localBytes` | **2.197.463.040** | **2.197.463.040** | **0** |
| `headroom.rawBytes` | **30.910.865.408** | **30.910.865.408** | **0** |
| danh sách hộ (sắp xếp, từng byte) | `cuda-backend:reranker=0 \| cuda-backend=452595712 \| gguf-embed-ctx:…=551575552 \| gguf:Qwen3-Embedding-0.6B-f16=1193291776 \| reranker:D:\…=0` | **Y HỆT** | **0** |
| số hộ | 5 | 5 | 0 |
| `nvidia-smi memory.used` | 3.317 MiB | 3.315 MiB | −2 MiB (nhiễu của ứng dụng đang chạy; **không hộ nào rời sổ**) |

⇒ **★ MỤC BẮT BUỘC 2 ĐẠT** ở **cả hai lớp**:
1. **UI**: nút xám, cú bấm **không đi tới đâu** — không có cả một lượt gọi mạng để mà từ chối;
2. **tRPC trực tiếp** (§4/§5): khi `engineer1` **vượt qua** UI và gọi thẳng **có OTP tươi** ⇒ **403
   `vram_control/delete`**, và sổ + thiết bị **không đổi một byte**.

*(Lớp 1 một mình là chưa đủ — nút xám chỉ chứng minh UI hẹp; §5 mới chứng minh MÁY CHỦ cưỡng chế.)*

### Nửa DƯƠNG của bước 7 — `engineer1` bấm *Thử lại ngay* và lệnh **CHẠY**

Bấm nút `cron:kb-sync` (đang BẬT). **Không hộp thoại OTP** (đúng: `retryDeferred` đứng ở
`actuationProcedure`, **không** `requireFreshTotp`). Câu hiện ra trên màn, nguyên văn:

> **"Command to rearm holder cron:kb-sync was REFUSED: cron:kb-sync DOES run in this process, but
> there is currently no live defer chain (deferStreak === null) — there's nothing to rearm because
> the most recent request wasn't refused, or already succeeded."**

⇒ `canCreate` **có răng thật** trên đường UI, và lệnh **hỏng TRUNG THỰC** (nói rõ nó không làm gì).

---

## 13. Bước 9 — `operator1` trên màn thật

Đăng nhập `operator1` (2FA thật) → vào `/ops-console`.

| kiểm | ĐO ĐƯỢC |
|---|---|
| menu có `/ai-brain` không | ✅ **KHÔNG** — `links.includes('/ai-brain') === false`; **0 link nào khớp `ai-*`**. Menu chỉ có `Overview · Factory Overview · Production Quality · Alert Response · Andon Board · Layout & Digital Twin` |
| đi thẳng URL `/ai-brain` | ✅ **"Access denied — You don't have permission to access this page."** · **0** phần tử `data-testid^="vram-"` · **0** con số MiB · `body` chỉ 436 ký tự |
| gọi thẳng `vram.state` | ✅ **403** *"Bạn không có quyền view cho module \"machine_control\""* (§6) |

**Ảnh `p5-05-operator-denied.png`** — tự chụp, tự đọc. ⇒ **Bước 9 ĐẠT ở cả BA lớp** (menu · route
guard · máy chủ).

---

## 14. Bước 13 — **CỐ Ý KHÔNG CHẠY**, và đây là quyết định có lý do

Bước 13 yêu cầu bấm **"Áp dụng quyền mặc định"** cho `supervisor` để xác nhận grant `vram_control`
**biến mất**, rồi **cấp lại**.

**Không chạy, vì ba ràng buộc của chính brief chặn nó:**
1. *"**KHÔNG** cấp lại quyền"* — bước 13 **bắt buộc** phải cấp lại sau khi xoá.
2. *"⚠ **KHÔNG bấm Lưu** ở màn Phân quyền cho user 49/51 — sẽ **xoá sạch** grant."*
3. `applyRolePermissions` là **`adminProcedure`** và tôi **không có phiên admin** (§3).

⚠ Và nợ mà bước 13 định chứng minh **đã được chứng minh bằng MÃ, không cần phá**:
`shared/permissions.ts:122` — `vram_control` **cố ý không** có trong `DEFAULT_ROLE_PERMISSIONS`;
`permissionsRouter.ts:453-483` **`DELETE` toàn bộ** hàng quyền của user rồi `INSERT` lại từ khuôn vai.
Hai sự thật ấy **đủ** kết luận; chạy nó chỉ đổi một suy luận chắc chắn lấy một rủi ro mất grant.

⇒ **Bước 13: KHÔNG CHẠY (đường CHƯA đi có chủ ý).**

---

## 15. BẢNG CHẤM — 14 bước

| # | bước | kỳ vọng | **ĐO ĐƯỢC** | chấm |
|---|---|---|---|---|
| 0 | deploy máy chủ · `getAvailableModules` có `vram_control` | 1 hàng | hàng **có trong `dist/index.js` đang phục vụ** (đủ 3 ngôn ngữ tên) — **chưa gọi sống** (thiếu phiên admin) | ⚠ **ĐẠT GIÁN TIẾP** |
| 1 | cấp `supervisor`: `vram_control` C+D · `machine_control/canView` | 2 hàng đúng bit | `SELECT` ⇒ `49: canCreate=true, canDelete=true` · `machine_control.canView=true` | ✅ **ĐẠT** |
| 2 | cấp `engineer`: C, **không** D | `canDelete=false` | `51: canCreate=true, **canDelete=false**` | ✅ **ĐẠT** |
| 3 | 2FA bật cả hai | `require2FA` không chặn nhầm | cả 4 tài khoản `two_factor_enabled=true`; màn 2FA hiện thật, TOTP thật qua | ✅ **ĐẠT** |
| 4 | deploy client | — | `npm run build` ✓ 33,52 s; hash chunk `index-DN8l8I8M.js` **không đổi** ⇒ client vốn đã ở `ebfec4a5` | ✅ **ĐẠT** |
| 5 | `supervisor` → `/ai-brain`: menu hiện, panel **SỐ THẬT** | không phải câu từ chối | **23.388 / 32.607 MiB**, 6 hộ có tên, 2 nút `Thu hồi` **BẬT** | ✅ **ĐẠT** |
| **6** | ★ `supervisor` **Thu hồi** một hộ · `nvidia-smi` trước/sau **giảm thật** | byte rời card | **`nvidia-smi` 8.365 → 3.328 MiB = −5.037 MiB** · sổ −5.030 MiB · hộ **rời sổ** · OTP dialog bật thật | ✅ **ĐẠT** |
| 7 | `engineer` → panel số thật · 2 nút phá huỷ **XÁM** · *Thử lại ngay* **BẬT** ở `cron:kb-sync` | — | **27.431 MiB**, `Thu hồi` **`disabled=true`**, `Thử lại ngay` **1/6 BẬT** và **chạy thật** | ✅ **ĐẠT** |
| **8** | ★ `engineer` gọi **thẳng tRPC** `vram.preempt` (có OTP tươi) ⇒ **403 `canDelete`** | chứng minh C-1 không sống | **403 FORBIDDEN** — *"Bạn không có quyền **delete** cho module **\"vram_control\"**"*; và `retryDeferred` **200** | ✅ **ĐẠT** |
| 9 | `operator` không thấy `/ai-brain`; `vram.state` ⇒ 403 | — | 0 link `ai-*`; deep-link ⇒ **"Access denied"**; `vram.state` **403** | ✅ **ĐẠT** |
| **10** | ★ hỏi mã lỗi servo **bằng tiếng Việt** ⇒ quét kho **91.678**, không phải 237 | ca hồi quy RAG | kho `91.678` (`vi`=**237** ✔) · `lang` **KHÔNG bị tiêm** vào 2 tool KB · **NHƯNG** đường Agent NL rơi vào `get_today_stats` | ⚠ **ĐẠT CƠ CHẾ · CHƯA ĐẠT END-TO-END** |
| 11 | cùng câu bằng `zh` rồi `en` ⇒ 3 ngôn ngữ, không câu nào rơi về `vi` | — | `vi`/`zh` đúng; **`en` RƠI VỀ `vi`** nếu không kèm `uiLanguage` (giao diện thật **có** kèm) | ⚠ **ĐẠT CÓ ĐIỀU KIỆN** |
| 12 | Agent gọi `get_vram_state` ba ngôn ngữ; `owner`/`processKey`/`leaseKey` **nguyên vẹn** | — | 3 bản tóm tắt **4.433 / 3.325 / 5.866** ký tự, 3 tiêu đề khác nhau; **0 ký tự `…`**; `owner` dài nhất 52 ký tự ra đủ | ✅ **ĐẠT** |
| 13 | "Áp dụng quyền mặc định" ⇒ grant biến mất ⇒ cấp lại | xác nhận nợ I-1 | **KHÔNG CHẠY** — mâu thuẫn ràng buộc *"không cấp lại quyền"* + cảnh báo xoá sạch; nợ đã chứng minh bằng mã | ⬜ **KHÔNG CHẠY (có chủ ý)** |
| 14 | `max(length(owner))` ≤ 160 | I-2 có sống không | DB `vram_leases`: **39** (đầu) → **54** (cuối) · mặt đọc **39** · qua Agent **52** — **đều ≪ 160**, nhưng **đang lớn dần** | ✅ **ĐẠT — I-2 KHÔNG sống** |

**Tổng: 10 ĐẠT · 3 ĐẠT CÓ ĐIỀU KIỆN · 1 KHÔNG CHẠY · 0 HỎNG.**

### Bốn mục BẮT BUỘC

| # | mục | chấm | bằng chứng cốt lõi |
|---|---|---|---|
| **1** | `supervisor1` thu hồi VRAM THẬT, `nvidia-smi` trước/sau | ✅ **ĐẠT** | **8.365 → 3.328 MiB (−5.037)**, sổ −5.030 MiB, hai thước lệch 7 MiB |
| **2** | `engineer1` bấm nút phá huỷ ⇒ từ chối **và không tác dụng phụ** | ✅ **ĐẠT** | nút `disabled`, **không lượt gọi mạng nào**; và qua tRPC: 403 + `localBytes`/`rawBytes`/6 hộ **y hệt từng byte** |
| **3** | `engineer1` gọi **thẳng** `vram.preempt` ⇒ **403** | ✅ **ĐẠT** | *"không có quyền **delete** cho module **vram_control**"* — **C-1 KHÔNG SỐNG** |
| **4** | câu tiếng Việt ⇒ quét kho đầy đủ 91.678 | ⚠ **ĐẠT CƠ CHẾ, CHƯA END-TO-END** | `lang` không bị tiêm (đo trên registry thật); nhưng bộ phân loại **không định tuyến** tới `lookup_error_code` |

---

## 16. ĐƯỜNG ĐÃ ĐI · ĐƯỜNG **CHƯA** ĐI

> ⚠ *"Nghiệm thu sống chỉ chứng minh ĐÚNG ĐƯỜNG MÌNH VỪA ĐI."*

### ĐÃ ĐI
1. `POST /api/auth/login` + `/verify-2fa` — **4 danh tính** (`supervisor1` · `engineer1` · `operator1` · `maint1`), TOTP THẬT sinh từ `two_factor_secret`.
2. `POST /api/trpc/vram.{state,preempt,releaseStale,retryDeferred}` — **13 lượt**, có role-floor · 2FA · step-up OTP tươi · `requirePermission`.
3. Màn `/ai-brain` render THẬT trong Chromium, **3 phiên khác nhau**, **bấm 4 nút thật**, **5 ảnh tự chụp + tự đọc**.
4. `POST /api/ai/local-kb/stream` — **6 lượt**, 4 ngôn ngữ/cấu hình.
5. tRPC `aiProgrammingKb.{collections,search}` — 3 lượt, đối chứng `lang` có/không.
6. `argsWithAuthCtx` + registry sản xuất THẬT (ngoài HTTP) — 5 tool.
7. Topology **MỘT tiến trình** (`all:30108:1786058062019`), GPU RTX 5090, `NODE_ENV=production`, `ACTUATION_STEPUP_2FA=true`.

### CHƯA ĐI — phần quan trọng hơn

| # | đường chưa đi | vì sao nó có thể giấu lỗi |
|---|---|---|
| **N1** | ⚠⚠ **`vram.releaseStale` chưa chạy MỘT lượt THÀNH CÔNG nào** | Topology **một tiến trình** ⇒ `foreign.holders = []` ⇒ **0 nút** trên màn. Chỉ đo được nhánh **403** (§4 B3b) và `refused` (Pha 4). Nhánh `released` + `durability` **vẫn chưa từng chạy**. |
| **N2** | ⚠⚠ **`supervisor1` gọi THẲNG tRPC `preempt` (bypass UI)** | Đo chiều **TỪ CHỐI** rất kỹ (engineer), chiều **CHO PHÉP** chỉ đo **qua UI**. Nếu UI và tRPC lệch nhau ở đường `supervisor`, lượt này không thấy. |
| **N3** | **Tiến trình anh em** (`ROLE=api`/`worker`) | Cả `foreign.known/stale`, nhánh `declared-by-owner-process`, và lệnh chéo **chưa chạm**. |
| **N4** | **Mặt SUY GIẢM**: `blind` · `trusted=false` · `degradedReasons[]` · `baseline.verified=false` · `foreign.stale=true` | **5/5 ảnh đều in `tin cậy`**, `degradedReasons: []`. Nửa panel **chỉ hiện lúc hệ hỏng** — tức đúng lúc cần đọc — **chưa từng render**. Y hệt U9 của Pha 4, **vẫn chưa đóng**. |
| **N5** | `lookup_error_code` / `retrieve_programming_kb` **từ đường Agent** | §8.4 — bộ phân loại không định tuyến. **Mục bắt buộc 4 kẹt ở đây.** |
| **N6** | `owner` **> 160 ký tự** (hộ `onnx-ocr:` dựng từ đường dẫn tuyệt đối) | Hộ ấy **không sống** trong lượt đo (dài nhất đo được: **52**). **I-2 chưa nổ, chưa đóng.** |
| **N7** | Bước 13 — ba đường xoá sạch grant | Không chạy (§14). Nợ vận hành **chưa ai nghiệm thu**, chỉ suy ra từ mã. |
| **N8** | `RBAC_SCOPED_ADMIN=true` (M-3) | Cờ **không có trong `.env`** ⇒ nhánh gương-rộng-hơn-máy-chủ **chưa sống**. |
| **N9** | **Hai lệnh CÙNG LÚC** / tranh chấp cùng một hộ | Mọi lượt **tuần tự**. |
| **N10** | **Dư địa ÂM** · GPU gần đầy · lượt xin bị từ chối thật | Đỉnh chỉ 8,4/32,6 GB. |
| **N11** | `preempt` nhánh `reclaimer-returned-false` / `reclaimer-threw` / `no-bytes-freed` | Chỉ đo `reclaimed`. Ba nhánh **hỏng của người thi hành** vẫn chưa chạy (U5 của Pha 4). |
| **N12** | Vai `quality_inspector` · `it_admin` · `manager` · **admin** | 4 danh tính; **không có lượt admin nào** (không có mật khẩu). |
| **N13** | Locale `vi`/`zh` **trên MÀN** | Trình duyệt ở `en` suốt; 3 ngôn ngữ chỉ đo qua **Agent**, không qua panel. |
| **N14** | **Một máy · một card · một tiến trình · một locale trình duyệt** | Wave 2 có tiền lệ *"một Critical chỉ tồn tại ở cấu hình khác"*. |

---

## 17. MỐI LO

1. **★★ Mục bắt buộc 4 kẹt sau một khuyết tật CÓ TRƯỚC.** `extractArgsForTool` có **41 `case`** và
   **0** cho 8 tool `readToolsProgramming`. Ngày ai đó sửa nó là ngày ô `lang` của hai tool KB nhận
   đầu vào thật **lần đầu tiên** — và cũng là ngày `read_project_file` + `calc` (hai ranh giới an
   ninh, **chưa từng chạy**, nợ F2 của Pha 4) mở ra. **Phải đo lại §8 và toàn bộ U2 của Pha 4 ngay
   sau lượt sửa ấy.**
2. **★★ `releaseStale` là lệnh PHÁ HUỶ chưa từng chạy thành công một lần nào** (N1) — qua **cả hai**
   pha. Nó xoá một hàng khỏi sổ mà **mọi tiến trình anh em** đọc để tính dư địa, và nó đứng cùng bit
   `canDelete` với `preempt` (vừa được chứng minh có răng). Bit thì đã nghiệm thu; **người thi hành
   thì chưa**.
3. **★★ Cache step-up 10 phút của máy chủ VẪN MỞ** (M-4, đo sống ở §4 B3c). Giao diện hỏi OTP **mỗi
   lần bấm** nên người dùng thật không thấy — nhưng đó là **UI che, không phải máy chủ đóng**. Một
   lượt gọi tRPC trực tiếp trong 10 phút sau bất kỳ `deployProcedure` nào **không bị hỏi lại**.
4. **★ Mặt SUY GIẢM chưa từng render** (N4) — **lần thứ hai liên tiếp**. Đây là nửa panel dựng ra cho
   đúng lúc hệ hỏng, và nó **chưa từng được một con mắt nào nhìn thấy** ở cả Pha 4 lẫn Pha 5.
5. **★ `effectiveBytes` là cái bẫy đo lường.** Nó trôi **426 MiB** giữa hai lượt đọc cách nhau vài
   giây, thuần tuý theo `foreign.ageMs`. Pha 4 dùng nó làm bằng chứng *"không đổi"* và **trúng nhờ
   may**. Ai viết lưới hay quy trình sau này phải neo `rawBytes` + `localBytes` + danh sách hộ +
   `nvidia-smi`, **không** neo `effectiveBytes`.
6. **★ Tiếng Anh không có chữ viết để nhận ra.** `buildExecCtx` rơi về `"vi"` cho mọi câu ASCII không
   kèm `uiLanguage`. Giao diện thật có gửi ⇒ chưa cắn người dùng; **cắn mọi người gọi API/Agent**.
   Và hai bộ dò (`meta.language` vs `execCtx.lang`) **trả lời khác nhau cho cùng một câu**.
7. **★ Grant vẫn MỒ CÔI.** Nó sống qua lượt dựng lại + khởi động lại (đo được), nhưng ba đường xoá
   sạch (§7 của báo cáo cấp quyền) **không đường nào có cảnh báo**, và bước 13 **không chạy** nên
   chưa ai thấy nó biến mất thật.
8. **★ Panel trộn hai ngôn ngữ** ở locale `en` (§10) — nhãn cứng tiếng Việt cạnh câu `translateVram*`
   tiếng Anh. Không chặn, nhưng nó nói rằng bề mặt này có **hai vòng đời i18n**.
9. **Không có lượt admin nào** (N12) — mọi kết luận về `adminProcedure` (bước 0, bước 13) là **suy ra
   từ mã**, không phải đo sống.

---

## 18. DỌN DẸP + trạng thái cây

| việc | trạng thái |
|---|---|
| **Máy chủ ĐANG CHẠY sau lượt đo** | **PID 30108** — `node dist/index.js`, cổng 3000. **CỐ Ý ĐỂ CHẠY** (đây là máy chủ của hệ, không phải tiến trình tạm của lượt đo; nó thay đúng chỗ PID 32368 đã tắt). |
| tiến trình cũ | **ĐÃ TẮT theo PID**: cây `32952 → 13780 → 7228 → 29592 → 33704 → 32368` (`taskkill /F /PID 32952 /T`) |
| tiến trình tạm **của lượt đo** | **KHÔNG dựng cái nào** — không `ROLE=api`, không sidecar, không server dev thứ hai. ⇒ **không có nền VRAM bẩn** như Pha 4 từng để lại. |
| trình duyệt Playwright | đã đóng phiên đo |
| mã sản xuất | ✅ **KHÔNG SỬA MỘT DÒNG** — `git status --porcelain -- server/ client/ shared/` **RỖNG** |
| thư mục tạm trong repo | `.tmp-nghiemthu/` (dùng cho §8.3) — **ĐÃ XOÁ**, kiểm lại: không còn |
| script đo | nằm trong scratchpad **ngoài repo** |
| ảnh | `docs/superpowers/reports/assets/2026-08-06-vram-pha5-nghiem-thu-song/p5-0{1..5}.png` — **5 ảnh, tự chụp, tự `Read`** |
| DDL · migration · seed · trainer · `kb:sync` · cấp lại quyền · sub-agent | ✅ **KHÔNG chạy cái nào** |
| 243 mục bẩn của việc khác | ✅ **không đụng, không dọn, không stage** |
| `git diff --cached` | **rỗng** |

**Quyền sau lượt đo — kiểm lại bằng đúng câu của §7 báo cáo cấp quyền:**
```
SELECT "userId","canCreate","canDelete" FROM permissions WHERE "moduleName"='vram_control';
⇒ [{49, true, true}, {51, true, false}]      ✅ CÒN NGUYÊN
```

**Kiểm cuối cùng, đo chứ không khai:**

| kiểm | kết quả |
|---|---|
| `git rev-parse --short HEAD` | **`ebfec4a5`** — không đổi, **không commit** |
| `git status --porcelain -- server/ client/ shared/ drizzle/` | **rỗng** ✅ |
| `git diff --cached --name-only` | **0** ✅ |
| `SELECT … FROM permissions WHERE "moduleName"='vram_control'` | `[{49,true,true},{51,true,false}]` ✅ **CÒN NGUYÊN** |
| tổng hàng `permissions` | **87** — **không đổi** so với lượt cấp quyền (85→87) ⇒ **không cấp thêm, không xoá hàng nào** |
| `nvidia-smi` | **3.293 MiB dùng / 28.898 MiB trống** |
| máy chủ | **PID 30108** LISTENING `0.0.0.0:3000` — đang chạy, một tiến trình duy nhất |

Model `Qwen3-4B-Instruct` đã thu hồi sẽ **nạp lại theo nhu cầu** — đường bình thường của
`getOrLoadModel`, không cần can thiệp.
