#!/usr/bin/env node
/**
 * scripts/ui-metrics/engineeringLayout.mjs — THIẾT BỊ ĐO BỐ CỤC 14 màn "Kỹ thuật & Điều khiển"
 * (doc 81 Đợt 2 Task 1). Mọi task chuyển trang của Đợt 2 được nghiệm thu bằng số của script này,
 * nên mọi chỉ số phải KHÔNG LÁCH ĐƯỢC bằng chính mã nó chấm (ruling R-2-e):
 *
 *   · MAIN            — `[data-layout-main]` trong `<main>`, KHÔNG được chứa h1 / page header / banner /
 *                       KPI (vi phạm = LỖI của trang). Trước khi có attribute: selector FE1 + cảnh báo.
 *                       Diện tích = HỢP các hình chữ nhật (không cộng trùng).
 *   · chromeAboveMain — = mainTop (px từ đỉnh trang). Không phụ thuộc lớp CSS, không lách được.
 *   · bannersBeforeMain — HÌNH HỌC: mọi khối nhìn thấy nằm giữa đáy h1 và đỉnh MAIN (không thuộc
 *                       page header), số + chiều cao hợp. Bộ phân loại lớp CSS của FE1 chỉ còn là NHÃN.
 *   · kpi             — LUÔN đếm cả MetricCard cũ lẫn `[data-layout-kpi]`.
 *   · coverMain       — hit-test lưới 8 px trên MAIN: điểm nào phần tử trên cùng KHÔNG thuộc MAIN là
 *                       bị che, bất kể tệp nguồn; quy về phần tử fixed/absolute/sticky ngoài cùng.
 *   · actions         — hành động khai báo không tìm thấy = LỖI (không phải 0); dialog phân theo LOẠI.
 *   · pageHeightRatio — tính cả phần cuộn của container cuộn tổ tiên của MAIN.
 *   · drift           — băm nội dung các bảng 14 màn đọc, TRƯỚC và SAU mỗi lần chạy; trôi ⇒ pass=false.
 *   · calibration     — trang LẦN ĐẦU gắn attribute phải khớp MAIN FE1 (legacyRef trong baseline) ±4 px/3 %,
 *                       hoặc đã có bản ghi `--calibrate` trong do-bo-cuc/calibration.json; lệch ⇒ LỖI.
 *   · insideMain      — banner / dải KPI KHÔNG đánh dấu ở ĐẦU MAIN (trên phần tử làm việc, <120 px, ≥60 % bề
 *                       rộng) ⇒ LỖI, trừ một [data-layout-toolbar] ≤48 px. MAIN được CẮT theo tổ tiên overflow.
 *   · aiInsideMain    — bề mặt AI/Copilot bên trong MAIN bị trừ khỏi `workspacePct` và báo riêng.
 *   · fix3 (R-2-f)    — W là phần tử làm việc GỐC ([data-layout-workspace] không còn là lối thoát; W===MAIN bị từ
 *                       chối); pageHeightRatio chỉ gác tài liệu + tổ tiên (anh em: siblingScrollExtra, chỉ báo);
 *                       hiệu chuẩn theo màn|vw|biến thể + bộ chọn attribute, so lại MỖI lần chạy; mất h1 = LỖI;
 *                       notice trên h1 tính banner; AI theo nhãn i18n; fixed TRONG MAIN vẫn là che.
 *   · fix4            — miễn trừ "nhãn chữ ≤40 px" xét CẢ CÂY CON (hậu duệ có nền/viền, badge/chip, alert/status, icon,
 *                       từ khoá ⇒ mất miễn trừ); hàng chip/KPI phân loại TRƯỚC miễn trừ nhãn; trạng thái trống tự viết
 *                       KHÔNG được nằm trong hộp notice (tổ tiên tới MAIN có role alert/status, lớp notice, lớp màu
 *                       bg-/border-, hay màu đã tính chroma OKLab > 0,05) và chữ không có từ khoá notice.
 *   · selfTest        — 37 ca đối chứng DƯƠNG mỗi lần chạy, qua đúng measurePage/runActions; `--mutation` gỡ
 *                       từng gác (32 gác) và chứng minh ca của nó ĐỎ.
 *   · final wave      — (R-2-z1) màn tab `equipment-standards-alarms` (tabOf, hiệu chuẩn theo phần tử của trang mẹ);
 *                       `hScroll` cuộn ngang cấp trang ≥1366 = LỖI; biến thể Copilot phải THẬT SỰ hiện/ẩn (LỖI nếu không).
 *
 * Instance: KHÔNG dùng :3000 (chạy dist cũ). `--spawn` tự dựng server TỪ MÃ NGUỒN (tsx) ở :3016
 * + Vite dev (in-process) ở :5176, DB `aoi_management_test`. Server KHÔNG nạp .env (DOTENV_CONFIG_PATH
 * trỏ tệp không tồn tại); hồ sơ cờ `dev` (mặc định, ruling R-2-d) BẬT cờ giao diện như dev, TẮT mọi
 * actuation/ra ngoài; kết nối mạng của server được lấy mẫu và kiểm (chỉ Postgres). Xem README.md.
 *
 * Dùng:
 *   node scripts/ui-metrics/engineeringLayout.mjs --spawn --out <file.json> [--flags dev|off] [--shots] [--screens a,b] [--sizes 1600x950,1366x768]
 *   node scripts/ui-metrics/engineeringLayout.mjs --compare a.json b.json [--threshold 2]
 *   node scripts/ui-metrics/engineeringLayout.mjs --fe1 run.json [--threshold 5]
 *   node scripts/ui-metrics/engineeringLayout.mjs --spawn --discover-tables --out tables.json
 *   node scripts/ui-metrics/engineeringLayout.mjs --spawn --list-buttons --out buttons.json
 *   node scripts/ui-metrics/engineeringLayout.mjs --spawn --screens engineering-changes --sizes 1600x950 --mutation --out m.json
 *   node scripts/ui-metrics/engineeringLayout.mjs --spawn --calibrate --screens <màn> --out c.json
 */
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(REPO, "package.json"));

// ───────────────────────────────────────────────────────────────────────────────────────────
// 1. Khai báo: 14 màn, MAIN cũ (FE1), hành động mở dialog, biến thể Copilot
// ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * `legacyMain` — selector đo của FE1 (`.playwright-mcp/survey81/_kpi.cjs`), viết lại theo TỆP của
 * `data-loc` + loại vùng + tiêu đề thay vì số dòng (số dòng trôi sau mỗi lần sửa tệp). Chỉ dùng khi
 * trang CHƯA có `[data-layout-main]`; khi dùng, kết quả mang `mainSource: "fe1-legacy"` và script
 * in cảnh báo — không bao giờ im lặng.
 *
 * `actions` — hành động MỞ (không bao giờ lưu/gửi): bấm nút theo tên, đếm role=dialog, Esc đóng.
 * Chỉ khai nút mở form/sheet/popover; nút ghi (Duyệt, Lưu, Deploy, Chạy…) KHÔNG được khai.
 */
