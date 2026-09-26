# Phụ lục C — Visual IR Editor (`/ir-editor`) + POU Studio (`/pou-studio`)

> Thuộc doc 80. 2026-09-25 · HEAD `84f12c7d5` · pha PLAN (không sửa mã).
> Cách đo: đọc mã (`file:line`); gọi THẬT các thủ tục tRPC thuần tính toán trên :3000 (engineer1); `SELECT` chỉ đọc; chạy hàm client `reorderRelativeToSibling` bằng tsx. Không gọi mutation.
> Số thô (ngoài repo): scratchpad phiên `C-ir-pou/` — `probe-out.json`, `probe2-out.json`, `foreign.xml`, `export-lad.xml`, `reorder.test.mts`.

**Điểm:** IR Editor **4,5** (chức năng 5,5 · UX 5 · so đối thủ 3,5 · backend 4 · DB 5 · hiệu năng 4). POU Studio **3,5** (4 · 4 · 2,5 · 4 · 3 · 3,5).

## 1. Kiểm kê

| Lớp | IR Editor | POU Studio |
|---|---|---|
| Trang | `pages/IrEditor.tsx` (1661) | `pages/PouStudio.tsx` (637) |
| Canvas | `IrGraphCanvas.tsx` (433, @xyflow/react 12.11) + cây BlockCard | `PouCanvas.tsx` (1200, xyflow) |
| So sánh | `IrDiffPanel.tsx`, `IrMergePanel.tsx` (diff/merge 3 chiều theo AST) | — |
| Router | `irRouter.ts` (status/listFlows/getFlow/lint/transpilePreview/diff/merge + saveFlow/requestBuild; cờ `DPC_IR_V2_ENABLED` **BẬT**) | `programmingRouter.ts:963-1000` pouLint/pouTranspilePreview/plcopenExport/plcopenImport (đều là **query GET**) |
| Đường ra thiết bị | `irAdapter.ts:219` deploy luôn `simulated` | `iec61131Adapter.ts:55-67` deploy luôn `failed` |

## 2. Số đo

Độ trễ p50: ir.lint 37 ms · transpile UR 62 ms · ROS2 71 ms · pouLint 45–74 ms · pou→ST 60–232 ms · export 62–146 ms · import 63–107 ms. Round-trip export(import(export)) đúng cả 3 mẫu **của chính hệ thống**.

**Trần URL** (`main.tsx:121-135`, httpBatchLink GET, không methodOverride):

| Kịch bản | Qua | HTTP 431 |
|---|---|---|
| ir.lint đơn lẻ | 50 block (13,2 KB) | 100 block |
| lint + preview cùng batch (hình dạng UI) | 25 | **30 block** |
| POU transpile + lint (mỗi phím) | 10 rung | **20 rung** |
| plcopenImport | XML 6,6 KB | **XML 11,9 KB** (zod cho phép 5 MB) |

DB: project ir-flow 1 (seed), iec61131-pou **0**; artifact ir-flow 2 hàng seed `language='json'` trong khi `saveFlow` ghi `'ir-json'`; artifact POU **0**; tenant NULL 4/4 project, 7/7 artifact; không index `kind`, không FK artifact→project.

Bundle: IrEditor 26,9 KB gz; PouStudio 16,8 KB gz nhưng import tĩnh CodeEditor 154 KB gz.

RBAC (bảng `permissions`, user không phải admin): operator 3/4 và supervisor 1/4 **thấy menu nhưng bị chặn** (4/12 tổng).

Quan sát UI live (phiên chính, ảnh `05-ir-editor.png`, `06-pou-studio.png`): trang IR cuộn dọc ~2 870 px, canvas nằm trong cột giữa ~200×390 px; hai artifact đã lưu hiện "không phân tích được"; panel So sánh còn chuỗi tiếng Anh ("Base version", "Pick a saved version…"); ladder POU vẽ bằng node xyflow (không phải lưới rung).

## 3. Phát hiện IR

