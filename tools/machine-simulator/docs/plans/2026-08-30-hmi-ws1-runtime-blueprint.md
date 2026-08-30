# WS-HMI-1 — HMI Runtime: một renderer đọc JSON
# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một renderer React duy nhất đọc `HmiScreenDocument` và vẽ ra màn hình — để thêm một loại máy nghĩa là thêm một tài liệu JSON, không phải viết thêm React.

**Architecture:** Không sinh mã. Một registry `kind` → component, phủ **đúng** 15 giá trị của enum đã đóng băng và được ghim bằng test. Một bộ binding phân giải `{component}` rồi tra giá trị qua một seam nhà cung cấp dữ liệu, để runtime không phụ thuộc vào hợp đồng giá-trị-sống mà WS-HMI-0c chưa định nghĩa. Theme `isa101` thêm vào cạnh ba theme đã có, không thay chúng.

**Tech Stack:** React 19 · Vite · TypeScript · `web/src/contracts/*.ts` (đóng băng ở Mốc 0) · Playwright (176 bài, gồm visual baseline + axe AA) · `node --test` cho bài không cần trình duyệt.

**Spec:** [docs/HMI_BUILDER_DESIGN_2026-08-29.md](../HMI_BUILDER_DESIGN_2026-08-29.md) §3.4, §6. Design system: [docs/HMI_DESIGN_SPEC.md](../HMI_DESIGN_SPEC.md).

**Nhánh này chạy SONG SONG với WS-HMI-0a/b/c.** Nó không chờ chúng, và không được import gì từ chúng ngoài `web/src/contracts/`.

---

## 🔴 Một đính chính với spec, phải chốt trước khi bắt đầu

Spec §3.4 và §7 đặt nghiệm thu: *"viết lại 3 màn hard-code thành JSON, **xoá bản React**, 176 bài Playwright vẫn xanh"*.

Hiểu theo nghĩa đen là **sai và không làm được**. Ba file `web/src/components/hmi/schematics/*.tsx` là **bản vẽ SVG động** — sơ đồ dây, điểm đo, đường nối, hoạt hoạ theo trạng thái. Một tài liệu JSON mô tả *bố cục và binding*; nó không diễn đạt được một hình vẽ tuỳ ý, và cố ép nó làm việc đó sẽ đẻ ra một ngôn ngữ vẽ trong JSON — tức là phát minh lại SVG, tệ hơn SVG.

**Cái thật sự bị xoá là bố cục trang viết tay:** hằng `SCHEMATIC_READOUT_FLEX` trong `web/src/routes/Hmi.tsx` (tỉ lệ cột cứng theo `DeviceClass`), nhánh `if` chọn schematic theo loại máy, và việc thứ tự các panel bị đóng đinh trong JSX.

**Ba schematic sống tiếp — với tư cách widget.** Chúng trở thành hiện thực của `kind: "faceplate"`, chọn bằng `props.faceplate`. Đó chính là điều khiến thư viện faceplate ở WS-HMI-3 có chỗ cắm vào sau này.

Nghiệm thu đúng, và kế hoạch này dùng nó: **`Hmi.tsx` không còn chứa bố cục nào theo `DeviceClass`; ba màn hình được mô tả bằng ba tài liệu JSON; 176 bài Playwright, gồm visual baseline, vẫn xanh.** Nếu visual baseline lệch, đó là câu hỏi cho chủ sở hữu — không phải cái cớ để cập nhật ảnh chuẩn.

---

## Global Constraints