export const SCREENS = [
  { n: 1, id: "engineering-home", route: "/engineering-home",
    legacyMain: { desc: "PendingReviewStrip + EngineeringHub section (depth 0)", fn: (r) => r.depth === 0 && /PendingReviewStrip\.tsx|EngineeringHub\.tsx/.test(r.loc || "") && r.kind === "section" },
    actions: [] },
  // Ruling R-2-x (Task 15 fix 1): Studio đã gộp vào Hub ⇒ màn này đo Hub ở CHẾ ĐỘ DANH MỤC (`?tab=catalog`, đích chuyển
  // hướng của /engineering-studio). BÍ DANH: hiệu chuẩn so với bản ghi của Hub (`calibrateAs`), không tự ghi bản ghi.
  // TRƯỚC/SAU của id này KHÔNG cùng loại (trước: launcher Studio riêng; sau: tab Danh mục của Hub) — README.
  { n: 2, id: "engineering-studio", route: "/engineering-home?tab=catalog", aliasOf: "/engineering-studio", calibrateAs: { id: "engineering-home", variant: "n/a" },
    legacyMain: { desc: "WorkspaceShell resizable-panel bên phải (panel nội dung)", pick: (rs) => { const c = rs.filter((r) => /WorkspaceShell\.tsx/.test(r.loc || "") && r.kind === "resizable-panel"); if (!c.length) return []; const mx = Math.max(...c.map((r) => r.x)); return c.filter((r) => r.x === mx).slice(0, 1); } },
    actions: [] },
  // IDE: editor chỉ hiện khi đã chọn dự án ⇒ mở bằng deep-link `?projectId=` (U1 doc 26, phải còn sống
  // qua Đợt 2) tới dự án cập nhật gần nhất trong `programming.listProjects` — FE1 có dự án đã chọn sẵn.
  { n: 3, id: "engineering", route: "/engineering", copilot: true, deepLink: "firstProject",
    legacyMain: { desc: "khung CodeMirror (vùng không data-loc, có input, cao ≥200)", fn: (r) => !r.loc && r.inp >= 1 && r.h >= 200 },
    actions: [{ id: "so-tay", label: /sổ tay/i }] },
  { n: 4, id: "engineering-changes", route: "/engineering-changes",
    // final wave (T4-M6): danh sách ECN là <section> (trước: Card bị vô hiệu kiểu chỉ để selector này còn thấy). Selector
    // nhận cả hai — baseline (Card) vẫn tái lập được; hình học của MAIN cũ không đổi.
    legacyMain: { desc: "EngineeringChanges card/section chứa bảng", fn: (r) => /EngineeringChanges\.tsx/.test(r.loc || "") && (r.kind === "card" || r.kind === "section") && r.tbl >= 1 && r.depth === 0 },
    actions: [{ id: "thay-doi-moi", label: /Thay đổi mới/ }] },
  { n: 5, id: "recipes", route: "/recipes",
    legacyMain: { desc: "RecipeManagement: card 'Mã recipe' + card cùng hàng (phiên bản)", pick: (rs) => { const a = rs.find((r) => /RecipeManagement\.tsx/.test(r.loc || "") && r.kind === "card" && /^Mã recipe/.test(r.head)); if (!a) return []; return rs.filter((r) => /RecipeManagement\.tsx/.test(r.loc || "") && r.kind === "card" && r.depth === a.depth && Math.abs(r.y - a.y) <= 4); } },
    actions: [{ id: "luu-phien-ban-moi", label: /Lưu phiên bản mới/ }] },
  { n: 6, id: "interlock-rules", route: "/interlock-rules",
    legacyMain: { desc: "InterlockRuleManagement tabs-content đang mở", fn: (r) => /InterlockRuleManagement\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    // Task 5: "Thêm quy tắc" KHOÁ với role đo (engineer: DEFAULT_ROLE_PERMISSIONS interlock chỉ canView) ⇒ cảnh báo
    // "disabled" là trạng thái THẬT, giữ khai báo. Thêm nút MỞ công cụ Test (dry-run) trên hàng đầu (flyout, chỉ đọc).
    actions: [{ id: "them-quy-tac", label: /Thêm quy tắc/ }, { id: "test-dry-run", label: /^Test \(dry-run\)$/ }] },
  { n: 7, id: "orchestration-studio", route: "/orchestration-studio",
    legacyMain: { desc: "OrchestrationStudio card Cây/Sơ đồ + Cấu hình bước", fn: (r) => /OrchestrationStudio\.tsx/.test(r.loc || "") && r.kind === "card" && /^(Cây quy trình|Sơ đồ|Cấu hình bước)/.test(r.head) },
    actions: [{ id: "phien-ban", label: /^Phiên bản$/ }, { id: "nhan-ban", label: /^Nhân bản$/ }] },
  { n: 8, id: "ir-editor", route: "/ir-editor", copilot: true,
    legacyMain: { desc: "card 'Vùng vẽ luồng'", fn: (r) => r.kind === "card" && /Vùng vẽ luồng/.test(r.head) },
    actions: [{ id: "project-ir-flow-moi", label: /Project ir-flow mới/ }] },
  { n: 9, id: "pou-studio", route: "/pou-studio", copilot: true,
    legacyMain: { desc: "card 'Trình soạn POU'", fn: (r) => r.kind === "card" && /Trình soạn POU/.test(r.head) },
    actions: [{ id: "luu-vao-project", label: /Lưu vào project/ }] },
  // Ruling R-2-x (Task 15 fix 1): trang Copilot riêng ⇒ CHẾ ĐỘ SCRATCH của IDE (`/engineering?copilot=scratch`, đích chuyển
  // hướng của /programming-copilot). Copilot nay là panel TRONG layout NGOÀI MAIN ⇒ bỏ `aiIsWorkspace` (miễn trừ cũ không
  // còn đúng — giữ nó sẽ là NỚI thước). BÍ DANH: hiệu chuẩn so với bản ghi IDE mở Copilot (`engineering|vw|open`).
  // TRƯỚC/SAU của id này KHÔNG cùng loại (trước: trang form riêng; sau: IDE chưa mở dự án + Copilot) — README.
  { n: 10, id: "programming-copilot", route: "/engineering?copilot=scratch", aliasOf: "/programming-copilot", calibrateAs: { id: "engineering", variant: "open" },
    legacyMain: { desc: "ProgrammingCopilot card đầu (form sinh mã)", pick: (rs) => rs.filter((r) => /ProgrammingCopilot\.tsx/.test(r.loc || "") && r.kind === "card" && r.depth === 0).slice(0, 1) },
    actions: [] },
  // Đợt 3 Task 5 ([QĐ-3b], khuôn R-2-x): Fleet dời sang nhóm Labs — CÙNG trang, chỉ đổi đường dẫn. `route` = route mới;
  // `aliasOf` = URL cũ (nay chỉ chuyển hướng giữ query). Không `calibrateAs`/`movedFrom`: id, MAIN (`data-layout-main=
  // "fleet-orchestration"`) và bản ghi hiệu chuẩn `fleet-orchestration|vw|n/a` là CỦA CHÍNH trang này ⇒ so lại như mọi lần
  // chạy (lệch ⇒ LỖI). TRƯỚC/SAU CÙNG LOẠI (cùng trang); khác duy nhất là breadcrumb top bar (… › Labs — thử nghiệm › …).
  { n: 11, id: "fleet-orchestration", route: "/labs/fleet-orchestration", aliasOf: "/fleet-orchestration",
    legacyMain: { desc: "FleetOrchestration tabs-content đang mở", fn: (r) => /FleetOrchestration\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [] },
  { n: 12, id: "safety-workforce", route: "/safety-workforce",
    legacyMain: { desc: "SafetyWorkforce tabs-content đang mở", fn: (r) => /SafetyWorkforce\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [{ id: "bao-cao-tiem-can", label: /Báo cáo tiệm cận/ }] },
  { n: 13, id: "equipment-standards", route: "/equipment-standards",
    legacyMain: { desc: "EquipmentStandards tabs-content đang mở", fn: (r) => /EquipmentStandards\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [{ id: "dang-ky-loai", label: /Đăng ký loại/ }] },
  // final wave (R-2-z1 / I-4): mục tiêu §1.1 "trang cao nhất (Standards cảnh báo) ≤1,5×" đo trên CHÍNH tab cảnh báo
  // (`?tab=alarms`), trước đây chỉ có ở bản sao thước trong scratchpad. Cùng trang ⇒ `tabOf`: bản ghi hiệu chuẩn RIÊNG
  // (MAIN của tab khác hình học), bản ghi MỚI chỉ được ghi khi phần tử mang attribute TRÙNG phần tử đã hiệu chuẩn của
  // trang mẹ (FE1 chưa từng đo tab này nên không có tham chiếu hình học); sau đó so lại mỗi lần chạy như mọi màn.
  { n: 13.5, id: "equipment-standards-alarms", route: "/equipment-standards?tab=alarms", tabOf: "equipment-standards",
    legacyMain: { desc: "EquipmentStandards tabs-content đang mở", fn: (r) => /EquipmentStandards\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [{ id: "chuan-hoa-canh-bao", label: /Chuẩn hóa cảnh báo/ }] },
  { n: 14, id: "equipment-integration", route: "/equipment-integration",
    legacyMain: { desc: "EquipmentIntegration tabs-content đang mở", fn: (r) => /EquipmentIntegration\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [] },
  // Đợt 3 Task 2 (doc 81 §11 "Đã chốt" 2026-10-05) — worker thu ảnh dời sang trang riêng Vision › Thu ảnh.
  // Bước 1 (R-2-k, commit 5107ac3ca): đo TRƯỚC trên CHÍNH tab `?tab=acquisition` của Integration (khi đó `tabOf`; bản ghi
  // `vision-acquisition|vw|n/a` ghi bằng --calibrate vì attribute trùng phần tử đã hiệu chuẩn của Integration).
  // Bước 2: `route` = trang mới; `aliasOf` = URL cũ (nay chuyển hướng tới đây). `movedFrom` CHỈ cấp tham chiếu h1 (trang mẹ
  // cũ); KHÔNG có nhánh hiệu chuẩn riêng — bản ghi đã có từ bước 1 nên mỗi lần chạy so lại với nó, lệch ⇒ LỖI, đổi bản ghi
  // phải chạy --calibrate (giữ `previous`). README "Màn dời ra trang riêng".
  { n: 14.5, id: "vision-acquisition", route: "/vision/acquisition", aliasOf: "/equipment-integration?tab=acquisition", movedFrom: "equipment-integration",
    legacyMain: { desc: "VisionAcquisition: FE1 chưa từng đo — không có selector cũ (thiếu attribute ⇒ không thấy MAIN)", fn: () => false },
    actions: [{ id: "khoi-dong-worker", label: /Khởi động worker/ }] },
  // Đợt 3 Task 3 (doc 81 §11 "Đã chốt" 2026-10-05) — bảng nhân lực dời sang Sản xuất › Ca (`/production/shifts`).
  // Bước 1 (R-2-k, commit 62100994f): đo TRƯỚC trên CHÍNH tab `?tab=workforce` của Safety (khi đó `tabOf`; bản ghi
  // `production-shifts|vw|n/a` ghi bằng --calibrate vì attribute trùng phần tử đã hiệu chuẩn của Safety).
  // Bước 2: `route` = trang mới; `aliasOf` = URL cũ (nay chuyển hướng tới đây); `movedFrom` CHỈ cấp tham chiếu h1 — khuôn
  // `vision-acquisition`, README "Màn dời ra trang riêng".
  { n: 12.5, id: "production-shifts", route: "/production/shifts", aliasOf: "/safety-workforce?tab=workforce", movedFrom: "safety-workforce",
    legacyMain: { desc: "ProductionShifts: FE1 chưa từng đo — không có selector cũ (thiếu attribute ⇒ không thấy MAIN)", fn: () => false },
    actions: [{ id: "phan-cong", label: /^Phân công$/ }] },
];

/** FE1 §0 (docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU/FE1_DO_BO_CUC_THEO_VUNG_14_MAN.md), :3000 dist, engineer1, 2026-09-26. */
export const FE1 = {
  "engineering-home": { mainTop: 366, ws1600: 42.5, ws1366: 33.0, notices: 1, noticePx: 57, ratio1600: 2.03, ratio1366: 2.57, crumbs: 2, kpi: 0 },
  "engineering-studio": { mainTop: 134, ws1600: 53.5, ws1366: 48.9, notices: 0, noticePx: 0, ratio1600: 1.02, ratio1366: 1.03, crumbs: 1, kpi: 0 },
  "engineering|open": { mainTop: 713, ws1600: 10.4, ws1366: 0.0, notices: 1, noticePx: 70, ratio1600: 3.11, ratio1366: 3.93, crumbs: 2, kpi: 0 },
  "engineering|closed": { mainTop: 697, ws1600: 14.8, ws1366: 3.5, notices: 1, noticePx: 54, ratio1600: 2.99, ratio1366: 3.84, crumbs: 2, kpi: 0 },
  "engineering-changes": { mainTop: 347, ws1600: 21.3, ws1366: 25.0, notices: 0, noticePx: 0, ratio1600: 1.0, ratio1366: 1.0, crumbs: 1, kpi: 0 },
  "recipes": { mainTop: 511, ws1600: 28.0, ws1366: 23.9, notices: 1, noticePx: 48, ratio1600: 1.25, ratio1366: 1.56, crumbs: 2, kpi: 0 },
  "interlock-rules": { mainTop: 399, ws1600: 15.9, ws1366: 19.5, notices: 1, noticePx: 34, ratio1600: 1.0, ratio1366: 1.0, crumbs: 2, kpi: 0 },
  "orchestration-studio": { mainTop: 762, ws1600: 15.1, ws1366: 0.0, notices: 2, noticePx: 72, ratio1600: 1.60, ratio1366: 2.01, crumbs: 2, kpi: 0 },
  "ir-editor|open": { mainTop: 822, ws1600: 2.8, ws1366: 0.0, notices: 3, noticePx: 174, ratio1600: 3.04, ratio1366: 4.01, crumbs: 2, kpi: 4 },
  "ir-editor|closed": { mainTop: 704, ws1600: 8.2, ws1366: 1.1, notices: 3, noticePx: 138, ratio1600: 2.86, ratio1366: 3.61, crumbs: 2, kpi: 4 },
  "pou-studio|open": { mainTop: 689, ws1600: 6.9, ws1366: 0.0, notices: 3, noticePx: 178, ratio1600: 1.56, ratio1366: 2.15, crumbs: 2, kpi: 4 },
  "pou-studio|closed": { mainTop: 629, ws1600: 12.9, ws1366: 5.6, notices: 3, noticePx: 138, ratio1600: 1.47, ratio1366: 1.88, crumbs: 2, kpi: 4 },
  "programming-copilot": { mainTop: 315, ws1600: 23.9, ws1366: 34.6, notices: 1, noticePx: 34, ratio1600: 1.0, ratio1366: 1.03, crumbs: 1, kpi: 0 },
  "fleet-orchestration": { mainTop: 653, ws1600: 24.2, ws1366: 9.0, notices: 3, noticePx: 118, ratio1600: 1.55, ratio1366: 1.94, crumbs: 2, kpi: 9 },
  "safety-workforce": { mainTop: 695, ws1600: 20.8, ws1366: 5.0, notices: 3, noticePx: 160, ratio1600: 1.68, ratio1366: 2.13, crumbs: 2, kpi: 4 },
  "equipment-standards": { mainTop: 669, ws1600: 22.9, ws1366: 7.5, notices: 3, noticePx: 118, ratio1600: 1.85, ratio1366: 2.32, crumbs: 2, kpi: 5 },
  "equipment-integration": { mainTop: 673, ws1600: 22.6, ws1366: 7.1, notices: 3, noticePx: 138, ratio1600: 1.31, ratio1366: 1.70, crumbs: 2, kpi: 4 },
};


// ───────────────────────────────────────────────────────────────────────────────────────────
// 1b. Bảng dữ liệu mỗi màn đọc (canh trôi dữ liệu) + thủ tục tRPC đã biết
// ───────────────────────────────────────────────────────────────────────────────────────────
/**
 * `PAGE_TABLES` — bảng mà 14 màn (kể cả vỏ: top bar, andon, hộp AI…) ĐỌC khi nạp, rút bằng
 * `--discover-tables` (delta `pg_stat_user_tables.seq_scan+idx_scan` quanh từng lần nạp màn; chunk
 * TimescaleDB quy về hypertable). Rút 2026-10-02: lấy HỢP của 2 lần chạy (disc2 ∪ disc3 — hai lần khớp
 * nhau trừ ±2 bảng nhiễu ở Safety/Fleet) + `collaboration_sessions` (Safety, thấy ở lần 2) — HỢP để
 * KHÔNG sót bảng; nhiễu thừa chỉ làm canh trôi nhạy hơn. Mỗi bảng được băm NỘI DUNG (md5 từng hàng, sắp theo md5)
 * trước và sau mỗi lần đo. `cols` giới hạn cột khi chính instance đo ghi vào cột khác của bảng
 * (vd `users.lastSignedIn` khi đăng nhập). Xem `SELF_WRITTEN` cho bảng loại trừ có lý do.
 */
export const PAGE_TABLES = {
  "engineering-home": ["ai_insights","ai_pending_actions","andon_events","changeover_requests","daily_statistics","engineering_assignments","engineering_changes","equipment_3d_models","factories","interlock_events","interlock_rules","machine_recipes","machine_status_logs","machines","oee_metrics","orchestration_runs","permissions","product_inspections","product_machine_mappings","production_lines","robot_telemetry","robots","safety_events","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","vram_leases","workshops","zone_reservations","zones"],
  "engineering-studio": ["ai_insights","ai_pending_actions","andon_events","equipment_3d_models","factories","machines","permissions","product_inspections","production_lines","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","workshops","zones"],
  "engineering": ["ai_insights","ai_pending_actions","andon_events","daily_statistics","equipment_3d_models","factories","machine_status_logs","machines","oee_metrics","permissions","predictive_alerts","product_inspections","product_machine_mappings","production_lines","program_artifacts","program_deployments","program_projects","program_symbols","robot_jobs","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","vram_leases","workshops","zones"],
  "engineering-changes": ["ai_insights","ai_pending_actions","andon_events","engineering_assignments","engineering_changes","equipment_3d_models","factories","machines","permissions","product_inspections","product_models","production_lines","robot_telemetry","robots","sites","stations","tasks","user_factory_assignments","users","workshops","zones"],
  "recipes": ["ai_insights","ai_pending_actions","andon_events","daily_statistics","engineering_assignments","equipment_3d_models","factories","machine_recipes","machine_status_logs","machines","oee_metrics","permissions","predictive_alerts","product_inspections","product_machine_mappings","production_lines","recipe_deployments","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","vram_leases","workshops","zones"],
  "interlock-rules": ["ai_insights","ai_pending_actions","andon_events","daily_statistics","engineering_assignments","equipment_3d_models","factories","interlock_events","interlock_rules","machine_status_logs","machines","oee_metrics","permissions","predictive_alerts","product_inspections","product_machine_mappings","production_lines","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","vram_leases","workshops","zones"],
  "orchestration-studio": ["ai_insights","ai_pending_actions","andon_events","engineering_assignments","equipment_3d_models","factories","machines","orchestration_runs","orchestration_workflows","permissions","product_inspections","production_lines","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","workshops","zones"],
  "ir-editor": ["ai_insights","ai_pending_actions","andon_events","daily_statistics","equipment_3d_models","factories","machine_status_logs","machines","oee_metrics","permissions","predictive_alerts","product_inspections","product_machine_mappings","production_lines","program_artifacts","program_projects","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","vram_leases","workshops","zones"],
  "pou-studio": ["ai_insights","ai_pending_actions","andon_events","daily_statistics","equipment_3d_models","factories","machine_status_logs","machines","oee_metrics","permissions","predictive_alerts","product_inspections","product_machine_mappings","production_lines","program_projects","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","vram_leases","workshops","zones"],
  "programming-copilot": ["ai_insights","ai_pending_actions","andon_events","equipment_3d_models","factories","machines","permissions","product_inspections","production_lines","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","workshops","zones"],
  "fleet-orchestration": ["ai_insights","ai_pending_actions","andon_events","battery_charging_plans","charger_stations","daily_statistics","equipment_3d_models","factories","machine_status_logs","machines","oee_metrics","operation_codes","permissions","predictive_alerts","product_inspections","product_machine_mappings","production_lines","resource_reservations","robot_telemetry","robots","shared_resources","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","vram_leases","workshops","zone_reservations","zones"],
  "safety-workforce": ["ai_insights","ai_pending_actions","andon_events","battery_charging_plans","camera_calibrations","charger_stations","collaboration_sessions","daily_statistics","equipment_3d_models","factories","machines","operation_codes","operator_assignments","permissions","predictive_alerts","production_lines","resource_reservations","robot_telemetry","robots","safety_events","safety_plc_configs","safety_zones","shared_resources","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","workshops","zone_reservations","zones"],
  "equipment-standards": ["ai_insights","ai_pending_actions","alarm_taxonomy","alert_settings","andon_events","camera_calibrations","daily_statistics","device_type_change_requests","device_types","equipment_3d_models","factories","machine_status_logs","machines","master_alarms","oee_metrics","permissions","predictive_alert_occurrences","predictive_alerts","product_inspections","product_machine_mappings","production_lines","robot_telemetry","robots","safety_events","safety_zones","sites","stations","tasks","user_factory_assignments","users","workshops","zones"],
  "equipment-integration": ["ai_insights","ai_pending_actions","andon_events","equipment_3d_models","factories","machines","permissions","product_inspections","production_lines","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","workshops","zones"],
};
/** Bảng do CHÍNH instance đo ghi khi đăng nhập / xem trang (không phải dữ liệu màn hiển thị). */
export const SELF_WRITTEN = {
  user_sessions: "mỗi lượt đăng nhập (của instance đo và của vitest phiên khác) ghi một hàng; nội dung không hiển thị trên 14 màn",
  user_secrets: "bí mật của user đo tạm; không hiển thị",
};
/** Cột được băm cho bảng mà instance đo ghi một phần (đăng nhập cập nhật lastSignedIn…). */
const TABLE_COLS = { users: ["id", "username", "name", "role", "isActive"] };
/**
 * Cột do CHÍNH instance đo ghi, loại khỏi phép băm (kèm lý do). `predictive_alerts`: bộ máy leo thang
 * cảnh báo LUÔN BẬT (`startEscalationScheduler(60_000)`, server/_core/index.ts — không có cờ tắt) chạy
 * ngay khi server đo khởi động và nâng `escalationLevel`/`lastEscalatedAt`/`updatedAt`. Phát hiện bởi
 * chính canh trôi (lần đo 2026-10-02 07:55Z: cùng 813 hàng, băm đổi; mọi lastEscalatedAt = giờ khởi động).
 */
const TABLE_EXCLUDE_COLS = { predictive_alerts: ["escalationLevel", "lastEscalatedAt", "updatedAt"] };
/** Bỏ hàng của USER ĐO TẠM (tạo trước ảnh TRƯỚC, xoá sau ảnh SAU, id mới mỗi lần) khỏi phép băm. */
const PROBE_FILTER = `(select id from users where "openId" = 'ui-metrics-engineer')`;
const TABLE_WHERE = {
  users: `t."openId" is distinct from 'ui-metrics-engineer'`,
  permissions: `t."userId" not in ${PROBE_FILTER}`,
  user_factory_assignments: `t."userId" not in ${PROBE_FILTER}`,
  user_corporate_assignments: `t."userId" not in ${PROBE_FILTER}`,
};
/** Thủ tục tRPC mỗi màn gọi lúc rút `PAGE_TABLES`. Gọi thủ tục MỚI ⇒ cảnh báo: chạy lại --discover-tables. */
export const KNOWN_PROCS = {
  "engineering-home": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","license.getAllowedModules","license.systemState","oversight.pendingSummary","oversight.posture","permissions.getMyPermissions"],
  "engineering-studio": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","license.getAllowedModules","license.systemState","permissions.getMyPermissions"],
  "engineering": ["aiInbox.count","aiProgrammingKb.search","andon.active","auth.me","commandCenter.hierarchy","license.getAllowedModules","license.systemState","machine.list","permissions.getMyPermissions","programming.fleetVersionMatrix","programming.listApprovers","programming.listArtifacts","programming.listDeployments","programming.listProjects","programming.listSymbols","programming.status"],
  "engineering-changes": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","ecn.list","engineering.assignments","license.getAllowedModules","license.systemState","permissions.getMyPermissions","productModel.list"],
  "recipes": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","engineering.assignments","license.getAllowedModules","license.systemState","machineRecipe.deployments.list","machineRecipe.machines.list","machineRecipe.recipes.listCodes","permissions.getMyPermissions"],
  "interlock-rules": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","engineering.assignments","interlock.events","interlock.list","license.getAllowedModules","license.systemState","oversight.posture","permissions.getMyPermissions"],
  "orchestration-studio": ["aiInbox.count","aiOrchestration.status","andon.active","auth.me","commandCenter.hierarchy","engineering.assignments","equipment.listEquipment","license.getAllowedModules","license.systemState","orchestration.listRuns","orchestration.listVersions","orchestration.listWorkflows","orchestration.status","permissions.getMyPermissions"],
  "ir-editor": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","ir.lint","ir.listFlows","ir.status","license.getAllowedModules","license.systemState","permissions.getMyPermissions","programming.listProjects"],
  "pou-studio": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","license.getAllowedModules","license.systemState","permissions.getMyPermissions","programming.listProjects","programming.pouLint","programming.pouTranspilePreview"],
  "programming-copilot": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","license.getAllowedModules","license.systemState","permissions.getMyPermissions"],
  // final wave (I-4): Task 10 đưa bản đồ lên MAIN ⇒ `fleet.robotPositions` (5 s) + `twin.occupancyGrid` chạy mỗi lần mở trang.
  "fleet-orchestration": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","fleet.deadlocks","fleet.listChargers","fleet.listChargingPlans","fleet.listOperations","fleet.listReservations","fleet.listResourceReservations","fleet.listResources","fleet.listTasks","fleet.listZones","fleet.resourceStatus","fleet.robotPositions","fleet.status","license.getAllowedModules","license.systemState","permissions.getMyPermissions","twin.occupancyGrid"],
  // Đợt 3 Task 3: bỏ `safety.currentBoard` — bảng hiện trường dời sang Sản xuất › Ca, Safety không còn gọi (THU HẸP danh sách).
  "safety-workforce": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","license.getAllowedModules","license.systemState","permissions.getMyPermissions","safety.feed","safety.listAssignments","safety.listCollaborations","safety.nearMissTrend","safety.sourceHealth","safety.status"],
  "equipment-standards": ["aiInbox.count","alarmKpi.summary","andon.active","auth.me","commandCenter.hierarchy","equipmentStandards.complianceMetrics","equipmentStandards.hierarchyTree","equipmentStandards.listAlarmMappings","equipmentStandards.listChangeRequests","equipmentStandards.listMasterAlarms","equipmentStandards.status","license.getAllowedModules","license.systemState","permissions.getMyPermissions"],
  "equipment-integration": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","equipmentIntegration.integrationStatus","equipmentIntegration.status","license.getAllowedModules","license.systemState","machine.list","permissions.getMyPermissions"],
};
// R-2-x (Task 15 fix 1) — hai màn BÍ DANH đọc đúng những gì màn đích đọc (Hub / IDE): bảng canh trôi và thủ tục đã biết
// lấy theo màn đích (bảng của bí danh vốn ⊆ hợp `allTables()`; dòng cũ giữ lại trong git để đối chiếu).
PAGE_TABLES["engineering-studio"] = [...new Set([...PAGE_TABLES["engineering-studio"], ...PAGE_TABLES["engineering-home"]])].sort();
PAGE_TABLES["programming-copilot"] = [...new Set([...PAGE_TABLES["programming-copilot"], ...PAGE_TABLES["engineering"]])].sort();
KNOWN_PROCS["engineering-studio"] = [...new Set([...KNOWN_PROCS["engineering-studio"], ...KNOWN_PROCS["engineering-home"]])].sort();
KNOWN_PROCS["programming-copilot"] = [...new Set([...KNOWN_PROCS["programming-copilot"], ...KNOWN_PROCS["engineering"]])].sort();
// final wave (I-4) — tab cảnh báo của Standards là CÙNG trang: đọc đúng những gì trang Standards đọc.
PAGE_TABLES["equipment-standards-alarms"] = PAGE_TABLES["equipment-standards"];
KNOWN_PROCS["equipment-standards-alarms"] = KNOWN_PROCS["equipment-standards"];
// Đợt 3 Task 2 — Vision › Thu ảnh (trước: tab thu ảnh của Integration). Bảng: của vỏ (⊆ danh sách của Integration — giữ
// nguyên để canh trôi không hẹp đi). Thủ tục đã biết (fix round 1, review minor): CHỈ vỏ + hai thủ tục visionAdapter (trạng
// thái worker, loại nguồn — bộ nhớ server, không bảng) — trang không gọi equipmentIntegration.* nên không thừa kế chúng
// (thừa kế = nới danh sách cho phép, che một thủ tục mới không mong muốn).
PAGE_TABLES["vision-acquisition"] = PAGE_TABLES["equipment-integration"];
KNOWN_PROCS["vision-acquisition"] = [
  ...KNOWN_PROCS["equipment-integration"].filter((p) => !p.startsWith("equipmentIntegration.") && p !== "machine.list"),
  "visionAdapter.acquisitionWorkerStatus", "visionAdapter.listAcquisitionSources",
].sort();

// Đợt 3 Task 3 — Sản xuất › Ca (bước 2, trang riêng). Bảng: danh sách của Safety (đã phủ tab này ở bước 1; gồm
// operator_assignments, robots, tasks của bảng hiện trường) + `shift_configs` (thủ tục mới `shiftConfig.list`) — HỢP để không
// sót bảng (lần --discover-tables `dot3-task3/bang.json` không bắt được delta của hai bảng nhỏ này; thừa chỉ làm canh trôi nhạy
// hơn). Thủ tục đã biết: CHỈ đúng 11 thủ tục trang gọi (7 của vỏ + safety.status/listAssignments/currentBoard +
// shiftConfig.list) — không thừa kế danh sách Safety (feed/trend/collab/sourceHealth: trang này không gọi).
PAGE_TABLES["production-shifts"] = [...new Set([...PAGE_TABLES["safety-workforce"], "shift_configs"])].sort();
KNOWN_PROCS["production-shifts"] = [
  "aiInbox.count", "andon.active", "auth.me", "commandCenter.hierarchy", "license.getAllowedModules", "license.systemState",
  "permissions.getMyPermissions", "safety.currentBoard", "safety.listAssignments", "safety.status", "shiftConfig.list",
];

const DEFAULT_SIZES = [[1600, 950], [1366, 768]];

// ───────────────────────────────────────────────────────────────────────────────────────────
// 2. Pha 1 (trong trình duyệt): walk vùng của FE1 — NGUYÊN VĂN `.playwright-mcp/survey81/_driver.js`
//    để đối chiếu được; gắn `data-uim-r` lên từng vùng để pha 2 lấy lại phần tử của MAIN cũ.
// ───────────────────────────────────────────────────────────────────────────────────────────
function PHASE1() {
  const vw = innerWidth, vh = innerHeight;
  for (const e of document.querySelectorAll('[data-uim-r]')) e.removeAttribute('data-uim-r');
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none'; };
  const main = document.querySelector('main');
  const BOUND_SLOT = new Set(['card','alert','tabs','table-container','resizable-panel-group','resizable-panel','scroll-area','sheet-content','dialog-content','accordion','collapsible']);
  const BOUND_ROLE = new Set(['alert','tablist','tabpanel','region','status','grid','tree','toolbar','log','dialog','application']);
  const BOUND_TAG = new Set(['SECTION','FORM','TABLE','CANVAS','ASIDE','ARTICLE','FIELDSET']);
  const cls = (e) => (typeof e.className === 'string' ? e.className : (e.getAttribute('class') || ''));
  const isEditor = (e) => /(^|\s)(cm-editor|monaco-editor|react-flow|reactflow)(\s|$)/.test(cls(e));
  const isNoticeCls = (e) => { const c = cls(e); return /(border|bg)-(amber|yellow|warning|info|blue|orange|destructive|red|sky|primary\/|success\/|muted)/.test(c) && /(border)/.test(c) && /(rounded)/.test(c) && /(p-2|p-3|p-4|px-3|px-4|py-2|py-3)/.test(c); };
  const isBoundary = (e) => {
    if (!(e instanceof Element)) return false;
    if (BOUND_TAG.has(e.tagName)) return true;
    const sl = e.getAttribute('data-slot'); if (sl && BOUND_SLOT.has(sl)) return true;
    const ro = e.getAttribute('role'); if (ro && BOUND_ROLE.has(ro)) return true;
    if (isEditor(e)) return true;
    if (e.tagName === 'NAV') return true;
    if (isNoticeCls(e) && e.getBoundingClientRect().height < 260) return true;
    return false;
  };
  const hasBoundDesc = (e) => { for (const d of e.querySelectorAll('*')) if (isBoundary(d) && vis(d)) return true; return false; };
  const count = (e) => {
    const q = (s) => [...e.querySelectorAll(s)].filter(vis).length;
    return {
      btn: q('button,[role=button],a[data-slot=button]'),
      inp: q('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),textarea,[contenteditable=true],.cm-content'),
      tbl: q('table'),
      cnv: q('canvas,.react-flow,.reactflow') + [...e.querySelectorAll('svg')].filter(s => { const r = s.getBoundingClientRect(); return r.width > 200 && r.height > 120; }).length,
    };
  };
  const head = (e) => {
    const h = e.querySelector('h1,h2,h3,h4,[data-slot=card-title],[data-slot=alert-title],legend,caption');
    let t = h ? h.innerText : '';
    if (!t) t = (e.innerText || '').split('\n').find(x => x.trim()) || '';
    return t.trim().replace(/\s+/g, ' ').slice(0, 70);
  };
  const NOTICE_TXT = /(Khi nào dùng|Beta|xem trước|Chỉ xem|chỉ đọc|advisory|TẮT|SIMULATED|không được phép|Bạn không có quyền|Chế độ|Lưu ý|Cảnh báo|Luồng vàng|thử nghiệm|preview)/i;
  const regions = []; let id = 0;
  const push = (e, depth, parent, kind) => {
    const r = e.getBoundingClientRect(); const y = r.top + scrollY;
    const c = count(e); const txt = (e.innerText || '').trim();
    const noticeReason = (e.getAttribute('role') === 'alert' || e.getAttribute('data-slot') === 'alert') ? 'alert' : (isNoticeCls(e) && r.height < 260 && c.tbl === 0 && c.inp === 0 && c.btn <= 3 ? 'notice-style' : ((kind === 'block' && r.height < 160 && c.inp === 0 && c.tbl === 0 && NOTICE_TXT.test(txt.slice(0, 300)) && txt.length > 25) ? 'notice-text' : null));
    const o = { id: id++, parent, depth, tag: e.tagName, loc: e.getAttribute('data-loc'), kind: kind || (e.getAttribute('data-slot') || e.getAttribute('role') || e.tagName.toLowerCase()), head: head(e),
      x: Math.round(r.left), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height), ...c, notice: noticeReason };
    e.setAttribute('data-uim-r', String(o.id));
    regions.push(o); return o.id;
  };
  const walk = (el, depth, parent) => {
    for (const ch of el.children) {
      if (!vis(ch)) { if (hasBoundDesc(ch)) walk(ch, depth, parent); continue; }
      if (isBoundary(ch)) {
        const pid = push(ch, depth, parent);
        const r = ch.getBoundingClientRect();
        if (depth < 3 && (r.height > 0.45 * vh || (r.width > 0.9 * main.getBoundingClientRect().width && r.height > 250)) && hasBoundDesc(ch) && !isEditor(ch) && ch.tagName !== 'TABLE') walk(ch, depth + 1, pid);
      } else if (hasBoundDesc(ch)) {
        walk(ch, depth, parent);
      } else {
        const r = ch.getBoundingClientRect();
        if (r.height >= 16 && (ch.innerText || '').trim().length + ch.querySelectorAll('button,input,svg,canvas,img').length > 0) push(ch, depth, parent, 'block');
      }
    }
  };
  if (main) walk(main, 0, null);
  const sidebar = [...document.querySelectorAll('div,aside')].find(e => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().left === 0 && e.getBoundingClientRect().height > vh * 0.9 && e.getBoundingClientRect().width > 40 && e.getBoundingClientRect().width < 400);
  const sbW = sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0;
  const topEl = document.elementFromPoint(Math.min(vw - 5, sbW + 20), 10);
  const topbar = topEl ? (topEl.closest('header') || topEl) : null;
  const crumbs = [...document.querySelectorAll('nav[data-slot=breadcrumb],nav[aria-label*=readcrumb],[aria-label*="breadcrumb" i]')].filter(vis).map(n => ({ loc: n.getAttribute('data-loc'), y: Math.round(n.getBoundingClientRect().top + scrollY), h: Math.round(n.getBoundingClientRect().height) }));
  const mr = main ? main.getBoundingClientRect() : null;
  const scrollH = Math.max(document.scrollingElement.scrollHeight, main ? (main.scrollHeight + mr.top + scrollY) : 0);
  const spinners = [...document.querySelectorAll('.animate-spin,[data-slot=skeleton],.animate-pulse')].filter(vis).length;
  const topbarPos = topbar ? getComputedStyle(topbar).position : null;
  return {
    url: location.pathname + location.search, vw, vh, spinners,
    shell: { sidebarW: sbW, topbarH: topbar ? Math.round(topbar.getBoundingClientRect().height) : null, topbarBottom: topbar ? Math.round(topbar.getBoundingClientRect().bottom) : null, topbarPos, mainTop: mr ? Math.round(mr.top + scrollY) : null, mainW: mr ? Math.round(mr.width) : null, mainPad: main ? getComputedStyle(main).padding : null, crumbs },
    scrollH, scrollRatio: +(scrollH / vh).toFixed(2),
    regions,
    hasLayoutMainAttr: document.querySelectorAll('[data-layout-main]').length > 0,
  };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// 3. Pha 2 (trong trình duyệt): đo HÌNH HỌC quanh các phần tử MAIN đã chọn.
// ───────────────────────────────────────────────────────────────────────────────────────────
function PHASE2(arg) {
  const vw = innerWidth, vh = innerHeight;
  const OFF = new Set(arg.off || []); // gác bị TẮT có chủ đích (chỉ dùng trong --mutation để chứng minh ca tự kiểm biết ĐỎ)
  const errors = [], warnings = [];
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cls = (e) => (typeof e.className === 'string' ? e.className : (e.getAttribute('class') || ''));
  const desc = (e) => { if (!e) return null; const loc = e.getAttribute('data-loc'); return { tag: e.tagName.toLowerCase(), testid: e.getAttribute('data-testid'), loc: loc ? loc.replace(/^.*[\\/]/, '') : null, role: e.getAttribute('role'), slot: e.getAttribute('data-slot'), label: (e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50) }; };
  const isNoticeCls = (e) => { const c = cls(e); return /(border|bg)-(amber|yellow|warning|info|blue|orange|destructive|red|sky|primary\/|success\/|muted)/.test(c) && /(border)/.test(c) && /(rounded)/.test(c) && /(p-2|p-3|p-4|px-3|px-4|py-2|py-3)/.test(c); };
  const NOTICE_TXT = /(Khi nào dùng|Beta|xem trước|Chỉ xem|chỉ đọc|advisory|TẮT|SIMULATED|không được phép|Bạn không có quyền|Chế độ|Lưu ý|Cảnh báo|Luồng vàng|thử nghiệm|preview)/i;
  const KPI_SEL = '[data-loc*="MetricCard.tsx"],[data-layout-kpi]';
  // Bề mặt AI/Copilot (rộng có chủ đích; xem README): vai trò, thuộc tính, testid, tệp nguồn, nhãn
  const AI_SEL = '[role=complementary],[data-ai],[data-layout-ai],[data-testid*="copilot" i],[data-testid*="assistant" i],[data-testid*="ai-panel" i],[data-testid*="ai-chat" i],[data-loc*="Copilot" i],[data-loc*="AILocal" i],[data-loc*="Assistant" i],[aria-label*="copilot" i],[aria-label*="assistant" i],[aria-label*="trợ lý" i]';
  const unionY = (list, lo, hi) => { const iv = list.map((b) => [Math.max(b.y, lo), Math.min(b.y + b.h, hi)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]); let s = 0, cs = -1, ce = -1; for (const [a, b] of iv) { if (a > ce) { if (ce > cs) s += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); } if (ce > cs) s += ce - cs; return Math.round(s); };
  const main = document.querySelector('main');
  if (!main) errors.push('không có phần tử <main>');

  // ── MAIN ──
  let mainEls = [];
  if (arg.mode === 'attr') {
    const all = [...document.querySelectorAll('[data-layout-main]')];
    for (const e of all) if ((!main || !main.contains(e)) && !OFF.has('attrConstraint')) errors.push(`[data-layout-main] NẰM NGOÀI <main>: ${JSON.stringify(desc(e))}`);
    const inMain = all.filter((e) => main && main.contains(e) && vis(e));
    mainEls = inMain.filter((e) => !inMain.some((o) => o !== e && o.contains(e)));
    if (all.length && !mainEls.length) errors.push('[data-layout-main] có nhưng không phần tử nào nhìn thấy trong <main>');
  } else {
    mainEls = (arg.ids || []).map((id) => document.querySelector(`[data-uim-r="${id}"]`)).filter(Boolean);
    mainEls = mainEls.filter((e) => !mainEls.some((o) => o !== e && o.contains(e)));
  }
  if (!mainEls.length) errors.push('KHÔNG THẤY MAIN');
  const push = (list, msg) => (arg.mode === 'attr' ? errors : warnings).push(msg);

  // ── Cắt theo tổ tiên có overflow ≠ visible (R-2 fix2 #5) ──
  const clipInfo = (el) => {
    const r0 = el.getBoundingClientRect();
    let l = r0.left, t = r0.top, rr = r0.right, b = r0.bottom; const by = [];
    if (!OFF.has('clip')) for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      const cl = ar.left + a.clientLeft, ct = ar.top + a.clientTop, cr = cl + a.clientWidth, cb = ct + a.clientHeight;
      if (cl > l || ct > t || cr < rr || cb < b) by.push({ ...desc(a), overflow: `${s.overflowX}/${s.overflowY}` });
      l = Math.max(l, cl); t = Math.max(t, ct); rr = Math.min(rr, cr); b = Math.min(b, cb);
    }
    const w = Math.max(0, rr - l), h = Math.max(0, b - t);
    return { vr: { left: l, top: t, right: l + w, bottom: t + h, width: w, height: h }, rect: { x: Math.round(l), y: Math.round(t + scrollY), w: Math.round(w), h: Math.round(h) }, by };
  };
  const clips = mainEls.map(clipInfo);
  const mainRectsRaw = mainEls.map(R);
  const mainRects = clips.map((c) => c.rect);
  const nonEmpty = mainRects.filter((r) => r.w > 0 && r.h > 0);
  const mainTop = nonEmpty.length ? Math.min(...nonEmpty.map((r) => r.y)) : (mainRectsRaw.length ? Math.min(...mainRectsRaw.map((r) => r.y)) : null);
  const clippedBy = clips.flatMap((c) => c.by);

  // ── Ràng buộc MAIN theo MARKUP (R-2-e a) ──
  const FORBID = [
    ['h1', 'h1,[role=heading][aria-level="1"]'],
    ['page-header', '[data-loc*="PageHeader.tsx"],[data-layout-header]'],
    ['banner', '[role=alert],[data-slot=alert],[data-loc*="FeatureStatusGate.tsx"],[data-loc*="BetaBadge.tsx"],[data-layout-banner]'],
    ['kpi', KPI_SEL],
  ];
  if (!OFF.has('attrConstraint')) for (const m of mainEls) {
    for (const [kind, sel] of FORBID) {
      const isBannerBox = (e) => { const r = e.getBoundingClientRect(); return r.width >= 200 && r.height >= 24 && !e.matches('button,a,[role=button]'); };
      const hits = [...(m.matches(sel) ? [m] : []), ...m.querySelectorAll(sel)].filter(vis).filter((e) => kind !== 'banner' || isBannerBox(e));
      if (hits.length) push(errors, `MAIN chứa ${kind} ×${hits.length}: ${JSON.stringify(desc(hits[0]))}`);
    }
  }

  // ── Bề mặt AI bên TRONG MAIN (R-2 fix2 #6) ──
  const aiInside = [];
  if (!arg.aiIsWorkspace && !OFF.has('aiInside')) for (const m of mainEls) {
    const big = (e) => vis(e) && e.getBoundingClientRect().width >= 120 && e.getBoundingClientRect().height >= 120;
    const LABELS = OFF.has('aiText') ? [] : (arg.aiLabels || []).map((x) => x.toLowerCase());
    // nhãn của khối = aria-label hoặc tiêu đề đầu tiên (h1–h4/card-title) nằm trong 60 px đầu khối
    const headOf = (e) => { const a = e.getAttribute('aria-label'); if (a) return a; const h = e.querySelector('h1,h2,h3,h4,[data-slot=card-title],[role=heading]'); return h && h.getBoundingClientRect().top - e.getBoundingClientRect().top <= 60 ? h.innerText : ''; };
    const byText = LABELS.length ? [...m.querySelectorAll('div,section,aside,article,form')].filter((e) => big(e) && (() => { const t = headOf(e).toLowerCase().replace(/\s+/g, ' ').trim(); return t && LABELS.some((l) => t.includes(l)); })()) : [];
    const c = [...new Set([...m.querySelectorAll(AI_SEL), ...byText])].filter(big);
    for (const e of c) if (!c.some((o) => o !== e && o.contains(e))) aiInside.push({ el: e, ...desc(e), via: e.matches(AI_SEL) ? 'selector' : 'i18n-label', rect: clipInfo(e).rect });
  }
  const isAiEl = (e) => aiInside.some((a) => a.el === e || a.el.contains(e));

  // ── Banner / dải KPI bên TRONG MAIN, theo HÌNH HỌC (R-2 fix2 #2) ──
  // W = phần tử làm việc đầu tiên (đỉnh nhỏ nhất) trong MAIN: [data-layout-workspace], table, grid/treegrid/tree/listbox,
  // canvas, CodeMirror/Monaco, react-flow, textarea, contenteditable, svg ≥200×120 (không nằm trong bề mặt AI).
  // Khối "trên W" = con (đi xuống qua tổ tiên của W) nằm HẲN trên W. Khối trên W cao <120 px và rộng ≥60 % MAIN là
  // BANNER TRONG MAIN, trừ đúng MỘT [data-layout-toolbar] ≤48 px. Không có W ⇒ W = khối đầu tiên cao ≥120 px.
  // fix3 #1: W là phần tử làm việc GỐC (native). [data-layout-workspace] KHÔNG còn là W: bên trong nó vẫn tìm phần
  // tử gốc đầu tiên và luật banner áp cho khối phía trên phần tử đó (kể cả bên trong wrapper). W === MAIN chỉ hợp lệ
  // khi chính MAIN là phần tử gốc. EmptyState là W (trang trống).
  const hasColor = (e) => { const s = getComputedStyle(e); const bg = s.backgroundColor; return (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') || ['Top', 'Right', 'Bottom', 'Left'].some((k) => parseFloat(s['border' + k + 'Width']) > 0) || isNoticeCls(e); };
  // fix4 #1: màu/notice xét CẢ CÂY CON — wrapper trong suốt bọc chip màu / hộp notice màu / badge không được là "nhãn chữ".
  // Hậu duệ nhìn thấy có nền hay viền (kể cả badge đếm), hoặc là badge/chip/alert/status ⇒ khối MẤT miễn trừ nhãn.
  const BADGE_SEL = '[data-slot=badge],[data-loc*="Badge" i],[data-loc*="Chip" i],[role=alert],[role=status],[data-slot=alert]';
  const hasColorDeep = (e) => {
    if (hasColor(e)) return true;
    if (OFF.has('labelDeep')) return false;
    if (e.querySelector(BADGE_SEL)) return true;
    for (const d of e.querySelectorAll('*')) if (vis(d) && hasColor(d)) return true;
    return false;
  };
  const isPlainText = (e) => {
    if (e.querySelector('svg,img,button,input,select,textarea,[role=button],[role=alert]') || e.matches('[role=alert],[data-slot=alert]')) return false;
    if (hasColorDeep(e)) return false;
    return !NOTICE_TXT.test((e.innerText || '').slice(0, 300));
  };
  // hàng tiêu đề: chứa h2–h6/role=heading/card-title chiếm ≥50 % chữ của khối, icon (nếu có) chỉ trang trí
  // (aria-hidden), không nút/ô nhập/alert, bản thân khối không nền/viền ⇒ tiêu đề (vd "📥 ĐANG CHỜ DUYỆT & CẢNH BÁO 12")
  const isHeadingRow = (e) => {
    const h = e.querySelector('h2,h3,h4,h5,h6,[role=heading],[data-slot=card-title]'); if (!h) return false;
    if (e.querySelector('button,input,select,textarea,[role=button],[role=alert]') || hasColor(e)) return false;
    if ([...e.querySelectorAll('svg,img')].some((x) => x.getAttribute('aria-hidden') !== 'true')) return false;
    const tt = (e.innerText || '').trim().length; return tt > 0 && (h.innerText || '').trim().length >= 0.5 * tt;
  };
  // fix4 #2: TỔ TIÊN có kiểu notice. Chrome trả màu đã tính dạng oklch()/oklab() (theme Tailwind v4) hoặc rgb()/#hex;
  // canvas KHÔNG chuẩn hoá về rgb (đo 2026-10-02) ⇒ tự đổi về chroma OKLab. Trung tính của theme (card/border/muted/
  // secondary/accent/input) có C ≤ 0,03; màu notice (info/primary/warning/success/destructive, amber-500/10…) C ≥ 0,13.
  // Ngưỡng 0,05. Lớp Tailwind mang token màu (bg-/border-amber|red|sky|…) được nhận THẲNG theo tên lớp, không cần
  // viền+rounded+padding như regex FE1 (shade nhạt -100 có C ≈ 0,03–0,06, không tách được bằng chroma).
  const okChroma = (str) => {
    if (!str || str === 'transparent') return 0;
    let m;
    const num = (v, pct, scale) => (pct ? +v / 100 * scale : +v);
    if ((m = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)(%?)\s+(?:[\d.]+(?:deg)?|none)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/.exec(str))) { const a = m[4] == null ? 1 : num(m[4], m[5], 1); return a <= 0 ? 0 : num(m[2], m[3], 0.4); }
    if ((m = /^oklab\(\s*[\d.]+%?\s+(-?[\d.]+)(%?)\s+(-?[\d.]+)(%?)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/.exec(str))) { const a = m[5] == null ? 1 : num(m[5], m[6], 1); return a <= 0 ? 0 : Math.hypot(num(m[1], m[2], 0.4), num(m[3], m[4], 0.4)); }
    let rgb = null, alpha = 1;
    if ((m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(str))) { rgb = [+m[1], +m[2], +m[3]]; if (m[4] != null) alpha = num(m[4], m[5], 1); }
    else if ((m = /^#([0-9a-f]{3,8})$/i.exec(str))) { let h = m[1]; if (h.length <= 4) h = [...h].map((c) => c + c).join(''); rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); if (h.length === 8) alpha = parseInt(h.slice(6, 8), 16) / 255; }
    else if ((m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(str))) { rgb = [+m[1] * 255, +m[2] * 255, +m[3] * 255]; if (m[4] != null) alpha = +m[4]; }
    if (!rgb) return null; // định dạng lạ ⇒ không kết luận (các lớp nhận diện khác vẫn áp)
    if (alpha <= 0) return 0;
    const lin = (c) => { c = Math.min(255, Math.max(0, c)) / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const [R, G, B] = rgb.map(lin);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), mm = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return Math.hypot(1.9779984951 * l - 2.4285922050 * mm + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * mm - 0.8086757660 * s);
  };
  const TINT_C = 0.05;
  const tinted = (e) => { const s = getComputedStyle(e); if ((okChroma(s.backgroundColor) ?? 0) > TINT_C) return true; return ['Top', 'Right', 'Bottom', 'Left'].some((k) => parseFloat(s['border' + k + 'Width']) > 0 && (okChroma(s['border' + k + 'Color']) ?? 0) > TINT_C); };
  const COLOR_CLS = /(^|\s)(bg|border(?:-[trblxyse])?)-(amber|yellow|orange|red|rose|pink|fuchsia|purple|violet|indigo|blue|sky|cyan|teal|emerald|green|lime|warning|info|destructive|success|primary)(-|\/|\s|$)/;
  const noticeStyled = (a) => a.matches('[role=alert],[role=status],[data-slot=alert]') || isNoticeCls(a) || COLOR_CLS.test(cls(a)) || tinted(a);
  // tổ tiên từ cha của e tới (không gồm) MAIN m: hộp notice bọc ngoài ⇒ e không phải trạng thái trống
  const noticeAncestor = (e, m) => { for (let a = e.parentElement; a && a !== m && a !== main && a !== document.body; a = a.parentElement) if (noticeStyled(a)) return a; return null; };
  // trạng thái trống tự viết (không qua EmptyState): p/div ngắn, chữ mở đầu kiểu "Chưa có… / Chọn … để …", không màu, không tương tác;
  // fix4: KHÔNG có từ khoá notice trong chữ và KHÔNG nằm trong hộp notice (tổ tiên tới MAIN) — "Chưa có dữ liệu" trong hộp vàng là banner
  const EMPTY_TXT = /^(Chưa có|Không có|Hiện không có|Trống|Chọn [^\n]{0,60}(để|ở)|No |Nothing|Select [^\n]{0,60} to|暂无|没有)/i;
  const emptyLike = (e, m) => { const t = (e.innerText || '').trim(); return t.length > 0 && t.length < 160 && e.children.length <= 3 && EMPTY_TXT.test(t) && !e.querySelector('button,input,select,textarea,table,[role=alert]') && !e.matches('[role=alert],[data-slot=alert]') && !hasColor(e) && (OFF.has('emptyNotice') || (!NOTICE_TXT.test(t) && !noticeAncestor(e, m))); };
  const NATIVE_SEL = 'table,[role=grid],[role=treegrid],[role=tree],[role=listbox],canvas,.cm-editor,.monaco-editor,.react-flow,textarea,[contenteditable="true"]' + (OFF.has('emptyStateW') ? '' : ',[data-loc*="EmptyState.tsx"],[data-layout-empty]');
  const WS_SEL = OFF.has('wsEscape') ? '[data-layout-workspace],' + NATIVE_SEL : NATIVE_SEL;
  // chip KPI: ≥3 con hẹp (<50 %), cao 28–140 px, KHÔNG chứa ô nhập/chọn/nút (hàng điều khiển form không phải KPI)
  const chipRow = (e) => e.children.length >= 3 && [...e.children].every((k) => { const r = k.getBoundingClientRect(); return r.height >= (OFF.has('chipMin') ? 0 : 28) && r.height <= 140 && r.width < e.getBoundingClientRect().width * 0.5 && !k.matches('button,input,select,textarea,[role=combobox],[role=button]') && !k.querySelector('button,input,select,textarea,[role=combobox],[role=button]'); });
  const inKpiRow = (e, m) => { for (let a = e.parentElement; a && a !== m.parentElement; a = a.parentElement) { if (a.matches(KPI_SEL) || chipRow(a)) return true; } return false; };
  const inside = [];
  for (const m of mainEls) {
    const mr = m.getBoundingClientRect();
    if (!OFF.has('wsEscape') && m.hasAttribute('data-layout-workspace') && !m.matches(NATIVE_SEL)) push(errors, 'MAIN tự khai [data-layout-workspace] nhưng KHÔNG phải phần tử làm việc gốc (table/canvas/editor/EmptyState…) — W === MAIN bị từ chối');
    const svgs = [...m.querySelectorAll('svg')].filter((s) => { const r = s.getBoundingClientRect(); return r.width >= 200 && r.height >= 120 && (OFF.has('wsEscape') || !inKpiRow(s, m)); });
    const empties = OFF.has('emptyStateW') ? [] : [...m.querySelectorAll('p,div')].filter((e) => vis(e) && e.getBoundingClientRect().height >= 32 && emptyLike(e, m)).filter((e, _i, a) => !a.some((o) => o !== e && e.contains(o)));
    const cand = [...(m.matches(WS_SEL) ? [m] : []), ...m.querySelectorAll(WS_SEL), ...svgs, ...empties].filter((e) => vis(e) && !isAiEl(e));
    let W = null; for (const e of cand) if (!W || e.getBoundingClientRect().top < W.getBoundingClientRect().top - 0.5) W = e;
    const blocks = []; let stop = false;
    const Wtop = () => W.getBoundingClientRect().top;
    const walkIn = (el) => {
      for (const ch of el.children) {
        if (stop) return;
        if (ch === W) { stop = true; return; }
        const st = getComputedStyle(ch);
        if (st.display === 'none' || st.position === 'fixed') continue;
        if (W && ch.contains(W)) { walkIn(ch); continue; }
        if (isAiEl(ch)) continue;
        const r = ch.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) { if (st.display === 'contents' || ch.children.length) walkIn(ch); continue; }
        if (!vis(ch)) continue;
        if (W) { if (r.bottom > Wtop() + 1) continue; } // không nằm HẲN trên W (bên cạnh / dưới)
        else if (r.height >= 120) { W = ch; stop = true; return; }
        // tiêu đề thuần (h2–h6 / role=heading / card-title) ≤40 px không phải banner
        if (r.height <= 40 && ch.matches('h2,h3,h4,h5,h6,[role=heading],[data-slot=card-title]')) { blocks.push({ ...R(ch), kind: 'heading', ...desc(ch) }); continue; }
        const tb = ch.hasAttribute('data-layout-toolbar');
        const kpi = ch.matches(KPI_SEL) || !!ch.querySelector(KPI_SEL) || chipRow(ch);
        const stripGeo = r.height < 120 && r.width >= 0.6 * mr.width;
        // fix4 #1: dải KPI / hàng chip được phân loại TRƯỚC miễn trừ nhãn — hàng 32 px chip trong wrapper trong suốt
        // (kể cả chip không màu) là kpi-strip, không bao giờ là "label"
        if (!OFF.has('kpiFirst') && !tb && kpi && stripGeo) { blocks.push({ ...R(ch), kind: 'kpi-strip', ...desc(ch) }); continue; }
        // R-2-f: khối CHỮ THUẦN ≤40 px không kiểu notice (cả CÂY CON không có nền màu / viền / badge / icon svg|img,
        // không có nút/ô nhập, chữ không chứa từ khoá notice) ⇒ nhãn, không phải banner
        if (!OFF.has('textLabel') && r.height <= 40 && isPlainText(ch)) { blocks.push({ ...R(ch), kind: 'label', ...desc(ch) }); continue; }
        if (!OFF.has('textLabel') && r.height <= 40 && isHeadingRow(ch)) { blocks.push({ ...R(ch), kind: 'heading', ...desc(ch) }); continue; }
        const kind = tb ? 'toolbar' : stripGeo ? (kpi ? 'kpi-strip' : 'banner') : 'other';
        blocks.push({ ...R(ch), kind, ...desc(ch) });
      }
    };
    walkIn(m);
    if (W && !W.matches(NATIVE_SEL) && !empties.includes(W) && !svgs.includes(W) && !OFF.has('wsEscape')) {
      // W dự phòng (khối ≥120 px không phải phần tử gốc): xét tiếp các khối dẫn đầu bên trong nó
      const W0 = W; W = null; stop = false; walkIn(W0); if (!W) W = W0;
    }
    const top0 = mr.top;
    const banners = blocks.filter((b) => b.kind === 'banner' || b.kind === 'kpi-strip');
    const toolbars = blocks.filter((b) => b.kind === 'toolbar');
    const aboveW = W ? Math.max(0, Math.round(W.getBoundingClientRect().top - top0)) : unionY(blocks, -1e9, 1e9);
    inside.push({ workspace: W ? { ...desc(W), kind: W.matches(NATIVE_SEL) ? 'native' : empties.includes(W) ? 'empty-state' : svgs.includes(W) ? 'chart' : 'fallback-block', top: Math.round(W.getBoundingClientRect().top + scrollY) } : null, aboveWorkspacePx: aboveW, banners: banners.length, bannerPx: unionY(banners, -1e9, 1e9), toolbars: toolbars.map((t) => t.h), blocks, wsTopAbs: W ? W.getBoundingClientRect().top + scrollY : null });
    if (!OFF.has('insideMain')) {
      if (banners.length) push(errors, `BANNER/DẢI KPI TRONG MAIN ×${banners.length} (khối trên phần tử làm việc, <120 px, ≥60 % bề rộng MAIN): ${JSON.stringify(banners.map((b) => ({ kind: b.kind, h: b.h, loc: b.loc, label: b.label })))}`);
      if (toolbars.length > 1) push(errors, `MAIN có ${toolbars.length} [data-layout-toolbar] (tối đa 1)`);
      const TB_MAX = OFF.has('toolbar56') ? 48 : 56;
      for (const t of toolbars) if (t.h > TB_MAX) push(errors, `[data-layout-toolbar] cao ${t.h} px (> ${TB_MAX})`);
    }
  }

  // ── h1 + page header ──
  const h1s = [...document.querySelectorAll('main h1')].filter(vis);
  const h1 = h1s[0] || [...document.querySelectorAll('h1')].filter(vis)[0] || null;
  const h1r = h1 ? R(h1) : null;
  if (!h1) warnings.push('trang KHÔNG có h1 nhìn thấy — dải "trước MAIN" tính từ đỉnh <main>');
  let h1Header = null;
  if (h1) {
    for (let n = h1; n && n !== main && n !== document.body; n = n.parentElement) if (n.matches('[data-loc*="PageHeader.tsx"],[data-layout-header],header')) h1Header = n;
    if (h1Header && mainEls.some((m) => h1Header.contains(m))) { errors.push('page header của h1 CHỨA MAIN'); h1Header = null; }
  }

  // ── Khối phía trên MAIN (R-2-e b) ──
  const contentTop = main ? R(main).y : 0;
  const holdsKey = (e) => mainEls.some((m) => e.contains(m)) || (h1 && e.contains(h1));
  const blocks = [];
  const mainX0 = mainEls.length ? Math.min(...mainEls.map((m) => m.getBoundingClientRect().left)) : 0;
  const mainX1 = mainEls.length ? Math.max(...mainEls.map((m) => m.getBoundingClientRect().right)) : vw;
  const walk = (el) => {
    for (const ch of el.children) {
      if (ch === h1 || mainEls.includes(ch)) continue;
      if (holdsKey(ch)) { walk(ch); continue; }
      const st = getComputedStyle(ch);
      if (st.position === 'fixed') continue; // lớp phủ — xem overlay dưới và coverMain
      const r = ch.getBoundingClientRect();
      if (!vis(ch)) { if (ch.children.length && st.display !== 'none') walk(ch); continue; }
      const top = r.top + scrollY, bot = r.bottom + scrollY;
      if (mainTop == null || bot > mainTop + 1) continue;
      const xOverlap = r.left < mainX1 && r.right > mainX0;
      const pos = !xOverlap ? 'besideMain' : (!h1r ? 'belowH1' : (bot <= h1r.y + 1 ? 'aboveH1' : (top >= h1r.y + h1r.h - 1 ? 'belowH1' : 'besideH1')));
      const txt = (ch.innerText || '').trim();
      const fe1Notice = ch.getAttribute('role') === 'alert' || ch.getAttribute('data-slot') === 'alert' || isNoticeCls(ch) || NOTICE_TXT.test(txt.slice(0, 300));
      const inHeader = !!(h1Header && h1Header.contains(ch));
      const isKpi = ch.matches(KPI_SEL) || !!ch.querySelector(KPI_SEL);
      const isTabs = r.height <= 64 && (ch.matches('[role=tablist]') || !!ch.querySelector('[role=tablist]'));
      const isCrumb = ch.matches('nav[data-slot=breadcrumb],nav[aria-label*=readcrumb],[aria-label*="breadcrumb" i]') || (!!ch.querySelector('nav[data-slot=breadcrumb],nav[aria-label*=readcrumb]') && (ch.innerText || '').length < 200 && r.height <= 48);
      const kind = isCrumb ? 'breadcrumb' : isKpi ? 'kpi' : isTabs ? 'tabs' : fe1Notice ? 'notice' : (inHeader && ch.tagName === 'P') ? 'subtitle' : 'other';
      blocks.push({ ...R(ch), pos, kind, inHeader, ...desc(ch), fe1Notice });
    }
  };
  if (main) walk(main);
  // Popover/portal mở sẵn đè lên dải đầu trang (ngoài <main>, fixed/absolute, không phải vỏ, không phải AI) ⇒ banner
  if (main && mainTop != null && !OFF.has('overlayBand')) {
    const mr = main.getBoundingClientRect();
    const bandTop = arg.clipTop || 0, bandBot = mainTop - scrollY;
    const shellOf = (e) => e.closest('[data-sidebar],[data-slot=sidebar],aside') || (e.closest('header') && e.closest('header').getBoundingClientRect().top <= 0);
    const ov = [];
    for (const e of document.body.querySelectorAll('*')) {
      if (e.contains(main) || mainEls.some((m) => m.contains(e) || e.contains(m))) continue;
      const s = getComputedStyle(e);
      // ngoài <main>: fixed/absolute; TRONG <main>: chỉ fixed (absolute trong <main> đã nằm trong walk luồng)
      if (main.contains(e) ? (s.position !== 'fixed' || OFF.has('fixedInMain')) : (s.position !== 'fixed' && s.position !== 'absolute')) continue;
      if (!vis(e) || shellOf(e) || e.matches(AI_SEL) || e.closest(AI_SEL)) continue;
      const r = e.getBoundingClientRect();
      const ix = Math.min(r.right, mr.right) - Math.max(r.left, mr.left), iy = Math.min(r.bottom, bandBot) - Math.max(r.top, bandTop);
      if (ix < 8 || iy < 8) continue;
      if (ov.some((o) => o.el.contains(e))) continue;
      ov.push({ el: e });
    }
    for (const o of ov) blocks.push({ ...R(o.el), pos: 'overlay', kind: 'overlay', inHeader: false, ...desc(o.el), fe1Notice: false });
  }
  const bandLo = h1r ? h1r.y + h1r.h : contentTop;
  // fix2 #3: khối trong page header nằm dưới đáy h1 CŨNG là banner (không còn miễn trừ header)
  // fix3: khối phía TRÊN h1 cũng tính (banner Beta…), trừ breadcrumb (đếm riêng ở `breadcrumbs`)
  const before = blocks.filter((b) => b.pos === 'overlay' || (b.pos === 'belowH1' && (OFF.has('headerBanner') ? !b.inHeader : true)) || (b.pos === 'aboveH1' && b.kind !== 'breadcrumb' && !OFF.has('aboveH1Banner')));
  const aboveH1 = blocks.filter((b) => b.pos === 'aboveH1' && !b.inHeader);
  const headerParts = blocks.filter((b) => b.inHeader);

  // ── KPI (R-2-e c): cả hai nguồn, luôn luôn ──
  const top = (els) => els.filter(vis).filter((e, _i, a) => !a.some((o) => o !== e && o.contains(e)));
  const kpiLegacyEls = top([...document.querySelectorAll('main [data-loc*="MetricCard.tsx"]')]);
  const kpiOfficialEls = OFF.has('kpiBoth') ? [] : top([...document.querySelectorAll('main [data-layout-kpi]')]);
  const kpiAll = top([...kpiLegacyEls, ...kpiOfficialEls]);
  const strip = (els) => els.length ? unionY(els.map(R), -1e9, 1e9) : 0;

  // ── Che MAIN (R-2-e d): hit-test lưới trên phần ĐÃ CẮT của MAIN ──
  const STEP = 8;
  const clipTop = arg.clipTop || 0;
  const vr = clips.map((c) => c.vr).filter((r) => r.width > 0 && r.height > 0);
  let pts = 0, cov = 0, sepPts = 0; const culprits = new Map();
  // R-2-m (Task 5 fix 1): separator co giãn của chính bố cục (vd đường kéo panel dưới của WorkbenchShell) có dải
  // "hit" (::after) lấn 1–2 px vào MAIN — không phải lớp phủ. CHỈ miễn điểm khi phần tử trúng LÀ separator (không leo
  // tổ tiên), nằm trong luồng (static/relative), hộp riêng mỏng ≤2 px, là anh em của MAIN (cha chứa MAIN), và điểm cách
  // hộp ≤4 px. Điểm miễn báo riêng ở `separatorHitPx` (không gác). `--mutation` tắt được (gác `separatorExempt`).
  const sepExempt = (el, x, y) => {
    if (OFF.has('separatorExempt')) return false;
    if (!el.matches('[data-panel-resize-handle-id][role=separator]')) return false;
    const pos = getComputedStyle(el).position;
    if (pos !== 'static' && pos !== 'relative') return false;
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) > 2) return false;
    if (!el.parentElement || !mainEls.some((m) => el.parentElement.contains(m))) return false;
    const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
    return Math.hypot(dx, dy) <= 4;
  };
  if (vr.length && !OFF.has('hitTest')) {
    const x0 = Math.max(0, Math.min(...vr.map((r) => r.left))), x1 = Math.min(vw, Math.max(...vr.map((r) => r.right)));
    const y0 = Math.max(clipTop, Math.min(...vr.map((r) => r.top))), y1 = Math.min(vh, Math.max(...vr.map((r) => r.bottom)));
    for (let y = Math.floor(y0 / STEP) * STEP + STEP / 2; y < y1; y += STEP) {
      for (let x = Math.floor(x0 / STEP) * STEP + STEP / 2; x < x1; x += STEP) {
        if (y < clipTop || !vr.some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom)) continue;
        pts++;
        const el = document.elementFromPoint(x, y);
        if (!el || mainEls.some((m) => el.contains(m))) continue;
        const host = mainEls.find((m) => m.contains(el));
        if (host) {
          // fix3: phần tử position:fixed nằm TRONG MAIN vẫn là lớp phủ (thoát khỏi luồng của MAIN)
          let fx = null; if (!OFF.has('fixedInMain')) for (let n = el; n && n !== host; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') fx = n;
          if (!fx) continue;
          cov++;
          const k = culprits.get(fx) || { ...desc(fx), position: 'fixed', zIndex: getComputedStyle(fx).zIndex, rect: R(fx), px: 0, insideMain: true };
          k.px += STEP * STEP; culprits.set(fx, k); continue;
        }
        if (sepExempt(el, x, y)) { sepPts++; continue; }
        cov++;
        let n = el, outer = el, posEl = null;
        while (n && n !== document.body && !mainEls.some((m) => n.contains(m))) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'absolute' || p === 'sticky') posEl = n; outer = n; n = n.parentElement; }
        const c = posEl || outer;
        const k = culprits.get(c) || { ...desc(c), position: getComputedStyle(c).position, zIndex: getComputedStyle(c).zIndex, rect: R(c), px: 0 };
        k.px += STEP * STEP; culprits.set(c, k);
      }
    }
  }
  const positioned = [];
  if (vr.length) {
    for (const e of document.querySelectorAll('body *')) {
      const s = getComputedStyle(e);
      if (s.position !== 'fixed' && s.position !== 'absolute' && s.position !== 'sticky') continue;
      if (mainEls.some((m) => m.contains(e) || e.contains(m)) || !vis(e)) continue;
      if (positioned.some((p) => p.el.contains(e))) continue;
      const r = e.getBoundingClientRect();
      let a = 0; for (const m of vr) { const ix = Math.min(r.right, m.right, vw) - Math.max(r.left, m.left, 0), iy = Math.min(r.bottom, m.bottom, vh) - Math.max(r.top, m.top, clipTop); if (ix > 0 && iy > 0) a += ix * iy; }
      if (a > 0) positioned.push({ el: e, ...desc(e), position: s.position, zIndex: s.zIndex, pointerEvents: s.pointerEvents, intersectPx: Math.round(a) });
    }
  }

  // ── Chiều cao trang: tài liệu + phần cuộn/ẩn của tổ tiên MAIN + container cuộn/ẩn ANH EM (fix2 #7) ──
  const SCROLLY = OFF.has('scrollAncestors') ? /(auto|scroll|overlay)/ : /(auto|scroll|overlay|hidden|clip)/;
  const docH = Math.max(document.scrollingElement.scrollHeight, main ? (main.scrollHeight + R(main).y) : 0);
  const scrollers = []; let extra = 0;
  const ancestors = new Set();
  if (mainEls[0]) for (let a = mainEls[0].parentElement; a && a !== main && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    ancestors.add(a);
    const s = getComputedStyle(a);
    if (SCROLLY.test(s.overflowY) && a.scrollHeight > a.clientHeight + 24) { extra += a.scrollHeight - a.clientHeight; scrollers.push({ ...desc(a), rel: 'ancestor', overflowY: s.overflowY, scrollH: a.scrollHeight, clientH: a.clientHeight }); }
  }
  let sib = 0;
  if (main && !OFF.has('siblingReport')) for (const d of main.querySelectorAll('*')) {
    if (ancestors.has(d) || mainEls.some((m) => m.contains(d) || d.contains(m))) continue;
    if (scrollers.some((x) => x.el && x.el.contains(d))) continue;
    const s = getComputedStyle(d);
    if (!/(auto|scroll|overlay|hidden|clip)/.test(s.overflowY) || d.clientHeight <= 40 || d.scrollHeight <= d.clientHeight + 24 || !vis(d)) continue;
    const ex = d.scrollHeight - d.clientHeight; sib = Math.max(sib, ex);
    scrollers.push({ el: d, ...desc(d), rel: 'sibling', overflowY: s.overflowY, scrollH: d.scrollHeight, clientH: d.clientHeight });
  }
  // R-2-f: panel anh em tự cuộn (explorer/inspector) là bình thường ⇒ CHỈ BÁO `siblingScrollExtra`, không gác
  const inner = [];
  for (const m of mainEls) for (const d of [m, ...m.querySelectorAll('*')]) { const s = getComputedStyle(d); if (/(auto|scroll|overlay|hidden|clip)/.test(s.overflowY) && d.scrollHeight > d.clientHeight + 24 && d.clientHeight > 40) inner.push({ ...desc(d), overflowY: s.overflowY, scrollH: d.scrollHeight, clientH: d.clientHeight, ratio: +(d.scrollHeight / d.clientHeight).toFixed(2) }); }
  inner.sort((a, b) => b.ratio - a.ratio);

  const dialogs = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(vis).map((e) => ({ role: e.getAttribute('role'), slot: e.getAttribute('data-slot'), ...R(e) }));
  // final wave (R-2-z1 / I-4) — Ràng buộc 10 "không có thanh cuộn ngang ở 1366": cuộn ngang CẤP TRANG = tài liệu hoặc
  // <main> của shell (container cuộn của trang) rộng hơn khung. Cuộn ngang BÊN TRONG một ô (bảng tự cuộn) không tính.
  const se = document.scrollingElement;
  const hDoc = Math.max(0, se.scrollWidth - se.clientWidth);
  const mainSX = main ? getComputedStyle(main).overflowX : 'visible';
  const hMain = main && /(auto|scroll|overlay)/.test(mainSX) ? Math.max(0, main.scrollWidth - main.clientWidth) : 0;
  return {
    hScroll: { docOverflowPx: hDoc, mainOverflowPx: hMain, mainOverflowX: mainSX },
    errors, warnings, mainCount: mainEls.length, mainRects, mainRectsRaw, clippedBy, mainTop,
    attrSel: arg.mode === 'attr' ? mainEls.map((e) => `${e.tagName.toLowerCase()}[data-layout-main="${e.getAttribute('data-layout-main')}"]@${(e.getAttribute('data-loc') || '').replace(/^.*[\\/]/, '').replace(/:\d+$/, '')}`).sort().join('|') : null,
    inside, aiInside: aiInside.map(({ el, ...rest }) => rest),
    h1: h1 ? { top: Math.round(h1.getBoundingClientRect().top), bottom: Math.round(h1.getBoundingClientRect().bottom), text: h1.innerText.replace(/\s+/g, ' ').slice(0, 60), inPageHeader: !!h1Header } : null, h1Count: h1s.length,
    band: { lo: Math.round(bandLo), before: { count: before.length, unionPx: unionY(before, -1e9, mainTop ?? 0), byKind: before.reduce((o, b) => { o[b.kind] = (o[b.kind] || 0) + 1; return o; }, {}) }, aboveH1: { count: aboveH1.length, unionPx: unionY(aboveH1, contentTop, h1r ? h1r.y : contentTop) }, headerParts: headerParts.length, blocks },
    kpi: { legacy: { count: kpiLegacyEls.length, stripPx: strip(kpiLegacyEls) }, official: { count: kpiOfficialEls.length, stripPx: strip(kpiOfficialEls) }, all: { count: kpiAll.length, stripPx: strip(kpiAll) } },
    cover: { step: STEP, points: pts, coveredPoints: cov, px: cov * STEP * STEP, separatorHitPx: sepPts * STEP * STEP, items: [...culprits.values()].sort((a, b) => b.px - a.px), positionedIntersecting: positioned.map(({ el, ...rest }) => rest) },
    scroll: { docH, extra, siblingScrollExtra: sib, scrollers: scrollers.map(({ el, ...rest }) => rest), inner: inner.slice(0, 3) },
    dialogs,
  };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// 4. Rút gọn (node)
// ───────────────────────────────────────────────────────────────────────────────────────────
/** Diện tích HỢP các hình chữ nhật trong [0,vw]×[clipTop,vh] (nén toạ độ — không cộng trùng). */
export function unionArea(rects, vw, vh, clipTop) {
  const rs = rects.map((r) => [Math.max(r.x, 0), Math.max(r.y, clipTop), Math.min(r.x + r.w, vw), Math.min(r.y + r.h, vh)]).filter(([a, b, c, d]) => c > a && d > b);
  if (!rs.length) return 0;
  const xs = [...new Set(rs.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  let s = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i], xb = xs[i + 1];
    const iv = rs.filter((r) => r[0] <= xa && r[2] >= xb).map((r) => [r[1], r[3]]).sort((p, q) => p[0] - q[0]);
    let len = 0, cs = -1, ce = -1;
    for (const [a, b] of iv) { if (a > ce) { if (ce > cs) len += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); }
    if (ce > cs) len += ce - cs;
    s += len * (xb - xa);
  }
  return s;
}
const BAD_NOTICE_KINDS = ["button", "a", "select-trigger", "input", "popover-trigger", "textarea", "combobox"];
function legacyIds(screen, regions) {
  const L = screen.legacyMain;
  return (L.pick ? L.pick(regions) : regions.filter(L.fn)).map((r) => r.id);
}
const interRect = (a, b) => { const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h); return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null; };
/** Gác tắt có chủ đích (chỉ --mutation): tên gác → ca tự kiểm phải ĐỎ khi gác bị gỡ. */
const OFF = new Set();
export const GUARDS = {
  geoBand: ["T01-banner-long-sau"], hitTest: ["T02-lop-phu-fixed"], kpiBoth: ["T03-kpi-hai-nguon"], attrConstraint: ["T04-attribute-vi-pham"], actionNotFound: ["T05-hanh-dong-ma"],
  calib: ["T06-hieu-chuan"], insideMain: ["T07-banner-trong-main", "T08-kpi-trong-main"], headerBanner: ["T09-banner-trong-header"], noDialog: ["T10-nut-chet", "T10b-panel-inline"],
  clip: ["T11-cat-overflow"], aiInside: ["T12-ai-trong-main"], overlayBand: ["T13-portal-dai-dau"], dialogsAtLoad: ["T14-dialog-luc-nap"], errHash: ["T16-bam-loi"],
  // fix round 3
  scrollAncestors: ["T15-to-tien-an"], siblingReport: ["T15b-anh-em-chi-bao"], wsEscape: ["T17-wrapper-workspace", "T17b-main-la-workspace"], h1Gate: ["T18-mat-h1"],
  aboveH1Banner: ["T19-banner-tren-h1"], fixedInMain: ["T20-fixed-trong-main"], textLabel: ["T21-nhan-chu-thuan"], aiText: ["T22-ai-theo-nhan-i18n"],
  toolbar56: ["T23-toolbar-56"], chipMin: ["T24-chip-thap"], emptyStateW: ["T25-emptystate-la-W"],
  // fix round 4
  kpiFirst: ["T26-chip-trong-wrapper"], labelDeep: ["T27-wrapper-notice-mau"], emptyNotice: ["T28-trong-trong-notice"],
  // Task 5 fix round 1 (R-2-m)
  separatorExempt: ["T29a-separator-anh-em-mien"],
  // final wave (R-2-z1 / I-4)
  hScroll: ["T30-cuon-ngang-trang"], copilotAssert: ["T31-copilot-phai-hien"], tabCalib: ["T32-hieu-chuan-tab"],
};
/** Dung sai hiệu chuẩn (fix2 #1): MAIN theo attribute so với MAIN tham chiếu (selector FE1, lưu trong baseline). */
export const CALIB_TOL = { px: 4, areaPct: 3 };

export function summarize(screen, variant, p1, p2, legacyP2, opts = {}) {
  const { vw, vh } = p1;
  const mode = p1.hasLayoutMainAttr ? "data-layout-main" : "fe1-legacy";
  const clipTop = p1.shell.topbarPos === "sticky" || p1.shell.topbarPos === "fixed" ? (p1.shell.topbarBottom ?? 0) : 0;
  const mainArea = unionArea(p2.mainRects, vw, vh, clipTop);
  // vùng LÀM VIỆC = MAIN (đã cắt) từ đỉnh phần tử làm việc trở xuống, TRỪ bề mặt AI bên trong MAIN
  const wsRects = p2.mainRects.map((r, i) => { const ins = p2.inside[i]; if (!ins || ins.wsTopAbs == null) return r; const y = Math.max(r.y, Math.round(ins.wsTopAbs)); return { x: r.x, y, w: r.w, h: Math.max(0, r.y + r.h - y) }; });
  const aiRects = p2.aiInside.map((a) => a.rect);
  const aiInWs = [], aiInMain = []; for (const a of aiRects) { for (const w of wsRects) { const i = interRect(a, w); if (i) aiInWs.push(i); } for (const m of p2.mainRects) { const i = interRect(a, m); if (i) aiInMain.push(i); } }
  const aiPx = unionArea(aiInWs, vw, vh, clipTop);
  const aiMainPx = unionArea(aiInMain, vw, vh, clipTop);
  const wsArea = Math.max(0, unionArea(wsRects, vw, vh, clipTop) - aiPx);
  const fe1Notices = p1.regions.filter((r) => r.notice && !BAD_NOTICE_KINDS.includes(r.kind) && !/-trigger$/.test(r.kind) && r.tag !== "BUTTON" && r.tag !== "A" && r.depth === 0 && !/PageHeader/.test(r.loc || ""));
  const fe1Before = p2.mainTop == null ? fe1Notices : fe1Notices.filter((n) => n.y < p2.mainTop);
  const errors = [...p2.errors], warnings = [...p2.warnings];
  if (mode === "fe1-legacy") warnings.push("CHƯA có [data-layout-main] — đo bằng selector FE1");
  const geo = !OFF.has("geoBand");
  const banners = geo ? { count: p2.band.before.count, px: p2.band.before.unionPx, byKind: p2.band.before.byKind } : { count: fe1Before.length, px: fe1Before.reduce((s, n) => s + n.h, 0), byKind: {} };
  const rec = {
    screen: screen.id, route: screen.route, vw, vh, variant,
    mainSource: mode, missingDataLayoutMain: mode !== "data-layout-main",
    mainSelector: mode === "data-layout-main" ? "[data-layout-main]" : screen.legacyMain.desc,
    mainFound: p2.mainCount > 0, mainRects: p2.mainRects, mainRectsRaw: p2.mainRectsRaw, clippedBy: p2.clippedBy, mainTop: p2.mainTop,
    chromeAboveMain: p2.mainTop,
    mainPct: +(mainArea / (vw * vh) * 100).toFixed(1),
    workspacePct: +(wsArea / (vw * vh) * 100).toFixed(1),
    mainPctFe1: +(unionArea(p2.mainRects, vw, vh, 109) / (vw * vh) * 100).toFixed(1),
    mainPctUncovered: +(Math.max(0, mainArea - p2.cover.px) / (vw * vh) * 100).toFixed(1),
    insideMain: p2.inside.map(({ wsTopAbs, ...rest }) => rest),
    aiInsideMain: { px: aiMainPx, inWorkspacePx: aiPx, pctOfViewport: +(aiMainPx / (vw * vh) * 100).toFixed(1), items: p2.aiInside },
    h1Top: p2.h1 ? p2.h1.top : null, h1Bottom: p2.h1 ? p2.h1.bottom : null, h1Text: p2.h1 ? p2.h1.text : null, h1Missing: !p2.h1, h1Count: p2.h1Count,
    gapH1ToMain: p2.h1 && p2.mainTop != null ? p2.mainTop - p2.h1.bottom : null,
    breadcrumbs: p1.shell.crumbs.length,
    bannersBeforeMain: { ...banners, method: geo ? (p2.h1 ? "geometric: khối giữa đáy h1 và đỉnh MAIN (kể cả trong page header) + popover/portal đè dải đầu" : "geometric: khối giữa đỉnh <main> và đỉnh MAIN (không có h1)") : "FE1-class (gác geoBand TẮT)" },
    blocksAboveH1: p2.band.aboveH1, headerParts: p2.band.headerParts,
    bandBlocks: p2.band.blocks.map((b) => ({ pos: b.pos, kind: b.kind, inHeader: b.inHeader, y: b.y, h: b.h, x: b.x, w: b.w, loc: b.loc, tag: b.tag, testid: b.testid, label: b.label, fe1Notice: b.fe1Notice })),
    bannersFe1Class: { count: fe1Before.length, px: fe1Before.reduce((s, n) => s + n.h, 0), items: fe1Before.map((n) => ({ loc: (n.loc || "").replace(/^.*[\\/]/, ""), y: n.y, h: n.h, head: n.head.slice(0, 50) })) },
    kpi: p2.kpi,
    coverMain: { px: p2.cover.px, separatorHitPx: p2.cover.separatorHitPx ?? 0, pctOfMain: mainArea ? +(p2.cover.px / mainArea * 100).toFixed(1) : 0, pctOfViewport: +(p2.cover.px / (vw * vh) * 100).toFixed(1), items: p2.cover.items, positionedIntersecting: p2.cover.positionedIntersecting },
    pageHeightRatio: +((p2.scroll.docH + p2.scroll.extra) / vh).toFixed(2), pageHeightRatioDoc: p1.scrollRatio, scroll: p2.scroll,
    shell: { sidebarW: p1.shell.sidebarW, topbarH: p1.shell.topbarH, mainTop: p1.shell.mainTop, mainW: p1.shell.mainW, mainPad: p1.shell.mainPad, breadcrumbLocs: p1.shell.crumbs.map((c) => (c.loc || "").replace(/^.*[\\/]/, "")) },
    dialogsAtLoad: { count: p2.dialogs.length, kinds: p2.dialogs.map(dialogKind) },
    hScroll: p2.hScroll,
    spinnersAtMeasure: p1.spinners,
    errors, warnings,
  };
  // fix2 #7: dialog/sheet mở sẵn lúc nạp = LỖI
  if (p2.dialogs.length && !OFF.has("dialogsAtLoad")) errors.push(`${p2.dialogs.length} dialog/sheet MỞ SẴN lúc nạp: ${JSON.stringify(rec.dialogsAtLoad.kinds)}`);
  // final wave (R-2-z1): Ràng buộc 10 — cuộn ngang cấp trang ở khung ≥1366 px = LỖI (dưới 1366 chỉ báo trong `hScroll`).
  const hPx = Math.max(p2.hScroll?.docOverflowPx ?? 0, p2.hScroll?.mainOverflowPx ?? 0);
  if (vw >= 1366 && hPx > 1 && !OFF.has("hScroll")) errors.push(`CUỘN NGANG CẤP TRANG ${hPx} px ở ${vw} px (tài liệu ${p2.hScroll.docOverflowPx} px, <main> ${p2.hScroll.mainOverflowPx} px) — Ràng buộc 10`);
  // Tham chiếu MAIN theo selector FE1 (luôn ghi khi selector FE1 còn tìm thấy) — lưu trong baseline cho cổng hiệu chuẩn
  const lp = legacyP2 || (mode === "fe1-legacy" ? p2 : null);
  if (lp && lp.mainCount) rec.legacyRef = { mainTop: lp.mainTop, rects: lp.mainRects, areaPx: unionArea(lp.mainRects, 1e6, 1e6, -1e6), hadH1: !!p2.h1 };
  // fix3: trang CÓ h1 ở baseline mà nay mất h1 ⇒ LỖI (Studio không có h1 ở baseline ⇒ miễn)
  // final wave (T1 minor): màn KHÔNG có tham chiếu riêng (tab `tabOf`, bí danh `calibrateAs`) dùng tham chiếu h1 của màn
  // mẹ/đích (`opts.h1Ref`) ⇒ cổng h1 không còn tắt chỉ vì thiếu legacyRef.
  const h1Ref = opts.ref || opts.h1Ref;
  if (h1Ref && h1Ref.hadH1 && !p2.h1 && !OFF.has("h1Gate")) errors.push("MẤT h1: trang có h1 ở baseline nhưng nay không có h1 nhìn thấy");
  rec.attrSel = p2.attrSel;
  // fix2 #1: CỔNG HIỆU CHUẨN khi trang có data-layout-main
  if (mode === "data-layout-main" && !OFF.has("calib")) {
    // R-2-x — màn BÍ DANH (route cũ đã gộp) so với bản ghi của màn đích; vẫn là cổng cứng (lệch ⇒ LỖI), không tự ghi.
    const key = screen.calibrateAs ? `${screen.calibrateAs.id}|${vw}|${screen.calibrateAs.variant}` : `${screen.id}|${vw}|${variant}`;
    const ref = opts.ref; const cal = opts.calibrations && opts.calibrations[key];
    const area = unionArea(p2.mainRects, 1e6, 1e6, -1e6);
    const cmp = (r) => { const dTop = Math.abs(p2.mainTop - r.mainTop), dArea = r.areaPx ? Math.abs(area - r.areaPx) / r.areaPx * 100 : 100; const dLeft = Math.abs(Math.min(...p2.mainRects.map((x) => x.x)) - Math.min(...r.rects.map((x) => x.x))); return { dTop, dLeft, dAreaPct: +dArea.toFixed(2), ok: dTop <= CALIB_TOL.px && dLeft <= CALIB_TOL.px && dArea <= CALIB_TOL.areaPct }; };
    if (cal) {
      // fix3: bản ghi theo (màn, vw, biến thể) — so LẠI mỗi lần chạy: hình học ±4 px/3 % VÀ đúng phần tử mang attribute
      const c = cmp(cal); const selOk = cal.attrSel === p2.attrSel;
      rec.calibration = { status: c.ok && selOk ? "recorded-match" : "RECORD-MISMATCH", ...c, selOk, record: { mainTop: cal.mainTop, areaPx: cal.areaPx, attrSel: cal.attrSel, gitHead: cal.gitHead } };
      if (!(c.ok && selOk)) errors.push(`HIỆU CHUẨN LỆCH BẢN GHI (${key}): Δtop ${c.dTop} px, Δleft ${c.dLeft} px, Δdiện tích ${c.dAreaPct} %${selOk ? "" : `, phần tử mang attribute đổi: "${cal.attrSel}" → "${p2.attrSel}"`} — đổi bản ghi phải chạy --calibrate (calibration.json được commit, thay đổi hiện trong git)`);
    }
    else if (screen.tabOf) {
      // final wave (R-2-z1): TAB của một trang đã hiệu chuẩn — chưa có bản ghi riêng ⇒ chỉ chấp nhận khi attribute nằm
      // TRÊN ĐÚNG phần tử đã hiệu chuẩn của trang mẹ (không có tham chiếu hình học FE1 cho tab này). Ghi bản ghi bằng --calibrate.
      const parent = opts.calibrations && opts.calibrations[`${screen.tabOf}|${vw}|${variant}`];
      const same = !!parent && parent.attrSel === p2.attrSel;
      if (same || OFF.has("tabCalib")) { rec.calibration = { status: "matches-reference", refKind: "parent-element", parentAttrSel: parent?.attrSel ?? null }; warnings.push(`hiệu chuẩn tab: attribute trên đúng phần tử của ${screen.tabOf} nhưng CHƯA có bản ghi cho ${key} — chạy --calibrate và commit calibration.json`); }
      else { rec.calibration = { status: "MISMATCH", refKind: "parent-element", parentAttrSel: parent?.attrSel ?? null }; errors.push(`HIỆU CHUẨN TAB: ${parent ? `attribute của tab nằm trên phần tử khác trang mẹ ("${parent.attrSel}" ≠ "${p2.attrSel}")` : `trang mẹ ${screen.tabOf}@${vw}/${variant} chưa có bản ghi hiệu chuẩn`}`); }
    }
    else if (!ref) { rec.calibration = { status: "no-reference" }; errors.push(`HIỆU CHUẨN: trang có [data-layout-main] nhưng không có tham chiếu FE1 trong baseline cho ${screen.id}@${vw}/${variant}`); }
    else {
      const dTop = Math.abs(p2.mainTop - ref.mainTop), dArea = ref.areaPx ? Math.abs(area - ref.areaPx) / ref.areaPx * 100 : 100;
      const dLeft = Math.abs(Math.min(...p2.mainRects.map((r) => r.x)) - Math.min(...ref.rects.map((r) => r.x)));
      const ok = dTop <= CALIB_TOL.px && dLeft <= CALIB_TOL.px && dArea <= CALIB_TOL.areaPct;
      rec.calibration = { status: ok ? "matches-reference" : "MISMATCH", dTop, dLeft, dAreaPct: +dArea.toFixed(2), ref: { mainTop: ref.mainTop, areaPx: ref.areaPx } };
      if (ok) warnings.push(`hiệu chuẩn: khớp tham chiếu FE1 nhưng CHƯA có bản ghi cho ${key} — chạy --calibrate và commit calibration.json`);
      if (!ok) errors.push(`HIỆU CHUẨN TRƯỢT: [data-layout-main] lệch MAIN tham chiếu FE1 (Δtop ${dTop} px, Δleft ${dLeft} px, Δdiện tích ${dArea.toFixed(1)} %; dung sai ${CALIB_TOL.px} px / ${CALIB_TOL.areaPct} %) và chưa có bản ghi trong calibration.json — gắn attribute trên bố cục CHƯA đổi rồi chạy --calibrate`);
    }
  }
  return rec;
}
/**
 * final wave (R-2-z1 / I-4) — biến thể Copilot PHẢI có thật: trước đây biến thể "open" chỉ đặt khoá localStorage, không ai
 * kiểm Copilot có hiện không (bản ghi open/closed của IR/POU giống từng byte). Đầu dò trong trang: bề mặt `[data-layout-ai]`
 * nhìn thấy (≥120×120) chứa tabpanel Copilot (`[role=tabpanel][id$="-copilot"]`, không `hidden`, cao >0).
 */
function COPILOT_PROBE() {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width >= 4 && r.height >= 4 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const surfaces = [...document.querySelectorAll('[data-layout-ai]')].filter((e) => { const r = e.getBoundingClientRect(); return vis(e) && r.width >= 120 && r.height >= 120; });
  const panels = surfaces.flatMap((a) => [...a.querySelectorAll('[role=tabpanel][id$="-copilot"]')]).filter((p) => !p.hidden && vis(p));
  return { rendered: panels.length > 0, surfaces: surfaces.length, panelIds: panels.map((p) => p.id) };
}
export function copilotCheck(rec, probe, expected) {
  rec.copilot = { expected, ...probe };
  if (OFF.has("copilotAssert")) return;
  if (expected === "open" && !probe.rendered) rec.errors.push("BIẾN THỂ COPILOT MỞ nhưng KHÔNG thấy panel Copilot trong layout ([data-layout-ai] chứa tabpanel *-copilot) — số đo của biến thể này không đo Copilot");
  if (expected === "closed" && probe.rendered) rec.errors.push("BIẾN THỂ COPILOT ĐÓNG nhưng panel Copilot đang hiện — hạt giống trạng thái không có tác dụng");
}
function dialogKind(d) {
  const s = d.slot || "";
  if (/sheet/.test(s)) return "sheet";
  if (/drawer/.test(s)) return "drawer";
  if (/alert-dialog/.test(s) || d.role === "alertdialog") return "alert-dialog";
  if (/popover/.test(s)) return "popover";
  if (/dialog/.test(s)) return "dialog";
  if (d.role === "menu" || d.role === "listbox") return d.role;
  return `unknown(${d.role})`;
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// 5. Instance tự dựng: _test DB, server tsx :3016, Vite dev :5176
// ───────────────────────────────────────────────────────────────────────────────────────────
const TEST_DB = "aoi_management_test";
const PROBE_OPENID = "ui-metrics-engineer";
const PROBE_USER = "uim_engineer";

function readEnvKey(key) {
  const f = path.join(REPO, ".env");
  if (!fs.existsSync(f)) return undefined;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i < 0 || t.slice(0, i).trim() !== key) continue;
    return t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}
/** URL DB _test: UIM_TEST_DATABASE_URL, hoặc DATABASE_URL của .env (chỉ ĐỌC chuỗi) đổi tên DB thành aoi_management_test. Tên khác ⇒ từ chối. */
export function testDatabaseUrl() {
  let u;
  if (process.env.UIM_TEST_DATABASE_URL) u = new URL(process.env.UIM_TEST_DATABASE_URL);
  else { const dev = readEnvKey("DATABASE_URL"); if (!dev) throw new Error("Không có DATABASE_URL trong .env và không có UIM_TEST_DATABASE_URL"); u = new URL(dev); u.pathname = "/" + TEST_DB; }
  if (u.pathname !== "/" + TEST_DB) throw new Error(`Từ chối: DB đo phải là ${TEST_DB}, nhận ${u.pathname}`);
  return u.toString();
}
async function withTestDb(fn) {
  const postgres = require("postgres");
  const sql = postgres(testDatabaseUrl(), { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    const [{ db }] = await sql`select current_database() as db`;
    if (db !== TEST_DB) throw new Error(`Từ chối: current_database()=${db}`);
    return await fn(sql);
  } finally { await sql.end({ timeout: 5 }); }
}
function engineerTemplatePerms() {
  const src = fs.readFileSync(path.join(REPO, "server/routers/permissionsRouter.ts"), "utf8");
  const start = src.indexOf("\n  engineer: [");
  if (start < 0) throw new Error("Không tìm thấy DEFAULT_ROLE_PERMISSIONS.engineer");
  const from = src.indexOf("[", start); let depth = 0, i = from;
  for (; i < src.length; i++) { if (src[i] === "[") depth++; else if (src[i] === "]") { depth--; if (depth === 0) break; } }
  // dữ liệu tĩnh của repo (object literal) — cùng cách scripts/seed-test-data.mjs
  return Function(`"use strict"; return ([${src.slice(from + 1, i)}])`)();
}
async function deleteProbeUser(sql) {
  const rows = await sql`select id from users where "openId" = ${PROBE_OPENID}`;
  let deleted = 0, deactivated = 0;
  for (const { id } of rows) {
    await sql`delete from permissions where "userId" = ${id}`;
    await sql`delete from user_factory_assignments where "userId" = ${id}`;
    await sql`delete from user_sessions where "userId" = ${id}`.catch(() => {});
    await sql`delete from user_secrets where "userId" = ${id}`;
    try { await sql`delete from users where id = ${id}`; deleted++; }
    catch { await sql`update users set "isActive" = false where id = ${id}`; deactivated++; }
  }
  return { deleted, deactivated };
}
async function createProbeUser() {
  const bcrypt = require("bcryptjs");
  const password = "Uim!" + crypto.randomBytes(12).toString("hex");
  const hash = await bcrypt.hash(password, 10);
  const perms = engineerTemplatePerms();
  return withTestDb(async (sql) => {
    const stale = await deleteProbeUser(sql);
    return sql.begin(async (tx) => {
      const [u] = await tx`insert into users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
        values (${PROBE_OPENID}, ${PROBE_USER}, 'UI metrics engineer', 'password', 'engineer', true, false, now()) returning id`;
      await tx`insert into user_secrets ("userId", "passwordHash", "updatedAt") values (${u.id}, ${hash}, now())`;
      for (const p of perms) {
        await tx`insert into permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport")
          values (${u.id}, ${p.category}, ${p.moduleName}, ${!!p.canView}, ${!!p.canCreate}, ${!!p.canEdit}, ${!!p.canDelete}, ${!!p.canExport})`;
      }
      const fac = await tx`select code from factories where code = 'SIM-FAC' limit 1`;
      if (fac.length) await tx`insert into user_factory_assignments ("userId", "factoryCode") values (${u.id}, 'SIM-FAC')`;
      return { userId: u.id, username: PROBE_USER, password, perms: perms.length, factory: fac.length ? "SIM-FAC" : null, staleRemoved: stale };
    });
  });
}

/** Băm nội dung bảng: md5 từng hàng (hoặc các cột chỉ định), sắp theo md5 — không cần khoá chính. */
async function dataSnapshot(tables) {
  return withTestDb(async (sql) => {
    const o = {};
    for (const t of tables) {
      const cols = TABLE_COLS[t];
      const ex = TABLE_EXCLUDE_COLS[t];
      const rowExpr = cols ? `md5(row(${cols.map((c) => `t."${c}"`).join(",")})::text)` : ex ? `md5((to_jsonb(t) ${ex.map((c) => `- '${c}'`).join(" ")})::text)` : "md5(t::text)";
      try {
        const where = TABLE_WHERE[t] ? ` where ${TABLE_WHERE[t]}` : "";
        const [r] = await sql.unsafe(`select count(*)::int n, md5(coalesce(string_agg(${rowExpr}, ',' order by ${rowExpr}), '')) h from "${t}" t${where}`);
        o[t] = `${r.n}:${r.h.slice(0, 12)}`;
      } catch (e) { o[t] = `ERR:${e.message.slice(0, 60)}`; }
    }
    return o;
  });
}
function diffSnap(a = {}, b = {}) {
  const d = {};
  for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[t] !== b[t]) d[t] = [a[t] ?? null, b[t] ?? null];
  return d;
}
/** Bộ đếm lượt quét theo BẢNG public; chunk TimescaleDB quy về hypertable của nó; bỏ catalog nội bộ. */
async function scanStats() {
  return withTestDb(async (sql) => {
    const chunkOf = new Map();
    try { for (const r of await sql`select chunk_schema || '.' || chunk_name k, hypertable_name h from timescaledb_information.chunks`) chunkOf.set(r.k, r.h); } catch { /* không có timescale */ }
    try { for (const r of await sql`select c.schema_name || '.' || c.table_name k, h.table_name h from _timescaledb_catalog.chunk c join _timescaledb_catalog.hypertable ch on ch.id = c.hypertable_id join _timescaledb_catalog.hypertable h on h.compressed_hypertable_id = ch.id`) chunkOf.set(r.k, r.h); } catch { /* chunk nén */ }
    const o = {};
    for (const r of await sql`select schemaname, relname, (seq_scan + coalesce(idx_scan, 0))::bigint s from pg_stat_user_tables`) {
      const k = r.schemaname === "public" ? r.relname : chunkOf.get(`${r.schemaname}.${r.relname}`);
      if (!k) continue;
      o[k] = (o[k] || 0) + Number(r.s);
    }
    return o;
  });
}

function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(true));
    s.once("listening", () => s.close(() => resolve(false)));
    s.listen(port, "0.0.0.0");
  }).then((busy) => busy || new Promise((resolve) => {
    const c = net.connect({ port, host: "127.0.0.1" });
    c.once("connect", () => { c.destroy(); resolve(true); });
    c.once("error", () => resolve(false));
    c.setTimeout(1000, () => { c.destroy(); resolve(false); });
  }));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Hồ sơ cờ (R-2-d). `dev` (mặc định, hồ sơ NGHIỆM THU): cờ GIAO DIỆN bật như `.env` dev; mọi actuation /
 * ra ngoài TẮT. `off`: mọi thứ tắt (ca phụ — trang khi cờ tắt). Không cờ nào ở đây khởi tác vụ nền khi
 * ROLE=api (sweeper fleet/sạc nằm ở backgroundJobs, chỉ chạy khi ROLE ≠ api).
 */
export const UI_FLAGS_DEV = ["FOE_ENABLED", "DPC_IR_V2_ENABLED", "WORKFORCE_ENABLED", "SAFETY_AUDIT_ENABLED", "EQ_GOVERN_ENABLED", "EQ_INTEG_ENABLED", "FLEET_ORCH_ENABLED", "FLEET_RESOURCE_ENABLED"];
const ALWAYS_OFF = {
  DPC_DEPLOY_ENABLED: "false", SAFETY_PLC_ADAPTER_ENABLED: "false", ALERT_EVALUATOR_ENABLED: "false", AI_ORCHESTRATION_ENABLED: "false", AI_ORCHESTRATION_ADVISOR_ENABLED: "false",
  MQTT_ENABLED: "false", MQTT_PORT: "51883", MQTT_WS_PORT: "51884", EXTERNAL_MQTT_ENABLED: "false",
  UNS_BRIDGE_ENABLED: "false", UNS_SPARKPLUG_ENABLED: "false", UNS_BROKER_URL: "mqtt://127.0.0.1:9", SPARKPLUG_COMMAND_ENABLED: "false", UNS_TOPIC_V2_ENABLED: "false",
  OT_CONTROL_ENABLED: "false", OT_STORE_FORWARD_ENABLED: "false", OT_CONN_HA_ENABLED: "false", ROBOT_GATEWAY_ENABLED: "false", ROBOT_CONTROL_ENABLED: "false", OPCUA_GATEWAY_ENABLED: "false", ROS2_BRIDGE_ENABLED: "false",
  SIM_OT_TELEMETRY_ENABLED: "false", SIM_KINEMATIC_ENABLED: "false", EDGE_RUNTIME_ENABLED: "false", SECS_GEM_ENABLED: "false", MTCONNECT_ENABLED: "false", VDA5050_ENABLED: "false",
  LLAMA_SERVER_ENABLED: "false", ENABLE_GPU: "false", GGUF_WARM_DEEP_MODEL_ON_BOOT: "false", PROG_KB_ENABLED: "false", KB_AUTOSYNC_ENABLED: "false", HOT_FOLDER_INGEST_ENABLED: "false",
  WEBHOOKS_ENABLED: "false", OTEL_ENABLED: "false", TWIN_LIVE_ENABLED: "false", TWIN_STREAM_ENABLED: "false", STREAM_TELEMETRY_TAP_ENABLED: "false", OPENAI_GATEWAY_ENABLED: "false",
  // doc 81 Đợt 3 final wave (Task 2) — `warmUpOllamaModels()` (registerAiLocalKnowledgeRoutes, lúc khởi động) LUÔN bắn một
  // POST làm ấm Ollama tới OLLAMA_BASE_URL (mặc định 127.0.0.1:11434), không cờ nào tắt được; Task 2 đo được MỘT kết nối
  // Established tới :11434 ngay sau khởi động (f1-sau-1.json ⇒ pass=false). Hồ sơ đo trỏ nó vào cổng ĐÓNG (như
  // UNS_BROKER_URL) ⇒ không tiến trình Ollama nào được chạm; bộ canh kết nối KHÔNG đổi (vẫn bắt mọi kết nối ngoài danh sách).
  OLLAMA_BASE_URL: "http://127.0.0.1:9",
};
/** Env của tiến trình server đo: KHÔNG kế thừa env cha (ngoài biến hệ thống), KHÔNG nạp .env. */
function serverEnv(port, logDir, flags) {
  const keep = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "COMSPEC", "PATHEXT", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "HOME"];
  const env = {};
  for (const k of keep) if (process.env[k] != null) env[k] = process.env[k];
  Object.assign(env, {
    DOTENV_CONFIG_PATH: path.join(logDir, "khong-ton-tai.env"),
    DATABASE_URL: testDatabaseUrl(),
    PORT: String(port), ROLE: "api",
    JWT_SECRET: "uim-" + crypto.randomBytes(32).toString("hex"),
    LICENSE_BYPASS: "true", AUTH_2FA_BAT_BUOC: "0", VITE_APP_ID: "ui-metrics",
  }, ALWAYS_OFF);
  for (const f of UI_FLAGS_DEV) env[f] = flags === "dev" ? "true" : "false";
  return env;
}

