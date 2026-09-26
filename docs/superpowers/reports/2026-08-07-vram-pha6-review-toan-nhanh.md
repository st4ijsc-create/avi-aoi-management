# Review TOÀN NHÁNH — Pha 6 (backlog sau Pha 5), dải `ebfec4a5..8b066230`

> **Lượt thứ CHÍN** của kỷ luật "review toàn nhánh". Không chấm lại từng task — chỉ hỏi những câu
> **chỉ trả lời được khi nhìn cả nhánh**: đường ghép giữa các task, bất biến có hai người ghi,
> cơ chế mà mọi task đều tưởng task khác lo, và **nợ mới đẻ ra từ chính lượt trả nợ**.

- **Dải:** `ebfec4a5..8b066230` — 18 commit · 52 file · +7.377/−193 (mã + lưới: 34 file, +5.734/−192)
- **Nhánh:** `feat/hmi-dep` · **HEAD:** `8b066230` · **Ngày:** 2026-08-07

---

## 0. Trạng thái cây khi BẮT ĐẦU + cổng tự chạy lại

| Trục | Kết quả |
|---|---|
| `git status --porcelain` | 243+ mục bẩn (`knowledge/**` + docs) — **nợ CÓ TRƯỚC**, không đụng |
| Cổng kiểm chung — **14 đường**, `ls` kiểm **TRƯỚC KHI TIN** | **14/14 tồn tại trên đĩa** |
| `npx vitest run <14 đường>` | ✅ **109 file / 1.861 ca XANH**, 29,40 s |
| `npm run check` (`tsc --noEmit`) | ✅ sạch |
| `npm run check:tests` | ✅ sạch |
| `npm run i18n:check` | ✅ `0 key(s) with placeholder mismatch` |

⚠ `109 file / 1.861 ca` là **mốc so** cho mọi đột biến dưới đây.
⚠ Gõ `npm run i18n` (thiếu `:check`) ⇒ `Missing script` + exit 1 — **không** im lặng khai xanh. Tốt.

---

## 1. Ba đột biến TỰ CHẠY — nhắm ĐƯỜNG GHÉP giữa các task, không nhắm trong một task

Kỷ luật: **commit trước, đột biến sau**; khôi phục bằng `git checkout HEAD -- <file>`; chạy lại
**TOÀN BỘ** sau mỗi lượt.

### W1 — *"hợp đồng `totpCode` bắt buộc (Task 1/I-4) có được canh trên MÃ SẢN XUẤT, hay chỉ trên FIXTURE?"*

**Vì sao đây là câu của cả nhánh:** ô `totpBatBuoc` sinh ra ở Task 1b (`deployProcedureScan.ts:76`)
để đóng bài học I-4 của Task 1. `git grep totpBatBuoc` trong `server/**` cho **đúng MỘT** điểm
khẳng định — `deployStepUpFreshness.test.ts:323` — và nó lọc trên `DEPLOY_TRONG_LUOI`, tức **hai
fixture M3**, **không phải** 7 thủ tục sản xuất. Dự đoán của tôi: nới `.optional()` ở sản xuất ⇒ cổng XANH.

**Đột biến:** `server/routers/programmingRouter.ts:453` `totpCode: z.string().max(16)` → `.optional()`.

**Kết quả: ❌ DỰ ĐOÁN CỦA TÔI SAI — cổng ĐỎ, và ĐỎ ĐÚNG TÊN.**
`108 passed | 1 failed` — `client/src/lib/vramPanelStepUp.unit.test.ts:611` ·
*"★★★ I-4 — ô `totpCode` ấy phải BẮT BUỘC, không `.optional()`"*, lượng từ trên `QUET.thuTuc`
(**tập sản xuất**, suy từ AST). `tsc` sạch — tức **lưới là tầng duy nhất bắt được**, đúng như I-4 nói.
→ Khôi phục `git checkout HEAD -- server/routers/programmingRouter.ts` ⇒ sạch.

**Ghi nhận (Minor M-4 dưới):** một bất biến **của máy chủ** được canh **chỉ từ nửa client** của cổng.

### W2 — *"lượng từ HÀNH VI mới của Task 1 (`VRAM_COMMAND_DESTRUCTIVE`) có phần tử thứ N+1 ở trục TÊN/FILE không?"*

Luật Task 1: *"∀ hàm `vram*Command` export **từ `vramCommands.ts`** phải có một mục"*. Hai trục thoát
hiển nhiên: **tên** (`/^vram\w*Command$/`) và **file**.

**Đột biến:** thêm `export async function huyHoTieuThu(owner)` → gọi `preemptOwner()` (GIẾT TIẾN TRÌNH)
vào `server/services/vram/vramPreempt.ts` (**file khác**, **tên không khớp mẫu**), rồi gắn vào
`vramRouter.ts` trên `vramActuationProcedure` (`canCreate`, **không step-up**).

**Kết quả: ❌ DỰ ĐOÁN SAI LẦN HAI — cổng ĐỎ 7 ca / 4 file, và có MỘT ca bắt đúng cơ chế:**

```
server/routers/vramStepUpFreshness.test.ts:424
AssertionError: mutation không tham chiếu hàm lệnh nào ⇒ ngoài tầm lượng từ HÀNH VI:
  expected 'huyManh' to be ''
```

Đây là **cầu chì đảo lượng từ** đúng bài: *"∀ mutation của `vramRouter` phải tham chiếu ít nhất một
hàm lệnh — nếu không, nó nằm NGOÀI tầm lượng từ, và điều đó phải ĐỎ."* Task 1 làm đúng.
→ Khôi phục cả hai file ⇒ sạch.