- **KHÔNG sinh mã.** Renderer đọc JSON lúc chạy. Một bước build biến JSON thành React là đi ngược mục tiêu — kỹ sư tại nhà máy phải sửa được màn hình mà không build lại app.
- **KHÔNG sửa hợp đồng.** `web/src/contracts/*.ts` đóng băng từ Mốc 0. Cần trường mới ⇒ bốn chỗ, một commit, theo [contracts/README.md](../../contracts/README.md).
- **Offline tuyệt đối.** Font bundled, không CDN, không fetch ra ngoài. Đây là ràng buộc sản phẩm, không phải sở thích — xem `HMI_DESIGN_SPEC.md` §1.
- **Không thêm npm package** trừ khi thật sự không tránh được; nếu cần, **đề xuất và nêu lý do**, đừng tự cài.
- **`web/contract-tests/` là của Mốc 0 — không đụng.** Bài test mới của nhánh này đi vào `web/tests/` (Playwright) hoặc một thư mục `node --test` riêng, và **không được** đặt file `*.test.mjs` dưới `web/tests/` vì `playwright.config.ts:31` đặt `testDir: "./tests"` và sẽ quét phải nó.
- **Chuẩn hoá `\r\n` → `\n`** ở mọi chỗ đọc file nguồn bằng regex. `core.autocrlf=true` trên kho này, và đúng chuyện này đã làm cổng hợp đồng của Mốc 0 đỏ trên mọi bản checkout mới.
- **Xác nhận `npm run build` bằng exit code**, không bằng đọc log.
- **§5 an toàn:** widget `setpoint-input`/`command-button` chỉ được render điều khiển ghi khi tài liệu mang `policyAction`. Schema đã bảo đảm nó có mặt — nhưng runtime **không được** giả định điều đó; một tài liệu tới từ đâu đó thiếu nó phải render **vô hiệu hoá**, không phải render một nút gọi API rồi để server từ chối.
- **§5-bis:** không có màn hình nào được thiết kế là trạng thái **hợp lệ** — rơi về màn sinh mặc định, không phải trang trắng, không phải màn chặn.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `web/src/hmi-runtime/ScreenRenderer.tsx` | Đọc `HmiScreenDocument`, dựng lưới, đặt widget |
| `web/src/hmi-runtime/widgetRegistry.ts` | `kind` → component; phủ đúng 15 giá trị |
| `web/src/hmi-runtime/bindings.ts` | Phân giải `{component}`, tra giá trị qua seam |
| `web/src/hmi-runtime/TagValueSource.ts` | Seam dữ liệu + adapter đầu tiên trên `MachineDetailDto` |
| `web/src/hmi-runtime/widgets/*.tsx` | 15 widget, mỗi file một cái |
| `web/src/index.css` | thêm khối `[data-theme="isa101"]` |
| `web/screens/*.json` | Ba màn hình mô tả bằng JSON |
| `web/runtime-tests/*.mjs` | Bài `node --test` cho registry và binding |

Mỗi widget một file: chúng đổi vì những lý do khác nhau, và một file 15 widget là file không ai giữ được trong đầu.

---

## Task 1: Seam dữ liệu, trước cả renderer

Viết seam trước vì nó quyết định renderer có bị khoá vào một hợp đồng chưa tồn tại hay không.

**Files:**
- Create: `web/src/hmi-runtime/TagValueSource.ts`
- Test: `web/runtime-tests/tagValueSource.test.mjs`

**Interfaces:**
- Produces:
  - `type TagValue = { value: number | boolean | string; unit?: string; quality: "good" | "stale" | "bad" }`
  - `interface TagValueSource { get(path: string): TagValue | undefined; subscribe(cb: () => void): () => void }`
  - `createMachineDetailSource(dto: MachineDetailDto): TagValueSource`

- [ ] **Step 1: Hiểu vì sao seam này tồn tại**

Hợp đồng **giá trị sống** chưa được định nghĩa — Mốc 0 hoãn `quality` có văn bản lý do, và WS-HMI-0c sẽ định nghĩa nó. Nếu renderer gọi thẳng một endpoint, nhánh này khoá vào một hợp đồng chưa có và phải viết lại khi nó tới.