async function startServer(port, logDir, flags) {
  if (await portBusy(port)) throw new Error(`Cổng ${port} đang bận — không đo (server sẽ tự nhảy cổng khác).`);
  const log = fs.openSync(path.join(logDir, "server.log"), "w");
  const child = spawn(process.execPath, [path.join(REPO, "node_modules/tsx/dist/cli.mjs"), "server/_core/index.ts"], { cwd: REPO, env: serverEnv(port, logDir, flags), stdio: ["ignore", log, log], windowsHide: true });
  const t0 = Date.now();
  while (Date.now() - t0 < 240_000) {
    if (child.exitCode != null) throw new Error(`Server thoát sớm (mã ${child.exitCode}) — xem ${path.join(logDir, "server.log")}`);
    const txt = fs.readFileSync(path.join(logDir, "server.log"), "utf8");
    const m = /Server running on https?:\/\/localhost:(\d+)/.exec(txt);
    if (m) {
      if (Number(m[1]) !== port) { killTree(child.pid); throw new Error(`Server nghe cổng ${m[1]} thay vì ${port}`); }
      return { child, bootMs: Date.now() - t0 };
    }
    await sleep(1000);
  }
  killTree(child.pid);
  throw new Error("Server không lên sau 240 s");
}
function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch { /* đã chết */ }
}
/**
 * Lấy mẫu kết nối mạng của CẢ cây tiến trình server (Windows: Get-NetTCPConnection/UDP). Cho phép: nghe
 * :serverPort; TCP tới 127.0.0.1:5434 (Postgres _test); TCP vào :serverPort từ loopback (Vite proxy).
 * Mọi thứ khác ⇒ vi phạm.
 */
