# VÁ REVIEW TOÀN NHÁNH — Pha 4 (module điều phối VRAM)

**Vào:** `4fdfdce9` · **Ra:** `aa0eea2c` (+ lượt tài liệu này) · nhánh `feat/hmi-dep`
**Nguồn yêu cầu:** `docs/superpowers/reports/2026-08-06-vram-pha4-review-toan-nhanh.md`
**Ngày:** 2026-08-06

> Kỷ luật: **COMMIT TRƯỚC, ĐỘT BIẾN SAU.** Khôi phục bằng `git checkout HEAD -- <file>` (không dùng
> dạng `git checkout <commit> --`, thứ ghi vào INDEX). Cổng chạy theo **đường dẫn TƯỜNG MINH**,
> không glob `*`. Không trainer · không `kb:sync` · không DDL/migration · không sinh sub-agent.

---

## 0. KẾT LUẬN

**Cả 5 mục CHẶN đã đóng, và cả 3 đột biến bắt buộc đều ĐỎ đúng chỗ.** Ba mục treo của cổng ra
(F1 · F2 · U19) nay có **số đo**, không còn là lời hoãn.

| # | mục | trạng thái | bằng chứng |
|---|---|---|---|
| **C-1** 🔴 | chuỗi không tin cậy → prompt LLM | ✅ **ĐÓNG** | đột biến M1 ⇒ **2 ca ĐỎ** |
| **I-3** 🟠 | lưới `.handler(` mù kiểu CẤU TRÚC | ✅ **ĐÓNG** | đột biến M2 ⇒ **2 ca ĐỎ** (bản cũ: 12/12 XANH) |
| **I-4** 🟠 | `vramReadModel.roster.test.ts` không tồn tại | ✅ **ĐÓNG** (kèm **đính chính**) | đột biến M4b ⇒ **1 ca ĐỎ** |
| **I-5** 🟠 | `getKbHealth().vramDefer.kbSync` thiếu caveat | ✅ **ĐÓNG** | đổi KIỂU ⇒ người đọc cũ gãy `tsc` |
| **F1 / I-1** 🟠 | hai nút phá huỷ không bấm được | ✅ **ĐÓNG** | đột biến M3 ⇒ **1 ca ĐỎ** |
| **F2** 🟠 | *"nợ CHẶN"* | ✅ **SỬA CÂU CHỮ** — sai chiều | §15.1 báo cáo nghiệm thu |
| **N7** 🟡 | payload symlink | ✅ **ĐO ĐƯỢC** (+1 phát hiện MỚI) | §15.2 báo cáo nghiệm thu |
| **U19** 🟡 | §8.1 đo lại | ✅ **ĐO ĐƯỢC**, fail-closed | §15.3 báo cáo nghiệm thu |
| **M-6** 🟡 | Agent được chỉ một hành động không thi hành được | ✅ **ĐÓNG** | câu mới cuối `tomTat()` |
| M-1 · M-2 · M-3 · M-4(một phần) · M-5 | | ⏸ **KHÔNG SỬA — khai ở §5** | |

---

## 1. 🔴 C-1 — chuỗi KHÔNG TIN CẬY thôi đi thẳng vào prompt LLM

### Hình dạng bản vá: **hai bề mặt, hai luật** (không nới ca cũ, không cắt ở nguồn)

Nghịch lý mà review chỉ ra được xử đúng chiều: ca *"`owner` KHÔNG BỊ CẮT NGẮN"* **giữ nguyên bất
biến** nhưng **dời sang mặt DANH TÍNH**.

| bề mặt | luật | nơi cưỡng chế |
|---|---|---|
| `data.state` (danh tính → đối số của `vram.preempt`) | **NGUYÊN VĂN**, không sạch, không cắt | `vramTools.test.ts` ca *"`owner` KHÔNG BỊ CẮT NGẮN **trong `data.state`**"* + `vramTools.promptSafety.test.ts` ca *"MẶT DANH TÍNH"* |
| `textSummary` / `rows` (câu chữ → prompt LLM) | **SẠCH + CẮT + KHAI đã cắt** | `vramTools.promptSafety.test.ts` (13 ca) |