Adapter đầu tiên đọc `MachineDetailDto` mà `web/src/lib/api.ts` đã trả về — thứ ba màn hình hiện tại đang dùng. Đọc file đó và `web/src/components/hmi/derive.ts` trước khi viết: `derive.ts` hiện **parse chuỗi** `"Torque=4.2Nm"` bằng regex, và adapter này là chỗ cái hack đó cuối cùng có một mặt tử tế để nấp sau.

- [ ] **Step 2: Viết bài test thất bại**

- Adapter trả đúng giá trị và đơn vị cho một path đã biết.
- Path không biết trả `undefined`, không ném.
- `quality` là `"stale"` khi DTO không có dữ liệu mới — ghim rằng runtime **có** khái niệm chất lượng ngay từ đầu, kể cả khi nguồn hiện tại chỉ đoán được thô. Nếu adapter không phân biệt nổi, trả `"good"` và **ghi trong doc comment rằng nó không đo được điều đó** thay vì bịa.
- `subscribe` trả một hàm huỷ, và gọi nó thì callback thôi chạy. Rò rỉ listener trong một app kiosk chạy nhiều ngày là lỗi thật.

- [ ] **Step 3: ĐỎ** · **Step 4: Viết seam + adapter** · **Step 5: XANH**

- [ ] **Step 6: Commit**

```bash
git add web/src/hmi-runtime/TagValueSource.ts web/runtime-tests
git commit -m "feat(hmi): a seam, so the renderer does not marry a contract that does not exist yet"
```

---

## Task 2: Registry widget, phủ đúng enum đã đóng băng

**Files:**
- Create: `web/src/hmi-runtime/widgetRegistry.ts`
- Create: `web/src/hmi-runtime/widgets/` (15 file)
- Test: `web/runtime-tests/widgetRegistry.test.mjs`

**Interfaces:**
- Consumes: `WidgetKind` từ `web/src/contracts/hmiScreen.ts`.
- Produces: `widgetRegistry: Record<WidgetKind, WidgetComponent>`; `type WidgetProps = { widget: ScreenWidget; source: TagValueSource; resolve: (binding: string) => string }`

- [ ] **Step 1: Viết bài ghim thất bại — bài này quan trọng hơn 15 widget**

Ghim hai chiều giữa registry và enum trong schema:
- Mọi giá trị của `WidgetKind` có một mục trong registry. Thiếu một cái nghĩa là một tài liệu hợp lệ làm runtime nổ.
- Mọi mục trong registry là một giá trị của `WidgetKind`. Thừa một cái nghĩa là runtime nhận một `kind` mà schema từ chối — hai bên lệch nhau, đúng lớp drift cả Mốc 0 dựng lên để chặn.
- Bài phải **đỏ khi rỗng** — một registry rỗng không được xanh.

Đọc `WidgetKind` từ chính `web/src/contracts/hmiScreen.ts`, **không** chép danh sách 15 chuỗi vào bài test. Một danh sách chép tay là bản sao thứ hai để lệch.

- [ ] **Step 2: ĐỎ** · **Step 3: Viết 15 widget + registry** · **Step 4: XANH**

Về hiện thực: **kế thừa `web/src/components/industrial/`** — `Sheet`, `Readout`, `StatusLamp`, `ControlButton`, `LogTag` đã tồn tại, đã qua axe AA, đã có visual baseline. `readout` bọc `Readout`, `status-lamp` bọc `StatusLamp`, `sheet` bọc `Sheet`, `log` bọc `LogTag`. Đừng vẽ lại; bọc lại.

`faceplate` chọn hiện thực theo `props.faceplate` và là chỗ ba schematic sẵn có cắm vào.

🔴 `setpoint-input` và `command-button`: nếu `widget.policyAction` vắng, render **vô hiệu hoá kèm lý do nhìn thấy được**, không phải render nút rồi để server từ chối. Ghim bằng một bài riêng.

- [ ] **Step 5: Commit**