### W3 — *"…nhưng cầu chì ấy đọc BAO NHIÊU FILE?"* ⇒ **ĐỘT BIẾN DUY NHẤT SỐNG SÓT**

W2 chỉ ra cầu chì hành vi đọc **đúng một file**: `vramStepUpFreshness.test.ts:235` neo vào
`vramRouter.ts`. Câu hỏi của cả nhánh: **Task 1b vừa học đúng bài này** — đột biến R1b của người
review đặt một thủ tục deploy ở `server/_core/systemRouter.ts` và **68/68 xanh hết**, nên Task 1b
dựng `deployProcedureScan.ts` quét **đệ quy toàn `server/**`** và nhận diện module bằng **phép nối
đường dẫn**. Bài học ấy **có được mang về cho nửa VRAM không?**

**Đột biến:** cùng hàm `huyHoTieuThu` (giết tiến trình), lần này gắn vào **`server/routers/aiModelRouter.ts`**
(đã nối vào `appRouter` — `server/routers.ts:649`, không gian tên `aiModel`), sàn
`roleProcedure("admin","supervisor","engineer").use(require2FA)` — tức **không `requireFreshTotp`,
không `requirePerCallFreshTotp`, KHÔNG step-up nào cả**.

**Kết quả: 🔴 CỔNG XANH TOÀN PHẦN — `109 file / 1.861 ca`, `tsc --noEmit` sạch.**
Không một ca nào đỏ. → Khôi phục ⇒ sạch. Chi tiết ở **C-2**.

---

## 2. PHÁN XỬ HAI MỤC ĐÃ BIẾT (xác minh + xếp hạng, không nhận là phát hiện của tôi)

### 🔴 Mục 1 — `/ai-brain` chết trên bản đang phục vụ ⇒ **CRITICAL** (xem C-1)
Xác minh độc lập: PID 30108 khởi động **06:14:20**, còn `dist/index.js` + `dist/public/` cùng mang mốc
**13:16** ⇒ tiến trình giữ mã `ebfec4a5` trong bộ nhớ, đĩa phát bundle `8b066230`. Đúng bản khai.
**Nhưng xếp hạng KHÔNG dựa vào lệch phiên bản** — xem C-1 để biết vì sao đây là lỗi **thiết kế hợp đồng**.

### 🟠 Mục 2 — nhãn `vramBroker.*` không có bản dịch ⇒ **IMPORTANT**, và **con số nặng hơn bản khai**
Đo lại: **33** khoá `vramBroker.*` được dùng trong `client/src`; `vi.json`/`en.json`/`zh.json` mỗi bản
có **đúng 3** (`commandError`, `readDenied`, `readUnreadable`) ⇒ **30 khoá vắng ở CẢ BA**, không phải 26/29.
Chi tiết cơ chế ở **I-1** — và `i18n:check` có **BA** lỗ lượng từ, không phải một.

---

## 3. PHÁT HIỆN

### 🔴 Critical

#### C-1 · `vram.state` là một HỢP ĐỒNG DÂY BỊ PHÁ VỠ **không có thương lượng phiên bản, không có dung sai ở client, và không có cách ly lỗi** ⇒ một ô làm chết cả trang

- **Nơi:** `server/services/vram/vramReadModel.ts:1313` (đổi `headroom.effectiveBytes` → `headroom.effective.{…}`)
  · `client/src/components/ai/VramBrokerPanel.tsx:244` (`s.headroom.effective.bytesAtReadMs`)
  · `client/src/pages/AIBrainDashboard.tsx:332` (render panel **không có** `ErrorBoundary`/`AsyncBoundary`)
- **Kịch bản hỏng cụ thể:** máy chủ trả payload **cũ** (`headroom.effectiveBytes`), client **mới** đọc
  `s.headroom.effective.bytesAtReadMs` ⇒ `s.headroom.effective === undefined` ⇒
  `TypeError: Cannot read properties of undefined (reading 'bytesAtReadMs')`. Vì `VramBrokerPanel`
  **không** được bọc boundary riêng (grep `ErrorBoundary|AsyncBoundary|Suspense` trong
  `AIBrainDashboard.tsx` = **0**), throw leo lên boundary cấp trang ⇒ **toàn bộ `/ai-brain` trắng**.
  Trên máy này nó **đang xảy ra thật**; nhưng đường tái lập trong sản xuất **không cần** một lượt
  "quên restart": bất kỳ lượt phát hành nào mà **tài sản tĩnh đi trước tiến trình API** (nginx/CDN
  cập nhật trước pod, rolling deploy, `vite build` không kèm restart) đều dựng đúng cảnh này.
- **Vì sao là Critical chứ không phải "lỗi môi trường":** panel **đã có sẵn** cả một từ vựng cho
  đúng tình huống *"tôi không đọc được mặt đọc"* — `VRAM_READ_SURFACE_NOTICE` với ba trạng thái
  `denied`/`unreadable`/`blind` (dùng ở `VramBrokerPanel.tsx:227`). Bề mặt ấy **chỉ với tới được từ
  một lỗi tRPC**, **không** từ một payload sai hình dạng. Tức: cơ chế được dựng ra để nói *"tôi
  không đọc được"* **không nói được** đúng lúc nó không đọc được.