### Không hàm thứ hai — và vì sao có **hai** hàm làm sạch chứ không phải hai bản sao

`stripInterpolationSyntax()` **DỜI** từ `client/src/lib/errorCodes.ts` xuống **`shared/textSafety.ts`**;
`errorCodes.ts` **tái xuất** nó (`import` + `export {}` — file còn tự dùng ở `sanitizeAllParams()` và
tám hàm `translateVram*`). Cạnh phụ thuộc đã kiểm: `server/` **không thể** nhập `errorCodes.ts` (kéo
theo `i18next`); `@shared/*` có alias ở `tsconfig.json` · `vite.config.ts` · `vitest.config.ts`, và
`server/services/**` đã có 12 điểm nhập `@shared/` từ trước ⇒ không mở cạnh mới.

Thêm `stripChatControlTokens()` (lớp ký tự `<`, `>`, `|`). **Đây là bộ diễn giải THỨ HAI, không phải
bản sao của vị từ cũ**: i18next đọc `{{…}}`/`$t(…)`, chat template đọc `<|im_start|>`/`</s>`. Một bề
mặt đi qua cả hai thì **ghép** cả hai.

⚠ **Một chi tiết đắt:** regex kiểu `/<\|[^|]*\|>/g` **KHÔNG bất động** — `<|<|im_start|>|>` → `<||>` →
`` (hai lượt hai kết quả). Đã thử và **BỎ**; xoá **lớp ký tự** thì `S(S(x)) === S(x)` giữ nguyên. Có
ca kiểm riêng cho 5 payload tự huỷ.

Phép cắt: `catChuoi()` về `shared/`, và `vramPreempt.catCau()` gọi **đúng nó** (giữ trần riêng 400
cho cột `vram_events`). `vramTools` dùng trần **200** = trần lớn hơn trong hai lệnh
(`preempt.owner ≤ 160`, `releaseStale.leaseKey ≤ 200`) ⇒ **không mất một byte nào *hành động được***.
Thêm trần **16.000 ký tự** cho cả bản tóm tắt, cắt theo DÒNG, **khai ra đã bỏ bao nhiêu dòng**.

### Đo được (sau vá)

| payload | trước | sau |
|---|---|---|
| `owner` 3.8 KB chứa `<\|im_start\|>` · `{{}}` · `${}` · `$t()` qua `broker.reserve()` THẬT | vào `textSummary` **nguyên văn 3.869 ký tự** | `textSummary` **không còn một ký tự** `{}$<>\|` nào · payload nguyên văn **biến mất** · dòng hộ **< 400 ký tự** · có câu *"đã cắt … data.state giữ nguyên văn"* |
| 400 hàng anh em, mỗi hàng owner 3.8 KB | không trần | `textSummary ≤ 16.400` ký tự, có dòng *"BẢN TÓM TẮT ĐÃ BỊ CẮT"* |
| `owner` SẠCH `gguf:qwen3-30b-a3b-instruct` (đối chứng dương) | — | **nguyên vẹn**, không có chữ "đã cắt" |
| hàng anh em độc hại | — | hộ **vẫn hiện ra** (`IGNORE ALL PREVIOUS INSTRUCTIONS` còn đọc được dạng CHỮ) — làm sạch ≠ nuốt dữ liệu |

---

## 2. 🟠 I-3 — đổi **VỊ TỪ**, không thêm ca

Bỏ *"file này có cạnh NHẬP `aiLocalTools` không"*. Thay bằng: quét **mọi** điểm chạm `.handler`
trong mã sản xuất (chiều CHẶT) + **DANH SÁCH CHO PHÉP** có tên có lý do (chiều LỎNG). Kèm ba lỗ nhỏ
mà review nêu:

- `x["handler"](…)` (ElementAccess) — **nay bắt được**;
- `const h = x.handler; h(x)` (lấy `handler` ra khỏi ngữ cảnh gọi) — **nay bắt được** (`hinhDang: "doc"`);
- lọc nhanh đổi từ `src.includes(".handler(")` sang `src.includes("handler")` ⇒ `.handler (` có khoảng
  trắng cũng vào lưới;
