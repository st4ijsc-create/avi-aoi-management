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
 *   · selfTest        — đối chứng DƯƠNG trong mỗi lần chạy: chèn banner lồng sâu, lớp phủ fixed, KPI,
 *                       attribute vi phạm, hành động ma ⇒ thiết bị PHẢI bắt được cả năm.
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
  { n: 2, id: "engineering-studio", route: "/engineering-studio",
    legacyMain: { desc: "WorkspaceShell resizable-panel bên phải (panel nội dung)", pick: (rs) => { const c = rs.filter((r) => /WorkspaceShell\.tsx/.test(r.loc || "") && r.kind === "resizable-panel"); if (!c.length) return []; const mx = Math.max(...c.map((r) => r.x)); return c.filter((r) => r.x === mx).slice(0, 1); } },
    actions: [] },
  // IDE: editor chỉ hiện khi đã chọn dự án ⇒ mở bằng deep-link `?projectId=` (U1 doc 26, phải còn sống
  // qua Đợt 2) tới dự án cập nhật gần nhất trong `programming.listProjects` — FE1 có dự án đã chọn sẵn.
  { n: 3, id: "engineering", route: "/engineering", copilot: true, deepLink: "firstProject",
    legacyMain: { desc: "khung CodeMirror (vùng không data-loc, có input, cao ≥200)", fn: (r) => !r.loc && r.inp >= 1 && r.h >= 200 },
    actions: [{ id: "so-tay", label: /sổ tay/i }] },
  { n: 4, id: "engineering-changes", route: "/engineering-changes",
    legacyMain: { desc: "EngineeringChanges card chứa bảng", fn: (r) => /EngineeringChanges\.tsx/.test(r.loc || "") && r.kind === "card" && r.tbl >= 1 && r.depth === 0 },
    actions: [{ id: "thay-doi-moi", label: /Thay đổi mới/ }] },
  { n: 5, id: "recipes", route: "/recipes",
    legacyMain: { desc: "RecipeManagement: card 'Mã recipe' + card cùng hàng (phiên bản)", pick: (rs) => { const a = rs.find((r) => /RecipeManagement\.tsx/.test(r.loc || "") && r.kind === "card" && /^Mã recipe/.test(r.head)); if (!a) return []; return rs.filter((r) => /RecipeManagement\.tsx/.test(r.loc || "") && r.kind === "card" && r.depth === a.depth && Math.abs(r.y - a.y) <= 4); } },
    actions: [{ id: "luu-phien-ban-moi", label: /Lưu phiên bản mới/ }] },
  { n: 6, id: "interlock-rules", route: "/interlock-rules",
    legacyMain: { desc: "InterlockRuleManagement tabs-content đang mở", fn: (r) => /InterlockRuleManagement\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [{ id: "them-quy-tac", label: /Thêm quy tắc/ }] },
  { n: 7, id: "orchestration-studio", route: "/orchestration-studio",
    legacyMain: { desc: "OrchestrationStudio card Cây/Sơ đồ + Cấu hình bước", fn: (r) => /OrchestrationStudio\.tsx/.test(r.loc || "") && r.kind === "card" && /^(Cây quy trình|Sơ đồ|Cấu hình bước)/.test(r.head) },
    actions: [{ id: "phien-ban", label: /^Phiên bản$/ }, { id: "nhan-ban", label: /^Nhân bản$/ }] },
  { n: 8, id: "ir-editor", route: "/ir-editor", copilot: true,
    legacyMain: { desc: "card 'Vùng vẽ luồng'", fn: (r) => r.kind === "card" && /Vùng vẽ luồng/.test(r.head) },
    actions: [{ id: "project-ir-flow-moi", label: /Project ir-flow mới/ }] },
  { n: 9, id: "pou-studio", route: "/pou-studio", copilot: true,
    legacyMain: { desc: "card 'Trình soạn POU'", fn: (r) => r.kind === "card" && /Trình soạn POU/.test(r.head) },
    actions: [{ id: "luu-vao-project", label: /Lưu vào project/ }] },
  { n: 10, id: "programming-copilot", route: "/programming-copilot",
    legacyMain: { desc: "ProgrammingCopilot card đầu (form sinh mã)", pick: (rs) => rs.filter((r) => /ProgrammingCopilot\.tsx/.test(r.loc || "") && r.kind === "card" && r.depth === 0).slice(0, 1) },
    actions: [] },
  { n: 11, id: "fleet-orchestration", route: "/fleet-orchestration",
    legacyMain: { desc: "FleetOrchestration tabs-content đang mở", fn: (r) => /FleetOrchestration\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [] },
  { n: 12, id: "safety-workforce", route: "/safety-workforce",
    legacyMain: { desc: "SafetyWorkforce tabs-content đang mở", fn: (r) => /SafetyWorkforce\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [{ id: "bao-cao-tiem-can", label: /Báo cáo tiệm cận/ }] },
  { n: 13, id: "equipment-standards", route: "/equipment-standards",
    legacyMain: { desc: "EquipmentStandards tabs-content đang mở", fn: (r) => /EquipmentStandards\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [{ id: "dang-ky-loai", label: /Đăng ký loại/ }] },
  { n: 14, id: "equipment-integration", route: "/equipment-integration",
    legacyMain: { desc: "EquipmentIntegration tabs-content đang mở", fn: (r) => /EquipmentIntegration\.tsx/.test(r.loc || "") && r.kind === "tabs-content" },
    actions: [] },
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
 * `--discover-tables` (delta `pg_stat_user_tables.seq_scan+idx_scan` quanh từng lần nạp màn, chạy 2
 * lần, lấy GIAO để bỏ nhiễu của phiên khác). Mỗi bảng được băm NỘI DUNG (md5 từng hàng, sắp theo md5)
 * trước và sau mỗi lần đo. `cols` giới hạn cột khi chính instance đo ghi vào cột khác của bảng
 * (vd `users.lastSignedIn` khi đăng nhập). Xem `SELF_WRITTEN` cho bảng loại trừ có lý do.
 */
export const PAGE_TABLES = {
  "engineering-home": ["ai_insights","ai_pending_actions","andon_events","changeover_requests","daily_statistics","engineering_changes","equipment_3d_models","factories","interlock_events","interlock_rules","machine_recipes","machine_status_logs","machines","oee_metrics","orchestration_runs","permissions","product_inspections","product_machine_mappings","production_lines","robot_telemetry","robots","safety_events","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","vram_leases","workshops","zone_reservations","zones"],
  "engineering-studio": ["ai_insights","ai_pending_actions","andon_events","equipment_3d_models","factories","machines","permissions","product_inspections","production_lines","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","workshops","zones"],
  "engineering": ["ai_insights","ai_pending_actions","andon_events","daily_statistics","equipment_3d_models","factories","machine_status_logs","machines","oee_metrics","permissions","predictive_alerts","product_inspections","product_machine_mappings","production_lines","program_artifacts","program_deployments","program_projects","program_symbols","robot_jobs","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","vram_leases","workshops","zones"],
  "engineering-changes": ["ai_insights","ai_pending_actions","andon_events","engineering_changes","equipment_3d_models","factories","machines","permissions","product_inspections","product_models","production_lines","robot_telemetry","robots","sites","stations","tasks","user_factory_assignments","users","workshops","zones"],
  "recipes": ["ai_insights","ai_pending_actions","andon_events","daily_statistics","equipment_3d_models","factories","machine_recipes","machine_status_logs","machines","oee_metrics","permissions","predictive_alerts","product_inspections","product_machine_mappings","production_lines","recipe_deployments","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","vram_leases","workshops","zones"],
  "interlock-rules": ["ai_insights","ai_pending_actions","andon_events","daily_statistics","equipment_3d_models","factories","interlock_events","interlock_rules","machine_status_logs","machines","oee_metrics","permissions","predictive_alerts","product_inspections","product_machine_mappings","production_lines","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","vram_leases","workshops","zones"],
  "orchestration-studio": ["ai_insights","ai_pending_actions","andon_events","equipment_3d_models","factories","machines","orchestration_runs","orchestration_workflows","permissions","product_inspections","production_lines","robot_telemetry","robots","sites","stations","tasks","user_corporate_assignments","user_factory_assignments","users","workshops","zones"],
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
  "engineering-changes": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","ecn.list","license.getAllowedModules","license.systemState","permissions.getMyPermissions","productModel.list"],
  "recipes": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","license.getAllowedModules","license.systemState","machineRecipe.deployments.list","machineRecipe.machines.list","machineRecipe.recipes.listCodes","permissions.getMyPermissions"],
  "interlock-rules": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","interlock.events","interlock.list","license.getAllowedModules","license.systemState","permissions.getMyPermissions"],
  "orchestration-studio": ["aiInbox.count","aiOrchestration.status","andon.active","auth.me","commandCenter.hierarchy","equipment.listEquipment","license.getAllowedModules","license.systemState","orchestration.listRuns","orchestration.listVersions","orchestration.listWorkflows","orchestration.status","permissions.getMyPermissions"],
  "ir-editor": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","ir.lint","ir.listFlows","ir.status","license.getAllowedModules","license.systemState","permissions.getMyPermissions","programming.listProjects"],
  "pou-studio": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","license.getAllowedModules","license.systemState","permissions.getMyPermissions","programming.listProjects","programming.pouLint","programming.pouTranspilePreview"],
  "programming-copilot": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","license.getAllowedModules","license.systemState","permissions.getMyPermissions"],
  "fleet-orchestration": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","fleet.deadlocks","fleet.listChargers","fleet.listChargingPlans","fleet.listOperations","fleet.listReservations","fleet.listResourceReservations","fleet.listResources","fleet.listTasks","fleet.listZones","fleet.resourceStatus","fleet.status","license.getAllowedModules","license.systemState","permissions.getMyPermissions"],
  "safety-workforce": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","license.getAllowedModules","license.systemState","permissions.getMyPermissions","safety.currentBoard","safety.feed","safety.listAssignments","safety.listCollaborations","safety.nearMissTrend","safety.sourceHealth","safety.status"],
  "equipment-standards": ["aiInbox.count","alarmKpi.summary","andon.active","auth.me","commandCenter.hierarchy","equipmentStandards.complianceMetrics","equipmentStandards.hierarchyTree","equipmentStandards.listAlarmMappings","equipmentStandards.listChangeRequests","equipmentStandards.listMasterAlarms","equipmentStandards.status","license.getAllowedModules","license.systemState","permissions.getMyPermissions"],
  "equipment-integration": ["aiInbox.count","andon.active","auth.me","commandCenter.hierarchy","equipmentIntegration.integrationStatus","equipmentIntegration.status","license.getAllowedModules","license.systemState","machine.list","permissions.getMyPermissions"],
};

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
  const errors = [], warnings = [];
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cls = (e) => (typeof e.className === 'string' ? e.className : (e.getAttribute('class') || ''));
  const desc = (e) => { if (!e) return null; const loc = e.getAttribute('data-loc'); return { tag: e.tagName.toLowerCase(), testid: e.getAttribute('data-testid'), loc: loc ? loc.replace(/^.*[\\/]/, '') : null, role: e.getAttribute('role'), slot: e.getAttribute('data-slot'), label: (e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50) }; };
  const isNoticeCls = (e) => { const c = cls(e); return /(border|bg)-(amber|yellow|warning|info|blue|orange|destructive|red|sky|primary\/|success\/|muted)/.test(c) && /(border)/.test(c) && /(rounded)/.test(c) && /(p-2|p-3|p-4|px-3|px-4|py-2|py-3)/.test(c); };
  const NOTICE_TXT = /(Khi nào dùng|Beta|xem trước|Chỉ xem|chỉ đọc|advisory|TẮT|SIMULATED|không được phép|Bạn không có quyền|Chế độ|Lưu ý|Cảnh báo|Luồng vàng|thử nghiệm|preview)/i;
  const main = document.querySelector('main');
  if (!main) errors.push('không có phần tử <main>');

  // ── MAIN ──
  let mainEls = [];
  if (arg.mode === 'attr') {
    const all = [...document.querySelectorAll('[data-layout-main]')];
    for (const e of all) if (!main || !main.contains(e)) errors.push(`[data-layout-main] NẰM NGOÀI <main>: ${JSON.stringify(desc(e))}`);
    const inMain = all.filter((e) => main && main.contains(e) && vis(e));
    mainEls = inMain.filter((e) => !inMain.some((o) => o !== e && o.contains(e)));
    if (all.length && !mainEls.length) errors.push('[data-layout-main] có nhưng không phần tử nào nhìn thấy trong <main>');
  } else {
    mainEls = (arg.ids || []).map((id) => document.querySelector(`[data-uim-r="${id}"]`)).filter(Boolean);
    mainEls = mainEls.filter((e) => !mainEls.some((o) => o !== e && o.contains(e)));
  }
  if (!mainEls.length) errors.push('KHÔNG THẤY MAIN');

  // ── Ràng buộc MAIN (R-2-e a): không chứa h1 / page header / banner / KPI ──
  const FORBID = [
    ['h1', 'h1,[role=heading][aria-level="1"]'],
    ['page-header', '[data-loc*="PageHeader.tsx"],[data-layout-header]'],
    ['banner', '[role=alert],[data-slot=alert],[data-loc*="FeatureStatusGate.tsx"],[data-loc*="BetaBadge.tsx"],[data-layout-banner]'],
    ['kpi', '[data-loc*="MetricCard.tsx"],[data-layout-kpi]'],
  ];
  const violations = [];
  for (const m of mainEls) {
    for (const [kind, sel] of FORBID) {
      // banner = KHUNG (≥200×24), không phải chip/nhãn nhỏ (vd chip "Beta" trong ô công cụ) và không phải nút/liên kết
      const isBannerBox = (e) => { const r = e.getBoundingClientRect(); return r.width >= 200 && r.height >= 24 && !e.matches('button,a,[role=button]'); };
      const hits = [...(m.matches(sel) ? [m] : []), ...m.querySelectorAll(sel)].filter(vis).filter((e) => kind !== 'banner' || isBannerBox(e));
      if (hits.length) violations.push({ kind, n: hits.length, first: desc(hits[0]) });
    }
    const heur = [...m.querySelectorAll('*')].filter((e) => isNoticeCls(e) && vis(e) && !e.matches('button,a,[role=button]') && !e.closest('button,a,[role=button]') && e.getBoundingClientRect().width >= 200 && e.getBoundingClientRect().height < 260 && NOTICE_TXT.test((e.innerText || '').slice(0, 300)));
    if (heur.length) violations.push({ kind: 'banner-heuristic', n: heur.length, first: desc(heur[0]) });
  }
  for (const v of violations) (arg.mode === 'attr' ? errors : warnings).push(`MAIN chứa ${v.kind} ×${v.n}: ${JSON.stringify(v.first)}`);

  const mainRects = mainEls.map(R);
  const mainTop = mainRects.length ? Math.min(...mainRects.map((r) => r.y)) : null;

  // ── h1 ──
  const h1s = [...document.querySelectorAll('main h1')].filter(vis);
  const h1 = h1s[0] || [...document.querySelectorAll('h1')].filter(vis)[0] || null;
  const h1r = h1 ? R(h1) : null;
  if (!h1) warnings.push('trang KHÔNG có h1 nhìn thấy — dải "trước MAIN" tính từ đỉnh <main>');
  // page header = tổ tiên NGOÀI CÙNG của h1 mang data-loc PageHeader.tsx / [data-layout-header] / <header>, nếu nó không chứa MAIN
  let h1Header = null;
  if (h1) {
    for (let n = h1; n && n !== main && n !== document.body; n = n.parentElement) {
      if (n.matches('[data-loc*="PageHeader.tsx"],[data-layout-header],header')) h1Header = n;
    }
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
      if (st.position === 'fixed') continue; // lớp phủ — đo ở coverMain
      const r = ch.getBoundingClientRect();
      if (!vis(ch)) { if (ch.children.length && st.display !== 'none') walk(ch); continue; }
      const top = r.top + scrollY, bot = r.bottom + scrollY;
      if (mainTop == null || bot > mainTop + 1) continue; // không nằm HẲN trên MAIN (cột bên cạnh…)
      // không giao NGANG với MAIN ⇒ cột bên cạnh, không phải "trước" MAIN (vẫn hiện trong bandBlocks)
      const xOverlap = r.left < mainX1 && r.right > mainX0;
      const pos = !xOverlap ? 'besideMain' : (!h1r ? 'belowH1' : (bot <= h1r.y + 1 ? 'aboveH1' : (top >= h1r.y + h1r.h - 1 ? 'belowH1' : 'besideH1')));
      const txt = (ch.innerText || '').trim();
      const fe1Notice = ch.getAttribute('role') === 'alert' || ch.getAttribute('data-slot') === 'alert' || isNoticeCls(ch) || NOTICE_TXT.test(txt.slice(0, 300));
      const isKpi = ch.matches('[data-loc*="MetricCard.tsx"],[data-layout-kpi]') || !!ch.querySelector('[data-loc*="MetricCard.tsx"],[data-layout-kpi]');
      const isTabs = r.height <= 64 && (ch.matches('[role=tablist]') || !!ch.querySelector('[role=tablist]'));
      const kind = isKpi ? 'kpi' : isTabs ? 'tabs' : fe1Notice ? 'notice' : 'other';
      blocks.push({ ...R(ch), pos, kind, inHeader: !!(h1Header && h1Header.contains(ch)), ...desc(ch), fe1Notice });
    }
  };
  if (main) walk(main);
  const unionY = (list, lo, hi) => { const iv = list.map((b) => [Math.max(b.y, lo), Math.min(b.y + b.h, hi)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]); let s = 0, cs = -1, ce = -1; for (const [a, b] of iv) { if (a > ce) { if (ce > cs) s += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); } if (ce > cs) s += ce - cs; return Math.round(s); };
  const bandLo = h1r ? h1r.y + h1r.h : contentTop;
  const before = blocks.filter((b) => b.pos === 'belowH1' && !b.inHeader);
  const aboveH1 = blocks.filter((b) => b.pos === 'aboveH1' && !b.inHeader);
  const headerParts = blocks.filter((b) => b.inHeader);

  // ── KPI (R-2-e c): cả hai nguồn, luôn luôn ──
  const top = (els) => els.filter(vis).filter((e, _i, a) => !a.some((o) => o !== e && o.contains(e)));
  const kpiLegacyEls = top([...document.querySelectorAll('main [data-loc*="MetricCard.tsx"]')]);
  const kpiOfficialEls = top([...document.querySelectorAll('main [data-layout-kpi]')]);
  const kpiAll = top([...kpiLegacyEls, ...kpiOfficialEls]);
  const strip = (els) => els.length ? unionY(els.map(R), -1e9, 1e9) : 0;

  // ── Che MAIN (R-2-e d): hit-test lưới ──
  const STEP = 8;
  const clipTop = arg.clipTop || 0;
  const vr = mainEls.map((m) => m.getBoundingClientRect());
  let pts = 0, cov = 0; const culprits = new Map();
  if (vr.length) {
    const x0 = Math.max(0, Math.min(...vr.map((r) => r.left))), x1 = Math.min(vw, Math.max(...vr.map((r) => r.right)));
    const y0 = Math.max(clipTop, Math.min(...vr.map((r) => r.top))), y1 = Math.min(vh, Math.max(...vr.map((r) => r.bottom)));
    for (let y = Math.floor(y0 / STEP) * STEP + STEP / 2; y < y1; y += STEP) {
      for (let x = Math.floor(x0 / STEP) * STEP + STEP / 2; x < x1; x += STEP) {
        if (y < clipTop || !vr.some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom)) continue;
        pts++;
        const el = document.elementFromPoint(x, y);
        if (!el || mainEls.some((m) => m.contains(el)) || mainEls.some((m) => el.contains(m))) continue;
        cov++;
        let n = el, outer = el, posEl = null;
        while (n && n !== document.body && !mainEls.some((m) => n.contains(m))) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'absolute' || p === 'sticky') posEl = n; outer = n; n = n.parentElement; }
        const c = posEl || outer;
        const k = culprits.get(c) || { ...desc(c), position: getComputedStyle(c).position, zIndex: getComputedStyle(c).zIndex, rect: R(c), px: 0 };
        k.px += STEP * STEP; culprits.set(c, k);
      }
    }
  }
  // phụ: phần tử định vị cắt MAIN nhưng hit-test không thấy (pointer-events:none…) — chỉ báo
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

  // ── Chiều cao trang (cả container cuộn tổ tiên của MAIN) ──
  const docH = Math.max(document.scrollingElement.scrollHeight, main ? (main.scrollHeight + R(main).y) : 0);
  const scrollers = []; let extra = 0;
  if (mainEls[0]) for (let a = mainEls[0].parentElement; a && a !== main && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (/(auto|scroll|overlay)/.test(s.overflowY) && a.scrollHeight > a.clientHeight + 1) { extra += a.scrollHeight - a.clientHeight; scrollers.push({ ...desc(a), scrollH: a.scrollHeight, clientH: a.clientHeight }); }
  }
  const inner = [];
  for (const m of mainEls) for (const d of [m, ...m.querySelectorAll('*')]) { const s = getComputedStyle(d); if (/(auto|scroll|overlay)/.test(s.overflowY) && d.scrollHeight > d.clientHeight + 1 && d.clientHeight > 40) inner.push({ ...desc(d), scrollH: d.scrollHeight, clientH: d.clientHeight, ratio: +(d.scrollHeight / d.clientHeight).toFixed(2) }); }
  inner.sort((a, b) => b.ratio - a.ratio);

  const dialogs = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(vis).map((e) => ({ role: e.getAttribute('role'), slot: e.getAttribute('data-slot'), ...R(e) }));
  return {
    errors, warnings, mainCount: mainEls.length, mainRects, mainTop,
    h1: h1 ? { top: Math.round(h1.getBoundingClientRect().top), bottom: Math.round(h1.getBoundingClientRect().bottom), text: h1.innerText.replace(/\s+/g, ' ').slice(0, 60), inPageHeader: !!h1Header } : null, h1Count: h1s.length,
    band: { lo: Math.round(bandLo), before: { count: before.length, unionPx: unionY(before, bandLo, mainTop ?? 0), byKind: before.reduce((o, b) => { o[b.kind] = (o[b.kind] || 0) + 1; return o; }, {}) }, aboveH1: { count: aboveH1.length, unionPx: unionY(aboveH1, contentTop, h1r ? h1r.y : contentTop) }, headerParts: headerParts.length, blocks },
    kpi: { legacy: { count: kpiLegacyEls.length, stripPx: strip(kpiLegacyEls) }, official: { count: kpiOfficialEls.length, stripPx: strip(kpiOfficialEls) }, all: { count: kpiAll.length, stripPx: strip(kpiAll) } },
    cover: { step: STEP, points: pts, coveredPoints: cov, px: cov * STEP * STEP, items: [...culprits.values()].sort((a, b) => b.px - a.px), positionedIntersecting: positioned.map(({ el, ...rest }) => rest) },
    scroll: { docH, extra, scrollers, inner: inner.slice(0, 3) },
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

export function summarize(screen, variant, p1, p2, legacyP2) {
  const { vw, vh } = p1;
  const mode = p1.hasLayoutMainAttr ? "data-layout-main" : "fe1-legacy";
  const clipTop = p1.shell.topbarPos === "sticky" || p1.shell.topbarPos === "fixed" ? (p1.shell.topbarBottom ?? 0) : 0;
  const mainArea = unionArea(p2.mainRects, vw, vh, clipTop);
  // FE1: nhãn lớp CSS (phụ) — định nghĩa FE1 + loại trừ nút (*-trigger)
  const fe1Notices = p1.regions.filter((r) => r.notice && !BAD_NOTICE_KINDS.includes(r.kind) && !/-trigger$/.test(r.kind) && r.tag !== "BUTTON" && r.tag !== "A" && r.depth === 0 && !/PageHeader/.test(r.loc || ""));
  const fe1Before = p2.mainTop == null ? fe1Notices : fe1Notices.filter((n) => n.y < p2.mainTop);
  const errors = [...p2.errors], warnings = [...p2.warnings];
  if (mode === "fe1-legacy") warnings.push("CHƯA có [data-layout-main] — đo bằng selector FE1");
  const rec = {
    screen: screen.id, route: screen.route, vw, vh, variant,
    mainSource: mode, missingDataLayoutMain: mode !== "data-layout-main",
    mainSelector: mode === "data-layout-main" ? "[data-layout-main]" : screen.legacyMain.desc,
    mainFound: p2.mainCount > 0, mainRects: p2.mainRects, mainTop: p2.mainTop,
    chromeAboveMain: p2.mainTop,
    mainPct: +(mainArea / (vw * vh) * 100).toFixed(1),
    mainPctFe1: +(unionArea(p2.mainRects, vw, vh, 109) / (vw * vh) * 100).toFixed(1),
    mainPctUncovered: +(Math.max(0, mainArea - p2.cover.px) / (vw * vh) * 100).toFixed(1),
    h1Top: p2.h1 ? p2.h1.top : null, h1Bottom: p2.h1 ? p2.h1.bottom : null, h1Text: p2.h1 ? p2.h1.text : null, h1Missing: !p2.h1, h1Count: p2.h1Count,
    gapH1ToMain: p2.h1 && p2.mainTop != null ? p2.mainTop - p2.h1.bottom : null,
    breadcrumbs: p1.shell.crumbs.length,
    bannersBeforeMain: { count: p2.band.before.count, px: p2.band.before.unionPx, byKind: p2.band.before.byKind, method: p2.h1 ? "geometric: khối giữa đáy h1 và đỉnh MAIN, ngoài page header" : "geometric: khối giữa đỉnh <main> và đỉnh MAIN (không có h1)" },
    blocksAboveH1: p2.band.aboveH1, headerParts: p2.band.headerParts,
    bandBlocks: p2.band.blocks.map((b) => ({ pos: b.pos, kind: b.kind, inHeader: b.inHeader, y: b.y, h: b.h, x: b.x, w: b.w, loc: b.loc, tag: b.tag, testid: b.testid, label: b.label, fe1Notice: b.fe1Notice })),
    bannersFe1Class: { count: fe1Before.length, px: fe1Before.reduce((s, n) => s + n.h, 0), items: fe1Before.map((n) => ({ loc: (n.loc || "").replace(/^.*[\\/]/, ""), y: n.y, h: n.h, head: n.head.slice(0, 50) })) },
    kpi: p2.kpi,
    coverMain: { px: p2.cover.px, pctOfMain: mainArea ? +(p2.cover.px / mainArea * 100).toFixed(1) : 0, pctOfViewport: +(p2.cover.px / (vw * vh) * 100).toFixed(1), items: p2.cover.items, positionedIntersecting: p2.cover.positionedIntersecting },
    pageHeightRatio: +((p2.scroll.docH + p2.scroll.extra) / vh).toFixed(2), pageHeightRatioDoc: p1.scrollRatio, scroll: p2.scroll,
    shell: { sidebarW: p1.shell.sidebarW, topbarH: p1.shell.topbarH, mainTop: p1.shell.mainTop, mainW: p1.shell.mainW, mainPad: p1.shell.mainPad, breadcrumbLocs: p1.shell.crumbs.map((c) => (c.loc || "").replace(/^.*[\\/]/, "")) },
    dialogsAtLoad: { count: p2.dialogs.length, kinds: p2.dialogs.map(dialogKind) },
    spinnersAtMeasure: p1.spinners,
    errors, warnings,
  };
  if (legacyP2) rec.calibration = { legacyMainTop: legacyP2.mainTop, legacyMainPct: +(unionArea(legacyP2.mainRects, vw, vh, clipTop) / (vw * vh) * 100).toFixed(1), legacyMainRects: legacyP2.mainRects };
  return rec;
}
function dialogKind(d) {
  const s = d.slot || "";
  if (/sheet/.test(s)) return "sheet";
  if (/drawer/.test(s)) return "drawer";
  if (/alert-dialog/.test(s) || d.role === "alertdialog") return "alert-dialog";
  if (/popover/.test(s)) return "popover";
  if (/dialog/.test(s)) return "dialog";
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
    return [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { role: e.getAttribute('role'), slot: e.getAttribute('data-slot'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
  });
}
/** Hành động KHAI BÁO: không tìm thấy = LỖI; disabled = cảnh báo; mở được ⇒ ghi LOẠI dialog. */
async function runActions(page, actions) {
  const out = [];
  for (const a of actions || []) {
    const btn = page.locator("main").getByRole("button", { name: a.label }).first();
    const rec = { id: a.id, label: String(a.label) };
    if (!(await btn.count())) { out.push({ ...rec, status: "not-found", error: `hành động khai báo "${a.id}" KHÔNG TÌM THẤY` }); continue; }
    if (!(await btn.isEnabled())) { out.push({ ...rec, status: "disabled" }); continue; }
    await btn.click();
    await page.waitForTimeout(700);
    const ds = await countDialogs(page);
    rec.status = "opened"; rec.dialogs = ds.length; rec.kinds = ds.map(dialogKind); rec.rects = ds;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    rec.closedByEsc = (await countDialogs(page)).length === 0;
    if (!rec.closedByEsc) { await page.reload(); await settle(page); }
    out.push(rec);
  }
  return out;
}
async function measurePage(page, s, variant) {
  const p1 = await page.evaluate(PHASE1);
  const clipTop = p1.shell.topbarPos === "sticky" || p1.shell.topbarPos === "fixed" ? (p1.shell.topbarBottom ?? 0) : 0;
  const ids = legacyIds(s, p1.regions);
  const p2 = await page.evaluate(PHASE2, p1.hasLayoutMainAttr ? { mode: "attr", clipTop } : { mode: "legacy", ids, clipTop });
  const legacyP2 = p1.hasLayoutMainAttr && ids.length ? await page.evaluate(PHASE2, { mode: "legacy", ids, clipTop }) : null;
  return summarize(s, variant, p1, p2, legacyP2);
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
 * ĐỐI CHỨNG DƯƠNG trong mỗi lần chạy (MSA): trên ECN @1600, chèn từng nhiễu vào DOM thật rồi đo lại
 * ⇒ thiết bị PHẢI thấy. Mỗi phép chèn làm trên trang nạp lại sạch.
 */
async function selfTest(page, base, s) {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, ...detail });
  const fresh = async () => { await page.goto(base + s.route); await settle(page); await page.evaluate(() => window.scrollTo(0, 0)); };
  await fresh();
  const b0 = await measurePage(page, s, "selftest");
  // T1: banner lồng 2 tầng, lớp px-5 py-4 (lọt regex FE1), cao 100 px, chèn ngay trước nhánh chứa MAIN
  {
    const p1 = await page.evaluate(PHASE1);
    const id = legacyIds(s, p1.regions)[0];
    await page.evaluate((rid) => {
      const main = document.querySelector('main');
      const h1 = document.querySelector('main h1');
      const target = document.querySelector('main [data-layout-main]') || document.querySelector(`[data-uim-r="${rid}"]`);
      let a = target; while (a.parentElement && a.parentElement !== main && !(h1 && a.parentElement.contains(h1))) a = a.parentElement;
      const w = document.createElement('div');
      const w2 = document.createElement('div');
      const bn = document.createElement('div');
      bn.className = 'rounded-lg border border-amber-500/40 bg-amber-500/10 px-5 py-4';
      bn.style.height = '100px';
      bn.textContent = 'UIM tự kiểm — banner chèn';
      w2.appendChild(bn); w.appendChild(w2);
      a.parentElement.insertBefore(w, a);
    }, id);
  }
  const b1 = await measurePage(page, s, "selftest");
  check("banner-long-sau-px5-py4", b1.bannersBeforeMain.count === b0.bannersBeforeMain.count + 1 && b1.bannersBeforeMain.px >= b0.bannersBeforeMain.px + 100 && b1.chromeAboveMain >= b0.chromeAboveMain + 100,
    { before: { n: b0.bannersBeforeMain.count, px: b0.bannersBeforeMain.px, top: b0.chromeAboveMain, fe1: b0.bannersFe1Class.count }, after: { n: b1.bannersBeforeMain.count, px: b1.bannersBeforeMain.px, top: b1.chromeAboveMain, fe1: b1.bannersFe1Class.count } });
  // T2: lớp phủ fixed 200×200 không data-loc, z 9999, giữa MAIN
  await fresh();
  const r = b0.mainRects[0];
  await page.evaluate((rc) => { const d = document.createElement('div'); d.setAttribute('data-testid', 'uim-overlay'); d.style.cssText = `position:fixed;z-index:9999;left:${rc.x + 40}px;top:${Math.min(rc.y + 40, innerHeight - 220)}px;width:200px;height:200px;background:rgba(255,0,0,.3)`; document.body.appendChild(d); }, r);
  const b2 = await measurePage(page, s, "selftest");
  check("lop-phu-fixed-200x200", b2.coverMain.px >= b0.coverMain.px + 0.9 * 40000 && b2.coverMain.items.some((i) => i.testid === "uim-overlay"), { before: b0.coverMain.px, after: b2.coverMain.px, culprit: b2.coverMain.items[0] });
  // T3: thêm một chip [data-layout-kpi] — MetricCard cũ vẫn phải được đếm song song
  await fresh();
  {
    const p1 = await page.evaluate(PHASE1);
    const id = legacyIds(s, p1.regions)[0];
    await page.evaluate((rid) => {
      const main = document.querySelector('main');
      const h1 = document.querySelector('main h1');
      const target = document.querySelector('main [data-layout-main]') || document.querySelector(`[data-uim-r="${rid}"]`);
      let a = target; while (a.parentElement && a.parentElement !== main && !(h1 && a.parentElement.contains(h1))) a = a.parentElement;
      const d = document.createElement('div'); d.setAttribute('data-layout-kpi', ''); d.style.cssText = 'display:block;height:32px;width:120px'; d.textContent = 'KPI';
      a.parentElement.insertBefore(d, a);
    }, id);
  }
  const b3 = await measurePage(page, s, "selftest");
  check("kpi-chinh-thuc-va-cu", b3.kpi.official.count === b0.kpi.official.count + 1 && b3.kpi.legacy.count === b0.kpi.legacy.count, { before: b0.kpi, after: b3.kpi });
  // T4: attribute vi phạm — MAIN bọc h1, và một attribute ngoài <main>
  await fresh();
  await page.evaluate(() => { const h1 = document.querySelector('main h1'); let a = h1; while (a.parentElement && a.parentElement !== document.querySelector('main')) a = a.parentElement; a.setAttribute('data-layout-main', 'uim-test'); const o = document.createElement('div'); o.setAttribute('data-layout-main', 'ngoai'); o.style.cssText = 'height:20px;width:20px'; document.body.appendChild(o); });
  const b4 = await measurePage(page, s, "selftest");
  check("attribute-vi-pham", b4.errors.some((e) => /chứa h1/.test(e)) && b4.errors.some((e) => /NGOÀI <main>/.test(e)), { errors: b4.errors.slice(0, 4) });
  // T5: hành động khai báo không tồn tại
  await fresh();
  const acts = await runActions(page, [{ id: "uim-ma", label: /__khong_ton_tai_uim__/ }]);
  check("hanh-dong-khong-thay-la-loi", acts[0].status === "not-found" && !!acts[0].error, { got: acts[0] });
  return { screen: s.id, vw: (await page.viewportSize()).width, pass: checks.every((c) => c.pass), checks };
}

async function measureAll({ base, username, password, screens, sizes, shots, shotDir, listButtons, serverPid, serverPort, discover, doSelfTest }) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const results = [], buttons = {}, connections = [], discovered = {};
  let selfTestResult = null;
  try {
    for (const variant of ["closed", "open"]) {
      const list = screens.filter((s) => variant === "closed" || s.copilot);
      if (!list.length) continue;
      const ctx = await browser.newContext({ viewport: { width: sizes[0][0], height: sizes[0][1] }, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh", deviceScaleFactor: 1 });
      await ctx.addInitScript((dock) => { try { localStorage.setItem("i18nextLng", "vi"); localStorage.setItem("progCopilotDock.open", dock); localStorage.setItem("sidebar_open", "true"); } catch { /* */ } }, variant === "open" ? "1" : "0");
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
          const rec = await measurePage(page, s, s.copilot ? variant : "n/a");
          rec.actions = await runActions(page, s.actions);
          for (const a of rec.actions) { if (a.status === "not-found") rec.errors.push(a.error); if (a.status === "disabled") rec.warnings.push(`hành động "${a.id}" disabled cho role đo`); if (a.status === "opened" && !a.closedByEsc) rec.warnings.push(`hành động "${a.id}": Esc không đóng`); }
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
        selfTestResult = await selfTest(page, base, ecn);
        console.log(`[uim] tự kiểm (đối chứng dương): ${selfTestResult.pass ? "ĐẠT" : "TRƯỢT"} — ${selfTestResult.checks.map((c) => `${c.name}:${c.pass ? "✓" : "✗"}`).join(" ")}`);
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
  ["dialogsAtLoad", (r) => r.dialogsAtLoad.count], ["actions.sig", (r) => (r.actions || []).map((a) => `${a.id}:${a.status}:${(a.kinds || []).join("+")}`).join(";")],
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
  const FLAGS = ["spawn", "shots", "list-buttons", "keep", "discover-tables", "no-selftest"];
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
  const meta = { tool: "scripts/ui-metrics/engineeringLayout.mjs", startedAt: new Date().toISOString(), argv: process.argv.slice(2), sizes, flags, gitHead: (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO }).toString().trim(); } catch { return null; } })() };
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
    const r = await measureAll({ base, username: probe.username, password: probe.password, screens, sizes, shots: !!args.shots, shotDir, listButtons: !!args["list-buttons"], serverPid: s.child.pid, serverPort, discover: !!args["discover-tables"], doSelfTest: !args["no-selftest"] && !args["discover-tables"] && screens.some((x) => x.id === "engineering-changes") });
    meta.connections = [conn0, ...r.connections];
    meta.outboundViolations = meta.connections.flatMap((c) => c.violations || []);
    meta.selfTest = r.selfTest;
    if (!args["discover-tables"]) { meta.data.after = await dataSnapshot(tables); meta.data.drift = diffSnap(meta.data.before, meta.data.after); }
    const missing = [...new Set(r.results.filter((x) => x.missingDataLayoutMain).map((x) => x.screen))];
    const errors = r.results.flatMap((x) => x.errors.map((e) => `${x.screen}@${x.vw}/${x.variant}: ${e}`));
    meta.finishedAt = new Date().toISOString();
    const out = { meta, pagesMissingDataLayoutMain: missing, errors, results: r.results };
    if (args["list-buttons"]) out.buttons = r.buttons;
    if (args["discover-tables"]) out.discovered = r.discovered;
    await cleanup();
    await sleep(1500); out.meta.portsAfter = await portsReport([serverPort, vitePort]);
    out.pass = errors.length === 0 && meta.outboundViolations.length === 0 && (args["discover-tables"] || (Object.keys(meta.data.drift).length === 0 && (args["no-selftest"] || !!meta.selfTest?.pass)));
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
    if (missing.length) console.log(`\n⚠ ${missing.length}/${screens.length} màn CHƯA có [data-layout-main] — đang đo bằng selector FE1: ${missing.join(", ")}`);
    if (errors.length) console.log(`✗ ${errors.length} LỖI:\n  ${errors.join("\n  ")}`);
    console.log(`[uim] kết nối ngoài danh sách: ${meta.outboundViolations.length} · trôi dữ liệu trong lần chạy: ${meta.data.drift ? Object.keys(meta.data.drift).length : "n/a"} (${meta.data.tables} bảng) · tự kiểm: ${meta.selfTest ? (meta.selfTest.pass ? "ĐẠT" : "TRƯỢT") : "n/a"}`);
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