- **Task nào lẽ ra phải bắt:** **Task 2, Bước 4 (đột biến).** Cả bốn đột biến của Task 2 đều chạy
  **trong hệ kiểu** (*"viết một ca so `effectiveBytes` trước/sau ⇒ `tsc` phải ĐỎ"*). Không đột biến
  nào hỏi câu *"một người tiêu thụ **đã biên dịch trước** đọc payload này thì sao"* — mà đó chính là
  định nghĩa của một **thay đổi phá vỡ**. `tsc` xanh vì nó biên dịch **cả hai đầu cùng lúc**; sản
  xuất **không bao giờ** chạy cả hai đầu cùng lúc.
- **Ghi công đúng chỗ:** Task 4 **đã chụp được** (`…/pha6-task4/n4-00-panel-crash-version-skew.png`)
  nhưng xếp nó là hiện vật môi trường của lượt nghiệm thu, không nâng thành phát hiện.
- Đây là **"trả nợ ĐẺ RA nợ"** lần thứ **NHẤT của Pha 6** (đã biết) — lần thứ **BA** của chuỗi Pha 5→6.

#### C-2 · Câu load-bearing nhất của Pha 6 — *"lệnh phá huỷ VRAM đòi OTP MỖI LƯỢT"* — **SAI Ở DẠNG TỔNG QUÁT**, và cổng KHÔNG phát hiện được phản ví dụ (đột biến W3)

