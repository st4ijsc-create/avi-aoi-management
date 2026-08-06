# Review TOÀN NHÁNH — Pha 5 (trả nợ N8–N14) · module điều phối VRAM

**Dải:** `ed61688d..13116471` — 24 commit · 37 file · +7.755/−357
**Nhánh:** `feat/hmi-dep` · **HEAD lúc review:** `13116471075b4ff99cd79be13f8548cebb0ed4b3`
**Người review:** agent review toàn nhánh độc lập · 2026-08-06
**Nguyên tắc:** KHÔNG chấm lại từng task (đã có 6 review + ~10 vòng sửa). Chỉ hỏi những câu **chỉ trả
lời được khi nhìn CẢ NHÁNH**. Mọi con số dưới đây là **tôi tự chạy**.

> **Ghi DẦN.** Mỗi mục được viết ngay sau khi đo xong.

---

## 0. Baseline — đo trước khi đụng vào bất cứ thứ gì

| kiểm | lệnh | kết quả |
|---|---|---|
| HEAD | `git rev-parse HEAD` | `13116471075b4ff99cd79be13f8548cebb0ed4b3` ✅ |
| cây bẩn của việc khác | `git status --porcelain \| wc -l` | **243** — không đụng ✅ |
| không stage rác | `git diff --cached --name-only \| wc -l` | **0** ✅ |
| mọi đường cổng tồn tại (`ls` TRƯỚC khi tin) | 10/10 đường | **OK 10/10** ✅ |

**Cổng đầy đủ (đường dẫn TƯỜNG MINH — cổng của kế hoạch **CỘNG** `vramPermissionSplit.test.ts`, xem
I-1 vì sao phải cộng):**

```
npx vitest run server/services/vram/ server/services/aiLocalTools/ \
  server/routers/vramRouter.test.ts server/routers/vramRouter.commands.test.ts \
  server/routers/vramRouter.retryDeferred.test.ts server/routers/vramRouter.unledgered.test.ts \
  server/routers/vramRouter.kbSyncDefer.test.ts server/routers/permissions.machineControl.test.ts \
  server/routers/vramPermissionSplit.test.ts client/src/lib/
⇒ Test Files 100 passed (100) · Tests 1692 passed (1692) · 26,87 s
```

---
## 1. 🔴 **CRITICAL C-1 — HAI CỔNG "NGUỒN ĐỘC LẬP" CANH **TẬP**, KHÔNG CANH **ÁNH XẠ**. HOÁN VỊ HAI BIT LÀ MỘT BẢN VÁ SHIP ĐƯỢC.**

**Địa chỉ:**
- `server/routers/vramRouter.ts:96` + `:99` (điểm sản xuất)
- `server/routers/vramPermissionSplit.test.ts:439-446` — ca *"★★★ `vramRouter.ts` KHAI ĐỦ và KHAI ĐÚNG ba cổng của nó"*
- `client/src/lib/vramCommandReach.role.unit.test.ts:322-336` — ca *"★★★ hai cổng lệnh mà client khai đúng bằng hai cổng lệnh của `vramRouter`"*

### Đột biến W1 (của reviewer) — **HOÁN VỊ** `canDelete` ↔ `canCreate` giữa hai thủ tục

```diff
-const vramDestructiveProcedure = deployProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canDelete"));
+const vramDestructiveProcedure = deployProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canCreate"));
-const vramActuationProcedure  = actuationProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canCreate"));
+const vramActuationProcedure  = actuationProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canDelete"));
```

| cổng | kết quả **dưới đột biến** |
|---|---|
| **CỔNG CỦA KẾ HOẠCH** (§"Cổng kiểm chung", nguyên văn, 9 đường) | ★ **99 file / 1675 ca — XANH TOÀN BỘ** |
| `client/src/lib/vramCommandReach.role.unit.test.ts` (gương "nguồn ĐỘC LẬP") | **XANH 100%** |
| `client/src/lib/vramCommandReach.unit.test.ts` | **XANH** |
| `server/routers/vramRouter.test.ts` · `.commands.test.ts` · `permissions.machineControl.test.ts` | **XANH** |
| ca AST **★★★ "KHAI ĐỦ và KHAI ĐÚNG ba cổng của nó"** | ★ **XANH** |
| `server/routers/vramPermissionSplit.test.ts` (toàn file) | **2/17 đỏ** — và **cả hai là ca RUNTIME**, không phải ca AST |

⇒ Hai ca duy nhất bắt được nằm **trong đúng cái file mà cổng của kế hoạch KHÔNG chạy** (xem I-1).
Chạy đúng cổng đã ghi trong kế hoạch thì đột biến này **XANH 1675/1675**, `tsc` sạch, `i18n:check` sạch
— tức nó là một bản vá **ship được**.

### Vì sao cả hai cổng "nguồn độc lập" cùng mù — **LƯỢNG TỪ SAI**

Cả hai đọc `vramRouter.ts` bằng AST rồi rút ra một **TẬP chuỗi `module/action`**, và phát biểu bất biến trên **tập** ấy:

```ts
// vramPermissionSplit.test.ts:441-445 — so SẮP XẾP hai mảng
expect(cua).toEqual([`${VRAM_CONTROL_MODULE}/canCreate`, `${VRAM_CONTROL_MODULE}/canDelete`, "machine_control/canView"].sort());

// vramCommandReach.role.unit.test.ts:329-335 — `toContain` + lọc phần dư
for (const k of khai) expect(may).toContain(k);
const conLai = may.filter((c) => !khai.includes(c) && c !== "machine_control/canView");
```

Hoán vị **giữ nguyên tập** ⇒ cả hai vế bất biến không đổi. Điều **chưa từng được phát biểu** là ánh xạ
***thủ tục → cổng***: `quetDiemGoi()` ghi `{file, module, action}` — **không ghi thủ tục/biến nào chứa
lời gọi**, nên bất biến ấy **viết ra không được** bằng dữ liệu mà máy quét thu thập.

