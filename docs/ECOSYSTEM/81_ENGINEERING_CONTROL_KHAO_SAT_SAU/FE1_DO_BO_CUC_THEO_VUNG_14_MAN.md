# Phụ lục FE1 — Đo bố cục theo vùng: 14 màn "Kỹ thuật & Điều khiển" (app thật, 2026-09-26)

> Thuộc doc 81. Số đo DOM (`getBoundingClientRect`) trên :3000, engineer1, mỗi màn ở **1600×950** và **1366×768**; supervisor/operator đo ở 1600. Ảnh + JSON + script đo lại (125 tệp, gitignored): `.playwright-mcp/survey81/`.
> **Cách đo:** script đi qua các con của `<main>`, ranh giới vùng = card/section/tabs/table/canvas/nav/notice, mỗi vùng gắn `data-loc` (tệp:dòng component). **ws** = diện tích nhìn thấy của vùng MAIN trong khung hình đầu, % khung hình. MAIN chọn theo màn: Hub = hộp việc + danh mục; IDE = khung CodeMirror; IR/POU = vùng vẽ; ECN/Interlock/màn tab = bảng hoặc nội dung tab.
> **Sự cố lúc đo:** Copilot dock mở sẵn (localStorage `progCopilotDock.open=1`) ⇒ IDE/IR/POU đo hai trạng thái có/đóng dock; đo xong trả khoá về `1`.
> Phân loại vùng: **MAIN** (bề mặt làm việc chính, luôn thấy, lớn nhất) · **SUB** (phụ nhưng dùng thường — tab, panel cạnh/dưới, chia đôi) · **FLYOUT** (mở theo hành động — sheet/drawer/popover/dialog) · **HEADER/STATUS** (thu vào chip đầu trang hoặc thanh trạng thái) · **BỎ/GỘP**. Tần suất: **phút** = liên tục · **tác vụ** = mỗi lần làm việc · **hiếm** = vài lần/tuần.

## 0. KPI tổng hợp

| # | Màn | MAIN bắt đầu y (1600) | ws % khung đầu (1600 / 1366) | Notice trước MAIN (số / px) | Cao cuộn ×vh (1600 / 1366) | Breadcrumb trùng | Thẻ KPI |
|---|---|---|---|---|---|---|---|
| 1 | Hub | 366 | 42,5 / 33,0 | 1 / 57 | 2,03 / 2,57 | có | 0 |
| 2 | Studio | 134 | 53,5 / 48,9 (63 % panel trống) | 0 | 1,02 / 1,03 | không | 0 |
| 3 | IDE (có dock) | 713 | **10,4 / 0,0** | 1 / 70 | 3,11 / 3,93 | có | 0 |
| 3 | IDE (đóng dock) | 697 | **14,8 / 3,5** | 1 / 54 | 2,99 / 3,84 | có | 0 |
| 4 | ECN | 347 | 21,3 / 25,0 | 0 | 1,0 / 1,0 | không | 0 |
| 5 | Recipes | 511 | 28,0 / 23,9 | 1 / 48 | 1,25 / 1,56 | có | 0 |
| 6 | Interlock | 399 | 15,9 / 19,5 | 1 / 34 | 1,0 / 1,0 | có | 0 |
| 7 | Orchestration | 762 | 15,1 / **0,0** | 2 / 72 | 1,60 / 2,01 (nạp xong 2,15) | có | 0 |
| 8 | IR (có dock) | 822 | **2,8 / 0,0** | 3 / 174 | 3,04 / 4,01 | có | 4 (y≈2026) |
| 8 | IR (đóng dock) | 704 | 8,2 / 1,1 | 3 / 138 | 2,86 / 3,61 | có | 4 |
| 9 | POU (có dock) | 689 | 6,9 / 0,0 | 3 / 178 | 1,56 / 2,15 | có | 4 |
| 9 | POU (đóng dock) | 629 | 12,9 / 5,6 | 3 / 138 | 1,47 / 1,88 | có | 4 |
| 10 | Copilot | 315 | 23,9 / 34,6 | 1 / 34 | 1,0 / 1,03 | không | 0 |
| 11 | Fleet | 653 | 24,2 / 9,0 | 3 / 118 | 1,55 / 1,94 | có | **9** |
| 12 | Safety | 695 | 20,8 / 5,0 | 3 / 160 | 1,68 / 2,13 | có | 4 |
| 13 | Standards | 669 | 22,9 / 7,5 | 3 / 118 | 1,85 / 2,32 (tab Phân loại cảnh báo **8,3×**) | có | 5 |
| 14 | Integration | 673 | 22,6 / 7,1 | 3 / 138 | 1,31 / 1,70 | có | 4 |