- gốc quét mở rộng `server/` → `server/` + `shared/` + `scripts/`;
- `typeof x.handler !== "function"` **được miễn tường minh** (một phép canh, không chở args) — để lưới
  không kêu oan bảy lần rồi bị tắt.

`CHO_PHEP` có **lưới của riêng nó**: dòng trỏ file không tồn tại / file không còn điểm chạm / lý do
ngắn hơn 40 ký tự ⇒ ĐỎ. Danh sách hiện có **đúng một dòng**: `services/streaming/inProcessAdapter.ts`
(`sub.handler(msg)` của pub/sub).

Hai ca "lưới-cho-lưới" nay chạy **ĐÚNG hai vị từ** mà máy quét chạy (trước đây chúng **chép** vị từ —
tức chính lớp lỗi "hai bản sao" mà cả nhánh đang gỡ).

---

## 3. 🟠 I-4 — **ĐÍNH CHÍNH một nửa phát hiện, rồi đóng nó**

Người review đúng: `vramReadModel.roster.test.ts` **không tồn tại**. Nhưng **cơ chế thì có thật** —
`git show 4fdfdce9:server/routers/vramRouter.test.ts` cho thấy ba ca ấy ở dòng **376-421**, cùng phép
quét, đang XANH. Thứ sai là **cái tên**: mã sản xuất trỏ người đọc tới một đường dẫn không có.

⇒ **DỜI** (không chép) sang đúng cái tên đã khai, cạnh chính bản khai nó canh. Bỏ luôn `fs`/`path` +
hai import đã thành thừa ở `vramRouter.test.ts`. Thêm một ca **khoá chính lời khai**: docstring của
`vramReadModel.ts` phải chứa đúng chuỗi `vramReadModel.roster.test.ts`, và tên file này phải đúng thế.