- **IR-01 P0 — chèn mã qua trường chuỗi (đi vòng cổng an toàn).** `signal`/`signal_ref`/`tool_id`/giá trị chuỗi của `if` chèn nguyên văn (`irToUrscript.ts:54,101,114,119,192,210`; `irToRos2.ts:251-333`); schema chỉ `min(1)`. **Đo:** lint `ok:true` còn mã sinh ra chứa `movel(p[…], a=40, v=3)` (3 m/s, 12× trần) và `movej(… v=6)`; bản ROS2 chứa `os.system("id")`.
- **IR-02 P1 — lint xanh giả.** `IrEditor.tsx:981` `lint?.ok ?? true`; không đọc `lintQ.error` ⇒ gặp 431 vẫn "Lint OK / Pass".
- **IR-03 P1 — sai đơn vị gia tốc.** `irToUrscript.ts:91` không đổi đơn vị; mặc định 200 (`irTree.ts:176`) ⇒ `a=200` m/s²; `acceleration=100000` lint vẫn ok.
- **IR-04 P1 — vòng lặp lồng dùng chung `i`** (`irToUrscript.ts:203-204`): vòng 2×3 chạy vòng ngoài 1 lần.
- **IR-05 P1 — nối cạnh đảo chiều** (`IrGraphCanvas.tsx:370-374` → `irTree.ts:341`): nối A→C trên [A,B,C] cho B→C→A. Không có test.
- **IR-06 P1 — Ctrl+Enter build flow mới nhất của toàn hệ thống** (`IrEditor.tsx:1176-1185`); `listFlows` `.limit(200)` trước rồi mới lọc projectId, không lọc tenant, kéo toàn bộ `content`.
- **IR-07 P2 — linter có lỗ:** khớp 720° ok; `while` không timeout + `count` 1e9 ok; `_targetDeviceType` không dùng; lực/timeout grip chỉ là comment.
- **IR-08 P2 — toạ độ `ui` bị coi là thay đổi** (`irDiff.ts:108-113`): chỉ kéo node ⇒ diff "modified", merge conflict.
- **IR-09 P2 — vòng đời bản nháp:** không dirty-state; Load thay nháp + xoá undo không hỏi; Save luôn vào `main`, không gửi base version ⇒ người lưu sau thắng; không xoá/đổi tên/nhân bản flow, không copy/paste.
- **IR-10 P2 — bố cục:** 9 khối cuộn dọc; canvas cố định; trạng thái lint lặp 3 chỗ; thả block bỏ qua vị trí thả; dock Copilot 420 px che cột phải.
- **IR-11 P3 — i18n/a11y:** thiếu 13 khoá `ir.diff.*` ×3 locale; chẩn đoán server chỉ tiếng Anh; 6 thuộc tính aria/role trên hai canvas.

## 4. Phát hiện POU

- **POU-01 P0 — nhập PLCopen làm mất logic mà vẫn `ok:true`.** Gom rung theo băng y=1000 (`plcopenXml.ts:17-19,506-549`). **Đo:** XML kiểu CODESYS 2 rung (y=40/140) thành 1 rung; mất `NOT Stop`; `Lamp` đi theo `Start`.
- **POU-02 P1 — FBD sai mà lint xanh:** vòng lặp, ref thiếu, loại khối lạ đều qua; ST thay bằng `(* cycle at b1 *) FALSE` (`pouToSt.ts:167,177`).
- **POU-03 P1 — mô hình quá hẹp:** một biến kiểu `TON` ⇒ cả tệp bị từ chối; hàm ST `Calc := A*2` báo undefined; LD không FB box/sườn P/N; SFC không nhánh; palette FBD thiếu TON.
- **POU-04 P1 — không có "Mở":** không listArtifacts/getArtifact; deep-link chỉ chọn project đích; nút "Build/Deploy" chuyển `/engineering` không kèm projectId (`PouStudio.tsx:342`). DB 0 artifact POU.
- **POU-05 P2 — gọi server mỗi phím** (1 batch GET chứa 2–3 bản sao dự án, không debounce; hạn mức 300 req/phút/người dùng chung toàn app).
- **POU-06 P2 — linter có lỗ:** coil ghi vào VAR_INPUT, double coil ok; `IF (GoNext AND ()` lint ok; palette có qualifier S/R/P/L/D nhưng linter luôn chặn.
- **POU-07 P2 — canvas chỉ sửa cấp node:** không kéo, không nối dây (`PouCanvas.tsx:1133-1134`); không CRUD POU; thân ST sửa qua JSON; không undo; `canControl` không khoá sửa; không chọn tệp XML.
- **POU-08 P3 — export:** `creationDateTime` cứng; configurations rỗng; chưa kiểm XSD.