Đây đúng lớp lỗi 2 của lăng kính (*"luật 'tồn tại' ở chỗ cần 'với mọi'"*): luật đang nói
*"∃ một điểm gọi mang cặp này"*, chỗ cần là *"∀ thủ tục p: cổng(p) = cổng kỳ vọng của p"*.
Và lớp lỗi 7: **tên của ca tự xưng là "KHAI ĐÚNG"** trong khi nó chỉ kiểm "KHAI ĐỦ".

### Kịch bản hỏng cụ thể (không giả định — dùng chính bảng grant đã duyệt)

`client/src/lib/vramCommandReach.ts:161-163` khai bảng grant chủ dự án đã chốt:
> `engineer`: `vram_control/canCreate` **CÓ** (⇒ "Thử lại ngay" bật), `canDelete` **KHÔNG**.

Sau hoán vị:
1. `engineer` được cấp `vram_control/canCreate` **đúng như kế hoạch** ⇒ máy chủ cho `engineer` chạy
   **`vram.preempt`** (giết một tiến trình) và **`vram.releaseStale`** (xoá một hàng khỏi sổ chung mà
   **mọi tiến trình anh em** đọc để tính dư địa) — `engineer` **có** trong `ACTUATION_ROLES` nên
   `deployProcedure` không chặn, chỉ đòi OTP tươi.
2. Gương client **vẫn** đọc `VRAM_LENH_GATE.destructive = canDelete` ⇒ hai nút phá huỷ **vẫn xám** trên
   màn hình của engineer. **Không một dấu hiệu nào trên UI.** Lỗ chỉ mở qua lời gọi tRPC trực tiếp.
3. Đây **ngược chiều** với chính lý do Task 3b tồn tại (*"thu hẹp, không nới"*): bit `canCreate` — cái
   được cấp **rộng hơn** — lại thành cổng của hai lệnh **PHÁ HUỶ**.

**Task nào lẽ ra phải bắt:** Task 3b (bước 3 của brief nói *"`supervisor` **có** bit VRAM mới ⇒
`preempt`/`releaseStale` QUA cổng quyền"* — vế ấy được ghim bằng **runtime**, còn vế cấu trúc thì
Task 3b tự khai là *"trục cưỡng chế"* và Task 3 tự khai là *"nguồn độc lập"*). **Cả hai neo cùng một
tính chất (TẬP), và mỗi bên tưởng bên kia neo ánh xạ** — đúng câu hỏi *"cơ chế nào các task đều tưởng
task khác lo"*.

### Bản vá dẫn tới (một lượt, rẻ)

Trong `quetDiemGoi()` / `cuaMayChu()`, ghi thêm **tên biến/thủ tục chứa lời gọi** (leo cây tới
`VariableDeclaration` gần nhất — `vramDestructiveProcedure` / `vramActuationProcedure` /
`vramReadProcedure` đều là khai báo biến có tên), rồi phát biểu bất biến theo **ánh xạ**:

```ts
expect(anhXa).toEqual({
  vramDestructiveProcedure: `${VRAM_CONTROL_MODULE}/canDelete`,
  vramActuationProcedure:   `${VRAM_CONTROL_MODULE}/canCreate`,
  vramReadProcedure:        "machine_control/canView",
});
```

⚠ **Hỏi lại "lưới DẪN người ta tới đâu":** phát biểu trên còn ép người sau **đặt tên** cho sàn thay vì
chain thẳng vào thủ tục — nếu ai đó viết `preempt: deployProcedure.use(requirePermission(...))` inline
thì máy quét phải rơi vào nhánh *"không phân giải được"* (**ĐỎ**), y như cách `khongPhanGiaiDuoc` đã làm
cho `module`. Không được im lặng bỏ qua.

---

## 2. 🟠 **IMPORTANT I-1 — CỔNG CỦA KẾ HOẠCH KHÔNG CHẠY FILE CƯỠNG CHẾ DUY NHẤT CỦA TASK 3b. HAI TRONG BA ĐỘT BIẾN CỦA TÔI LỌT QUA VÌ ĐÚNG LÝ DO NÀY.**

**Địa chỉ:** `docs/superpowers/plans/2026-08-06-vram-pha5-tra-no.md:39-43` (§"Cổng kiểm chung")

Cổng liệt kê **9 đường**; `server/routers/vramPermissionSplit.test.ts` (**662 dòng — toàn bộ phép
cưỡng chế của Task 3b**, gồm cả trục AST trên `server/**` lẫn ca ghim step-up 2FA) **không có trong
danh sách**. Commit cuối của nhánh (`13116471`) tên là *"RR-M4 — cổng thiếu **3 file** test"* và đã
thêm `unledgered` · `kbSyncDefer` · `permissions.machineControl` — **vẫn bỏ sót cái nặng nhất.**
Đây là **phần tử thứ N+1 của một danh sách** (lớp lỗi 1), tái diễn ngay trong bản vá dựng ra để đóng
chính lớp lỗi ấy.

| đột biến của reviewer | cổng **của kế hoạch** | cổng **+ `vramPermissionSplit.test.ts`** |
|---|---|---|
| **W1** hoán vị `canDelete`↔`canCreate` | ★ **99/1675 XANH** | 2 ca đỏ |
| **W3** `retryDeferred` lên `deployProcedure` | ★ **XANH** (file đỏ duy nhất là `vramPermissionSplit`) | 1 ca đỏ |
| **W2b** `owner.max(160)` → `.max(64)` | ★ **100/1692 XANH** | ★ **100/1692 XANH** |

⇒ **2/3 đột biến của tôi ship được nếu người sau chạy đúng cổng đã ghi.** Kế hoạch tự cảnh báo điều
này ở RR-M4 (*"review toàn nhánh sẽ chạy theo văn bản"*) và **vẫn** sót.