> ⚠ **PHÁT HIỆN PHỤ của lượt đột biến — cộng hưởng với M1 của review.** Đột biến *"đổi TÊN hộ
> `gguf-embed-ctx` → `gguf-embed-ctx-DOT-BIEN`"* ⇒ **4/4 vẫn XANH**. Lý do: cả `VRAM_BACKGROUND_HOST_IDS`
> lẫn `vramBackgroundHostForOwner()` đều **suy ra từ cùng một bảng**, nên một lượt đổi đồng thời hai
> vế là vô hình. Đột biến *"XOÁ một hàng"* thì ĐỎ đúng (ca #1). ⇒ Lưới canh **dân số**, không canh
> **tên**. Nợ Pha 5 (N14) — đây chính là mục M1 §3 của review, nay có số đo.

---

## 4. 🟠 I-5 · F1 — đổi KIỂU, và trả lại người bấm nút

**I-5.** `KbHealth["vramDefer"]["kbSync"]` từ `defer | null` **trần** đổi thành
`{ chain: defer | null; hostedHere: boolean | null }`. Đây là **đổi KIỂU thay vì thêm ca** (ràng buộc
8, đã dùng đúng ba lần trong nhánh): mọi người đọc cũ **gãy `tsc`** và buộc phải đọc caveat một lần.
Nhánh SUY GIẢM trả `hostedHere: null` — *"không đọc được"* ≠ *"không chủ trì"*.

**F1.** `VramBrokerPanel` dùng `useStepUpOtp()` đúng khuôn ba màn đang chạy; `{stepUp.dialog}` render
**một lần**. `retryDeferred` **CỐ Ý không bọc** — nó ở `actuationProcedure` (không `requireFreshTotp`)
và `input` của nó **không khai** `totpCode`, nên bọc là gửi một khoá mà `.strict()` từ chối. Lưới mới
`client/src/lib/vramPanelStepUp.unit.test.ts` (9 ca) canh **cả hai chiều**, kèm 4 hình dạng lách
(*không step-up* · *có `totpCode` mà không mở dialog* · *mở dialog mà quên `totpCode`* · *guard của hook khác*).

> 🟠 **PHÁT HIỆN MỚI — MỘT CA ĐANG ĐỎ SẴN Ở `4fdfdce9`, không ai thấy.**
> `client/src/lib/errorMessageI18nCoverage.unit.test.ts` → *"cổng chặn F11 — Lớp 3"* **ĐỎ tại HEAD**:
> `VramBrokerPanel.tsx:76 t('vramBroker.commandError', …) — THIẾU ở [vi,en,zh]`. File này **không nằm
> trong 12 file nền của review** nên cả năm review + báo cáo nghiệm thu đều không chạy nó. Đã vá bằng
> cách thêm khoá `vramBroker.commandError` vào **cả ba** locale. ⚠ Các khoá `vramBroker.*` **khác**
> vẫn chỉ sống bằng `defaultValue` tiếng Việt — xem M-3 ở §5.

---

## 5. MỤC **KHÔNG SỬA** — khai đủ, kèm lý do

| # | mục | vì sao không sửa lượt này |
|---|---|---|
| **M-1** 🟡 | `vram.state` là `protectedProcedure` (mọi user đăng nhập) trong khi `get_vram_state` đòi `machine_control/canView` ⇒ hai câu trả lời cho một câu hỏi | Là một **quyết định phân quyền sản phẩm** (nới tool xuống, hay siết router lên) — chọn sai chiều là hoặc rò `processKey`/`owner` cho `operator`, hoặc chặn một mặt đọc mà `aiGgufRouter.status` tiền lệ đang mở. Cần chủ dự án chốt. **Nợ N8.** |
| **M-2** 🟡 | `canCommand = admin \|\| engineer` ở `AIBrainDashboard.tsx:108` — **thiếu** `supervisor`, **thừa** `engineer` | Sửa đúng là **áp kỷ luật `vramCommandReach`** (một ô DUY NHẤT quyết định nút, và nó là một LỜI GỌI) cho **hai nút phá huỷ**, tức một hàm vị từ mới + lưới cho nó — vượt phạm vi "vá 5 mục chặn". **Nợ N9.** Hôm nay nó **không mở thêm quyền**: máy chủ vẫn chặn độc lập (role-floor + `canDelete` + step-up). |
| **M-3** 🟡 | bề mặt Agent (`tomTat()`) **chỉ tiếng Việt** | Dịch ~25 câu sang `en`/`zh` là một lượt i18n riêng; và `lang` hiện chỉ điều khiển câu `DENY`. **Nợ N10** (hoặc khai thẳng là chỉ `vi`). |
| **M-4** 🟡 | không cắt chuỗi ở `vramReadModel.ts` | **Đã trả phần nguy hiểm** (nó là đầu vào của C-1 — nay cắt ở bề mặt câu chữ). Phần còn lại là cắt **tại nguồn**, thứ sẽ **phá mặt DANH TÍNH** nếu làm ngây thơ. **Nợ N11**, hạ mức. |
| **M-5** 🟡 | panel gửi `h.host` làm `owner` cho `retryDeferred` (4/6 hộ ⇒ `unknown-background-host`) | Sửa đúng đòi một ô `owner` **thật** trong `defer.hosts` (không phải `ownerPattern`, vốn là một MẪU) ⇒ đổi kiểu mặt đọc. Vô hại hôm nay (nút bị khoá cho đúng những hộ đó). **Nợ N12.** |
| **N13** 🟠 MỚI | `read_project_file` đọc được file ngoài workspace qua **NTFS hard link** | Phát hiện của lượt đo (§15.2 báo cáo nghiệm thu). Sửa đúng là đổi vị từ chứa-trong-workspace (so `st.dev`+`st.ino`, hoặc từ chối `nlink > 1`) — một quyết định an ninh cần cân nhắc riêng, ngoài phạm vi. |
| **N14** 🟡 MỚI | lưới roster canh **dân số**, không canh **tên hộ** | Xem §3. |
| — | `canUseAgentic({role:"engineer"})` · flake `wiring.inprocess` · 16 file đỏ `server/routers/**` · 5 ca `server/services/programming/**` · 243+ mục bẩn | **Nợ có TRƯỚC**, brief loại trừ tường minh. Không đụng, không dọn, không stage. |

---

## 6. BA ĐỘT BIẾN BẮT BUỘC + MỘT ĐỘT BIẾN THÊM — KỲ VỌNG vs THỰC TẾ

Kỷ luật: cây **SẠCH** trước mỗi lượt (`git status --porcelain -- server/ client/ shared/` = rỗng);
đột biến ở **điểm SẢN XUẤT**; khôi phục bằng `git checkout HEAD -- <file>`; file probe **xoá bằng `rm`**.

| # | đột biến (điểm sản xuất) | kỳ vọng | **thực tế** — tên ca ĐỎ |
|---|---|---|---|
| **M1** | `vramTools.ts:catSach()` — gỡ **cả hai** bộ lọc (`stripChatControlTokens ∘ stripInterpolationSyntax` → `String(raw)`) | ĐỎ | **ĐỎ — 2 ca** trong `vramTools.promptSafety.test.ts`:<br>· `★★★ C-1 — owner độc hại đi qua NGUỒN THẬT… > ★★★ textSummary KHÔNG còn một ký tự nào dựng được cú pháp i18next hay chat template`<br>· `★★★ C-1 — ba trường của hàng ANH EM (owner · leaseKey · processKey) đều phải trơ > ★★★ cả ba trường đi qua sổ chung THẬT ⇒ textSummary vẫn TRƠ` |
| **M2** | thêm `server/services/zzProbeStructuralHandler.ts`: `interface CoHandler { handler: … }` + `t.handler(args)` — **không import gì** (kiểu CẤU TRÚC, đúng probe P3 của review) | ĐỎ | **ĐỎ — 2 ca** trong `authCtxInjection.test.ts`:<br>· `★★★ MỌI điểm gọi Tool.handler( … > ★★★ KHÔNG điểm gọi nào nhận args CHƯA qua argsWithAuthCtx(...)` → báo đích danh `services/zzProbeStructuralHandler.ts:2 [goi] → handler(args)`<br>· `★★★ MỌI điểm gọi Tool.handler( … > ★★ bản kiểm đếm khớp: đúng HAI đường thoát đã biết`<br>⚠ Bản **trước** bản vá: **12/12 XANH** trên đúng file này. |
| **M2b** | cùng file, hai hình dạng còn lại: `t["handler"](args)` và `const h = t.handler; h(args)` | ĐỎ | **ĐỎ — 2 ca**, báo `…:2 [goi] → handler(args)` **và** `…:3 [doc] → handler()` |
| **M3** | `VramBrokerPanel.tsx` — gỡ `stepUp.guard(…)` + `totpCode` khỏi **cả hai** nút phá huỷ (khôi phục nguyên văn lỗi F1) | ĐỎ | **ĐỎ — 1 ca** trong `vramPanelStepUp.unit.test.ts`:<br>· `★★★ F1 — hai nút PHÁ HUỶ của VramBrokerPanel phải đi qua step-up 2FA > ★★★ CẢ HAI lệnh phá huỷ: .mutate( nằm TRONG stepUp.guard(...) VÀ gửi totpCode` |
| **M4a** | `vramReadModel.ts` — **đổi TÊN** hộ `gguf-embed-ctx` | ĐỎ | 🔴 **XANH 4/4** ⇒ phát hiện phụ, xem §3 (nợ N14) |
| **M4b** | `vramReadModel.ts` — **XOÁ** hàng `gguf-embed-ctx` khỏi `HO_BACKGROUND` (mô phỏng "quên khai một hộ mới") | ĐỎ | **ĐỎ — 1 ca** trong `vramReadModel.roster.test.ts`:<br>· `vramReadModel — bảng sáu hộ khớp ĐÚNG các điểm gọi xinVramCoHoan… > ★★★ MỌI owner quét được đều khớp MỘT hàng trong bảng — một hộ MỚI mà quên khai ⇒ ĐỎ` |

**Sau khôi phục:** `git status --porcelain -- server/ client/ shared/` → **RỖNG**. Ba file probe tạm đã
**XOÁ** (`zzProbeStructuralHandler.ts` · `zzProbeSymlinkAndU19.test.ts` · `zzProbeSymlink2.test.ts`).
Không script tạm nào còn lại (thư mục scratchpad không dùng tới).

---

## 7. CỔNG KIỂM — đường dẫn TƯỜNG MINH, không glob

| cổng | kết quả |
|---|---|
| `npx vitest run server/services/vram/ server/services/aiLocalTools/ server/services/ai/ server/routers/vramRouter.commands.test.ts server/routers/vramRouter.retryDeferred.test.ts client/src/lib/` | **116 file · 1.963 xanh / 10 đỏ** — **toàn bộ 10 ca đỏ nằm NGOÀI module VRAM**, xem dưới |
| lượt `--sequence.shuffle.tests` (bỏ `server/services/ai/` — nợ DB, xem dưới) | **87 file · 1.378 xanh / 1 đỏ** — đúng flake `visionControl.tools.test.ts` đã ghi hồ sơ, không ca nào của module VRAM lệ thuộc thứ tự |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run check` | ✅ **0 lỗi** |
| `npm run check:tests` | ✅ **0 lỗi** (4 file test MỚI/SỬA được `tsc` canh ngay — không thêm dòng nào vào danh sách cách ly) |
| `npm run i18n:check` | ✅ `0 key(s) with placeholder mismatch across en/vi/zh` |

### 10 ca đỏ — **KHÔNG mục nào thuộc lượt vá này**

| file | ca | chẩn đoán |
|---|---|---|
| `server/services/ai/ntfClassifier.test.ts` · `ntfPredictor.test.ts` · `measurementCorrections.test.ts` | suite ngã ở `afterAll` | **Postgres `42501 permission denied for table product_inspections`** — đúng lớp nợ hạ tầng đã ghi sổ (`avi_app` thiếu quyền; DDL/DML phải bằng owner `aoi`) |
| `server/services/ai/aiLlmAudit.test.ts` (6 ca) | ghi hàng audit | cùng lớp DB |
| `server/services/ai/featureStore.test.ts` (2 ca) | `expected [0.0257…(383)] to deeply equal [0.11,0.22,0.33,0.44]` · `evicted 0 >= 1` | dữ liệu/môi trường (vector 384 chiều thật vs 4 chiều seed) |
| `server/services/aiLocalTools/visionControl.tools.test.ts` (1 ca) | 5.304 ms | **FLAKE dưới tải song song** — chạy RIÊNG: **7/7 XANH** trong 838 ms. Cùng hồ sơ `wiring.inprocess`. |

**Bằng chứng không liên quan:** `git diff 4fdfdce9 HEAD --stat` trên cả 5 file `server/services/ai/**`
⇒ **rỗng** (không file nào bị lượt vá chạm), và không file nào tham chiếu
`aiLocalKnowledgeService` / `vramTools` / `errorCodes` / `textSafety` / `vramPreempt`.
⚠ Ghi thẳng: tôi **không** dựng lại cây ở `4fdfdce9` để chạy đối chứng (tránh đụng 243+ mục bẩn);
bằng chứng ở trên là **cơ chế**, không phải một lượt chạy đối chứng.

---

## 8. FILE ĐÃ ĐỘNG

**Mới (5):** `shared/textSafety.ts` · `server/services/aiLocalTools/vramTools.promptSafety.test.ts` ·
`server/services/vram/vramReadModel.roster.test.ts` · `client/src/lib/vramPanelStepUp.unit.test.ts` ·
`docs/superpowers/reports/2026-08-06-vram-pha4-wholebranch-fix-report.md`

**Sửa (12):** `client/src/lib/errorCodes.ts` · `client/src/components/ai/VramBrokerPanel.tsx` ·
`client/src/i18n/locales/{vi,en,zh}.json` · `server/services/aiLocalTools/vramTools.ts` ·
`server/services/aiLocalTools/vramTools.test.ts` · `server/services/aiLocalTools/authCtxInjection.test.ts` ·
`server/services/vram/vramPreempt.ts` · `server/services/vram/deferShared.test.ts` ·
`server/services/aiLocalKnowledgeService.ts` · `server/routers/vramRouter.test.ts` ·
`docs/superpowers/reports/2026-08-05-vram-pha4-nghiem-thu-song.md` (§15 + hai dòng đính chính)

**Không đụng:** `.superpowers/` · 243+ mục bẩn có sẵn của cây · `server/routers/**` (ngoài
`vramRouter.test.ts`) · `server/services/programming/**` · mọi migration.