**Nhận xét:** ba màn soạn thảo (IDE, IR, POU) dành **0–15 % khung đầu** cho bề mặt soạn thảo; ở 1366×768 IDE (có dock), IR, POU và Orchestration đều **0 %** — không thấy một pixel editor/canvas nào nếu không cuộn. Bảy màn Beta (7, 8, 9, 11, 12, 13, 14) mở đầu bằng cùng chuỗi: banner Beta → breadcrumb trùng → tiêu đề → "Khi nào dùng" → ghi chú khoá/advisory → hàng thẻ KPI; công việc thật bắt đầu ở y 589–822.

## 1. Lớp vỏ (shell)

| Thành phần | `data-loc` | Kích thước | Chi phí |
|---|---|---|---|
| Sidebar | `DashboardLayout.tsx:364` | 264 px (16,5 % của 1600; 19,3 % của 1366) | danh sách menu tự cuộn (scrollHeight 978 so với 753 thấy) — 23 % mục khuất |
| Sidebar thu gọn | cùng | rail 48 px, vùng làm việc +216 px (1336 → 1552) | rail chỉ còn **2 icon nhóm**, không còn mục trang ⇒ thu gọn là mất điều hướng; reflow trễ ~2 s |
| Top bar (sticky) | `DashboardLayout.tsx:557` | cao 56, 11–12 điều khiển | Xưởng›Chuyền›Máy ~240, tìm 202, lưới ứng dụng 209, ngôn ngữ 128… |
| Breadcrumb shell | `DashboardLayout.tsx:619/620` | y56, cao **53** | trùng breadcrumb trong trang (`PageHeader.tsx:69`, 40 + 8) trên **11/14 màn** |
| Padding kép | `main` p-6 + container p-6 | **48 px** dọc, 48 mỗi bên | nội dung bắt đầu x=312 thay vì 264 |
| Banner Beta | `BetaBadge.tsx:44` | 1288×38 ⇒ đẩy **+54 px** | ngoài PageHeader; vẫn hiện trên trang "Không có quyền" của operator |
| Nút AI nổi | `AILocalChatBubble.tsx:1118` | 48×48 cố định mọi màn | mở panel 384×660 z50, **Esc không đóng**; trên IDE chồng lên Copilot dock |
| Copilot dock | `ProgrammingCopilotDock.tsx:109` | 420×950 cố định z40, **chiếm phần phải top bar** | nội dung KHÔNG reflow: card editor bị che 152 px ở 1600, **378 px (53 %) ở 1366** |

**Ngân sách dọc trước tiêu đề trang:** 56 + 53 + 48 + 48 = **205 px** (21,6 % của 950; 26,7 % của 768); màn Beta +54 = 259 px. **Ngang:** nội dung dùng được 1240/1600 (77,5 %), 998/1366 (73 %); IDE có dock ở 1366 chỉ còn 578 px (42 %).

**Khuyến nghị shell:** (1) một breadcrumb, dời vào top bar ⇒ +101 px dọc trên 11 màn; (2) bỏ padding kép (16 cho màn thường, 0 cho workbench) ⇒ +32–48 px; (3) tự thu gọn sidebar ở route workbench (`/engineering`, `/ir-editor`, `/pou-studio`, `/orchestration-studio`) như TIA ẩn Portal view — **nhưng phải sửa rail trước**: hover/bấm icon nhóm mở flyout submenu liệt kê trang (kiểu VS Code / Ignition Designer); (4) **một lối vào AI mỗi ngữ cảnh**: workbench ⇒ Copilot là panel phải trong layout (đẩy nội dung, co giãn 320–480), ẩn nút nổi và bỏ card "Trợ lý Lập trình AI"; màn khác ⇒ nút nổi mở **sheet phải**, Esc đóng; dock không đè top bar; (5) Beta / "Khi nào dùng" / ghi chú khoá ⇒ chip trong header + popover; (6) supervisor ở chế độ "Đơn giản" có sidebar **trống** (lãng phí 264 px) ⇒ menu rỗng thì tự thu gọn hoặc tự chuyển nâng cao.

## 2. Từng màn

### 2.1 Hub `/engineering-home`