## 5. Phát hiện chung

- **XC-01 P0 — preview dùng GET nên gãy ở cỡ nhỏ** (xem bảng trần URL). Sửa: `allowMethodOverride` + `splitLink` POST cho input >2 KB, hoặc chuyển preview sang POST.
- **XC-02 P1 — 3 cổng quyền lệch:** nav `machine_status` (`navigation.tsx:1097,1112`) · RouteGuard `machine_control` (`App.tsx:592-593`) · server đọc `machine_status` · Hub `machine_control` ⇒ chế độ chỉ-xem mà trang đã thiết kế không bao giờ tới được với 4 user.
- **XC-03 P1 — "Mở project này trong IR/POU" không mở gì** (`EngineeringWorkspace.tsx:703-707`): IR mở canvas trống, POU mở mẫu LAD.
- **XC-04 P2 — hai chuẩn lưu:** IR có cờ/validate/audit; POU không. `createProject` là `protectedProcedure`; `deleteProject` xoá cứng.
- **XC-05 — "dead-end" (doc 25) nay là đường MỘT CHIỀU:** editor → artifact → build → deploy (simulated/failed) đã có; chiều quay lại editor thì chưa.

## 6. So với đối thủ (CODESYS / TIA / TwinCAT / Node-RED / Blockly)

Thiếu: cây project, tab nhiều editor, bảng biến/GVL/IO map, vẽ dây tự do, số thứ tự thực thi (CFC), timer/edge trong LD, SFC nhánh song song, cross-reference, nhấp lỗi nhảy tới node, copy/paste, online/watch/force/mô phỏng, nhập PLCopen từ công cụ ngoài.
Điểm mạnh nên GIỮ: diff/merge 3 chiều theo AST của IR; nguyên tắc "một mô hình, nhiều view".

## 7. Thiết kế cải tiến

**Quyết định đề xuất:** hợp nhất IR Editor + POU Studio + Engineering Workspace thành **một IDE "một Project, nhiều Program Unit"** (LD/FBD/SFC/ST/Motion-IR/GVL/IOMap/Task) như CODESYS/TIA. Dùng chung vỏ IDE, bảng ký hiệu, phiên bản/diff, Problems, pipeline; **giữ hai AST, hai linter, hai transpiler**. Làm sau Pha 0, dưới cờ.

| Chỉ số kết cục | Hiện tại | Mục tiêu |
|---|---|---|
| Kích thước chạy được | 30 block / 20 rung / XML 12 KB | ≥1000 / ≥1000 / 5 MB, p95 <500 ms |
| Injection lọt | 100 % | 0 (fuzz ≥50 ca) |
| Nhập PLCopen ngoài tương đương ngữ nghĩa | 0/1 | ≥95 % trên ≥20 tệp thật; 0 mất phần tử không báo |
| Xanh giả | có | 0 |
| Mở lại bản đã lưu từ Workspace | không có | 1 nhấp |
| Thấy menu nhưng bị chặn | 4/12 | 0 |