function sampleConnections(rootPid, serverPort, label) {
  if (process.platform !== "win32") return { label, skipped: "chỉ hỗ trợ Windows" };
  const ps = `$root=${Number(rootPid)}; $all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; $ids=@($root); $added=$true; while($added){ $added=$false; foreach($p in $all){ if(($ids -contains $p.ParentProcessId) -and -not ($ids -contains $p.ProcessId)){ $ids+=$p.ProcessId; $added=$true } } }; $t=@(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess } | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess); $u=@(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess } | Select-Object LocalAddress,LocalPort,OwningProcess); @{ids=$ids; tcp=$t; udp=$u} | ConvertTo-Json -Depth 4 -Compress`;
  try {
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", timeout: 60_000 });
    const j = JSON.parse(raw);
    const tcp = [].concat(j.tcp || []).map((c) => ({ l: `${c.LocalAddress}:${c.LocalPort}`, r: `${c.RemoteAddress}:${c.RemotePort}`, s: String(c.State), lp: c.LocalPort, rp: c.RemotePort, ra: c.RemoteAddress }));
    const loop = (a) => a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
    const stateName = (s) => ({ 2: "Listen", 5: "Established", 3: "SynSent", 11: "TimeWait", 8: "CloseWait", 6: "FinWait1", 7: "FinWait2", 1: "Closed", 9: "Closing", 10: "LastAck", 4: "SynReceived", 100: "Bound" })[s] || s;
    const viol = [];
    for (const c of tcp) {
      const st = stateName(c.s);
      if (st === "Listen") { if (c.lp !== serverPort) viol.push({ ...c, st, why: "nghe cổng lạ" }); continue; }
      if (st === "Bound" || st === "TimeWait") continue;
      if (c.rp === 5434 && loop(c.ra)) continue;
      if (c.lp === serverPort && loop(c.ra)) continue;
      viol.push({ ...c, st, why: "kết nối ngoài danh sách cho phép" });
    }
    const udp = [].concat(j.udp || []).map((u) => `${u.LocalAddress}:${u.LocalPort}`);
    const summary = {};
    for (const c of tcp) { const st = stateName(c.s); const k = st === "Listen" ? `Listen ${c.l}` : `${st} → ${c.r === `0.0.0.0:0` ? "-" : (c.lp === serverPort ? `vào :${serverPort} từ ${c.ra}` : c.r)}`; summary[k] = (summary[k] || 0) + 1; }
    return { label, pids: [].concat(j.ids || []), tcp: summary, udp, violations: viol };
  } catch (e) { return { label, error: e.message.slice(0, 200) }; }
}
async function startVite(vitePort, serverPort) {
  if (await portBusy(vitePort)) throw new Error(`Cổng ${vitePort} đang bận`);
  const { createServer } = await import("vite");
  const cacheDir = path.join(os.tmpdir(), "aoi-ui-metrics-vite-cache"); // ngoài node_modules
  const target = `http://127.0.0.1:${serverPort}`;
  const server = await createServer({
    configFile: path.join(REPO, "vite.config.ts"),
    cacheDir, logLevel: "warn", clearScreen: false,
    server: { port: vitePort, strictPort: true, host: "127.0.0.1", hmr: false,
      fs: { strict: true, allow: [REPO, cacheDir] },
      proxy: { "/api": { target, ws: true, changeOrigin: false }, "/uploads": { target } } },
  });
  await server.listen();
  return server;
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// 6. Đo bằng Playwright
// ───────────────────────────────────────────────────────────────────────────────────────────
async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  let clean = 0;
  for (let i = 0; i < 40 && clean < 3; i++) {
    const n = await page.evaluate(() => { const v = (e) => { const r = e.getBoundingClientRect(); return r.width > 6 && r.height > 6; }; const m = document.querySelector('main'); const t = m ? m.innerText : ''; return [...document.querySelectorAll('main .animate-spin, main [data-slot=skeleton], main .animate-pulse')].filter(v).length + (/(Đang tải|Loading)/.test(t) ? 1 : 0) + (m ? 0 : 1); });
    clean = n === 0 ? clean + 1 : 0;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);
}
async function countDialogs(page) {
  return page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width >= 4 && r.height >= 4 && s.visibility !== 'hidden' && s.display !== 'none'; };
    return [...document.querySelectorAll('[role=dialog],[role=alertdialog],[role=menu],[role=listbox]')].filter(vis).filter((e) => e.getAttribute('role') === 'dialog' || e.getAttribute('role') === 'alertdialog' || !e.closest('main')).map((e) => { const r = e.getBoundingClientRect(); return { role: e.getAttribute('role'), slot: e.getAttribute('data-slot'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
  });
}
const geomSig = (r) => JSON.stringify([r.mainTop, r.mainRects, r.scroll.docH, r.scroll.extra, r.bandBlocks.map((b) => [b.y, b.h]), r.insideMain.map((i) => [i.aboveWorkspacePx, i.blocks.length]), r.pageHeightRatio]);
/**
 * Hành động KHAI BÁO: không tìm thấy = LỖI; disabled = cảnh báo; có dialog/sheet ⇒ ghi LOẠI; KHÔNG có dialog
 * ⇒ đo lại: không đổi hình học = LỖI (nút chết / đổi tên lén), đổi hình học = panel `inline` (cao bao nhiêu,
 * đẩy MAIN bao nhiêu). `ctx.before` = bản đo trang ngay trước khi bấm.
 */
async function runActions(page, actions, ctx = {}) {
  const out = [];
  for (const a of actions || []) {
    const btn = page.locator("main").getByRole("button", { name: a.label }).first();
    const rec = { id: a.id, label: String(a.label) };
    if (!(await btn.count())) { out.push(OFF.has("actionNotFound") ? { ...rec, status: "skipped" } : { ...rec, status: "not-found", error: `hành động khai báo "${a.id}" KHÔNG TÌM THẤY` }); continue; }
    if (!(await btn.isEnabled())) { out.push({ ...rec, status: "disabled" }); continue; }
    const url = page.url();
    await btn.click();
    await page.waitForTimeout(700);
    const ds = await countDialogs(page);
    if (ds.length || OFF.has("noDialog")) {
      rec.status = "opened"; rec.dialogs = ds.length; rec.kinds = ds.map(dialogKind); rec.rects = ds;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      rec.closedByEsc = (await countDialogs(page)).length === 0;
      if (!rec.closedByEsc) { await page.goto(url); await settle(page); }
      out.push(rec); continue;
    }
    const after = ctx.before && ctx.s ? await measurePage(page, ctx.s, ctx.variant, ctx.opts) : null;
    if (!after || geomSig(after) === geomSig(ctx.before)) {
      out.push({ ...rec, status: "no-effect", dialogs: 0, kinds: [], error: `hành động "${a.id}": bấm xong KHÔNG có dialog/sheet và KHÔNG đổi hình học` });
    } else {
      const old = new Set(ctx.before.bandBlocks.map((b) => `${b.loc}|${b.h}`));
      const fresh = after.bandBlocks.filter((b) => !old.has(`${b.loc}|${b.h}`));
      const panelH = Math.max(0, after.scroll.docH - ctx.before.scroll.docH, ...fresh.map((b) => b.h));
      out.push({ ...rec, status: "inline", dialogs: 0, kinds: ["inline"], inlineHeight: panelH, pushesMainPx: Math.max(0, (after.mainTop ?? 0) - (ctx.before.mainTop ?? 0)), newBlocks: fresh.slice(0, 3).map((b) => ({ loc: b.loc, h: b.h, label: b.label })) });
    }
    await page.goto(url); await settle(page); await page.evaluate(() => window.scrollTo(0, 0));
  }
  return out;
}
async function measurePage(page, s, variant, opts = {}) {
  const p1 = await page.evaluate(PHASE1);
  const clipTop = p1.shell.topbarPos === "sticky" || p1.shell.topbarPos === "fixed" ? (p1.shell.topbarBottom ?? 0) : 0;
  const ids = legacyIds(s, p1.regions);
  const common = { clipTop, off: [...OFF], aiIsWorkspace: !!s.aiIsWorkspace, aiLabels: aiLabels() };
  const p2 = await page.evaluate(PHASE2, p1.hasLayoutMainAttr ? { mode: "attr", ...common } : { mode: "legacy", ids, ...common });
  const legacyP2 = p1.hasLayoutMainAttr && ids.length ? await page.evaluate(PHASE2, { mode: "legacy", ids, ...common }) : null;
  return summarize(s, variant, p1, p2, legacyP2, opts);
}
async function resolveRoute(ctx, base, s) {
  if (s.deepLink !== "firstProject") return s.route;
  const res = await ctx.request.get(base + "/api/trpc/programming.listProjects");
  const body = await res.json().catch(() => null);
  const data = body?.result?.data?.json ?? body?.result?.data;
  const first = Array.isArray(data) && data.length ? data[0] : null;
  if (!first) { console.log(`[uim] ${s.id}: không có dự án nào ⇒ đo không chọn dự án (editor sẽ không hiện)`); return s.route; }
  return `${s.route}?projectId=${first.id}`;
}
/**
 * Nhãn AI/Copilot lấy từ i18n (vi/en/zh): mọi chuỗi ≤40 ký tự chứa copilot/trợ lý/assistant/副驾/助手 (không phải câu,
 * không có tham số). Khối ≥120×120 trong MAIN có aria-label/tiêu đề chứa một nhãn ⇒ bề mặt AI (bổ sung cho AI_SEL).
 */
let _aiLabels = null;
function aiLabels() {
  if (_aiLabels) return _aiLabels;
  const set = new Set();
  for (const l of ["vi", "en", "zh"]) {
    try {
      const walk = (o) => { for (const v of Object.values(o)) { if (v && typeof v === "object") walk(v); else if (typeof v === "string") { const t = v.trim(); if (t.length >= 4 && t.length <= 40 && /(copilot|trợ lý|assistant|副驾|助手)/i.test(t) && !/[{}]/.test(t) && !/[.?!…:。？！：]$/.test(t)) set.add(t); } } };
      walk(JSON.parse(fs.readFileSync(path.join(REPO, `client/src/i18n/locales/${l}.json`), "utf8")));
    } catch { /* thiếu tệp ⇒ chỉ còn AI_SEL */ }
  }
  return (_aiLabels = [...set]);
}
/** Lỗi băm dữ liệu (`ERR:`) ⇒ lần chạy trượt (fix2 #7). */
function dataErrors(snap) {
  if (OFF.has("errHash")) return [];
  return Object.entries(snap || {}).filter(([, v]) => String(v).startsWith("ERR")).map(([t, v]) => `băm bảng ${t} lỗi: ${v}`);
}

/**
 * ĐỐI CHỨNG DƯƠNG (MSA), đi qua ĐÚNG đường đo thật (measurePage / runActions / dataErrors): trên ECN @1600,
 * mỗi ca chèn một cách lách vào DOM của trang nạp lại sạch ⇒ thiết bị PHẢI bắt. `--mutation` gỡ từng gác
 * (GUARDS) và chứng minh ca tương ứng ĐỎ.
 */
async function selfTest(page, base, s, only = null) {
  const checks = [];
  const want = (name) => !only || only.includes(name);
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, ...detail });
  // Task 4 (doc 81 Đợt 2): các ca được thiết kế trên ECN CHƯA gắn attribute (MAIN theo selector FE1). Khi chính trang ECN
  // đã gắn `data-layout-main` (Task 4 là trang đầu tiên), attribute có sẵn làm MAIN lồng ⇒ ca T06 "attribute đặt lên tbody"
  // bị nuốt (phần tử lồng trong MAIN khác không tính) và tự kiểm đỏ OAN. Nên mỗi lần nạp lại sạch thì gỡ attribute của trang:
  // tự kiểm luôn chạy trên đúng điều kiện nó được thiết kế (đo thật của trang KHÔNG đi qua hàm này).
  const fresh = async () => { await page.goto(base + s.route); await settle(page); await page.evaluate(() => { for (const e of document.querySelectorAll('[data-layout-main]')) e.removeAttribute('data-layout-main'); window.scrollTo(0, 0); }); };
  // fix4: phép đo trong tự kiểm phải THẤY MAIN. Nếu selector FE1 không thấy MAIN đúng lúc đo (trang đang vẽ lại bảng ⇒
  // che = 0, không thấy cả bong bóng AI — r9-A 2026-10-02 13:01Z, T02 after=0, ca đỏ oan) thì chờ settle rồi đo lại, tối đa
  // 3 lần; số lần ghi ở `retries` (0 là bình thường). CHỈ xét "không thấy MAIN": MAIN bị cắt còn rect 0 (T15) là trạng thái hợp lệ.
  let retries = 0;
  const mp = async (pg, sc, variant, opts) => { let b; for (let i = 0; i < 3; i++) { b = await measurePage(pg, sc, variant, opts); if (b.mainFound) return b; retries++; await settle(pg); } return b; };
  // chạy mã trong trang với T = phần tử MAIN cũ (selector FE1), A = nhánh tổ tiên cao nhất của T không chứa h1
  const inPage = async (body) => {
    const p1 = await page.evaluate(PHASE1);
    const rid = legacyIds(s, p1.regions)[0];
    return page.evaluate(`(() => { const main = document.querySelector('main'); const h1 = document.querySelector('main h1');
      const T = document.querySelector('[data-uim-r="${rid}"]');
      let A = T; while (A.parentElement && A.parentElement !== main && !(h1 && A.parentElement.contains(h1))) A = A.parentElement;
      let H = null; for (let n = h1; n && n !== main; n = n.parentElement) if (n.matches('[data-loc*="PageHeader.tsx"],[data-layout-header],header')) H = n;
      const mk = (cls, h, txt) => { const d = document.createElement('div'); if (cls) d.className = cls; d.style.height = h + 'px'; d.textContent = txt || ''; return d; };
      ${body} })()`);
  };
  await fresh();
  const b0 = await mp(page, s, "selftest");
  const ref0 = b0.legacyRef;
  const NOTICE = "rounded-lg border border-amber-500/40 bg-amber-500/10 px-5 py-4";
  if (want("T01-banner-long-sau")) {
    await inPage(`const w = document.createElement('div'), w2 = document.createElement('div'); w2.appendChild(mk('${NOTICE}', 100, 'Lưu ý: UIM tự kiểm')); w.appendChild(w2); A.parentElement.insertBefore(w, A);`);
    const b = await mp(page, s, "selftest");
    check("T01-banner-long-sau", b.bannersBeforeMain.count === b0.bannersBeforeMain.count + 1 && b.bannersBeforeMain.px >= b0.bannersBeforeMain.px + 100 && b.chromeAboveMain >= b0.chromeAboveMain + 100, { before: [b0.bannersBeforeMain.count, b0.bannersBeforeMain.px, b0.chromeAboveMain], after: [b.bannersBeforeMain.count, b.bannersBeforeMain.px, b.chromeAboveMain], fe1Class: [b0.bannersFe1Class.count, b.bannersFe1Class.count] });
    await fresh();
  }
  if (want("T02-lop-phu-fixed")) {
    const r = b0.mainRects[0];
    await page.evaluate((rc) => { const d = document.createElement('div'); d.setAttribute('data-testid', 'uim-overlay'); d.style.cssText = `position:fixed;z-index:9999;left:${rc.x + 40}px;top:${Math.min(rc.y + 40, innerHeight - 220)}px;width:200px;height:200px;background:rgba(255,0,0,.3)`; document.body.appendChild(d); }, r);
    const b = await mp(page, s, "selftest");
    check("T02-lop-phu-fixed", b.coverMain.px >= b0.coverMain.px + 0.9 * 40000 && b.coverMain.items.some((i) => i.testid === "uim-overlay"), { before: b0.coverMain.px, after: b.coverMain.px, mainFound: b.mainFound, mainRects: b.mainRects, errors: b.errors.slice(0, 2) });
    await fresh();
  }
  if (want("T03-kpi-hai-nguon")) {
    await inPage(`const d = mk('', 32, 'KPI'); d.setAttribute('data-layout-kpi', ''); d.style.width = '120px'; A.parentElement.insertBefore(d, A);`);
    const b = await mp(page, s, "selftest");
    check("T03-kpi-hai-nguon", b.kpi.official.count === b0.kpi.official.count + 1 && b.kpi.legacy.count === b0.kpi.legacy.count, { before: b0.kpi.official.count, after: b.kpi.official.count });
    await fresh();
  }
  if (want("T04-attribute-vi-pham")) {
    await page.evaluate(() => { const h1 = document.querySelector('main h1'); let a = h1; while (a.parentElement && a.parentElement !== document.querySelector('main')) a = a.parentElement; a.setAttribute('data-layout-main', 'uim-test'); const o = document.createElement('div'); o.setAttribute('data-layout-main', 'ngoai'); o.style.cssText = 'height:20px;width:20px'; document.body.appendChild(o); });
    const b = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    check("T04-attribute-vi-pham", b.errors.some((e) => /chứa h1/.test(e)) && b.errors.some((e) => /NGOÀI <main>/.test(e)), { errors: b.errors.slice(0, 3) });
    await fresh();
  }
  if (want("T05-hanh-dong-ma")) {
    const acts = await runActions(page, [{ id: "uim-ma", label: /__khong_ton_tai_uim__/ }], { s, variant: "selftest", before: b0 });
    check("T05-hanh-dong-ma", acts[0].status === "not-found" && !!acts[0].error, { got: acts[0].status });
    await fresh();
  }
  if (want("T06-hieu-chuan")) {
    await inPage(`T.setAttribute('data-layout-main', 'dung');`);
    const ok = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    await fresh();
    await inPage(`(T.querySelector('tbody') || T.firstElementChild).setAttribute('data-layout-main', 'lech');`);
    const bad = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    await fresh();
    // bản ghi theo khoá (màn|vw|biến thể): khớp ⇒ recorded-match; cùng hình học nhưng attribute ở phần tử KHÁC ⇒ LỖI
    const key = `${s.id}|1600|selftest`;
    const rec = { mainTop: ok.mainTop, rects: ok.mainRects, areaPx: unionArea(ok.mainRects, 1e6, 1e6, -1e6), attrSel: ok.attrSel };
    await inPage(`T.setAttribute('data-layout-main', 'dung');`);
    const okRec = await mp(page, s, "selftest", { ref: ref0, calibrations: { [key]: rec } });
    const movedSel = await mp(page, s, "selftest", { ref: ref0, calibrations: { [key]: { ...rec, attrSel: "div[data-layout-main=\"khac\"]@Khac.tsx" } } });
    const movedGeo = await mp(page, s, "selftest", { ref: ref0, calibrations: { [key]: { ...rec, mainTop: rec.mainTop - 40 } } });
    check("T06-hieu-chuan", ok.calibration?.status === "matches-reference" && ok.errors.length === 0 && bad.errors.some((e) => /HIỆU CHUẨN TRƯỢT/.test(e))
      && okRec.calibration?.status === "recorded-match" && okRec.errors.length === 0 && movedSel.errors.some((e) => /LỆCH BẢN GHI/.test(e)) && movedGeo.errors.some((e) => /LỆCH BẢN GHI/.test(e)),
      { control: { status: ok.calibration?.status, errors: ok.errors }, attack: bad.calibration, record: okRec.calibration?.status, movedSel: movedSel.calibration?.status, movedGeo: movedGeo.calibration?.status });
    await fresh();
  }
  if (want("T07-banner-trong-main")) {
    await inPage(`T.setAttribute('data-layout-main', 'x'); T.insertBefore(mk('${NOTICE}', 80, 'Chế độ xem trước — banner không đánh dấu'), T.firstChild);`);
    const b = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    check("T07-banner-trong-main", b.errors.some((e) => /BANNER\/DẢI KPI TRONG MAIN/.test(e)), { errors: b.errors.slice(0, 2), inside: b.insideMain[0] && { banners: b.insideMain[0].banners, above: b.insideMain[0].aboveWorkspacePx } });
    await fresh();
  }
  if (want("T08-kpi-trong-main")) {
    await inPage(`T.setAttribute('data-layout-main', 'x'); const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;padding:8px'; for (let i = 0; i < 4; i++) { const c = mk('rounded-md border px-3', 32, (i * 7) + ' việc'); c.style.width = '140px'; row.appendChild(c); } T.insertBefore(row, T.firstChild);`);
    const b = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    check("T08-kpi-trong-main", b.errors.some((e) => /BANNER\/DẢI KPI TRONG MAIN/.test(e) && /kpi-strip/.test(e)), { errors: b.errors.slice(0, 2) });
    await fresh();
  }
  if (want("T09-banner-trong-header")) {
    // Task 4: header một hàng (PageHeaderCompact: flex-nowrap, max-height 48, overflow hidden) đẩy khối chèn vào CẠNH h1
    // và cắt mất ⇒ ca không còn tạo được "ghi chú DƯỚI h1 trong header". Mô phỏng đúng cách lách: header tự xuống hàng
    // thứ hai chứa ghi chú (bỏ nowrap/max-height/overflow của header, ghi chú chiếm cả hàng). Header khối cũ không đổi gì.
    await inPage(`const HH = H || h1.parentElement; HH.style.flexWrap = 'wrap'; HH.style.maxHeight = 'none'; HH.style.overflow = 'visible'; const n = mk('${NOTICE}', 40, 'Lưu ý trong header'); n.style.flexBasis = '100%'; n.style.width = '100%'; HH.appendChild(n);`);
    const b = await mp(page, s, "selftest");
    check("T09-banner-trong-header", b.bannersBeforeMain.count === b0.bannersBeforeMain.count + 1 && b.bannersBeforeMain.px >= b0.bannersBeforeMain.px + 40, { before: [b0.bannersBeforeMain.count, b0.bannersBeforeMain.px], after: [b.bannersBeforeMain.count, b.bannersBeforeMain.px] });
    await fresh();
  }
  if (want("T10-nut-chet")) {
    await inPage(`const b = document.createElement('button'); b.textContent = 'UIM nút chết'; h1.parentElement.appendChild(b);`);
    const before = await mp(page, s, "selftest");
    const acts = await runActions(page, [{ id: "uim-chet", label: /UIM nút chết/ }], { s, variant: "selftest", before });
    check("T10-nut-chet", acts[0].status === "no-effect" && !!acts[0].error, { got: acts[0] });
    await fresh();
  }
  if (want("T10b-panel-inline")) {
    await inPage(`const b = document.createElement('button'); b.textContent = 'UIM mở panel'; b.onclick = () => { A.parentElement.insertBefore(mk('border', 150, 'panel inline'), A); }; h1.parentElement.appendChild(b);`);
    const before = await mp(page, s, "selftest");
    const acts = await runActions(page, [{ id: "uim-inline", label: /UIM mở panel/ }], { s, variant: "selftest", before });
    check("T10b-panel-inline", acts[0].status === "inline" && acts[0].inlineHeight >= 150 && acts[0].pushesMainPx >= 150, { got: acts[0] });
    await fresh();
  }
  if (want("T11-cat-overflow")) {
    await inPage(`const P = T.parentElement; const top = T.getBoundingClientRect().top - P.getBoundingClientRect().top; P.style.overflow = 'hidden'; P.style.height = (top + 100) + 'px';`);
    const b = await mp(page, s, "selftest");
    const maxPct = (100 * b0.mainRects[0].w) / (1600 * 950) * 100 + 0.2;
    check("T11-cat-overflow", b.mainPct <= maxPct && b.mainPct < b0.mainPct && b.clippedBy.length > 0, { before: b0.mainPct, after: b.mainPct, maxPct: +maxPct.toFixed(1) });
    await fresh();
  }
  if (want("T12-ai-trong-main")) {
    await inPage(`T.style.position = 'relative'; const a1 = document.createElement('aside'); a1.setAttribute('role', 'complementary'); a1.style.cssText = 'position:absolute;right:0;top:60px;width:300px;height:300px;background:#123'; const a2 = document.createElement('div'); a2.setAttribute('data-testid', 'copilot-panel'); a2.style.cssText = 'position:absolute;right:320px;top:60px;width:200px;height:200px;background:#321'; T.appendChild(a1); T.appendChild(a2);`);
    const b = await mp(page, s, "selftest");
    check("T12-ai-trong-main", b.aiInsideMain.px >= 0.9 * 130000 && b.aiInsideMain.items.length === 2 && b.workspacePct <= b0.workspacePct - 0.9 * 130000 / (1600 * 950) * 100, { before: { ws: b0.workspacePct, ai: b0.aiInsideMain.px }, after: { ws: b.workspacePct, ai: b.aiInsideMain.px, items: b.aiInsideMain.items.map((i) => i.testid || i.role) } });
    await fresh();
  }
  if (want("T13-portal-dai-dau")) {
    await page.evaluate(() => { const m = document.querySelector('main').getBoundingClientRect(); const d = document.createElement('div'); d.setAttribute('role', 'status'); d.style.cssText = `position:fixed;z-index:60;left:${m.left + 40}px;top:70px;width:400px;height:40px;background:#fe0`; d.textContent = 'popover mở sẵn'; document.body.appendChild(d); });
    const b = await mp(page, s, "selftest");
    check("T13-portal-dai-dau", b.bannersBeforeMain.count === b0.bannersBeforeMain.count + 1 && (b.bannersBeforeMain.byKind.overlay || 0) === 1, { before: b0.bannersBeforeMain.count, after: b.bannersBeforeMain.count, byKind: b.bannersBeforeMain.byKind });
    await fresh();
  }
  if (want("T14-dialog-luc-nap")) {
    await page.evaluate(() => { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.setAttribute('data-slot', 'dialog-content'); d.style.cssText = 'position:fixed;z-index:70;left:600px;top:500px;width:300px;height:200px;background:#fff'; document.body.appendChild(d); });
    const b = await mp(page, s, "selftest");
    check("T14-dialog-luc-nap", b.errors.some((e) => /MỞ SẴN lúc nạp/.test(e)), { errors: b.errors.slice(0, 2) });
    await fresh();
  }
  if (want("T15-to-tien-an")) {
    // tổ tiên của MAIN bị ép cao 200 px + overflow:hidden ⇒ phần bị giấu PHẢI vẫn tính vào chiều cao trang
    await inPage(`const P = T.parentElement; P.style.height = '200px'; P.style.overflow = 'hidden';`);
    const b = await mp(page, s, "selftest");
    check("T15-to-tien-an", b.pageHeightRatio >= b0.pageHeightRatio - 0.05 && b.scroll.scrollers.some((x) => x.rel === "ancestor"), { before: b0.pageHeightRatio, after: b.pageHeightRatio, docH: b.scroll.docH, extra: b.scroll.extra });
    await fresh();
  }
  if (want("T15b-anh-em-chi-bao")) {
    // panel anh em tự cuộn (explorer/inspector) ⇒ BÁO siblingScrollExtra, KHÔNG cộng vào pageHeightRatio
    await inPage(`const box = document.createElement('div'); box.style.cssText = 'height:100px;overflow:hidden'; box.appendChild(mk('', 2000, 'nội dung ẩn')); A.parentElement.insertBefore(box, A);`);
    const b = await mp(page, s, "selftest");
    check("T15b-anh-em-chi-bao", b.scroll.siblingScrollExtra >= 1900 && b.pageHeightRatio <= b0.pageHeightRatio + 0.2, { before: b0.pageHeightRatio, after: b.pageHeightRatio, siblingScrollExtra: b.scroll.siblingScrollExtra });
    await fresh();
  }
  const insideErr = (b) => b.errors.some((e) => /BANNER\/DẢI KPI TRONG MAIN/.test(e));
  if (want("T17-wrapper-workspace")) {
    // bọc CardHeader + notice + bảng trong một wrapper khai [data-layout-workspace] ⇒ banner VẪN bị đếm
    await inPage(`T.setAttribute('data-layout-main', 'x'); const w = document.createElement('div'); w.setAttribute('data-layout-workspace', ''); while (T.firstChild) w.appendChild(T.firstChild); const hd = document.createElement('h3'); hd.textContent = 'Danh sách ECN'; w.insertBefore(mk('${NOTICE}', 80, 'Chế độ xem trước — banner trong wrapper'), w.firstChild); w.insertBefore(hd, w.firstChild); T.appendChild(w);`);
    const b = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    check("T17-wrapper-workspace", insideErr(b), { errors: b.errors.filter((e) => /BANNER/.test(e)).slice(0, 1), workspace: b.insideMain[0]?.workspace?.tag });
    await fresh();
  }
  if (want("T17b-main-la-workspace")) {
    await inPage(`T.setAttribute('data-layout-main', 'x'); T.setAttribute('data-layout-workspace', '');`);
    const b = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    check("T17b-main-la-workspace", b.errors.some((e) => /W === MAIN bị từ chối/.test(e)), { errors: b.errors.slice(0, 2) });
    await fresh();
  }
  if (want("T18-mat-h1")) {
    await page.evaluate(() => { const h = document.querySelector('main h1'); if (h) h.remove(); });
    const b = await mp(page, s, "selftest", { ref: ref0 });
    check("T18-mat-h1", b.errors.some((e) => /MẤT h1/.test(e)), { errors: b.errors.slice(0, 2), refHadH1: ref0?.hadH1 });
    await fresh();
  }
  if (want("T19-banner-tren-h1")) {
    await inPage(`const top = H || h1.parentElement; top.parentElement.insertBefore(mk('${NOTICE}', 44, 'Đây là tính năng xem trước'), top);`);
    const b = await mp(page, s, "selftest");
    check("T19-banner-tren-h1", b.bannersBeforeMain.count === b0.bannersBeforeMain.count + 1 && b.bannersBeforeMain.px >= b0.bannersBeforeMain.px + 44, { before: [b0.bannersBeforeMain.count, b0.bannersBeforeMain.px], after: [b.bannersBeforeMain.count, b.bannersBeforeMain.px] });
    await fresh();
  }
  if (want("T20-fixed-trong-main")) {
    await inPage(`const r = T.getBoundingClientRect(); const d = document.createElement('div'); d.setAttribute('data-testid', 'uim-fixed-in-main'); d.style.cssText = 'position:fixed;z-index:50;left:' + (r.left + 60) + 'px;top:' + Math.min(r.top + 40, innerHeight - 220) + 'px;width:200px;height:200px;background:#0a0'; T.appendChild(d);`);
    const b = await mp(page, s, "selftest");
    check("T20-fixed-trong-main", b.coverMain.px >= b0.coverMain.px + 0.9 * 40000 && b.coverMain.items.some((i) => i.testid === "uim-fixed-in-main"), { before: b0.coverMain.px, after: b.coverMain.px });
    await fresh();
  }
  if (want("T21-nhan-chu-thuan")) {
    // nhãn chữ thuần 20 px (không nền/viền/icon, không từ khoá notice) ⇒ MIỄN; cùng cỡ nhưng có nền màu ⇒ banner
    await inPage(`T.setAttribute('data-layout-main', 'x'); const l = document.createElement('div'); l.style.cssText = 'height:20px'; l.textContent = 'Danh sách thay đổi'; T.insertBefore(l, T.firstChild);`);
    const plain = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    await fresh();
    await inPage(`T.setAttribute('data-layout-main', 'x'); const l = document.createElement('div'); l.style.cssText = 'height:20px;background:#fde68a'; l.textContent = 'Danh sách thay đổi'; T.insertBefore(l, T.firstChild);`);
    const colored = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    await fresh();
    await inPage(`T.setAttribute('data-layout-main', 'x'); const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;height:20px'; row.innerHTML = '<svg aria-hidden="true" width="16" height="16"></svg><h2 style="margin:0;font-size:14px">Cảnh báo chờ duyệt</h2><span>12</span>'; T.insertBefore(row, T.firstChild);`);
    const headRow = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    check("T21-nhan-chu-thuan", !insideErr(plain) && insideErr(colored) && !insideErr(headRow), { plain: plain.insideMain[0]?.blocks?.map((x) => x.kind), colored: colored.insideMain[0]?.blocks?.map((x) => x.kind), headingRow: headRow.insideMain[0]?.blocks?.map((x) => x.kind) });
    await fresh();
  }
  if (want("T22-ai-theo-nhan-i18n")) {
    // khối KHÔNG có role/testid/data-loc AI, chỉ có tiêu đề là nhãn i18n "Trợ lý Lập trình AI" ⇒ vẫn là bề mặt AI
    await inPage(`T.style.position = 'relative'; const a = document.createElement('div'); a.style.cssText = 'position:absolute;right:0;top:60px;width:300px;height:300px;background:#123'; const h = document.createElement('h3'); h.textContent = 'Trợ lý Lập trình AI'; a.appendChild(h); T.appendChild(a);`);
    const b = await mp(page, s, "selftest");
    check("T22-ai-theo-nhan-i18n", b.aiInsideMain.px >= 0.9 * 90000 && b.aiInsideMain.items.some((i) => i.via === "i18n-label"), { after: b.aiInsideMain.px, items: b.aiInsideMain.items.map((i) => i.via) });
    await fresh();
  }
  if (want("T23-toolbar-56")) {
    await inPage(`T.setAttribute('data-layout-main', 'x'); const t = document.createElement('div'); t.setAttribute('data-layout-toolbar', ''); t.style.cssText = 'height:52px;display:flex;gap:8px'; const b1 = document.createElement('button'); b1.textContent = 'Lọc'; t.appendChild(b1); T.insertBefore(t, T.firstChild);`);
    const b = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    check("T23-toolbar-56", !b.errors.some((e) => /data-layout-toolbar\] cao/.test(e)) && !insideErr(b), { toolbars: b.insideMain[0]?.toolbars, errors: b.errors.filter((e) => /toolbar|BANNER/.test(e)) });
    await fresh();
  }
  if (want("T24-chip-thap")) {
    // hàng 4 "chip" cao 20 px (<28) ⇒ KHÔNG phải dải KPI (là banner thường); chip ≥28 px mới là kpi-strip (T08)
    await inPage(`T.setAttribute('data-layout-main', 'x'); const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;background:#eee'; for (let i = 0; i < 4; i++) { const c = mk('', 20, 'mục ' + i); c.style.width = '140px'; row.appendChild(c); } T.insertBefore(row, T.firstChild);`);
    const b = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    const kinds = (b.insideMain[0]?.blocks || []).map((x) => x.kind);
    check("T24-chip-thap", kinds.includes("banner") && !kinds.includes("kpi-strip"), { kinds });
    await fresh();
  }
  if (want("T25-emptystate-la-W")) {
    // EmptyState đứng TRƯỚC bảng ⇒ EmptyState là W (aboveWorkspacePx không tính khối 200 px của nó)
    await inPage(`const e = mk('', 200, 'Chưa có dữ liệu'); e.setAttribute('data-loc', 'client\\src\\components\\EmptyState.tsx:1'); T.insertBefore(e, T.firstChild);`);
    const b = await mp(page, s, "selftest");
    const ins = b.insideMain[0] || {};
    await fresh();
    await inPage(`const e = document.createElement('p'); e.style.cssText = 'padding:24px 0;text-align:center'; e.textContent = 'Chưa có bước nào. Thêm bước đầu tiên bên dưới.'; T.insertBefore(e, T.firstChild);`);
    const b2 = await mp(page, s, "selftest");
    const ins2 = b2.insideMain[0] || {};
    check("T25-emptystate-la-W", /EmptyState/.test(ins.workspace?.loc || "") && ins.aboveWorkspacePx < 50 && ins2.workspace?.kind === "empty-state" && ins2.aboveWorkspacePx < 50, { component: { workspace: ins.workspace?.loc || ins.workspace?.tag, above: ins.aboveWorkspacePx }, custom: { kind: ins2.workspace?.kind, above: ins2.aboveWorkspacePx } });
    await fresh();
  }
  const kindsOf = (b) => (b.insideMain[0]?.blocks || []).map((x) => x.kind);
  const wsOf = (b) => `${b.insideMain[0]?.workspace?.kind}:${b.insideMain[0]?.workspace?.tag}`;
  if (want("T26-chip-trong-wrapper")) {
    // fix4 (a): wrapper TRONG SUỐT không đánh dấu, cao 32 px, bọc 4 chip 32 px đầu MAIN (chip có màu, rồi chip không màu)
    // ⇒ phải là kpi-strip (LỖI), không được lọt miễn trừ "nhãn chữ ≤40 px"
    const row = (chipCss) => `T.setAttribute('data-layout-main', 'x'); const w = document.createElement('div'); w.style.cssText = 'display:flex;gap:8px;height:32px'; for (let i = 0; i < 4; i++) { const c = mk('', 32, (i * 7) + ' việc'); c.style.cssText += 'width:120px;border-radius:6px;line-height:32px;text-align:center;${chipCss}'; w.appendChild(c); } T.insertBefore(w, T.firstChild);`;
    await inPage(row('background:#dcfce7'));
    const colored = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    await fresh();
    await inPage(row(''));
    const plain = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    check("T26-chip-trong-wrapper", insideErr(colored) && kindsOf(colored).includes("kpi-strip") && insideErr(plain) && kindsOf(plain).includes("kpi-strip"), { colored: kindsOf(colored), plain: kindsOf(plain) });
    await fresh();
  }
  if (want("T27-wrapper-notice-mau")) {
    // fix4 (b): wrapper trong suốt 36 px bọc hộp notice CÓ MÀU (không icon, không từ khoá notice) ⇒ banner (LỖI)
    await inPage(`T.setAttribute('data-layout-main', 'x'); const w = document.createElement('div'); w.style.height = '36px'; const n = mk('', 36, 'Dữ liệu đang được đồng bộ từ máy chủ, bảng có thể chưa đầy đủ.'); n.style.cssText += 'background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;line-height:34px;padding:0 12px'; w.appendChild(n); T.insertBefore(w, T.firstChild);`);
    const b = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    check("T27-wrapper-notice-mau", insideErr(b) && kindsOf(b).includes("banner"), { kinds: kindsOf(b), errors: b.errors.filter((e) => /BANNER/.test(e)).slice(0, 1) });
    await fresh();
  }
  if (want("T28-trong-trong-notice")) {
    // fix4 (c): "Chưa có dữ liệu" NẰM TRONG hộp notice vàng đứng trước bảng ⇒ hộp là banner (LỖI) và W là BẢNG, không phải p.
    // (1) hộp màu bằng style oklch (như Tailwind v4 tính ra), không lớp; (2) hộp bằng lớp Tailwind `px-5 py-4` lọt regex FE1;
    // (3) chữ trống KHÔNG màu nhưng có từ khoá notice ⇒ cũng không là W
    const P = `const p = document.createElement('p'); p.style.cssText = 'margin:0;line-height:32px'; p.textContent = 'Chưa có dữ liệu để hiển thị.';`;
    await inPage(`T.setAttribute('data-layout-main', 'x'); const box = mk('', 64, ''); box.style.cssText += 'background:oklch(0.769 0.188 70.08 / 0.1);border:1px solid oklch(0.769 0.188 70.08 / 0.4);border-radius:8px;padding:16px 20px'; ${P} box.appendChild(p); T.insertBefore(box, T.firstChild);`);
    const inline = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    await fresh();
    await inPage(`T.setAttribute('data-layout-main', 'x'); const box = mk('${NOTICE}', 64, ''); ${P} box.appendChild(p); T.insertBefore(box, T.firstChild);`);
    const byClass = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    await fresh();
    await inPage(`T.setAttribute('data-layout-main', 'x'); const p = document.createElement('p'); p.style.cssText = 'margin:0;height:48px;line-height:48px;text-align:center'; p.textContent = 'Chưa có dữ liệu — Chế độ xem trước.'; T.insertBefore(p, T.firstChild);`);
    const keyword = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    const ok = (b) => insideErr(b) && b.insideMain[0]?.workspace?.tag === "table" && kindsOf(b).includes("banner");
    check("T28-trong-trong-notice", ok(inline) && ok(byClass) && ok(keyword), { inline: { ws: wsOf(inline), kinds: kindsOf(inline) }, byClass: { ws: wsOf(byClass), kinds: kindsOf(byClass) }, keyword: { ws: wsOf(keyword), kinds: kindsOf(keyword) } });
    await fresh();
  }
  // R-2-m — miễn che cho separator co giãn: (a) separator anh em MAIN, trong luồng, 1 px, dải ::after 8 px lấn vào MAIN ⇒
  // KHÔNG tính che, `separatorHitPx` > 0 (ĐỎ khi gỡ gác separatorExempt); (b) CÙNG attribute trên lớp phủ absolute 40 px
  // (anh em MAIN — trong MAIN thì absolute vốn không là che) ⇒ VẪN tính ≥0,9 diện tích; (c) separator 1 px position:fixed
  // ngang giữa MAIN ⇒ VẪN tính. Hàng lấy mẫu (lưới 8 px, +4) được tính trong trang để separator nằm ĐÚNG trên một hàng.
  const SEP_CSS = `.uim-sep::after{content:"";position:absolute;left:0;right:0;top:-4px;height:8px;z-index:20}`;
  const sepInject = (mode) => inPage(`const st = document.createElement('style'); st.textContent = ${JSON.stringify(SEP_CSS)}; document.head.appendChild(st);
      const r = T.getBoundingClientRect(); const row = (yy) => { let v = Math.floor(yy / 8) * 8 + 4; if (v < yy) v += 8; return v; };
      const d = document.createElement('div'); d.setAttribute('data-panel-resize-handle-id', 'uim-sep'); d.setAttribute('role', 'separator'); d.setAttribute('data-testid', 'uim-sep-' + ${JSON.stringify(mode)});
      if (${JSON.stringify(mode)} === 'a') { d.className = 'uim-sep'; d.style.cssText = 'position:relative;z-index:20;height:1px;margin-bottom:-1px;width:' + r.width + 'px'; T.parentElement.insertBefore(d, T);
        const top0 = d.getBoundingClientRect().top; d.style.top = (row(r.top) - top0) + 'px'; }
      if (${JSON.stringify(mode)} === 'b') { d.style.cssText = 'position:absolute;z-index:20;background:rgba(0,0,255,.3);height:40px;width:' + r.width + 'px;left:' + (r.left + scrollX) + 'px;top:' + (row(r.top + 24) - 4 + scrollY) + 'px'; T.parentElement.insertBefore(d, T);
        // tổ tiên định vị (relative) dời gốc toạ độ của absolute ⇒ chỉnh lại theo vị trí THẬT để dải 40 px phủ đúng 5 hàng lưới
        const rr = d.getBoundingClientRect(); d.style.left = (parseFloat(d.style.left) + r.left - rr.left) + 'px'; d.style.top = (parseFloat(d.style.top) + row(r.top + 24) - 4 - rr.top) + 'px'; }
      if (${JSON.stringify(mode)} === 'c') { d.style.cssText = 'position:fixed;z-index:20;background:#f00;height:1px;width:' + r.width + 'px;left:' + r.left + 'px;top:' + row(r.top + Math.min(r.height, innerHeight - r.top) / 2) + 'px'; T.parentElement.insertBefore(d, T); }
      return r.width;`);
  if (want("T29a-separator-anh-em-mien")) {
    await sepInject("a");
    const b = await mp(page, s, "selftest");
    check("T29a-separator-anh-em-mien", b.coverMain.px === b0.coverMain.px && b.coverMain.separatorHitPx > 0, { before: b0.coverMain.px, after: b.coverMain.px, separatorHitPx: b.coverMain.separatorHitPx });
    await fresh();
  }
  if (want("T29b-overlay-cung-attr-van-che")) {
    const w = await sepInject("b");
    const b = await mp(page, s, "selftest");
    check("T29b-overlay-cung-attr-van-che", b.coverMain.px >= b0.coverMain.px + 0.9 * 40 * w && b.coverMain.items.some((i) => i.testid === "uim-sep-b"), { before: b0.coverMain.px, after: b.coverMain.px, need: Math.round(0.9 * 40 * w), separatorHitPx: b.coverMain.separatorHitPx });
    await fresh();
  }
  if (want("T29c-separator-fixed-van-che")) {
    const w = await sepInject("c");
    const b = await mp(page, s, "selftest");
    check("T29c-separator-fixed-van-che", b.coverMain.px >= b0.coverMain.px + 0.9 * 8 * w && b.coverMain.separatorHitPx === b0.coverMain.separatorHitPx, { before: b0.coverMain.px, after: b.coverMain.px, need: Math.round(0.9 * 8 * w), separatorHitPx: b.coverMain.separatorHitPx });
    await fresh();
  }
  // final wave (R-2-z1 / I-4) — T30: một khối 3000 px trong <main> ⇒ cuộn ngang CẤP TRANG ⇒ LỖI (Ràng buộc 10).
  if (want("T30-cuon-ngang-trang")) {
    await page.evaluate(() => { const d = document.createElement('div'); d.setAttribute('data-testid', 'uim-rong'); d.style.cssText = 'width:3000px;height:8px'; document.querySelector('main').appendChild(d); });
    const b = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    const hit = (r) => r.errors.some((e) => /CUỘN NGANG CẤP TRANG/.test(e));
    check("T30-cuon-ngang-trang", !hit(b0) && hit(b) && (b.hScroll.mainOverflowPx > 1000 || b.hScroll.docOverflowPx > 1000), { before: b0.hScroll, after: b.hScroll });
    await fresh();
  }
  // T31: đầu dò Copilot — trang không có Copilot + biến thể "open" ⇒ LỖI; bơm bề mặt [data-layout-ai] có tabpanel *-copilot
  // ⇒ "open" hết lỗi còn "closed" thành LỖI. Đi qua đúng COPILOT_PROBE + copilotCheck của phép đo thật.
  if (want("T31-copilot-phai-hien")) {
    const none = await page.evaluate(COPILOT_PROBE);
    const rA = { errors: [] }; copilotCheck(rA, none, "open");
    await page.evaluate(() => { const a = document.createElement('aside'); a.setAttribute('data-layout-ai', ''); a.style.cssText = 'position:fixed;right:0;top:120px;width:320px;height:420px;background:#fff;z-index:5'; const p = document.createElement('div'); p.setAttribute('role', 'tabpanel'); p.id = 'uim-copilot'; p.style.cssText = 'height:300px'; p.textContent = 'Copilot'; a.appendChild(p); document.body.appendChild(a); });
    const yes = await page.evaluate(COPILOT_PROBE);
    const rB = { errors: [] }; copilotCheck(rB, yes, "open");
    const rC = { errors: [] }; copilotCheck(rC, yes, "closed");
    check("T31-copilot-phai-hien", !none.rendered && rA.errors.length === 1 && yes.rendered && rB.errors.length === 0 && rC.errors.length === 1, { none, yes, errA: rA.errors.length, errB: rB.errors.length, errC: rC.errors.length });
    await fresh();
  }
  // T32: hiệu chuẩn TAB (`tabOf`) — chưa có bản ghi riêng: attribute trên đúng phần tử của trang mẹ ⇒ đạt (cảnh báo);
  // phần tử khác ⇒ LỖI; trang mẹ chưa có bản ghi ⇒ LỖI.
  if (want("T32-hieu-chuan-tab")) {
    await inPage(`T.setAttribute('data-layout-main', 'dung');`);
    const tab = { ...s, tabOf: "uim-me" };
    const first = await mp(page, s, "selftest", { ref: ref0, calibrations: {} });
    const pk = "uim-me|1600|selftest";
    const good = await mp(page, tab, "selftest", { calibrations: { [pk]: { attrSel: first.attrSel } } });
    const moved = await mp(page, tab, "selftest", { calibrations: { [pk]: { attrSel: "div[data-layout-main=\"khac\"]@Khac.tsx" } } });
    const orphan = await mp(page, tab, "selftest", { calibrations: {} });
    const tabErr = (r) => r.errors.some((e) => /HIỆU CHUẨN TAB/.test(e));
    check("T32-hieu-chuan-tab", good.calibration?.status === "matches-reference" && !tabErr(good) && tabErr(moved) && tabErr(orphan), { good: good.calibration, moved: moved.calibration?.status, orphan: orphan.calibration?.status });
    await fresh();
  }
  if (want("T16-bam-loi")) {
    const errs = dataErrors({ bang_that: "12:abcdef", bang_hong: "ERR:relation does not exist" });
    check("T16-bam-loi", errs.length === 1, { errors: errs });
  }
  return { screen: s.id, vw: (await page.viewportSize()).width, off: [...OFF], pass: checks.every((c) => c.pass), retries, checks };
}