| Vùng (`data-loc`) | Vị trí / kích thước | Loại | Lý do |
|---|---|---|---|
| `PageHeader.tsx:69` breadcrumb | y157, 1240×40 | BỎ | trùng shell |
| `PageHeader.tsx:91` tiêu đề | y205, 56 | HEADER | còn 1 dòng 44 px |
| `EngineeringHub.tsx:159` "Luồng vàng…" | y285, 57 | BỎ/GỘP | chữ tĩnh ⇒ dải "luồng vàng số sống" 32 px |
| `PendingReviewStrip.tsx:58` hộp việc | y366, 1240×78, **TRỐNG** | **MAIN** | việc chính của supervisor; **báo trống trong khi SEED-ECN-0003 "Đang xem xét" và supervisor thấy nút Phê duyệt** |
| `EngineeringHub.tsx:175` ×6 section, 17 ô | y468→1877 | SUB | ô 304×206 quá lớn cho một liên kết |

KPI ws 42,5 / 33 %; cuộn 2,03 / 2,57; ô 9–17 dưới nếp gấp. Tham chiếu: TIA Portal view; worklist Teamcenter/Windchill đặt hộp việc lên đầu.
```
┌ Trung tâm Kỹ thuật  [⌘K]  chip: OT●  Gate●  Engine interlock○⚠  (44px) ─────────────────┐
├ HỘP VIỆC (MAIN ~60% rộng, ~55% cao) ───────────┬ TƯ THẾ & LUỒNG VÀNG (SUB ~40%) ────────┤
│ [Của tôi|Toàn module]  bảng 8 dòng              │ ECN 3 ▶ Recipe 4 ▶ Chờ 0 ▶ Deploy 3    │
│                                                 │ Nguồn lỗi: ⚠ safety_events              │
├ CÔNG CỤ (SUB, 3 hàng × 6 ô 64px, ☆ ghim · gần đây · Labs) ─────────────────────────────┤
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Studio `/engineering-studio`
`WorkspaceShell.tsx:44/45` + `HubLauncher.tsx:100` (283×812) và panel ô 1002×812 — 6 ô phủ 262 px, **~63 % trống**, nhãn tiếng Anh ⇒ **BỎ/GỘP**, chuyển hướng `Hub?view=catalog`. **Giữ `WorkspaceShell.tsx`** — nơi duy nhất trong module đã dùng resizable panel, là nền cho vỏ IDE.

### 2.3 IDE `/engineering`

| Vùng | Vị trí / kích thước | Loại | Lý do / tham chiếu |
|---|---|---|---|
| Breadcrumb `PageHeader.tsx:69` | y157, 40 | BỎ | |
| Tiêu đề + chip "Triển khai: ON" + "Làm mới" | y205, 56 | HEADER/STATUS | chip xuống thanh trạng thái |
| "Khi nào dùng" (link IR/POU) | y277, 54 (70 có dock) | FLYOUT | popover ⓘ; link "Mở trong IR/POU" vào menu ngữ cảnh Explorer |
| Dự án (tìm, lọc, 4 dự án) | x312, 280×349 | SUB (Explorer trái, cao hết màn) | Project tree TIA/CODESYS |
| Stepper (sticky, 6 bước) | y347, 944×46 | HEADER/STATUS | pipeline chips; bấm "3 Build" không thấy cuộn tới khối |
| ├ chip v2/v1 | 28 | SUB | nút "Phiên bản" trong Explorer |
| ├ So sánh phiên bản | 98, **TRỐNG** | FLYOUT | tab editor "Δ v1↔v2" |
| ├ Ngôn ngữ + "Sổ tay" (popover 365×117) | 40 | HEADER (toolbar editor) | |
| ├ **Editor CodeMirror** | y697, **892×360 (cao cố định mọi viewport)** | **MAIN** | tần suất phút; hiện 14,8 % / 3,5 % |
| └ Lưu / Kiểm tra / Build | **y1070, dưới nếp gấp** | HEADER (toolbar trên) | Ctrl+S / Ctrl+B |
| "Trợ lý Lập trình AI" (1 nút) | 154 | BỎ | lối vào AI thứ ba |
| Builds & Mô phỏng | 186, TRỐNG | SUB (tab panel dưới) | |
| Deploy (có kiểm soát) | y1523, 944×361 | FLYOUT (wizard) + tab dưới "Lịch sử deploy" | hiếm |
| Canary: 41 checkbox máy + ma trận | y1900, **944×673** | FLYOUT (bước "Đích" có lọc) + tab dưới "Ma trận máy×version" | hiếm |
| Bảng biến/tag | y2588, 207 | SUB (tab editor "Tags") | PLC tags TIA |
| Copilot dock | 420×950 | SUB (panel phải của vỏ) | hiện che 53 % card editor ở 1366 |

KPI đóng dock: editor y697; 14,8 / 3,5 %; cuộn 2,99 / 3,84; có dock 10,4 / 0 %. **Mục tiêu (1600, rail 48): editor ~870×580 (61 % vh); ≥45 % khung khi panel dưới đóng; 1366: ~1050×440 (≈44 %).**
```
┌ ◧Dự án▾ v2●nháp │ ✓Kiểm ⚒Build ⏵Mô phỏng ⇪Deploy… │ Soạn✓·Kiểm○·Build○·Deploy○ │ ⓘ │ Review ⏳ (40px) ┐
├─┬ EXPLORER 260 ─┬ [Main.bas●][Δ v1↔v2][Tags] (32) ──────────────────┬ INSPECTOR/COPILOT 380 ──┤
│📁│ ▾Dự án (4)    │                                                     │ [Thuộc tính|Copilot]    │
│🔍│ ▾Phiên bản    │   EDITOR (MAIN) ~870×580                            │ v2 · nháp · 0 dòng      │
│⎇ │ ▾Tags / IO    │                                                     │ Build: chưa có          │
│⏵ │ ▾Deploy       │                                                     │ ─ Copilot hội thoại     │
├─┴───────────────┴─────────────────────────────────────────────────────┴─────────────────────────┤
│ [Vấn đề][Build/Mô phỏng][Lịch sử deploy][Ma trận máy×ver]  (SUB, 200px, gập được)               │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Ln1 Col1 · zmotion-basic · Triển khai thật: ON · Copilot ● (24px STATUS)                        │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
FLYOUT: Deploy wizard (4 bước, dialog 720), Sổ tay (popover), Khi nào dùng (popover)
```

### 2.4 ECN `/engineering-changes`

| Vùng | Vị trí / kích thước | Loại | Lý do |
|---|---|---|---|
| Tiêu đề + "Thay đổi mới" | y157, 56 | HEADER | |
| `FilterBar.tsx:337` (2 select) | 1240×85 | HEADER (toolbar bảng 40 px) | |
| Bảng `EngineeringChanges.tsx:364` (3 dòng, Duyệt/Từ chối trên dòng) | y347, 1240×261 | **MAIN** (danh sách) | tác vụ |
| Duyệt/Từ chối trên dòng | — | FLYOUT (sheet chi tiết: tác động, diff đối tượng, ký) | |
| Dialog "Thay đổi mới" | 486×566, cuộn trong 594 | FLYOUT (sheet 560–640) | hiếm |
| Trống dưới bảng | **342 px (36 % khung)** | — | |

KPI 21,3 / 25 %. Tham chiếu: Teamcenter Change Manager, Windchill CN, Arena — danh sách trái, chi tiết có tab phải.
```
┌ Thay đổi kỹ thuật  [+ Thay đổi mới]  [Tìm…] [Trạng thái▾][Loại▾] (44) ───────────────────┐
├ DANH SÁCH (MAIN 40%) ──────────────┬ CHI TIẾT ECN (SUB 60%) ──────────────────────────────┤
│ ECN-0003 Đang xem xét ⏱3d  ▸        │ [Tổng quan|Đối tượng|Duyệt|Nhiệm vụ|Lịch sử]         │
│ ECN-0001 Đã duyệt                   │ … [Phê duyệt…] ⇒ FLYOUT ký (mật khẩu/OTP)           │
└─────────────────────────────────────┴──────────────────────────────────────────────────────┘
```

### 2.5 Recipes `/recipes`

| Vùng | Vị trí / kích thước | Loại | Lý do |
|---|---|---|---|
| Tiêu đề + "Lưu phiên bản mới" | y205 | HEADER | |
| Banner HITL ("…dùng luồng HITL trong AI Copilot") | y269, 48 | HEADER chip / FLYOUT | nội dung quy trình sai (doc 80) |
| "Xem theo máy" (1 select, TRỐNG) | y341, 1240×**146** | HEADER (bộ chọn ngữ cảnh 40 px) | 146 px cho một ô chọn |
| Mã recipe (4 dòng, cột bị cắt, cuộn ngang) | 397×350 | SUB (danh sách chủ, trái) | |
| Các phiên bản (TRỐNG tới khi chọn) | 819×350 | **MAIN** | tác vụ |
| Lịch sử triển khai | y885, 1240×255 | SUB (tab "Triển khai") | |
| Dialog "Lưu phiên bản mới" | 510×558 | FLYOUT (sheet) | |

KPI 28 / 23,9 %. Tham chiếu: FactoryTalk Batch Recipe Editor, SIMATIC Batch.
```
┌ Recipe máy  Máy:[▾]  [+ Phiên bản]  chip: "Đẩy xuống máy qua HITL ⓘ" (44) ────────────────┐
├ RECIPE (SUB 300) ─┬ SCRW-RECIPE-01 · v2 (MAIN) ─────────────────────────────────────────────┤
│ SCRW-RECIPE-01 2v │ [Tham số|Phiên bản|Duyệt|Triển khai (3)|Máy đang chạy]                  │
│ SEED-RCP-AOI  v1● │ lưới tham số có kiểu/đơn vị/giới hạn                                     │
└───────────────────┴─────────────────────────────────────────────────────────────────────────┘
```

### 2.6 Interlock `/interlock-rules`

| Vùng | Vị trí / kích thước | Loại | Lý do |
|---|---|---|---|
| Tiêu đề + "Chỉ xem" + "Thêm quy tắc" | y205 | HEADER | |
| "Khi nào dùng" | 34 | FLYOUT | |
| Bảng quy tắc (1 dòng, 5 nút icon) | y399, 1240×195 | **MAIN** | |
| Tab Sự kiện (3 dòng) | 1240×325 | SUB (panel dưới chia đôi, luôn thấy) | sự kiện là hậu quả của quy tắc |
| Sửa / Thêm quy tắc | — | FLYOUT (sheet có MOC/lý do) | chưa đo (engineer bị disabled) |
| Tư thế engine (engine TẮT, OT control) | **không có** | HEADER/STATUS | ILK-06 |
| Trống | 356 px | — | |

KPI 15,9 / 19,5 %. Tham chiếu: Siemens Safety Matrix, Rockwell C&E — ma trận nguyên nhân × hệ quả, log dưới.
```
┌ Quy tắc Interlock  chip: Engine○TẮT⚠ · OT ghi●BẬT · Phủ 0/1700  [+Quy tắc] (44) ─────────┐
├ [Danh sách | Ma trận C×E] MAIN ~60% cao ───────────────────────────────────────────────────┤
├ SỰ KIỆN (SUB, panel dưới 35%, lọc theo rule đang chọn) ────────────────────────────────────┤
└ FLYOUT: sheet sửa rule (revision nháp · người duyệt ≠ tác giả)                             ┘
```

### 2.7 Orchestration `/orchestration-studio`

| Vùng | Vị trí / kích thước | Loại | Lý do |
|---|---|---|---|
| Banner Beta | y133, 1288×38 | HEADER chip | |
| Breadcrumb trùng | y211 | BỎ | |
| Tiêu đề + 🔬 Mô phỏng / 💾 Lưu (deploy) / ▶️ Chạy | y259 | HEADER (toolbar designer) | icon bị đôi |
| "Khi nào dùng" | 34 | FLYOUT | |
| "Trợ lý AI điều phối" | y381, 1240×**205** (22 % vh) | FLYOUT (panel AI phải) | tác vụ |
| Metadata (mã/tên/phiên bản) | 1240×144 | HEADER (tiêu đề sửa tại chỗ) + inspector | |
| Cây / Sơ đồ | y762, 821×222 TRỐNG; nạp xong 816×740, react-flow 764×518 | **MAIN** | phút |
| Cấu hình bước | 403×222 → 400×740 | SUB (inspector) | |
| Quy trình đã lưu | y1000, 612×442 | SUB (Library, explorer trái) | |
| Lần chạy gần đây | y1000, 612×442 | SUB (panel dưới "Runs") | |
| Gợi ý chân trang | 17 | BỎ | |

KPI 15,1 / **0 %**; cuộn 1,60 (nạp xong 2,15). Tham chiếu: Camunda Modeler, Node-RED.
```
┌ line-a-startup · v1 ✎ │ ⏵Mô phỏng 💾Lưu nháp ⇪Publish ▶Chạy │ [Cây|Sơ đồ] │ ✨AI (40) ───────┐
├ LIBRARY 240 ─┬ CANVAS / CÂY (MAIN, full height) ──────────────┬ INSPECTOR 360 ────────────┤
│ QT-1..QT-4   │                                                 │ Bước đang chọn            │
├──────────────┴─────────────────────────────────────────────────┴───────────────────────────┤
│ [Runs 12][Chờ duyệt][Vấn đề] (SUB 200)                                                     │
└ FLYOUT: AI điều phối (sheet phải 420), So sánh phiên bản                                   ┘
```

### 2.8 IR Editor `/ir-editor`

| Vùng | Vị trí / kích thước (đóng dock) | Loại | Lý do |
|---|---|---|---|
| Banner Beta + breadcrumb trùng | 38 + 40 | HEADER chip / BỎ | |
| Tiêu đề (phụ đề 2 dòng) | 76 | HEADER (44) | |
| "Khi nào dùng" | 70 | FLYOUT | |
| Ghi chú khoá "Chỉ xem trước cấu trúc…" | 66 | HEADER chip "Xem trước — không deploy" + popover | |
| Card metadata (mã luồng, thiết bị, phiên bản, năng lực, Lint, undo/redo, 3 nút lưu, giải thích) | 287 | HEADER (toolbar 40) + inspector | |
| Bảng khối | x312, **298×895** (14 nút × 44) | SUB (palette trái gập được, 200) | Node-RED |
| **Vùng vẽ** `IrGraphCanvas.tsx:386` | card 507×895; canvas **455×558 (cao cố định)** | **MAIN** | canvas chỉ 37 % chiều ngang hàng |
| Thuộc tính / Transpile | 403×895 (thuộc tính TRỐNG) | SUB (inspector) | |
| Khối hàm (POU tái dùng) | y1748, 262 | SUB (Explorer) | |
| 4 thẻ KPI | y≈2026, 196×130 | STATUS ("Khối 0 · Lint Đạt") | |
| Luồng IR đã lưu | 261 | SUB (Explorer, "Mở") | |
| So sánh & hợp nhất | 392 | FLYOUT (tab editor diff/merge) | |

KPI đóng dock 8,2 / 1,1 %; có dock 2,8 / 0 %; cuộn 2,86–4,0×. **Mục tiêu:** cùng vỏ IDE §2.3; canvas ≥60 % ngang, cao hết màn.

### 2.9 POU Studio `/pou-studio`
Banner Beta + breadcrumb trùng + tiêu đề 96 px (phụ đề 3 dòng) + nút "Lưu vào project → Build/Deploy" ⇒ HEADER; "Khi nào dùng" (54) ⇒ FLYOUT; ghi chú khoá (**86**) ⇒ chip; 4 thẻ KPI 196×130 ⇒ STATUS; Trình soạn `PouCanvas.tsx:1126` 612×720, canvas **560×558** ⇒ **MAIN**; Chuyển mã→ST / PLCopen 612×720 ⇒ SUB (xem trước gập được / panel dưới); **Explorer / "Mở" không tồn tại** (POU-04) ⇒ thêm SUB. KPI đóng dock 12,9 / 5,6 %; có dock 6,9 / 0. Tham chiếu: CODESYS (cây POU, khai báo trên, thân mạng LD giữa, thông báo dưới); TIA LAD (interface trên block, Task Card lệnh phải).

### 2.10 Copilot `/programming-copilot`
Tiêu đề 76 ⇒ HEADER; ghi chú 34 ⇒ BỎ; form 848×428, **rộng tối đa 848 ⇒ 392 px trống phải** ⇒ FLYOUT/SUB của IDE (GitHub Copilot, Cursor, Siemens Industrial Copilot đều là panel trong IDE). KPI 23,9 / 34,6 %. Route chuyển hướng sang IDE (scratch); nếu giữ trang riêng: bố cục hội thoại (hội thoại MAIN cao hết màn, chip ngữ cảnh trên, khối mã có "Áp dụng (diff)").

### 2.11 Fleet `/fleet-orchestration`

| Vùng | Vị trí / kích thước | Loại |
|---|---|---|
| Banner Beta, breadcrumb trùng, tiêu đề | | HEADER / BỎ |
| "Khi nào dùng" 34; ghi chú khoá 46 | | FLYOUT; chip |
| **9 thẻ KPI** | y443, mỗi 127×130, nhãn bị cắt | HEADER/STATUS (9 chip, 1 hàng 32 px) |
| Hàng đợi tác vụ | 1232×248 (2 dòng DEMO) | SUB (danh sách phải) |
| Vùng & chiếm dụng | 1232×508 | SUB (lớp phủ bản đồ + danh sách) |
| Bản đồ (tab 2) | svg **720×469** trong card 1232×635 | **MAIN** |
| Thao tác / Tài nguyên / Sạc | 174–299 | SUB (tab panel phải) hoặc FLYOUT (sổ đăng ký) |

KPI 24,2 / 9 %. Tham chiếu: MiR Fleet, OTTO — bản đồ giữa, danh sách mission/robot cạnh.
```
┌ Đội xe  chip: Chờ1·Gán1·Chạy0·Lỗi0·Vùng0/4·Tắc0·TàiNg0/3·Sạc0 · "Chỉ trạng thái ⓘ" (44) ─┐
├ BẢN ĐỒ + vùng (MAIN ~65%) ──────────────────────┬ [Tác vụ|Vùng|Sạc|Tài nguyên] SUB 35% ─┤
└─────────────────────────────────────────────────┴───────────────────────────────────────┘
```

### 2.12 Safety & Workforce `/safety-workforce`
Banner Beta / breadcrumb trùng / "Khi nào dùng" 34 ⇒ HEADER/BỎ/FLYOUT; tuyên bố advisory **88** ⇒ chip cố định "Tư vấn — không phải SIS ⓘ" (phải luôn thấy nhưng 1 dòng); 4 KPI ⇒ STATUS; Cockpit: xu hướng 370 TRỐNG ⇒ SUB, bảng tin advisory 146 + luồng sự kiện 247 ⇒ **MAIN**; bảng nhân lực 315+252 ⇒ BỎ/GỘP (Sản xuất › Ca); phối hợp 182 ⇒ SUB; tuyên bố chân trang 44 ⇒ BỎ (trùng). KPI 20,8 / 5 %. Mẫu cockpit (Ignition alarm status + trend).

### 2.13 Equipment Standards `/equipment-standards`
Banner Beta, "Khi nào dùng" 34, ghi chú khoá 46 ⇒ chip/FLYOUT; 5 KPI 238×146 ("100 % 1700/1700") ⇒ STATUS có ghi nguồn; tab Phân cấp: cây 608×1042 ⇒ **MAIN** (trái 30 %), chi tiết 608×157 TRỐNG ⇒ **MAIN** (phải 70 %, sticky); tab Phân loại cảnh báo: form 174 ⇒ FLYOUT, **bảng ánh xạ 7003 px, 185 dòng không phân trang ⇒ tài liệu 7910 px (8,3 vh)** ⇒ **MAIN** phải thành DataTable ảo hoá/phân trang có lọc; Hiệu năng cảnh báo 313+739 ⇒ SUB; Yêu cầu thay đổi 203 ⇒ SUB/GỘP ECN; Tuân thủ ⇒ SUB. KPI 22,9 / 7,5 %. Tham chiếu: PAS PlantState / DynAMo.

### 2.14 Equipment Integration `/equipment-integration`
Banner Beta, "Khi nào dùng" 34, ghi chú khoá 66 ⇒ chip/FLYOUT; 4 KPI ("13 adapter đã kết nối" cạnh "0 thiết bị") ⇒ STATUS với nhãn đúng "đăng ký" ≠ "kết nối"; tab trạng thái: chip adapter 136 + Focas/Euromap 608×286 ⇒ **MAIN** (catalog connector danh sách–chi tiết), notice FRAMEWORK 66 ⇒ BỎ; Phiên bản recipe + Lịch sử nạp ⇒ BỎ/GỘP vào Recipes (cùng bảng — đường vòng FLOW-01); Worker thu ảnh 275 ⇒ BỎ/GỘP sang AOI/Vision. KPI 22,6 / 7,1 %. Tham chiếu: Kepware (cây channel/device trái, lưới tag phải, event log dưới), HighByte.

## 3. Mẫu bố cục chung và thành phần

| Mẫu | Màn | Đặc trưng |
|---|---|---|
| **P1 Workbench / IDE** | IDE, IR, POU; Copilot = panel phải | cao hết màn (`100vh − 56`), không cuộn trang; activity bar 40 · explorer 240–300 · tab editor · inspector 320–420 · panel dưới 180–320 · thanh trạng thái 24 |
| **P2 Canvas designer** | Orchestration Designer, IR | palette · canvas · inspector · panel dưới Runs/Vấn đề |
| **P3 Danh sách–Chi tiết** | ECN, Recipes, Interlock (+ ma trận C×E), Standards (cây–chi tiết), Integration (catalog), Orchestration Library/Runs | danh sách 35–40 % + chi tiết có tab; tạo/sửa/duyệt qua sheet |
| **P4 Cockpit / Monitor** | Hub (hộp việc), Fleet (bản đồ), Safety (luồng sự kiện) | dải chip 32 px; một MAIN lớn + panel phụ |
| **P5 Launcher** | Studio | gộp vào Hub |

**Thành phần cần có:** `PageHeaderCompact` 44–48 px (tiêu đề · chip · hành động chính · ⓘ) · `NoticeChip + Popover` (thay banner Beta 38, "Khi nào dùng" 34–70, ghi chú khoá 46–88 — **tiết kiệm 118–254 px mỗi màn Beta**) · `StatusChipStrip` 32 px (thay 30 thẻ `MetricCard` cao 130–146 trên 6 màn; ba mức ok/degraded/error) · `WorkbenchShell` (trên `WorkspaceShell.tsx`: `ExplorerTree`, `EditorTabs`, `InspectorPanel`, `BottomPanel`, `StatusBar`) · `SplitListDetail` + `DataTable` (tìm/lọc/phân trang server) · `DetailSheet` 480–640 · `WizardDialog` · `DiffView` (tab editor) · `EntityPicker` · `CopilotPanel` (một lõi; panel phải ở workbench, sheet ở màn khác).

### Danh sách flyout

| Flyout | Dạng / kích thước | Mở từ | Màn | Tần suất |
|---|---|---|---|---|
| Copilot | panel phải 320–480 co giãn (workbench); sheet 420 (màn khác) | Ctrl+I, ✨ | IDE, IR, POU, Orchestration, trang AI | tác vụ |
| Khi nào dùng / trợ giúp | popover ≤360 | ⓘ | 10 màn | hiếm |
| Beta / xem trước / chỉ metadata / advisory | chip + popover | chip header | 7 + 4 màn | hiếm (chip luôn hiện) |
| Deploy wizard (Đích lọc theo loại → Khác gì → Cổng → Xác nhận OTP), gồm canary | dialog 720–880 | ⇪ Deploy… | IDE (+ IR/POU) | hiếm |
| Diff / hợp nhất phiên bản | tab editor | Δ, menu phiên bản | IDE, IR, Orchestration | tác vụ |
| Duyệt / ký (ECN, recipe, rule, run) | sheet 560 có diff + mật khẩu/OTP | hộp việc, nút Duyệt | ECN, Recipes, Interlock, Orchestration | tác vụ (supervisor) |
| Tạo/sửa ECN, phiên bản recipe, rule, chuẩn hoá cảnh báo | sheet 560–640 | + / ✎ | ECN, Recipes, Interlock, Standards | hiếm |
| Lọc | popover / chip toolbar | nút lọc | ECN, Fleet, Standards, Runs | tác vụ |
| Lịch sử / audit | tab panel dưới / tab chi tiết | | IDE, Recipes, Interlock, ECN | hiếm |
| Sổ tay nhà sản xuất | popover → nên là tab trong inspector | "Sổ tay" | IDE | tác vụ |

## 4. Khác biệt theo vai trò (1600)

| | Engineer | Supervisor | Operator |
|---|---|---|---|
| Sidebar | menu nâng cao, 14 mục, danh sách tự cuộn | **chế độ "Đơn giản": trống** (chỉ nhãn module + "Hiện menu nâng cao") — lãng phí 264 px | cũng "Đơn giản", vẫn hiện nhãn module dù Hub bị chặn |
| Top bar | đủ | không Xưởng›Chuyền›Máy, không chip cảnh báo | đăng nhập vào `/ops-console` |
| Hub | đủ | giống engineer (17 ô kể cả công cụ soạn thảo); **hộp việc báo trống dù ECN-0003 chờ và supervisor thấy Phê duyệt** | **không có quyền** |
| IDE | 36 nút | 36 nút, 7 disabled — vẫn phải xem toàn bộ layout soạn thảo | bị chặn |
| ECN | Duyệt/Từ chối/Gửi duyệt trên dòng | y hệt (8 nút) | bị chặn |
| Interlock | "Chỉ xem"; Thêm/Tắt/Sửa/Xoá hiện nhưng mờ | 7 nút, 0 disabled | bị chặn |
| Orchestration | đủ | Mô phỏng/Chạy/AI tối ưu disabled, Lưu (deploy) bật | bị chặn (trang chặn vẫn hiện banner Beta) |
| IR / POU / Copilot | đủ | — | **VÀO ĐƯỢC**: IR "Chỉ xem" nhưng palette 14 khối, "Lưu vào dự án…" và zoom bật (7/40 disabled); POU 1/17 disabled; Copilot "Sinh mã" bật |
| Fleet / Safety / Standards / Integration | đủ | Fleet không nút tác vụ | vào được; Fleet "Chỉ xem" |

⇒ **Supervisor** cần Hub hộp-việc-trên-cùng và các màn ở "chế độ duyệt" (chi tiết + sheet ký), không phải layout soạn thảo với 7 nút mờ. **Operator** chỉ nên thấy màn giám sát (Safety, Fleet cockpit chỉ đọc); hiện vào được 3 công cụ soạn thảo/AI nhưng không vào được Hub (T4 doc 80, thấy trực tiếp).

## 5. Chưa đo được
Deploy wizard, canary, hộp OTP/ký, luồng Phê duyệt (không bấm nút ghi); sheet sửa rule Interlock (engineer disabled); Copilot khi đang sinh/có kết quả; bố cục khi dữ liệu lớn (editor đo trên bản nháp 1 dòng — riêng bảng 185 dòng Standards là dữ liệu thật); sidebar thu gọn chỉ đo ở ECN 1600; nội dung tab chỉ ở 1600; không đo 1920, dark mode, EN/ZH, LCP; stepper IDE không cuộn (chưa rõ do cuộn mượt hay thiếu anchor); supervisor/operator đo nút bằng `disabled`, chưa thử từng hành động.