⚠ Và trong **cả hai** ca bắt được, ca đỏ là ca **RUNTIME** bắt **tình cờ** (nó khẳng định
`appParams.action` / khẳng định `retryDeferred` chạy được **không** cần OTP). Ca **AST** — thứ tự
xưng là *"trục cưỡng chế"* — **xanh ở cả hai**. Xem C-1.

**Bản vá:** thêm `server/routers/vramPermissionSplit.test.ts` vào §Cổng kiểm chung. Và **phát biểu
lại lượng từ của chính cổng**: thay vì liệt kê đường dẫn (danh sách nào cũng có phần tử thứ N+1),
dùng một luật *"mọi file test khớp `server/routers/vram*.test.ts` **và** `server/services/vram/**`
**và** `client/src/lib/vram*`"* — rồi **ghim SỐ FILE** (`expect(soFile).toBe(N)` trong một ca) để
glob rỗng/hụt là **ĐỎ**, không phải im lặng.

**Task nào lẽ ra phải bắt:** Task 5 (RR-M4 là **của** Task 5) — nó đếm 3 file thiếu bằng cách nhìn
*"Task 5 đổi kiểu ô nào"*, tức nặn theo **chữ ký của lỗi vừa rồi**, đúng thứ Global Constraints cấm.

---

## 3. 🟠 **IMPORTANT I-2 — "DANH TÍNH ĐI THẲNG VÀO LỆNH" LÀ HỢP ĐỒNG HAI ĐẦU; PHA 5 CHỈ ĐÓNG ĐẦU ĐỌC. BỀ RỘNG `owner` HOÀN TOÀN KHÔNG CÓ LƯỚI.**

**Địa chỉ:**
- `server/services/vram/vramReadModel.ts:84-87` + `:304-305` — hợp đồng: `owner` là **danh tính**, **KHÔNG BAO GIỜ bị cắt**
- `client/src/components/ai/VramBrokerPanel.tsx:331-332` — *"owner KHÔNG cắt ngắn — danh tính đi thẳng vào lệnh"*, và `:362` `preempt.mutate({ owner: h.owner, … })`
- `server/routers/vramRouter.ts:146` — `owner: z.string().trim().min(1).max(160)`
- `server/services/vram/vramSharedLedger.ts:610-624` — sổ chung **CẮT `owner` ở 160** để vừa `varchar(160)`
- `server/services/ai/ocrService.ts:384` — `owner` dựng từ **đường dẫn tuyệt đối** (`onnx-ocr:<modelPath>`)

### Đột biến W2b — `owner.max(160)` → `.max(64)`

```
cổng ĐẦY ĐỦ (100 đường, gồm cả vramPermissionSplit)
⇒ Test Files 100 passed (100) · Tests 1692 passed (1692)   ★ XANH TOÀN BỘ
```

⇒ **Không một ca nào trong toàn nhánh ràng buộc bề rộng của ô `owner` với độ dài mà mặt đọc có thể
phát ra.** Khoảng 65–160 ký tự là **vùng mù tuyệt đối**. (Đo thêm: `.max(16)` mới đỏ — và đỏ vì
**fixture tình cờ dài hơn 16**, không vì một luật nào nói về danh tính.)

### Kịch bản hỏng cụ thể

`owner` sản xuất là **chuỗi động lấy từ đường dẫn tuyệt đối**. Hôm nay:
`onnx-ocr:` + `path.join(process.cwd(),"models","ocr","rec.onnx")` ≈ **57 ký tự** — vừa. Chính repo
đã viết ra ngòi nổ (`vramSharedLedger.ts:614-615`): *"Một lượt đổi thư mục model là đủ vượt
`varchar(160)`."*

Khi `owner` > 160:
1. Mặt đọc phát ra `owner` **nguyên vẹn** (đúng N11 — danh tính **không** được cắt) ⇒ nút *Thu hồi*
   **BẬT** (`vramDestructiveButtonDisabled` chỉ hỏi quyền + `isPending`, **không** hỏi độ dài).