```
┌ Kỹ thuật › IDE [Project CELL-L1▾] main▾ ●đã sửa [Lưu⌘S][Build⌘B][Sim][Deploy…] ┐
├ EXPLORER ──────┬ [MotorCtl LD●][PickPlace Motion][Sequence SFC][+] ────┬ PROPERTIES ┤
│▾CELL-L1        │ PALETTE│  ┃──| |──┬──|/|──( )──┃ ①                    │ variable▾  │
│ ▾Thiết bị      │        │  ┃  Start│  Stop Motor┃                      │ (từ GVL)   │
│ ▾Chương trình  │        │  canvas full-height, minimap, số thứ tự   │ ────────── │
│ ▾Biến & IO/GVL │        │                                            │ COPILOT▸   │
│ ▾Tasks ▾Phiên bản│      │                                            │ (chia cột) │
├────────────────┴──────────────────────────────────────────────────┴────────────┤
│ [Problems 2✖1⚠][Output ST/URScript][Cross-ref][Diff/Merge][Build log][Watch]   │
│ ✖ MotorCtl·rung1·double-coil "Motor"   ← nhấp để nhảy tới node                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**DB (chỉ thêm):** bảng `program_units` (projectId FK, name, unitType, headArtifactId, tenant, archivedAt, UNIQUE(projectId,name)); `program_artifacts` + `unitId`, `baseArtifactId` (khoá lạc quan), `layoutJson` (ngoài hash/diff); index `(kind, projectId, id desc)`, `(unitId, branch, version desc)`; FK artifact→project `NOT VALID` rồi VALIDATE; chuẩn hoá `language`.

**API:** transport POST; `units.list/get/create/rename/archive/duplicate/versions`; `units.saveVersion({unitId, branch, baseArtifactId, content, layout})` lệch base ⇒ 409 kèm head để mở Merge; `plcopen.importPreview` trả `lossless` + `warnings[]`; rule mới io-ref-invalid, accel-limit, joint-limit, unbounded-while, loop-ceiling, fbd-cycle/missing/unknown/arity, double-coil, write-to-input; parser ST thật.

**Pha 0 — tính đúng & an toàn (~8–10 ngày):**

| # | Việc | Công | Nghiệm thu |
|---|---|---|---|
| 0.1 | Chặn injection (whitelist + `emitIdent/emitString` ném lỗi) | S | 50 ca fuzz, 0 dòng lạ |
| 0.2 | POST cho query lớn | S | 1000 block & XML 2 MB trả 200 |
| 0.3 | Lint 3 trạng thái (ok/lỗi/không đọc được) | S | lỗi query ⇒ khoá Save/Build |
| 0.4 | Đơn vị gia tốc | S | mặc định ra `a=0.5` |
| 0.5 | Vòng lặp lồng | S | 2×3 đếm đúng 6 |
| 0.6 | Chiều reorder | S | A→C cho [A,C,B] |
| 0.7 | Ctrl+Enter + lọc SQL | S | — |
| 0.8 | Importer theo topology `refLocalId` | M | ≥20 tệp thật |
| 0.9 | Rule FBD | S | — |
| 0.10 | Thống nhất RBAC | S | ma trận khớp |
| 0.11 | `ui` ra khỏi diff | S | — |

**Pha 1 (~2 tuần):** migration units/base/layout · saveVersion + 409 · deep-link `unitId/artifactId` · panel phiên bản POU + debounce · dirty-state.
**Pha 2 (~3–4 tuần, cờ `ENG_IDE_SHELL` OFF):** shell Explorer + tab + panel dưới + Properties/Copilot chia cột (L) · editor provider theo unitType · bảng GVL/IO map, signal chọn từ dropdown · redirect route cũ · i18n + a11y (axe 0 lỗi serious).
**Pha 3 (đo trước khi làm):** LD FB/P-N, SFC nhánh, vẽ dây, parser ST đầy đủ, export đạt XSD, OpenPLC sim + watch.

**Rủi ro:** đa phiên sửa cùng nhánh; tương thích ngược (thêm `schemaVersion`); **không bật đường thiết bị thật cho IR/POU trước khi 0.1, 0.4, 0.5, 0.8, 0.9 xanh** — đưa fuzz + bộ import thật vào CI bắt buộc.

## 8. Chưa kiểm được
FPS/render canvas trong trình duyệt; màn hình khi gặp 431; mutation save/build/deploy; hai phiên lưu đồng thời; hạn mức 300 req/phút; XSD TC6 và nhập vào CODESYS/TwinCAT thật (tệp "ngoài" là tệp tự viết theo dạng CODESYS); vòng lặp lồng bản ROS2; chạy mã sinh ra trên URSim/ROS2.