- **Nơi:** `server/routers/vramStepUpFreshness.test.ts:235` (bộ suy đọc **đúng một file**
  `vramRouter.ts`) · `server/services/vram/vramCommands.ts:44-53` (khối tự xưng *"bảng dưới đây là
  **chủ duy nhất** của sự thật ấy"*) · đối chiếu `server/routers/deployProcedureScan.ts:158`
  (`quetThuTucDeploy` quét **đệ quy toàn `server/**`**).
- **Kịch bản hỏng cụ thể (đã chạy, W3):** một hàm giết tiến trình (gọi `preemptOwner()`) đặt ngoài
  `vramCommands.ts`, gắn làm mutation ở **bất kỳ router nào không phải `vramRouter.ts`**, trên sàn
  `roleProcedure(...).use(require2FA)` — và `require2FA` **chỉ kiểm cờ `user.twoFactorEnabled` tĩnh**
  (`_core/trpc.ts:250`), **không** verify OTP tươi. Kết quả đo: **cổng 109 file/1.861 ca XANH,
  `tsc --noEmit` sạch**. Một `engineer` đã bật 2FA giết được tiến trình mà **không gõ một mã nào**,
  và **không lưới nào đỏ**. (Hôm nay **không có** thủ tục nào như thế ⇒ **không có lỗ đang sống**;
  cái sai là **lượng từ** và **phạm vi cổng**.)
- **Vì sao chỉ review TOÀN NHÁNH thấy:** hai nửa của **cùng một câu** do hai task viết, và bài học
  cần thiết **đã được học trong chính nhánh này**:

  | | nửa `deployProcedure` (Task 1b) | nửa "lệnh phá huỷ VRAM" (Task 1) |
  |---|---|---|
  | phạm vi quét | `server/**` **đệ quy** | **một file** `vramRouter.ts` |
  | nhận diện module | phép **nối đường dẫn** (`phanGiaiToi`) | đường dẫn **ghim cứng** |
  | vì sao mở rộng | đột biến **R1b** của người review | *(chưa ai thử)* |

  Task 1b trả giá để học *"chặn trong một danh sách file"*; Task 1 chốt **trước đó** nên không được
  hưởng, và **không ai đi ngược lại** áp bài học cho nó. Review-theo-task không thể thấy: mỗi lượt
  chỉ nhìn một nửa.
- **Task nào lẽ ra phải bắt:** **Task 1b, Bước 6** — bước *"đảo lượng từ, gộp vào GỐC"*. Nó gộp
  đúng cho `deployProcedure` nhưng **không hỏi** *"nửa kia của cùng câu có gốc chung không"*.
- **Lời giải rẻ, đã có sẵn trong nhánh:** `deployProcedureScan.moiFileDuoi()` + `phanGiaiToi()` đã là
  hạ tầng **dùng chung, đã export**. Chỉ cần đổi câu hỏi thành *"∀ file dưới `server/**` nhập một hàm
  phá huỷ của `services/vram/**` ⇒ mutation dùng nó PHẢI chain `requirePerCallFreshTotp`"*.

### 🟠 Important

#### I-1 · 30/33 nhãn `vramBroker.*` vắng ở **CẢ BA** locale, và `i18n:check` mù **theo cấu tạo** (BA lỗ lượng từ)

- **Nơi:** `scripts/i18n-check.mjs:79` (`allKeys` = **hợp các khoá CÓ TRONG FILE locale**) ·
  `:82` (`if (present.length < 2) continue`) · `:87` (`union` chỉ tính trên locale **có** khoá).
- **Ba lỗ, cả ba là "lượng từ sai":**
  1. lượng từ chạy trên **khoá trong file dịch**, không trên **khoá được MÃ tham chiếu** ⇒ khoá vắng
     ở cả ba là **vô hình tuyệt đối** — đúng luật *"vắng ở cả ba ⇒ không lệch"* mà bản khai nêu;
  2. khoá có ở **đúng một** locale bị `continue` bỏ qua ⇒ dịch cho **một** ngôn ngữ cũng vẫn xanh;
  3. công cụ chỉ so **placeholder**, **không bao giờ** so **sự có mặt** ⇒ khoá có ở 2/3 locale vẫn xanh.

  Tức cái tên `i18n:check` hứa nhiều hơn cái nó làm — **cùng lớp lỗi** mà `vramReadModel.ts` tồn tại để diệt.
- **Kịch bản hỏng cụ thể:** người vận hành đặt phiên `en` hoặc `zh` mở `/ai-brain` ⇒ **30 nhãn của
  bảng VRAM hiện TIẾNG VIỆT** (`t("vramBroker.local","cục bộ")` trả `defaultValue`), gồm **hai nút
  phá huỷ** (`vramBroker.preempt`, `vramBroker.releaseStale`) và các nhãn cảnh báo (`blind`,
  `untrusted`, `ttlExpired`, `unattributedBytes`). Không lỗi, không cảnh báo, cổng xanh.
- **Bất đối xứng chỉ thấy khi nhìn cả nhánh:** mặt **Agent** của chính module này bị cưỡng chế **ba
  bản thật** (`vramPhrases.exhaustive.test.ts`: *"`en` chỉ ASCII · `zh` có Hán tự · khuôn không rẽ
  nhánh"*, chạy trong cổng, xanh). Mặt **người** — bảng mà người vận hành thật sự nhìn — có **0**
  phép canh. Hai bề mặt của một module, hai kỷ luật ngôn ngữ khác hẳn nhau.
- **Task nào lẽ ra phải bắt:** không task nào của Pha 6 nhận nhãn UI làm phạm vi ⇒ **nợ có trước**
  (sinh từ Pha 4). Nhưng Pha 6 **chạm đúng file ấy** (Task 1 + Task 2, 21 dòng) và chạy `i18n:check`
  **năm lượt** — nên đây là món mà **cổng khai xanh** đã ru ngủ, không phải món ai cố tình hoãn.

#### I-2 · Lời khai của Task 5 **KHÔNG tới người đọc nào** — và ca canh nó **tự đặt tên là "tới được người đọc"**

- **Nơi:** `server/services/vram/vramReadModel.ts:1273` (ô ra `ledger.foreign.truncatedIdentityWrites`)
  · `server/services/vram/sharedLedgerIdentityCut.test.ts` — ca *"★★★ Task 5 / ĐƯỜNG THOÁT — **lời
  khai phải tới được người đọc**, không chỉ tới `tsc`"* › *"mặt ĐỌC phát ra ô ấy — lời khai đi hết
  đường tới `ledger.foreign`"*.
- **Đo:** `git grep truncatedIdentityWrites` ngoài test ⇒ **5 điểm, tất cả trong `server/services/vram/`**.
  **0** ở `client/**`. **0** ở `server/services/aiLocalTools/vramTools.ts`.
- **Kịch bản hỏng cụ thể:** `GGUF_MODELS_DIR` chuyển sang một cây thư mục sâu (Task 5 đo được `owner`
  sản xuất dài **≥365** ký tự vs trần **160**) ⇒ mọi hàng của tiến trình này lên sổ chung dưới **danh
  tính cụt**; hệ quả mà chính docstring nêu — *"nút Thu hồi gửi `preempt({owner})` với chuỗi của mặt
  đọc, còn sổ giữ chuỗi đã cắt ⇒ hai chuỗi không khớp"* — tức **hộ ấy thành không thu hồi được**. Con
  số cảnh báo nằm trong payload JSON và **không một bề mặt nào in nó ra**.
- **Và điều đó được CHÍNH NHÁNH NÀY chứng minh là không thể tới Agent:** Task 2 đo và ghi vào
  `vramTools.ts` rằng Agent **chỉ nhận `textSummary`** (`aiLocalKnowledgeService.ts:2351` đường
  stream · `:2070`/`:2396` đường không stream — `data.state` **không bao giờ** tới LLM). Tôi xác minh
  lại cả hai đường: đúng. ⇒ Task 5 đưa lời khai vào **đúng cái ô mà Task 2 vừa chứng minh là Agent
  không đọc**.
- **Đột biến W4 (của tôi):** ép `truncatedIdentityWrites: 0` (nói dối) ⇒ **ĐỎ 1 ca, đúng tên**. Nghĩa
  là chặng **`sổ → payload`** được canh chắc; chặng **`payload → mắt người`** thì **không tồn tại**.
  Tên ca vì thế **hứa quá** — lớp lỗi *"docstring tự xưng là luật mà mâu thuẫn mã"*, lần thứ **NĂM**.
- **Task nào lẽ ra phải bắt:** **Task 5, Cổng ra** (*"không còn đường nào cắt `owner` mà không khai"*).
  Cổng đạt theo nghĩa **hệ kiểu**; theo nghĩa **có ai biết không** thì chưa.

#### I-3 · Ba ô "lời khai" của Task 2 là **TẢI CHẾT trên dây**, và người tiêu thụ mà Task 2 sinh ra để bảo vệ (**Agent**) vẫn nhận một con số trần

- **Nơi:** `server/services/vram/vramReadModel.ts:1310-1321` (`notAnInvariant`, `variesWith`,
  `beforeAfterEvidence`) · `server/services/aiLocalTools/vramTools.ts:176`
  (`eff: M(s.headroom.effective.bytesAtReadMs)`).
- **Đo:** `git grep` trên `client/src` cho `notAnInvariant|variesWith|beforeAfterEvidence` ⇒ **0 lượt
  đọc** (chỉ 1 lượt nhắc trong comment). Kích thước ba ô: **424 byte UTF-8 JSON** mỗi lượt trả lời;
  panel poll **5 s** ⇒ **≈298 KiB/giờ/panel** dữ liệu **không ai đọc**.
- **Kịch bản hỏng cụ thể:** Agent hỏi *"dư địa còn bao nhiêu?"* → nhận `textSummary` chứa một con số
  MiB **không kèm câu "nó đang chảy"** → so hai lượt hỏi cách nhau vài giây → kết luận *"vừa nhả
  426 MiB"* trong khi **không byte nào đổi**. Đó **đúng** kịch bản Pha 4 đã trúng-nhờ-may và Task 2
  sinh ra để đóng — và với Agent, **lượt đổi kiểu của Task 2 là vô hình**.
  ⚠ Task 2 **khai thẳng** món này (và đính chính lý do hoãn cũ là **SAI**); tôi xác nhận đánh giá ấy
  đúng. Xếp Important vì **cộng với I-2** nó thành một khuôn:
- **KHUÔN CHUNG (chỉ thấy khi ghép ba task):** Task 1 (docstring `StepUpOtpDialog`), Task 2 (ba ô
  trên) và Task 5 (`truncatedIdentityWrites`) **đều dừng lời khai ở BIÊN PAYLOAD** và đều gọi đó là
  *"tới được người đọc"*. Bề mặt duy nhất người thật nhìn — `VramBrokerPanel` — render **không một ô
  nào** trong số đó, và **30/33 nhãn của nó chưa được dịch** (I-1).
  **⇒ Cơ chế mà mọi task đều tưởng task khác lo: CHẶNG CUỐI, từ payload ra màn hình.**

#### I-4 · Bảng chi phí trong docstring **SAI Ở CẢ HAI CON SỐ** — vì hai task mỗi người tính chi phí tầng mình, không ai cộng lại

- **Nơi:** `server/_core/trpc.ts:422-423` (*"khi cache nguội thì OTP được verify **hai lần** … và nó
  chỉ xảy ra trên đường **cache-miss**"*) · `server/_core/trpc.ts:545` (*"trên đường **cache-miss**,
  OTP được verify **hai lần** (2 truy vấn `users`)"*) · `server/routers/vramRouter.ts:126-129`
  (*"hai lượt verify chỉ xảy ra trên đường cache-miss"*).
- **Chuỗi thật của `preempt`/`releaseStale`:** `requireFreshTotp` → `requirePerCallFreshTotp` (gốc,
  Task 1b) → `requirePermission` → `requirePerCallFreshTotp` (**lần hai**, `vramRouter.ts:132`,
  Task 1, **cố ý giữ**). `stepUpTotpMiddleware(false)` **không có** đường thoát sớm (`until` luôn
  `undefined`), và mỗi `verifyFreshTotp` là **1 `SELECT` trên `users` + 1 `speakeasy.totp.verify`**
  (`trpc.ts:319-337`).
  ⇒ **cache-miss = 3 lượt verify** (không phải 2) · **cache-hit = 2 lượt verify** (không phải 0).
  Lượt verify thừa xảy ra ở **MỌI lượt gọi**, đúng ngược với câu *"chỉ trên đường cache-miss"*.
- **Kịch bản hỏng cụ thể:** ai đọc câu này để quyết *"có nên chain per-call ở một sàn thứ ba không"*
  sẽ tính chi phí **thiếu ~50 %**; một lượt điều tra hiệu năng thấy 3 `SELECT users` cho một lượt bấm
  nút sẽ **không tìm thấy lời giải thích đúng** trong mã.
- **Không phải lỗi an ninh** (thừa theo chiều CHẶT), và **`getRawInput()` an toàn khi gọi 3 lần**
  (tRPC 11.18.0 bọc `memo()` — `resolveResponse-CdASWfAV.mjs:47,180,210`; tôi kiểm riêng vì gọi lặp
  một hàm đọc thân request là một đường hỏng thật).
- **Task nào lẽ ra phải bắt:** **Task 1b**, khi nó gộp vào gốc mà **giữ nguyên** lượt `.use()` của
  Task 1 ở `vramRouter` — quyết định giữ được viết lý do rất kỹ, **chi phí thì không tính lại**.

### 🟡 Minor

#### M-1 · Cache phiên `stepUpVerifiedUntil` nay **KHÔNG QUYẾT ĐỊNH KẾT QUẢ CỦA LƯỢT GỌI NÀO**
`git grep '.use(requireFreshTotp)'` trong `server/**` ⇒ **đúng một** điểm, ngay **trước**
`requirePerCallFreshTotp` trong `deployProcedure` (`trpc.ts:549`). ⇒ một cache-hit chỉ cho qua
middleware thứ nhất; **không request nào** có kết quả phụ thuộc cache. Lý do (a) mà docstring nêu để
giữ nó — *"bỏ nó đi thì ca đỏ thành chân lý rỗng"* — là **giữ mã sản xuất để phục vụ lưới**, một
chiều phụ thuộc ngược; lý do (b) (hỏng-theo-chiều-an-toàn) thì đứng vững. ⚠ Điểm dùng **được canh**
(`deployStepUpFreshness.test.ts:537`) ⇒ ghi nhận, không phải lỗ.

#### M-2 · `vramEventLog.VARCHAR_LIMITS` liệt **5/7** cột `varchar` của `vram_events`
`drizzle/schema/vram.ts:14,28,29,30,31,44,49` có **7** cột; `vramEventLog.ts:157` khai **5** (thiếu
`resourceKind(16)`, `wouldRefuse(8)`). **Không khai thác được hôm nay**: `resourceKind` không có
trong `VramEventInput` (DB tự điền), `wouldRefuse` là `boolean` → `String()` ≤ 5 < 8. Tức *"phần tử
thứ N+1 đã xảy ra rồi, chỉ chưa gây hại"*. Task 5 dựng đúng lời giải cho **bảng anh em**
(`VRAM_LEASE_COLUMN_MAX` + ca *"MỌI cột `varchar` của `vram_leases` phải có ĐÚNG một mục"*) và
**không** chĩa lượng từ ấy sang `vram_events` — chi phí ≈ một `describe` nữa trong cùng file.

#### M-3 · **3** file test tự khai một pha nhưng nằm **NGOÀI** cổng (đo bằng chính mẫu đã ship)
`server/routers/appErrorParamsCoverage.test.ts` · `server/services/aiGgufEngine.test.ts` ·
`server/services/kbSyncScheduler.evalGate.test.ts` (quét **852** file test bằng
`/\bPha\s+\d+(?:\.\d+)?[A-Za-z]?\b/i` + vị từ `duocPhu` của cổng). Một đột biến trong đúng ba file
này **ship được với cổng xanh 100 %**. Xác nhận bản khai Task 3; con số **không đổi** sau Task 1b/5.

#### M-4 · Một bất biến **của máy chủ** được canh **chỉ từ nửa client** của cổng
Ca duy nhất cưỡng chế *"∀ 7 thủ tục `deployProcedure`: `totpCode` phải BẮT BUỘC"* nằm ở
`client/src/lib/vramPanelStepUp.unit.test.ts:611`; `server/**` có **0** khẳng định trên `totpBatBuoc`
của tập sản xuất (`deployStepUpFreshness.test.ts:323` chỉ canh **hai fixture M3**). Đo được ở W1:
chạy riêng `deployStepUpFreshness.test.ts` dưới đột biến ⇒ **24/24 XANH**.

#### M-5 · `VRAM_BEFORE_AFTER_EVIDENCE` đưa **một câu tiếng Việt ghim cứng** lên dây API
`vramReadModel.ts:568` — 169 ký tự / 207 byte, đi trong **mọi** lượt `vram.state`, nằm **ngoài** kỷ
luật ba-bản-thật mà chính module này cưỡng chế cho `vramPhrases.ts` (51 khoá × 3, có lưới). Cùng
trục với I-1: chuỗi cho **máy đọc** thì tuỳ tiện, chuỗi cho **người đọc** thì không được dịch.

---

## 4. Những gì tôi đi kiểm và **KHÔNG** tìm thấy lỗi (ghi để lượt sau khỏi đi lại)

| Câu hỏi của cả nhánh | Kết quả |
|---|---|
| Task 5 thêm ô mới vào ảnh chụp — phép phân loại có-ĐO của Task 2 có bỏ sót nó không? | **KHÔNG.** `vramReadModel.drift.test.ts:394` xếp `ledger.foreign.truncatedIdentityWrites` vào vế KHÔNG-ĐỔI-THEO-ĐỒNG-HỒ; lượng từ suy từ **kiểu + lá thật** (`:734`), không phải danh sách tay ⇒ ô mới **buộc** phải phân loại. Đây là chỗ Pha 6 làm **đúng nhất**. |
| Đường Agent có ra được **lệnh phá huỷ** VRAM (bỏ qua step-up) không? | **KHÔNG.** Tool VRAM duy nhất là `get_vram_state` (đọc); ba hàm lệnh chỉ có điểm gọi ở `vramRouter.ts:183,193,204`. |
| `effectiveBytes` còn sót ở đường sản xuất nào không? | **KHÔNG.** `git grep` ⇒ chỉ còn trong comment + 1 ca canh *"ô cũ đã BIẾN MẤT khỏi payload"*. `nonFiniteFields` sinh đường **generic** (`locHuuHan`) nên `headroom.effective.bytesAtReadMs` là đường thật, không phải chuỗi chép tay. |
| `requireFreshTotp` còn điểm dùng nào ngoài `deployProcedure`? | **KHÔNG**, và có lưới ∀ canh (`deployStepUpFreshness.test.ts:537`). |
| Gọi `getRawInput()` 3 lần trên một request có làm hỏng lệnh thật không? | **KHÔNG** — tRPC 11.18.0 bọc `memo()`. |
| Cổng có đường nào không tồn tại trên đĩa (glob rỗng ⇒ vitest im lặng)? | **KHÔNG** — 14/14 `ls` kiểm trước. |

---

## 5. Ba đột biến — bảng tổng kết

| # | Nhắm vào đường ghép | Hình dạng | Kết quả | Phán xử |
|---|---|---|---|---|
| **W1** | Task 1 (bài học I-4) ↔ Task 1b (ô `totpBatBuoc`) | `deployBuild.totpCode` → `.optional()` | **ĐỎ 1 ca, đúng tên** (`vramPanelStepUp.unit.test.ts:611`), `tsc` sạch | Hàng rào **CÓ** — dự đoán của tôi sai. Ghi M-4 về **vị trí** hàng rào. |
| **W2** | Task 1 (`VRAM_COMMAND_DESTRUCTIVE`) — trục **tên + file** | hàm giết tiến trình ngoài `vramCommands.ts`, tên không khớp mẫu, gắn vào `vramRouter` trên sàn `canCreate` | **ĐỎ 7 ca / 4 file**, có ca bắt **đúng cơ chế**: *"mutation không tham chiếu hàm lệnh nào ⇒ ngoài tầm lượng từ HÀNH VI"* | Cầu chì đảo-lượng-từ **CÓ RĂNG**. Task 1 làm đúng. |
| **W3** | **Task 1 ↔ Task 1b** — cùng một câu, hai phạm vi quét | cùng hàm ấy, gắn vào **`aiModelRouter.ts`** (đã nối `appRouter`), sàn không có step-up nào | 🔴 **XANH TOÀN PHẦN 109/1.861**, `tsc` sạch | **C-2.** Bài học R1b của Task 1b không được mang về nửa VRAM. |

Mọi lượt: **commit trước → đột biến → chạy → `git checkout HEAD -- <file>` → chạy lại TOÀN BỘ**.

---

## 6. Nợ MANG SANG PHA 7

**Sinh ra / lộ ra ở lượt review này**
1. 🔴 **C-1** — dung sai hình dạng + cách ly lỗi cho `vram.state` ở client (và một lượt restart tiến trình 30108 để `/ai-brain` sống lại **ngay**).
2. 🔴 **C-2** — chĩa `deployProcedureScan` (đã có, đã export) vào lượng từ "lệnh phá huỷ VRAM"; bỏ neo một-file.
3. 🟠 **I-1** — `i18n:check` phải chạy lượng từ trên **khoá được mã tham chiếu**, và phải so **sự có mặt**, không chỉ placeholder; + dịch 30 khoá `vramBroker.*`.
4. 🟠 **I-2 + I-3** — chặng cuối payload→màn hình: render `truncatedIdentityWrites` và câu "đang chảy" ở `VramBrokerPanel` + `textSummary` (Task 2 đã tính giá: **3 chuỗi khuôn, 0 khoá i18n mới**).
5. 🟠 **I-4** — sửa ba khối chi phí (3 lượt verify / mọi lượt gọi), hoặc bỏ lượt `.use()` thừa ở `vramRouter.ts:132` và đổi bộ suy của `vramStepUpFreshness` sang leo tới gốc.
6. 🟡 **M-2** — chĩa lượng từ ∀-cột sang `vram_events`.

**Đã có TRƯỚC, vẫn treo (không phải phát hiện của lượt này)**
- **BA tuyến REST deploy KHÔNG cần OTP** (`/equipment/:id/commands` · `/orchestration/workflows` · `/orchestration/runs`) — probe thật **201 + 2 INSERT**, `createdBy:null`; nợ có từ `59948375` (2026-06-28). **Chờ chủ dự án.** ⚠ Sau Task 1b khoảng cách **rộng ra**: đường tRPC nay đòi OTP mỗi lượt, đường REST vẫn không đòi gì.
- **Không chống phát lại** — cùng mã dùng lại ~90 s (`speakeasy window:1`). Cần cơ chế MỚI (sổ mã đã dùng).
- `npm run check` **mù với `*.test.ts`** (đã che một lỗi thật của Task 5).
- **M-3** 3 file ngoài cổng · lưới I-3 nối `.mutate(`↔`useMutation` **trong cùng file** (prop-drilling chưa phủ) · repo **0** file `*.test.tsx` (không harness render).
- 9 thủ tục trên `machine_control/canDelete` · 31 thủ tục `canView` · 6 tên module ngoài `PERMISSION_MODULES` · brand `input` của lệnh — **chờ chủ dự án**.
- Flake/đỏ có trước: `wiring.inprocess` · `visionControl.tools` · `vramReconciler.test.ts` · 16 file `server/routers/**` · 5 ca `server/services/programming/**` · 10 ca `server/services/ai/**` (`42501`) · `programmingRouter.safetyGuard.test.ts` · `canUseAgentic({role:"engineer"})`.

---

## 7. Đối chiếu LĂNG KÍNH

| Lớp lỗi | Pha 6 có tái diễn? |
|---|---|
| **"Cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"** (13 lần) | **CÓ — lần thứ 14 và 15:** C-2 (danh sách **một file**) · M-2 (5/7 cột, N+1 **đã xảy ra**). |
| **LƯỢNG TỪ SAI** ("tồn tại" chỗ cần "với mọi") | **CÓ — I-1**, ba lần trong **một** công cụ 100 dòng. |
| **"Lưới XANH vì lý do sai"** | **CÓ — I-2**: ca tên *"tới được người đọc"* chỉ chứng minh *"tới được một ô"*. |
| **"An toàn là HỆ QUẢ của thứ khác đang hỏng"** (6 lần) | **KHÔNG tìm thấy lần thứ bảy.** Chỗ gần nhất là M-1 (cache sống nhờ một ca test) — quan hệ ngược chiều: **lưới** phụ thuộc **mã sản xuất**, không phải an toàn phụ thuộc lỗi. |
| **"Hàng rào KHÔNG AI CANH"** | **CÓ — C-2** (lệnh phá huỷ ngoài `vramRouter`) · **M-3** (3 file). |
| **"Docstring tự xưng là luật mà mâu thuẫn mã"** (4 lần) | **CÓ — lần 5 và 6:** I-4 (bảng chi phí) · I-2 (tên ca). |
| **"Độc lập về NGUỒN ≠ độc lập về SAI LẦM"** | **CÓ — C-2**: hai bộ suy AST **độc lập hoàn toàn** (`deployProcedureScan` vs bộ suy trong `vramStepUpFreshness`), cùng canh một câu, **hai phạm vi khác nhau** ⇒ cái yếu hơn canh nửa **nguy hiểm hơn**. |
| **"Cổng chạy glob rỗng ⇒ vitest im lặng"** (4 lần) | **KHÔNG** — 14/14 đường tồn tại; `vramPha5Gate` cưỡng chế cả `CONG=14` lẫn `FILE_CANH=71`. |
| **"Lý do SAI được trích dẫn lại để hoãn tiếp"** (3 lần) | **KHÔNG.** Ngược lại: Task 1b **bác** lý do sai của Task 1 (*"200 máy gãy giữa chừng"*) và ghi cảnh báo vào `vramRouter.ts:85` cấm trích lại. Điểm mạnh nhất của nhánh. |

---

## 8. ĐIỂM MẠNH đáng ghi (để lượt sau đừng phá)

1. **`vramReadModel.drift.test.ts` — phép phân loại CÓ ĐO** là cơ chế tốt nhất nhánh sinh ra: lượng từ
   suy từ **kiểu + lá thật**, mỗi bản khai bị **phép đo** chấm. Nó **tự động** bắt ô mới của Task 5.
2. **`deployProcedureScan.ts`** — nhận diện module bằng **phép nối đường dẫn**, không bằng chính tả;
   ba **cầu chì tự-khai-không-đủ** thay vì im lặng bỏ sót. Đây là hạ tầng nên dùng lại cho C-2.
3. **Cầu chì "mutation không tham chiếu hàm lệnh nào ⇒ ĐỎ"** (`vramStepUpFreshness.test.ts:424`) —
   đảo lượng từ đúng bài, và nó **bắt được đột biến W2 của tôi**.
4. **Gộp phép siết vào GỐC `deployProcedure`** thay vì chain tay 7 chỗ — đúng hình dạng của một **∀**.
5. **Task 1b bác một lý do SAI của Task 1 bằng số đo** và ghi cấm-trích-lại vào mã.

---

## 9. Trạng thái cây khi KẾT THÚC

| Trục | Kết quả |
|---|---|
| `git status --porcelain server client shared drizzle scripts` | **sạch** (mọi đột biến đã `git checkout HEAD --`) |
| `git log -1` | `8b066230` — **không commit mới**, **không sửa mã sản xuất** |
| Cổng 14 đường (chạy lại lần cuối) | ✅ **109 file / 1.861 ca XANH** |
| `npm run check` · `check:tests` · `i18n:check` | ✅ ✅ ✅ |
| Tiến trình PID 30108 | **KHÔNG đụng tới** |
| 243+ mục bẩn có trước | **KHÔNG đụng tới** |
| Script tạm | `/tmp/w2.py`, `/tmp/w3.py`, `/tmp/vb.txt` — đã xoá |

---

## 10. KẾT LUẬN

### Tuân thủ ràng buộc: ✅ **ĐẠT**
Commit-trước-đột-biến-sau · khôi phục bằng `git checkout HEAD --` · chạy lại toàn bộ sau mỗi lượt ·
cổng theo **đường dẫn tường minh** + `ls` kiểm trước · không sửa mã sản xuất · không trainer/`kb:sync`/
DDL/seed/sub-agent · không đụng 243+ mục bẩn · không giết PID 30108.

### Có đưa lên được không: ❌ **CHƯA — hai mục phải đóng trước**

- 🔴 **C-1** chặn vì **bề mặt đang phục vụ đang chết**: `/ai-brain` vào `ErrorBoundary` cho **mọi vai**,
  tức chính bảng mà Pha 4→6 dựng ra để người vận hành thấy VRAM. Mức tối thiểu để mở chặn: một lượt
  restart tiến trình **cộng** một dung sai hình dạng ở client (hoặc bọc `VramBrokerPanel` bằng
  boundary riêng) — nếu không, lượt phát hành kế tiếp có tài sản tĩnh đi trước API sẽ tái diễn.
- 🔴 **C-2** chặn vì **câu tuyên bố của cả pha sai ở dạng tổng quát** và cổng **không phát hiện được
  phản ví dụ** (đo được: W3 xanh 109/1.861). Không có lỗ đang sống, nhưng đưa lên kèm một cổng khai
  xanh cho đúng lớp lỗi mà pha này sinh ra để đóng là **tái lập chính xác** bài học Pha 5 (*"hai cổng
  độc lập cùng canh TẬP thay vì ÁNH XẠ"*). Chi phí sửa thấp: hạ tầng đã có sẵn **trong cùng nhánh**.

**Bốn Important + năm Minor KHÔNG chặn** — mang sang Pha 7 (§6).

### Chất lượng công việc: 🟠 **CAO, nhưng lệch trọng tâm về phía hệ kiểu**
Năm task đóng đúng những gì kế hoạch nêu và các cơ chế mới (phân loại có-đo, bộ suy đệ quy, cầu chì
đảo-lượng-từ) là **tốt nhất mà chuỗi pha này từng sinh ra** — hai trong ba đột biến của tôi bị chúng
bắt đúng tên. Điểm yếu **chỉ lộ ra khi ghép**: cả nhánh dồn sức vào **`tsc` + lưới**, và **chặng cuối
— từ payload ra mắt người đọc — không có ai nhận**. C-1, I-1, I-2, I-3 đều là **một** khuyết điểm ấy
nhìn từ bốn phía.