2. Bấm ⇒ zod `.max(160)` ném **`BAD_REQUEST` xác thực đầu vào** — **không** phải một `reason` nghiệp
   vụ. Agent/người vận hành nhận một câu về *schema*, không phải một câu về *VRAM*, trong khi
   `vramRouter.ts:86-88` vừa tuyên bố ngược lại (*"mọi lượt TỪ CHỐI NGHIỆP VỤ trả về DỮ LIỆU có
   `reason`, KHÔNG ném"*).
3. **Nặng hơn ở chiều anh em:** sổ chung **đã cắt** `owner` xuống 160 khi ghi DB ⇒ hộ của **tiến
   trình anh em** hiện lên mặt đọc với một **danh tính bị cắt ÂM THẦM** — không cờ `truncated`, vì
   cơ chế cắt-và-khai của Task 5 **chỉ áp cho ô CÂU CHỮ**, không áp cho ô danh tính. Đúng lớp lỗi
   *"hai bề mặt, hai luật"* mà N11 dựng ra để đóng, sống nguyên ở bề mặt thứ ba mà N11 không nhìn.

**Task nào lẽ ra phải bắt:** Task 5 (N11 + N12). N12 đã sửa **đúng** lớp lỗi này cho `defer.hosts`
(*"`ownerPattern` là một MẪU, không phải một DANH TÍNH"*) và đổi kiểu để chặn — nhưng **không hỏi
tiếp câu thứ hai**: *"cái danh tính thật ấy có LỌT QUA được `input` của lệnh không?"*

**Bản vá dẫn tới:** một hằng dùng chung `VRAM_OWNER_MAX = 160` mà **cả** `vramSharedLedger.cat()`
**lẫn** router input **cùng** đọc (hôm nay là hai con số `160` chép tay ở hai file), cộng một ca
*"∀ ô danh tính trên mặt đọc: schema `preempt.input` parse THÀNH CÔNG"*. ⚠ Nếu chọn **nới** router
thì phải nới **cả cột DB**, nếu không chỉ dời chỗ nói dối.

---

## 4. 🟠 **IMPORTANT I-3 — KHÔNG CÓ LƯỚI NÀO GHÉP "SÀN THỦ TỤC" VỚI "THỨ CLIENT THẬT SỰ GỬI". HÀNG RÀO KHÔNG AI CANH, LẦN THỨ BA — VÀ "AN TOÀN LÀ HỆ QUẢ", LẦN THỨ TƯ.**

**Địa chỉ:** `server/routers/vramRouter.ts:99` + `:166-168` · `client/src/components/ai/VramBrokerPanel.tsx:41-42` + `:454-457`

### Đột biến W3 — `vramActuationProcedure`: `actuationProcedure` → `deployProcedure`

```
cổng CỦA KẾ HOẠCH ⇒ XANH (file đỏ duy nhất là vramPermissionSplit.test.ts — không nằm trong cổng)
cổng ĐẦY ĐỦ       ⇒ 1 ca đỏ / 1692: "★★★ step-up 2FA CÒN NGUYÊN: …"
```

Ca duy nhất bắt được **không** phát biểu về sự ghép nối; nó ghim *"`retryDeferred` chạy được **không
cần** OTP"*. Nó đỏ **như một tác dụng phụ**, và câu lỗi của nó **chỉ đường tới `preempt`**, không tới
`retryDeferred` — đúng cảnh báo của Global Constraints (*"một cổng có thể bắt đúng lỗi rồi chỉ đường
tới bản vá sai"*).

**Kịch bản hỏng:** panel **cố ý** không bọc `retryDeferred` trong `stepUp.guard`
(`VramBrokerPanel.tsx:41-42` giải thích: input của nó **không khai** `totpCode`).
`ACTUATION_STEPUP_2FA=true` **đang bật trên `.env` của hệ này** (`.env:568`). Nên chỉ cần ai đó nâng
sàn của `retryDeferred` lên `deployProcedure` — một thay đổi trông giống *"siết cho chặt hơn"*, đúng
chiều mà cả Pha 5 đang đi — thì:
- nút *"Thử lại ngay"* **hiện và bấm được** (`retryReach.kind === "reachable-here"` nói *"lệnh với
  tới"*, quyền đủ);
- lượt bấm **đầu tiên của mọi phiên** trả **403** vì không có `totpCode` và cache step-up trống;
- **không hộp thoại OTP nào bật lên** (panel không bọc step-up cho nút này) ⇒ người dùng bấm mãi.

Đó **chính xác** là *"mặt đọc hứa nhiều hơn mặt lệnh"* — do một bản vá **siết chặt** tạo ra.
Và đó là **"an toàn là HỆ QUẢ của một thứ khác đang hỏng", lần thứ TƯ**: hôm nay nút ấy chạy được
**không phải** vì ai đó đã ghép đúng client với server, mà vì `retryDeferred` **tình cờ** còn ở
`actuationProcedure`. Bất biến thật — *"thủ tục nào đứng sau `requireFreshTotp` thì mọi điểm gọi
client của nó PHẢI đi qua `stepUp.guard`, và `input` của nó PHẢI khai `totpCode`"* — **chưa từng được
viết ra ở đâu**.

**Task nào lẽ ra phải bắt:** Task 3b bước 4 (*"giữ nguyên `deployProcedure` + step-up 2FA"*) ghim
**nửa** bất biến (server còn step-up); Task 3/Task 5 ghim nửa kia ở client (`vramPanelStepUp`).
**Không ai ghép hai nửa** — *"cơ chế mà các task đều tưởng task khác lo"*.

**Bản vá dẫn tới:** một ca AST đọc `vramRouter.ts` (thủ tục nào đứng trên `deployProcedure`) rồi đọc
`VramBrokerPanel.tsx` (lời gọi `.mutate` nào bọc trong `stepUp.guard`), khẳng định **hai tập bằng
nhau**. Đây cũng chính là dữ liệu mà bản vá của **C-1** cần thu thập ⇒ **một lượt sửa, hai bất biến**.

---

## 5. 🟠 **IMPORTANT I-4 — TASK 3b ĐẾM BIT GHI (10 THỦ TỤC) RỒI TÁCH; KHÔNG AI ĐẾM BIT ĐỌC. LƯỢT CẤP QUYỀN SẮP TỚI MỞ 30 THỦ TỤC KHÁC MÀ CHỦ DỰ ÁN CHƯA ĐƯỢC HỎI.**

Task 3b tồn tại vì một phép đếm: `machine_control/canDelete` nuôi **10 thủ tục ở 8 router** ⇒ tách bit.
Quyết định N8 thì **cố ý** để mặt đọc `vram.state` ở lại `machine_control/canView`
(`vramRouter.ts:68-70`), biện hộ bằng *"`canView` là bit chỉ đọc, bề mặt dùng chung của nó không có
thủ tục phá huỷ nào"* — một câu **không kèm con số**.

**Tôi đếm (`requirePermission("machine_control","canView")`, bỏ comment và file test):**

| router | số thủ tục |
|---|---|
| `machineRecipeRouter.ts` | 8 |
| `robotRouter.ts` | 4 |
| `deviceAdapterRouter.ts` | 4 |
| `commandLogRouter.ts` | 4 |
| `unsMappingRouter.ts` | 3 |
| `aiOrchestrationRouter.ts` | 3 |
| `mtconnectRouter.ts` | 2 |
| `mappingAsCodeRouter.ts` | 2 |
| `vramRouter.ts` | **1** |
| **TỔNG** | **31 thủ tục / 9 router** |

⇒ Hàng quyền đang chờ cấp — **`machine_control/canView` cho `supervisor` VÀ `engineer`** (§THỨ TỰ
PHÁT HÀNH của kế hoạch) — mở **1 thủ tục VRAM** và **30 thủ tục khác**: công thức máy, trạng thái
robot, **nhật ký lệnh máy**, cấu hình device adapter, ánh xạ UNS, điều phối AI. Với `engineer` phần
lớn có lẽ là ý định; với `supervisor` đây là một **quyết định RBAC chưa ai nói ra** — đúng câu Task 3b
tự viết cho bit ghi: *"đây là một quyết định phải nói ra, không phải một hệ quả tình cờ"*.

Và câu biện hộ *"bề mặt dùng chung không có thủ tục phá huỷ nào"* **đúng về `canDelete`** nhưng
**không trả lời** câu mà chính Task 2 dùng để siết `vram.state`: *"mặt đọc phơi thông tin hạ tầng"*.
`commandLogRouter` phơi **nhật ký lệnh máy**; đó cũng là thông tin hạ tầng.

**Task nào lẽ ra phải bắt:** Task 3b bước 1 (*"đừng tin con số trong tài liệu này — tự đếm"*): nó đếm
bit **ghi** rất kỹ và **không đếm bit đọc**, dù mặt đọc là **nửa còn lại của cùng một lượt cấp quyền**.

**Việc phải làm (TRƯỚC lượt cấp quyền, không phải sau):** đưa bảng 31 dòng này cho chủ dự án; hoặc
tách nốt bit đọc cho đối xứng. ⚠ Tách bit đọc sẽ **mở lại khe N8** nếu không đổi **cùng lúc**
`requiredPermission` của tool `get_vram_state` (`vramTools.ts:455`) — và
`vramReadModel.guard.test.ts:223` sẽ **ĐỎ đúng lúc** nếu chỉ đổi một bên (lưới ấy **có răng**, và nó
**nằm trong** cổng).
---

## 6. 🟠 **IMPORTANT I-5 — THỨ TỰ PHÁT HÀNH ĐÃ LỖI THỜI TỪ TASK 3b: KHÔNG DEPLOY MÁY CHỦ TRƯỚC THÌ **KHÔNG CẤP ĐƯỢC** `vram_control` QUA GIAO DIỆN, VÀ CHÍNH NÚT LƯU CỦA MÀN ẤY XOÁ SẠCH HÀNG VỪA CẤP.**

Kế hoạch ra lệnh (§THỨ TỰ PHÁT HÀNH): **"LƯỢT CẤP QUYỀN CHẠY TRƯỚC · CLIENT DEPLOY SAU."** Câu ấy
được viết ở review **Task 2/Task 3**, khi bit còn là `machine_control` — một module **đã có sẵn**
trong danh mục. **Task 3b đổi tiền đề** mà không ai sửa lại câu lệnh:

1. `vram_control` chỉ xuất hiện trong danh mục quyền qua **một hàng MÃ MÁY CHỦ**
   (`server/routers/permissionsRouter.ts:825`), trả về bởi `permissions.getAvailableModules`.
2. `client/src/components/PermissionsManagement.tsx:123` lấy danh sách module **chỉ** từ thủ tục ấy.
⇒ **Chưa deploy máy chủ thì màn Phân quyền KHÔNG hiện `vram_control`, và admin không cấp được** (trừ
khi gọi tay `permissions.upsertPermission` — nó nhận `moduleName` là chuỗi tự do, `:574`).

⇒ Thứ tự đúng là **BA nhịp**: **deploy MÁY CHỦ → cấp quyền → deploy CLIENT.**

3. ⚠⚠ Và nút **Lưu** của chính màn ấy gọi `permissions.batchUpdateUserPermissions`
   (`PermissionsManagement.tsx:126`), mà thủ tục đó **`DELETE` TOÀN BỘ hàng quyền của user** rồi chèn
   lại đúng những gì màn hình đang giữ (`permissionsRouter.ts:663-686`). ⇒ **đường xoá sạch thứ ba**,
   ngoài `applyRolePermissions` mà sổ nợ đã ghi. Bất kỳ lượt lưu nào từ một màn **không** liệt kê
   `vram_control` (ví dụ tab đang mở từ trước lượt deploy máy chủ, hoặc một phiên admin cũ) sẽ
   **âm thầm gỡ** grant vừa cấp — và không một cảnh báo nào.

**Task nào lẽ ra phải bắt:** Task 3b bước 7 (*"khai CHÍNH XÁC hàng quyền cần cấp"*). Nó khai **cái
gì** phải cấp, không khai **cấp bằng đường nào** và **đường ấy có tồn tại lúc cấp không**.

**Việc phải làm:** viết lại §THỨ TỰ PHÁT HÀNH thành ba nhịp, và thêm một câu kiểm sau lượt cấp —
`SELECT * FROM permissions WHERE "moduleName"='vram_control'` — chạy **lại** sau mỗi lượt bảo trì vai.

---

## 7. Minor — ghi sổ, không chặn

| # | phát hiện | địa chỉ | vì sao ghi |
|---|---|---|---|
| **M-1** | `PERMISSION_MODULES` tự khai được canh bởi *"test CI 'mọi requiredPermission phải tồn tại'"*. **Test ấy KHÔNG tồn tại.** `git grep PERMISSION_MODULES` / `isValidPermissionModule` ⇒ **0 người dùng** ngoài chính file. `isValidPermissionModule` là **MÃ CHẾT**. | `shared/permissions.ts:17-18`, `:191-193` | Thêm `"vram_control"` vào danh sách là **trang trí** — chỉ để `satisfies` biên dịch. Lớp lỗi 7 (**docstring tự xưng là luật**) + lớp lỗi 6 (**hàng rào không ai canh**). |
| **M-2** | Cùng docstring khai danh sách là *"mọi `moduleName` đã seed ở ≥1 role trong `DEFAULT_ROLE_PERMISSIONS`. Giữ đồng bộ với seed đó."* `vram_control` **cố ý KHÔNG** vào khuôn vai — đó là **toàn bộ điểm** của Task 3b. | `shared/permissions.ts:30-32` vs `:122` | Hàng mới **phá vỡ luật mà chính danh sách ấy phát biểu**, không ai đính chính. Cùng họ M-1. |
| **M-3** | *"`usePermissions.hasPermission` tự short-circuit cho admin, **đúng như** `checkPermission` máy chủ ⇒ hai phía trả lời cùng một câu."* **Sai khi `RBAC_SCOPED_ADMIN=true`**: máy chủ khi ấy **TỪ CHỐI** một admin có hàng `vram_control` với `canDelete:false` (`accessControl.ts:163`), còn client trả `true` **vô điều kiện** (`usePermissions.ts:53`). | `client/src/lib/vramCommandReach.ts:220-221` | Gương thành **RỘNG HƠN** máy chủ — vi phạm chính luật file ấy tự đặt ở `:151` (*"phải hẹp hơn hoặc bằng máy chủ, không bao giờ rộng hơn"*). Cờ **không có trong `.env`** hôm nay (mặc định OFF) ⇒ **chưa sống**. |
| **M-4** | *"step-up OTP **tươi**"* nói quá. `stepUpVerifiedUntil` là cache **10 phút theo `sessionToken`**, **DÙNG CHUNG cho MỌI `deployProcedure` của hệ** — một supervisor vừa step-up cho `programming.deployBuild` thì `vram.preempt` chạy trong 10 phút **không hỏi OTP lần nào**. | `server/_core/trpc.ts:279-283`; câu bị ảnh hưởng ở `vramRouter.ts:61-62` và `shared/permissions.ts:148-149` | Luận cứ tách bit vẫn **đúng tương đối** (8/10 thủ tục kia không có gì), nhưng câu chữ *"hai thủ tục CHẶT NHẤT, có step-up OTP tươi"* mạnh hơn cơ chế. Sửa **lời**, không sửa mã. |
| **M-5** | Trần `160` của `owner` là **hai con số chép tay ở hai file** (`vramSharedLedger.cat(…,160)` và `vramRouter` `.max(160)`); `leaseKey` `.max(200)` không có đối chứng nào ở tầng sổ. | `vramSharedLedger.ts` · `vramRouter.ts:146,156,167` | Nền của **I-2**. Một hằng dùng chung đóng cả hai. |

---

## 8. Trả nợ có ĐẺ RA nợ mới không? — **CÓ, và món nặng nhất là C-1**

| lượt trả nợ | nợ mới nó đẻ ra | tình trạng |
|---|---|---|
| Task 1 (N13, lỗ ĐỌC) | lộ **2 Critical ở đường GHI** | ✅ đã đóng trong task |
| Task 2 (N8, siết đọc) | `engineer` mất panel ở deployment mặc định | ✅ đóng bằng notice + grant (grant **chưa chạy**) |
| Task 4 (N10, dịch câu) | **hồi quy RAG THẬT** 91.678 → 237 chunk | ✅ đóng; tôi xác nhận ở HEAD `readToolsProgramming.ts:454` + `:505` vẫn là `z.string().min(1).max(16)` ⇒ **không bị tiêm** (vị từ `laOEnumNgonNguHienThi` từ chối đúng) |
| **Task 3 + 3b (N9 + tách bit)** | ★ **C-1** — hai cổng *"nguồn độc lập"* cùng canh **TẬP**. **Lỗ này KHÔNG tồn tại trước Pha 5**: trước 3b hai lệnh đứng trên `machine_control/{canDelete,canCreate}` và **chưa có bản khai client nào để so**; Task 3 dựng **bản khai**, Task 3b dựng **máy quét**, rồi cả hai so bằng **tập** ⇒ đẻ ra **ảo giác được canh** ở đúng chỗ trước đó không ai hứa gì. | ❌ **MỞ** |
| Task 3b | grant per-user **mong manh 3 đường** (`applyRolePermissions` · `batchUpdateUserPermissions` · nút Lưu của màn Phân quyền) + module **cố ý ngoài khuôn vai** ⇒ **mọi supervisor mới tạo đều KHÔNG dùng được** cho tới khi ai đó nhớ cấp tay, **không cơ chế nào nhắc** | ❌ nợ vận hành, xem I-5 |
| Task 5 (N11/N12) | **I-2** — vá đầu ĐỌC của hợp đồng danh tính, bỏ đầu LỆNH | ❌ **MỞ** |

**Bất biến có HAI người ghi sau khi ghép 6 task:** trần `160` của `owner` (I-2 / M-5) — `vramSharedLedger`
ghi một bản (cắt), `vramRouter` ghi bản thứ hai (từ chối). Hai người ghi, **không ai đối chiếu**.

**Task N vá một chỗ có vô hiệu hoá cơ chế của Task M không?** — **Không tìm thấy ca nào.** Tôi kiểm ba
điểm dễ vỡ nhất: (a) Task 3b đổi bit **không** làm hở lưới N9 của Task 3 (ca *"cổng client = cổng máy
chủ"* vẫn có răng ở trục module — chỉ mù ở trục **ánh xạ**, xem C-1); (b) Task 4 sửa `argsWithAuthCtx`
**giữ nguyên** `__authCtx` vô điều kiện (`toolRegistry.ts:355-358` — tiêm `lang` chèn **trước**, không
chạm nhánh danh tính); (c) Task 5 cắt câu chữ **không** chạm ô danh tính mà Task 3b/N12 dựng
(`vramReadModel.ts:304-305` giữ `owner: string` nguyên vẹn — đột biến R1 của review Task 5 đã đo).

---

## 9. Kịch bản NGHIỆM THU SỐNG tối thiểu (chưa mục nào của Pha 5 được nghiệm thu)

⚠ Chạy theo **ĐÚNG** thứ tự. Nhịp 0 là mới (I-5).

| # | bước | kỳ vọng ĐO ĐƯỢC |
|---|---|---|
| **0** | **Deploy MÁY CHỦ** (chưa deploy client) | `permissions.getAvailableModules` trả về một hàng `moduleName='vram_control'` |
| **1** | Admin mở màn Phân quyền cho **1 tài khoản `supervisor` THẬT** → tick `vram_control`: `canDelete` **và** `canCreate`; **và** `machine_control`: `canView` | `SELECT * FROM permissions WHERE "userId"=<sup> AND "moduleName" IN ('vram_control','machine_control')` ⇒ **2 hàng**, đúng bit |
| **2** | Cấp cho **1 `engineer` THẬT**: `vram_control/canCreate` + `machine_control/canView`, **KHÔNG** `canDelete` | 2 hàng; `canDelete=false` |
| **3** | ⚠ Bật 2FA cho cả hai tài khoản **trước** khi thử lệnh | `require2FA` (`trpc.ts:250-257`) chặn **trước** mọi bit quyền — không bật thì mọi lượt dưới đều 403 vì lý do **sai** |
| **4** | **Deploy CLIENT** | — |
| **5** | `supervisor` đăng nhập → `/ai-brain` | menu **hiện** mục; panel VRAM hiện **SỐ THẬT** (không phải câu *"Không đủ quyền xem trạng thái VRAM"*) |
| **6** | `supervisor` bấm **Thu hồi** trên một hộ `reclaimable-here` | hộp thoại OTP bật → nhập OTP tươi → trả `outcome` + `freedBytes`; **`nvidia-smi` trước/sau** cho số **giảm thật** |
| **7** | `engineer` đăng nhập → `/ai-brain` | panel hiện **SỐ THẬT**; hai nút phá huỷ **XÁM**; nút *Thử lại ngay* **BẬT** ở `cron:kb-sync` khi tiến trình chủ trì cron là tiến trình đang phục vụ |
| **8** | `engineer` gọi **thẳng tRPC** `vram.preempt` (bypass UI, có OTP tươi) | **403 `PERMISSION_DENIED`** với `action: "canDelete"` — ⚠ **đây là ca chứng minh C-1 không sống trên bản đang chạy**; nếu nó **thành công** thì hoán vị bit đã xảy ra thật |
| **9** | `operator` đăng nhập | **không** thấy `/ai-brain`; gọi thẳng `vram.state` ⇒ **403** |
| **10** | ★ **Agent — câu tra mã lỗi servo bằng TIẾNG VIỆT** (ca hồi quy RAG của Task 4): hỏi trợ lý ***"Cho tôi biết mã lỗi servo AL.E42 nghĩa là gì và cách xử lý?"*** | tài liệu trả về đến từ **kho đầy đủ** (~91.678 chunk), **KHÔNG** phải 237 chunk `lang='vi'`; câu trả lời trích **đúng** tài liệu vendor (thường tiếng Anh) rồi diễn giải bằng **tiếng Việt**. ⚠ Nếu Agent trả *"không tìm thấy"* hoặc trích sai vendor ⇒ **C-1 của Task 4 sống lại** |
| **11** | Cùng câu ấy hỏi bằng **tiếng Trung** rồi **tiếng Anh** | ba câu trả lời **ba ngôn ngữ khác nhau**, cùng nội dung tài liệu; **không** câu nào rơi về tiếng Việt |
| **12** | Agent gọi `get_vram_state` bằng cả ba ngôn ngữ | ba bản tóm tắt khác nhau, mỗi bản nói **hành động tiếp theo**; ô `owner`/`processKey`/`leaseKey` **nguyên vẹn** (không `…`) |
| **13** | Nhấn nút **"Áp dụng quyền mặc định"** cho `supervisor` rồi kiểm lại | hàng `vram_control` **biến mất** ⇒ xác nhận nợ I-1 của Task 3b là **thật**; **cấp lại** trước khi kết thúc |
| **14** | ⚠ Đo `owner` dài nhất đang sống: `SELECT max(length(owner)) FROM vram_leases;` **và** đọc `state.ledger.localHolders[].owner` | nếu > 160 ⇒ **I-2 đang sống**, dừng và vá trước khi trao nút cho người dùng |

---

## 10. Nợ MANG SANG PHA 6

**Mở ra từ lượt review này:**
1. **C-1** — neo **ánh xạ thủ tục → cổng** ở cả hai cổng AST (`vramPermissionSplit.test.ts` · `vramCommandReach.role.unit.test.ts`). *(Critical — vá trước khi cấp quyền.)*
2. **I-1** — thêm `vramPermissionSplit.test.ts` vào §Cổng kiểm chung + đổi cổng từ **liệt kê đường** sang **luật + ghim SỐ FILE**.
3. **I-2** — hằng dùng chung `VRAM_OWNER_MAX`; ca round-trip *"mọi ô danh tính parse được bằng schema của lệnh"*; quyết định nới router hay nới cột DB.
4. **I-3** — ca AST ghép *"thủ tục đứng sau `requireFreshTotp`"* ⇔ *"điểm gọi client bọc `stepUp.guard` + input khai `totpCode`"*.
5. **I-4** — đưa bảng **31 thủ tục `machine_control/canView`** cho chủ dự án **trước** lượt cấp; cân nhắc tách `vram_control/canView` (⚠ phải đổi **cùng lúc** `vramTools.ts:455`).
6. **I-5** — viết lại §THỨ TỰ PHÁT HÀNH thành **ba nhịp** (máy chủ → cấp quyền → client); ghi **đường xoá sạch thứ ba** (nút Lưu của màn Phân quyền).
7. **M-1..M-5** — xem §7.

**Mang sang từ trước, CHƯA đóng:**
8. **Chưa cấp quyền nào** · **chưa nghiệm thu sống** mục nào của Pha 5.
9. Step-up 2FA **hở** ở `orchestration.deployWorkflow` + `programming.deployBuild`.
10. **9 thủ tục còn lại** trên `machine_control/canDelete` **chưa vá** (gồm `programming.deleteProject` xoá cascade mã nguồn, không OTP).
11. 5 Minor của Task 5 (RR-M1..RR-M5) + 3 mục từ chối hợp lệ (brand `input` · bọc `host` · harness `.tsx`).
12. Bộ phân loại ý định **không** định tuyến câu hỏi mã lỗi tới `lookup_error_code` trong môi trường test ⇒ nhịp phân loại chưa được nghiệm thu (⇒ bước **10** ở §9).
13. Nợ CÓ TRƯỚC (loại trừ tường minh, **không** phải phát hiện): `canUseAgentic({role:"engineer"})` · flake `wiring.inprocess` + `visionControl.tools` · 16 file đỏ `server/routers/**` · 10 ca đỏ `server/services/ai/**` (`42501`). **Không mục nào xuất hiện trong cổng của tôi** — 100/100 file xanh.

---

## 11. KẾT LUẬN

### Có đưa lên được không: ❌ **CHƯA — nhưng chỉ cách một lượt vá ngắn.**

**1 Critical · 5 Important · 5 Minor.**

Cái chặn **không phải** chất lượng mã sản phẩm. Mã ở HEAD **đúng**: ba lệnh đứng đúng bit, mặt đọc
đúng mức, danh tính không bị cắt, ba ngôn ngữ có thật, hard link bị chặn ở **cả** đường đọc lẫn ghi.
Sáu review theo task + ~10 vòng sửa đã làm phần lớn việc, và làm tốt.

Cái chặn là: **hai cổng tự xưng "nguồn độc lập" của Task 3 và Task 3b cùng canh một TẬP thay vì một
ÁNH XẠ** (C-1), và **cổng ghi trong kế hoạch không chạy file cưỡng chế duy nhất** (I-1) — nên
**2/3 đột biến của tôi ship được** với cổng xanh 100%, `tsc` sạch, `i18n:check` sạch. Đây đúng là thứ
review-theo-task **không thể** bắt: mỗi task nhìn thấy lưới của mình đỏ đúng lúc; chỉ khi ghép lại
mới thấy **cả hai lưới cùng mù một trục**, và mỗi bên tưởng bên kia canh trục ấy.

### Điều kiện ĐƯA LÊN
1. **C-1** — đổi hai cổng AST sang bất biến **ánh xạ**; kèm đột biến hoán vị chứng minh **ĐỎ**.
2. **I-1** — thêm `vramPermissionSplit.test.ts` vào cổng của kế hoạch.

### Điều kiện TRƯỚC LƯỢT CẤP QUYỀN (không chặn push, chặn cấp quyền)
3. **I-4** — bảng 31 thủ tục `machine_control/canView` phải tới tay chủ dự án.
4. **I-5** — thứ tự phát hành **ba nhịp** + đường xoá sạch thứ ba.
5. **I-2** — đo `max(length(owner))` trên hệ thật (bước 14 §9); > 160 ⇒ vá trước khi trao nút.

### Ba việc làm TỐT, có địa chỉ
1. **Task 4 bác một tiền đề SAI của brief bằng phép đo** (máy chủ **không** nhập i18next ở đâu cả) và
   không đẻ instance i18next thứ hai. Đúng kỷ luật *"đừng dựng người ghi thứ hai"*.
2. **Task 3b đổi KIỂU thay vì thêm ca** — `VramGrant` mang `unique symbol` **không export** ⇒
   `canCommand={true}` là lỗi `tsc`. Tôi xác nhận vẫn còn răng ở HEAD.
3. **Task 5 bác con số của brief và đo lại** (2/6 chứ không phải 4/6), và `vramReadModel.ts:846-855`
   **viết ra chuỗi lập luận** vì sao hai nhánh bằng nhau **hôm nay** thay vì im lặng để người sau
   tưởng đó là hai nguồn độc lập. Đó đúng là cách phải viết một bản sao có chủ ý.

---

## 12. Trạng thái cây cuối + dọn dẹp

| kiểm | kết quả |
|---|---|
| HEAD | `13116471075b4ff99cd79be13f8548cebb0ed4b3` — **không đổi**, reviewer **không commit** |
| mã sản xuất | **không sửa** — cả ba đột biến chỉ chạm `server/routers/vramRouter.ts`, khôi phục bằng **`git checkout HEAD -- <file>`** sau **mỗi** lượt |
| `git status --porcelain -- server/ client/ shared/` | **0 mục** ✅ |
| `git status --porcelain \| wc -l` | **244** = **243 mục bẩn của việc khác** (không đụng, không stage) **+ 1** = chính báo cáo này |
| `git diff --cached --name-only \| wc -l` | **0** ✅ |
| file tạm của reviewer | scratchpad `part2.md` · `part3.md` — **ĐÃ XOÁ** (xem dòng cuối); **0** file tạm trong repo |
| DDL / migration / seed / trainer / `kb:sync` / sub-agent | **KHÔNG chạy cái nào** ✅ |

**Cổng chạy lại SAU khôi phục — tất cả XANH:**

| cổng (đường dẫn TƯỜNG MINH, `ls` kiểm trước) | kết quả |
|---|---|
| cổng ĐẦY ĐỦ (9 đường của kế hoạch **+** `vramPermissionSplit.test.ts`) | **100 file / 1692 ca PASS** |
| cùng bộ + `--sequence.shuffle.tests` | **100 file / 1692 ca PASS** |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run check` | **exit 0** |
| `npm run check:tests` | **exit 0** |
| `npm run i18n:check` | **0 key lệch en/vi/zh** |