```bash
git add web/src/hmi-runtime web/runtime-tests/widgetRegistry.test.mjs
git commit -m "feat(hmi): fifteen widgets, pinned both ways against the frozen kind enum"
```

---

## Task 3: Binding và renderer

**Files:**
- Create: `web/src/hmi-runtime/bindings.ts`, `web/src/hmi-runtime/ScreenRenderer.tsx`
- Test: `web/runtime-tests/bindings.test.mjs`

**Interfaces:**
- Produces: `resolveBinding(binding: string, componentTagPrefix?: string): string`; `<ScreenRenderer doc={...} source={...} components={...} />`

- [ ] **Step 1: Viết bài test binding thất bại**

- `"{component}/torque"` với prefix `"SCRW-01/spindle"` → `"SCRW-01/spindle/torque"`.
- Một binding **không** chứa `{component}` đi qua nguyên vẹn.
- `{component}` mà widget **không** khai `component` → trả nguyên chuỗi và một cảnh báo nhìn thấy được, **không** ném. Một màn hình cấu hình sai phải hỏng ở một widget, không phải sập cả trang kiosk.
- Lưới: widget đặt đúng `col`/`row`/`colSpan`/`rowSpan`; widget vượt biên lưới bị kẹp lại và cảnh báo.

- [ ] **Step 2: ĐỎ** · **Step 3: Viết** · **Step 4: XANH**

`ScreenRenderer` dựng CSS grid từ `layout.cols`/`layout.rows`. Không toạ độ pixel — spec đã chốt lưới, và lý do nằm trong doc comment của `ScreenLayout`.

- [ ] **Step 5: Commit**

```bash
git add web/src/hmi-runtime web/runtime-tests/bindings.test.mjs
git commit -m "feat(hmi): one misconfigured widget must not take the kiosk page down"
```

---

## Task 4: Theme `isa101`

**Files:**
- Modify: `web/src/index.css`, `web/src/theme/ThemePicker.tsx`, `web/src/theme/chartTokens.ts`
- Test: `web/tests/` (một spec Playwright mới)

- [ ] **Step 1: Đọc ba theme đã có trước khi thêm cái thứ tư**

`web/src/index.css` có `[data-theme="glass"]`, `[data-theme="console"]`, `[data-theme="warmth"]`. Thêm `[data-theme="isa101"]` theo đúng cấu trúc, **không** đổi ba cái kia.

Nguyên tắc ISA-101, từ nghiên cứu trong spec §6: **nền xám, màu CHỈ dành cho bất thường.** Thiết bị chạy bình thường vẽ xám trung tính; màu xuất hiện khi có alarm, chạm ngưỡng, đổi mode, hoặc người vận hành ra lệnh. Bậc trạng thái `run/warn/fault/idle` giữ nguyên ý nghĩa an toàn — đây là chỗ màu được phép sống.

- [ ] **Step 2: Bài Playwright**

Một spec kiểm: theme đổi được, khối `isa101` áp dụng, và **axe AA sạch** trên theme mới. Kho này đã có 44 bài visual/a11y — theo đúng khuôn chúng, đừng dựng cách kiểm thứ hai.

- [ ] **Step 3: Chạy Playwright** — theme là thứ nó render, nên **phải** chạy. `cd web && npm run test:e2e`.

- [ ] **Step 4: Commit**

```bash
git add web/src/index.css web/src/theme web/tests
git commit -m "feat(hmi): the ISA-101 theme, where colour means something is wrong"
```

---

## Task 5: Nghiệm thu — ba màn hình thành JSON

Đây là task chứng minh cả nhánh này không phải đồ chơi. Đọc lại khối đính chính đầu kế hoạch trước khi bắt đầu.

**Files:**
- Create: `web/screens/automation-overview.json`, `web/screens/aoi-overview.json`, `web/screens/iot-overview.json`
- Modify: `web/src/routes/Hmi.tsx`
- Test: bộ Playwright sẵn có, **không sửa**

- [ ] **Step 1: Mô tả ba màn hình bằng JSON**