async function measureAll({ base, username, password, screens, sizes, shots, shotDir, listButtons, serverPid, serverPort, discover, doSelfTest, refs = {}, calibrations = {}, mutation = false }) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const results = [], buttons = {}, connections = [], discovered = {};
  let selfTestResult = null;
  try {
    for (const variant of ["closed", "open"]) {
      const list = screens.filter((s) => variant === "closed" || s.copilot);
      if (!list.length) continue;
      const ctx = await browser.newContext({ viewport: { width: sizes[0][0], height: sizes[0][1] }, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh", deviceScaleFactor: 1 });
      // final wave (M-3): khoá nhớ Copilot đổi tên `progCopilot.open` (khoá cũ chỉ còn được ĐỌC một lần) — đặt khoá mới, gỡ khoá cũ.
      await ctx.addInitScript((dock) => { try { localStorage.setItem("i18nextLng", "vi"); localStorage.setItem("progCopilot.open", dock); localStorage.removeItem("progCopilotDock.open"); localStorage.setItem("sidebar_open", "true"); } catch { /* */ } }, variant === "open" ? "1" : "0");
      const login = await ctx.request.post(base + "/api/auth/login", { data: { username, password } });
      if (!login.ok()) throw new Error(`Đăng nhập thất bại ${login.status()} ${await login.text()}`);
      const page = await ctx.newPage();
      let procs = new Set();
      page.on("request", (rq) => { const m = /\/api\/trpc\/([^?]+)/.exec(rq.url()); if (m) for (const p of decodeURIComponent(m[1]).split(",")) procs.add(p); });
      for (const s of list) {
        const route = await resolveRoute(ctx, base, s);
        for (const [w, h] of sizes) {
          await page.setViewportSize({ width: w, height: h });
          procs = new Set();
          const st0 = discover ? await scanStats() : null;
          await page.goto(base + route);
          await settle(page);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(200);
          if (discover) {
            await sleep(1500);
            const st1 = await scanStats();
            const key = `${s.id}`;
            discovered[key] = discovered[key] || new Set();
            for (const [t, n] of Object.entries(st1)) if (n > (st0[t] ?? 0)) discovered[key].add(t);
          }
          if (shots) await page.screenshot({ path: path.join(shotDir, `${String(s.n).padStart(2, "0")}-${s.id}-${variant}-${w}.png`) });
          const v = s.copilot ? variant : "n/a";
          const parentId = s.tabOf ?? s.calibrateAs?.id ?? s.movedFrom;
          const opts = { ref: refs[`${s.id}|${w}|${v}`], h1Ref: parentId ? (refs[`${parentId}|${w}|${s.calibrateAs?.variant ?? v}`] ?? refs[`${parentId}|${w}|n/a`]) : undefined, calibrations };
          const rec = await measurePage(page, s, v, opts);
          // final wave (R-2-z1): màn có biến thể Copilot ⇒ kiểm Copilot THẬT SỰ mở/đóng đúng biến thể (LỖI nếu không).
          if (s.copilot) copilotCheck(rec, await page.evaluate(COPILOT_PROBE), v);
          rec.actions = await runActions(page, s.actions, { s, variant: v, before: rec, opts });
          for (const a of rec.actions) { if (a.error) rec.errors.push(a.error); if (a.status === "disabled") rec.warnings.push(`hành động "${a.id}" disabled cho role đo`); if (a.status === "opened" && !a.closedByEsc) rec.warnings.push(`hành động "${a.id}": Esc không đóng`); }
          rec.trpc = [...procs].sort();
          const known = KNOWN_PROCS[s.id];
          if (known) { const unk = rec.trpc.filter((p) => !known.includes(p)); if (unk.length) rec.warnings.push(`thủ tục tRPC chưa có trong KNOWN_PROCS (canh trôi có thể thiếu bảng — chạy --discover-tables): ${unk.join(", ")}`); }
          if (listButtons) buttons[`${s.id}-${variant}-${w}`] = await page.evaluate(() => [...document.querySelectorAll('main button,main [role=button]')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((b) => ({ name: (b.innerText.trim() || b.getAttribute('aria-label') || b.getAttribute('title') || '?').replace(/\s+/g, ' ').slice(0, 40), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true', haspopup: b.getAttribute('aria-haspopup') })));
          results.push(rec);
          const flag = rec.errors.length ? `  ✗ LỖI: ${rec.errors.join(" | ")}` : (rec.missingDataLayoutMain ? "  ⚠ CHƯA có [data-layout-main] → selector FE1" : "");
          console.log(`${s.id.padEnd(22)} ${String(w).padStart(4)} ${rec.variant.padEnd(6)} main=${String(rec.mainPct).padStart(5)}% top=${rec.chromeAboveMain} h1=${rec.h1Top} gap=${rec.gapH1ToMain} crumbs=${rec.breadcrumbs} truoc=${rec.bannersBeforeMain.count}/${rec.bannersBeforeMain.px}px kpi=${rec.kpi.all.count}/${rec.kpi.all.stripPx}px che=${rec.coverMain.px}px² ratio=${rec.pageHeightRatio}${flag}`);
        }
      }
      if (serverPid) connections.push(sampleConnections(serverPid, serverPort, `sau biến thể ${variant}`));
      if (doSelfTest && variant === "closed") {
        const ecn = SCREENS.find((x) => x.id === "engineering-changes");
        await page.setViewportSize({ width: 1600, height: 950 });
        OFF.clear();
        selfTestResult = await selfTest(page, base, ecn);
        console.log(`[uim] tự kiểm (đối chứng dương): ${selfTestResult.pass ? "ĐẠT" : "TRƯỢT"} — ${selfTestResult.checks.map((c) => `${c.name}:${c.pass ? "✓" : "✗"}`).join(" ")}`);
        if (mutation) {
          // gỡ TỪNG gác ⇒ (các) ca của nó PHẢI đỏ; các gác khác vẫn bật
          selfTestResult.mutation = [];
          for (const [g, cases] of Object.entries(GUARDS)) {
            OFF.clear(); OFF.add(g);
            const r = await selfTest(page, base, ecn, cases);
            OFF.clear();
            const red = r.checks.filter((c) => !c.pass).map((c) => c.name);
            const ok = cases.every((c) => red.includes(c));
            selfTestResult.mutation.push({ guard: g, cases, red, guardProven: ok, retries: r.retries ?? 0 });
            console.log(`[uim] gỡ gác ${g.padEnd(15)} ⇒ ${cases.map((c) => `${c}:${red.includes(c) ? "ĐỎ" : "xanh(!)"}`).join(" ")}`);
          }
          selfTestResult.mutationPass = selfTestResult.mutation.every((m) => m.guardProven);
          // final wave (T1 minor): số lần đo lại (không thấy MAIN) của MỌI lượt gỡ gác được cộng, không chỉ lượt chính.
          selfTestResult.mutationRetries = selfTestResult.mutation.reduce((n, m) => n + (m.retries ?? 0), 0);
        }
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
  return { results, buttons, connections, selfTest: selfTestResult, discovered: Object.fromEntries(Object.entries(discovered).map(([k, v]) => [k, [...v].sort()])) };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// 7. MSA (so 2 lần chạy) và đối chiếu FE1
// ───────────────────────────────────────────────────────────────────────────────────────────
const MSA_METRICS = [
  ["mainPct", (r) => r.mainPct], ["chromeAboveMain", (r) => r.chromeAboveMain], ["h1Top", (r) => r.h1Top], ["gapH1ToMain", (r) => r.gapH1ToMain], ["breadcrumbs", (r) => r.breadcrumbs],
  ["banners.count", (r) => r.bannersBeforeMain.count], ["banners.px", (r) => r.bannersBeforeMain.px], ["aboveH1.px", (r) => r.blocksAboveH1.unionPx],
  ["kpi.legacy", (r) => r.kpi.legacy.count], ["kpi.official", (r) => r.kpi.official.count], ["kpi.stripPx", (r) => r.kpi.all.stripPx],
  ["cover.px", (r) => r.coverMain.px], ["pageHeightRatio", (r) => r.pageHeightRatio],
  ["dialogsAtLoad", (r) => r.dialogsAtLoad.count], ["actions.sig", (r) => (r.actions || []).map((a) => `${a.id}:${a.status}:${(a.kinds || []).join("+")}:${a.inlineHeight ?? ""}`).join(";")],
  ["workspacePct", (r) => r.workspacePct], ["aiInsideMain.px", (r) => r.aiInsideMain.px], ["insideMain.banners", (r) => r.insideMain.reduce((n, i) => n + i.banners, 0)], ["insideMain.abovePx", (r) => r.insideMain.reduce((n, i) => n + i.aboveWorkspacePx, 0)],
  ["calibration", (r) => r.calibration ? r.calibration.status : "n/a"],
  ["errors", (r) => r.errors.length],
];
const keyOf = (r) => `${r.screen}|${r.vw}|${r.variant}`;
const relDev = (a, b) => (a == null && b == null) ? 0 : (a == null || b == null) ? 100 : (a === b ? 0 : (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) * 100 : 100));
export function compareRuns(A, B, threshold = 2) {
  const mb = new Map(B.results.map((r) => [keyOf(r), r]));
  const rows = []; let worst = 0, n = 0;
  for (const a of A.results) {
    const b = mb.get(keyOf(a)); if (!b) { rows.push({ key: keyOf(a), metric: "*", a: "có", b: "THIẾU", dev: 100 }); worst = 100; continue; }
    for (const [name, get] of MSA_METRICS) { const d = relDev(get(a), get(b)); n++; worst = Math.max(worst, d); if (d > 0) rows.push({ key: keyOf(a), metric: name, a: get(a), b: get(b), dev: +d.toFixed(2) }); }
  }
  const dataDiff = diffSnap(A.meta?.data?.before, B.meta?.data?.before);
  const gates = {
    deviationUnderThreshold: worst < threshold,
    selfTestA: !!A.meta?.selfTest?.pass, selfTestB: !!B.meta?.selfTest?.pass,
    noDataErrA: !!A.meta?.data?.errors && A.meta.data.errors.length === 0, noDataErrB: !!B.meta?.data?.errors && B.meta.data.errors.length === 0,
    noDriftWithinA: A.meta?.data ? Object.keys(A.meta.data.drift || {}).length === 0 : false,
    noDriftWithinB: B.meta?.data ? Object.keys(B.meta.data.drift || {}).length === 0 : false,
    sameDataAcrossRuns: Object.keys(dataDiff).length === 0,
    sameFlags: A.meta?.flags === B.meta?.flags,
  };
  return { comparisons: n, nonZero: rows.length, worstDevPct: +worst.toFixed(2), threshold, gates, pass: Object.values(gates).every(Boolean), dataSnapshotDiff: dataDiff, rows };
}
export function reconcileFe1(run, threshold = 5) {
  const rows = [];
  const get = (id, vw, variant) => run.results.find((r) => r.screen === id && r.vw === vw && (variant ? r.variant === variant : true));
  for (const [k, f] of Object.entries(FE1)) {
    const [id, v] = k.split("|"); const variant = v || undefined;
    const r16 = get(id, 1600, variant), r13 = get(id, 1366, variant);
    if (!r16 || !r13) continue;
    const add = (metric, fe1, now) => rows.push({ screen: k, metric, fe1, now, dev: +relDev(fe1, now).toFixed(1), ok: relDev(fe1, now) <= threshold });
    add("mainTop@1600", f.mainTop, r16.mainTop);
    add("ws%@1600", f.ws1600, r16.mainPctFe1);
    add("ws%@1366", f.ws1366, r13.mainPctFe1);
    add("notices@1600", f.notices, r16.bannersFe1Class.count);
    add("noticePx@1600", f.noticePx, r16.bannersFe1Class.px);
    add("ratio@1600", f.ratio1600, r16.pageHeightRatioDoc);
    add("ratio@1366", f.ratio1366, r13.pageHeightRatioDoc);
    add("crumbs@1600", f.crumbs, r16.breadcrumbs);
    add("kpiCards@1600", f.kpi, r16.kpi.legacy.count);
  }
  return { threshold, total: rows.length, within: rows.filter((r) => r.ok).length, rows };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// 8. CLI
// ───────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { _: [] };
  const FLAGS = ["spawn", "shots", "list-buttons", "keep", "discover-tables", "no-selftest", "mutation", "calibrate"];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const nx = argv[i + 1]; if (nx != null && !nx.startsWith("--") && !FLAGS.includes(k)) { o[k] = nx; i++; } else o[k] = true; }
    else o._.push(a);
  }
  return o;
}
async function portsReport(ports) {
  const r = {}; for (const p of ports) r[p] = (await portBusy(p)) ? "BẬN" : "trống"; return r;
}
const BASELINE_REL = "docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU/do-bo-cuc/baseline.json";
const CALIBRATION_REL = "docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU/do-bo-cuc/calibration.json";
const allTables = () => [...new Set(Object.values(PAGE_TABLES).flat())].filter((t) => !SELF_WRITTEN[t]).sort();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.compare) {
    const A = JSON.parse(fs.readFileSync(args.compare, "utf8")), B = JSON.parse(fs.readFileSync(args._[0], "utf8"));
    const c = compareRuns(A, B, Number(args.threshold ?? 2));
    console.log(JSON.stringify(c, null, 1));
    process.exit(c.pass ? 0 : 1);
  }
  if (args.fe1) {
    const run = JSON.parse(fs.readFileSync(args.fe1, "utf8"));
    console.log(JSON.stringify(reconcileFe1(run, Number(args.threshold ?? 5)), null, 1));
    return;
  }
  const flags = args.flags === "off" ? "off" : "dev";
  const serverPort = Number(args["server-port"] ?? 3016), vitePort = Number(args["vite-port"] ?? 5176);
  const sizes = args.sizes ? String(args.sizes).split(",").map((s) => s.split("x").map(Number)) : DEFAULT_SIZES;
  const screens = args.screens ? SCREENS.filter((s) => String(args.screens).split(",").includes(s.id)) : SCREENS;
  const outFile = path.resolve(args.out || path.join(REPO, ".playwright-mcp/do-bo-cuc", `run-${Date.now()}.json`));
  const shotDir = path.join(REPO, ".playwright-mcp/do-bo-cuc/anh");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (args.shots) fs.mkdirSync(shotDir, { recursive: true });
  const meta = { tool: "scripts/ui-metrics/engineeringLayout.mjs", startedAt: new Date().toISOString(), argv: process.argv.slice(2), sizes, flags, gitHead: (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO }).toString().trim(); } catch { return null; } })(),
    gitDirty: (() => { try { return execFileSync("git", ["status", "--porcelain", "--", "client/src", "scripts/ui-metrics"], { cwd: REPO }).toString().split("\n").filter(Boolean).map((l) => l.slice(3)); } catch { return null; } })() };
  if (!args.spawn) throw new Error("Chỉ hỗ trợ --spawn (instance tự dựng, có canh dữ liệu + kết nối). Đo instance khác không được nghiệm thu.");

  let serverChild = null, vite = null, probeMade = false;
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "uim-"));
  const cleanup = async () => {
    if (vite) { await vite.close().catch(() => {}); vite = null; }
    if (serverChild) { killTree(serverChild.pid); serverChild = null; }
    if (probeMade) { meta.probeUserRemoved = await withTestDb(deleteProbeUser).catch((e) => ({ error: e.message })); probeMade = false; }
  };
  process.on("SIGINT", async () => { await cleanup(); process.exit(130); });
  try {
    probeMade = true; // kể cả khi tạo hỏng giữa chừng ⇒ cleanup vẫn xoá
    const probe = await createProbeUser();
    const tables = allTables();
    meta.data = { tables: tables.length, before: args["discover-tables"] ? null : await dataSnapshot(tables) };
    meta.instance = { server: `tsx server/_core/index.ts :${serverPort} (env tách, không nạp .env; ROLE=api)`, vite: `vite dev in-process :${vitePort} (proxy /api,/uploads → :${serverPort}; envDir của vite.config nạp VITE_* từ .env vào client)`, db: TEST_DB, flagsOn: flags === "dev" ? UI_FLAGS_DEV : [], alwaysOff: Object.keys(ALWAYS_OFF).filter((k) => ALWAYS_OFF[k] === "false"), user: { username: probe.username, role: "engineer", perms: probe.perms, factory: probe.factory } };
    const s = await startServer(serverPort, logDir, flags); serverChild = s.child; meta.instance.serverBootMs = s.bootMs; meta.instance.serverPid = s.child.pid;
    vite = await startVite(vitePort, serverPort);
    const base = `http://127.0.0.1:${vitePort}`;
    console.log(`[uim] instance: server :${serverPort} (pid ${s.child.pid}, boot ${s.bootMs} ms, cờ ${flags}) · vite :${vitePort} · DB ${TEST_DB} · log ${logDir}`);
    const conn0 = sampleConnections(s.child.pid, serverPort, "sau khi khởi động");
    if (args.keep) { console.log(`[uim] --keep: giữ instance; user ${probe.username} / ${probe.password}. Ctrl-C để tắt.`); await new Promise(() => {}); }
    meta.base = base;
    // tham chiếu MAIN theo selector FE1 (cổng hiệu chuẩn) + bản ghi hiệu chuẩn đã có
    const refFile = path.resolve(args.reference || path.join(REPO, BASELINE_REL));
    const refs = {};
    if (fs.existsSync(refFile)) for (const x of JSON.parse(fs.readFileSync(refFile, "utf8")).results || []) {
      const lr0 = x.legacyRef || (x.mainSource === "fe1-legacy" && x.mainRects ? { mainTop: x.mainTop, rects: x.mainRects, areaPx: unionArea(x.mainRects, 1e6, 1e6, -1e6) } : null);
      const lr = lr0 ? { ...lr0, hadH1: lr0.hadH1 ?? !x.h1Missing } : null;
      if (lr) refs[`${x.screen}|${x.vw}|${x.variant}`] = lr;
    }
    const calFile = path.join(REPO, CALIBRATION_REL);
    const calibrations = fs.existsSync(calFile) ? JSON.parse(fs.readFileSync(calFile, "utf8")).pages || {} : {};
    meta.reference = { file: path.relative(REPO, refFile).replace(/\\/g, "/"), pages: Object.keys(refs).length, calibrations: Object.keys(calibrations) };
    const r = await measureAll({ base, username: probe.username, password: probe.password, screens, sizes, shots: !!args.shots, shotDir, listButtons: !!args["list-buttons"], serverPid: s.child.pid, serverPort, discover: !!args["discover-tables"], doSelfTest: !args["no-selftest"] && !args["discover-tables"] && screens.some((x) => x.id === "engineering-changes"), refs, calibrations, mutation: !!args.mutation });
    if (args.calibrate) {
      const cal = fs.existsSync(calFile) ? JSON.parse(fs.readFileSync(calFile, "utf8")) : { note: "Ghi bởi --calibrate, KHÔNG sửa tay. Khoá = màn|vw|biến thể. Bản ghi MỚI chỉ được ghi khi attribute khớp MAIN tham chiếu FE1 (bố cục chưa đổi); ghi ĐÈ bản ghi cũ (sau khi đổi bố cục) giữ `previous` để diff git cho thấy.", pages: {} };
      meta.calibrated = [];
      for (const x of r.results) {
        if (!x.calibration) continue;
        if (SCREENS.find((sc) => sc.id === x.screen)?.calibrateAs) continue; // R-2-x: bí danh KHÔNG BAO GIỜ ghi bản ghi
        const key = `${x.screen}|${x.vw}|${x.variant}`;
        // final wave (T4-M7): `gitHead` một mình không nói bố cục đo có nằm trong commit đó không ⇒ ghi kèm `gitDirty`
        // (tệp chưa commit dưới client/src hoặc scripts/ui-metrics lúc hiệu chuẩn).
        const entry = { screen: x.screen, vw: x.vw, variant: x.variant, mainTop: x.mainTop, rects: x.mainRects, areaPx: unionArea(x.mainRects, 1e6, 1e6, -1e6), attrSel: x.attrSel, gitHead: meta.gitHead, gitDirty: meta.gitDirty, at: new Date().toISOString() };
        if (cal.pages[key]) { if (x.calibration.status !== "recorded-match") { cal.pages[key] = { ...entry, previous: { mainTop: cal.pages[key].mainTop, areaPx: cal.pages[key].areaPx, attrSel: cal.pages[key].attrSel, gitHead: cal.pages[key].gitHead } }; meta.calibrated.push(`${key} (ghi đè)`); } }
        else if (x.calibration.status === "matches-reference") { cal.pages[key] = { ...entry, fromReference: x.calibration.refKind === "parent-element" ? { parentElement: x.calibration.parentAttrSel } : { dTop: x.calibration.dTop, dLeft: x.calibration.dLeft, dAreaPct: x.calibration.dAreaPct } }; meta.calibrated.push(key); }
      }
      fs.writeFileSync(calFile, JSON.stringify(cal, null, 1));
    }
    meta.connections = [conn0, ...r.connections];
    meta.outboundViolations = meta.connections.flatMap((c) => c.violations || []);
    meta.selfTest = r.selfTest;
    if (!args["discover-tables"]) { meta.data.after = await dataSnapshot(tables); meta.data.drift = diffSnap(meta.data.before, meta.data.after); meta.data.errors = [...new Set([...dataErrors(meta.data.before), ...dataErrors(meta.data.after)])]; }
    const missing = [...new Set(r.results.filter((x) => x.missingDataLayoutMain).map((x) => x.screen))];
    const errors = r.results.flatMap((x) => x.errors.map((e) => `${x.screen}@${x.vw}/${x.variant}: ${e}`));
    meta.finishedAt = new Date().toISOString();
    const out = { meta, pagesMissingDataLayoutMain: missing, errors, results: r.results };
    if (args["list-buttons"]) out.buttons = r.buttons;
    if (args["discover-tables"]) out.discovered = r.discovered;
    await cleanup();
    await sleep(1500); out.meta.portsAfter = await portsReport([serverPort, vitePort]);
    out.pass = errors.length === 0 && meta.outboundViolations.length === 0 && (args["discover-tables"] || (Object.keys(meta.data.drift).length === 0 && meta.data.errors.length === 0 && (args["no-selftest"] || !!meta.selfTest?.pass) && (!args.mutation || !!meta.selfTest?.mutationPass)));
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
    if (missing.length) console.log(`\n⚠ ${missing.length}/${screens.length} màn CHƯA có [data-layout-main] — đang đo bằng selector FE1: ${missing.join(", ")}`);
    if (errors.length) console.log(`✗ ${errors.length} LỖI:\n  ${errors.join("\n  ")}`);
    console.log(`[uim] kết nối ngoài danh sách: ${meta.outboundViolations.length} · trôi dữ liệu trong lần chạy: ${meta.data.drift ? Object.keys(meta.data.drift).length : "n/a"} (${meta.data.tables} bảng) · lỗi băm: ${meta.data.errors ? meta.data.errors.length : "n/a"} · tự kiểm: ${meta.selfTest ? (meta.selfTest.pass ? "ĐẠT" : "TRƯỢT") : "n/a"}${args.mutation ? ` · đột biến gác: ${meta.selfTest?.mutationPass ? "mọi gác ĐỎ khi gỡ" : "CÓ gác không đỏ"}` : ""}`);
    console.log(`[uim] cổng sau khi tắt: ${JSON.stringify(out.meta.portsAfter)} · user đo: ${JSON.stringify(out.meta.probeUserRemoved)}`);
    console.log(`[uim] ghi ${outFile} · pass=${out.pass}`);
    process.exitCode = out.pass ? 0 : 2;
  } catch (e) {
    await cleanup();
    console.error("[uim] LỖI:", e.message, `(log: ${logDir})`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