Mỗi file là một `HmiScreenDocument` hợp lệ theo `contracts/hmi-screen.schema.json`. Chạy chúng qua bộ validate của Mốc 0 để chắc:

```bash
cd web && node --test contract-tests/contracts.test.mjs
```

(Bộ ấy validate corpus của nó, không phải file của bạn — nên **thêm một bài riêng** trong `web/runtime-tests/` nạp ba file này và validate chúng bằng chính `validate.mjs` của Mốc 0. Import nó, đừng chép nó.)

- [ ] **Step 2: `Hmi.tsx` chỉ còn chọn tài liệu, không còn dựng bố cục**

Xoá `SCHEMATIC_READOUT_FLEX`, xoá nhánh chọn schematic theo `DeviceClass`, xoá thứ tự panel đóng đinh trong JSX. Thay bằng: chọn tài liệu JSON theo `deviceClass`, đưa vào `<ScreenRenderer>`.

Ba file `schematics/*.tsx` **ở lại** — chúng giờ là hiện thực faceplate.

- [ ] **Step 3: Chạy TOÀN BỘ Playwright**

```bash
cd web && npm run test:e2e
```

Kỳ vọng: **176/176 xanh, gồm visual baseline**.

🔴 **Nếu visual baseline lệch, KHÔNG cập nhật ảnh chuẩn.** Một baseline lệch nghĩa là màn hình đã đổi hình, và cả task này tồn tại để chứng minh nó **không** đổi. Dừng lại, chụp lại chỗ lệch, và báo — quyết định "hình mới chấp nhận được" thuộc chủ sở hữu, không thuộc người thi công. `npx playwright test --update-snapshots` là lệnh bị cấm trong task này.

- [ ] **Step 4: Chạy cổng còn lại**

```bash
cd web && npm run build && npx oxlint && node scripts/check-test-budgets.mjs
cd .. && node scripts/check-contracts.mjs
```

`npm run build` xác nhận bằng **exit code**. `check-contracts.mjs` phải PASS — nhánh này không đụng hợp đồng, nên nếu nó đỏ, bạn đã đụng.

- [ ] **Step 5: Commit**

```bash
git add web/screens web/src/routes/Hmi.tsx web/runtime-tests
git commit -m "feat(hmi): three screens described instead of coded, and the pixels did not move"
```

---

## Nghiệm thu WS-HMI-1

- [ ] `Hmi.tsx` không còn bố cục nào theo `DeviceClass`; ba màn hình là ba tài liệu JSON.
- [ ] Registry phủ **đúng** 15 `kind`, ghim hai chiều, đỏ khi rỗng.
- [ ] `setpoint-input`/`command-button` thiếu `policyAction` render **vô hiệu hoá kèm lý do**, không phải nút gọi API.
- [ ] Một widget cấu hình sai hỏng **một mình nó**, không sập trang.
- [ ] Theme `isa101` áp dụng được, **axe AA sạch**, ba theme cũ không đổi.
- [ ] **176/176 Playwright xanh, visual baseline KHÔNG được cập nhật.**
- [ ] `check-contracts.mjs` PASS — hợp đồng không bị đụng.
- [ ] Không thêm npm package nào (hoặc có, kèm lý do và đã được duyệt).

---

## Ghi chú cho WS-HMI-2 (editor)

Editor dựng trên đúng `ScreenRenderer` này — preview trong editor **phải** là cùng một renderer, không phải bản mô phỏng thứ hai. Hai renderer là hai hành vi để lệch, và người thiết kế sẽ tin cái sai.

Bộ `validate.mjs` của Mốc 0 là thứ editor gọi trước khi cho publish. Nó là bản viết tay, phủ đúng những từ khoá ba schema dùng, và **ném** khi gặp từ khoá lạ — đọc header của nó trước khi dựa vào nó, vì nó nói rất rõ nó KHÔNG làm gì.
