/**
 * Doc 81 Đợt 2 Task 3 — các DẤU BỐ CỤC mà thiết bị đo `scripts/ui-metrics/engineeringLayout.mjs`
 * đọc để chấm 14 màn Kỹ thuật & Điều khiển. Mọi layout dùng chung (SplitListDetail, CockpitLayout,
 * WorkbenchShell, EngineeringShell) gắn các dấu này đúng chỗ — trang dùng layout KHÔNG tự gắn lại.
 *
 * ── LUẬT CHO NGƯỜI VIẾT TRANG (đọc kèm README của thiết bị đo, mục "Ràng buộc cho các task sau") ──
 *
 * 1. `data-layout-main` (LAYOUT_MAIN) — vùng MAIN: editor / canvas / danh sách / bảng.
 *    - Phải nằm TRONG `<main>` (DashboardLayout đã có `<main>`).
 *    - KHÔNG được chứa `h1`, page header (`PageHeaderCompact` mang `data-layout-header`), notice
 *      (`NoticeChip`/`NoticeStack`/`FeatureStatusGate`/`role=alert`), hay dải KPI
 *      (`StatusChipStrip` mang `data-layout-kpi`). Đặt chúng PHÍA TRÊN MAIN, trong header.
 *    - Phần tử làm việc gốc (table / canvas / `.cm-editor` / `.react-flow` / `EmptyState`…) phải là
 *      phần tử làm việc ĐẦU TIÊN trong MAIN. Mọi khối đứng trước nó (<120 px, rộng ≥60 %) bị chấm là
 *      banner — trừ đúng MỘT `data-layout-toolbar` ≤56 px.
 * 2. `data-layout-toolbar` (LAYOUT_TOOLBAR) — tối đa MỘT thanh công cụ ≤56 px trong MAIN, đứng trên
 *    phần tử làm việc. Hai thanh, hoặc thanh >56 px, là LỖI.
 * 3. `data-layout-kpi` (LAYOUT_KPI) — gắn trên TỪNG chip của `StatusChipStrip` (chip ≥28 px; ở đây
 *    32 px). Dải chip đứng NGOÀI MAIN.
 * 4. Bề mặt AI / Inspector của workbench nằm NGOÀI MAIN (panel anh em), mang `role="complementary"`;
 *    khi là Copilot thì thêm `data-layout-ai` (LAYOUT_AI) để `workspacePct` trừ nó ra nếu lỡ lồng
 *    vào MAIN.
 * 5. `data-layout-header` (LAYOUT_HEADER) — header 1 dòng ≤48 px (`PageHeaderCompact`): h1 + chip
 *    notice + chip KPI + hành động trên CÙNG một hàng (khối nằm cạnh h1 không bị đếm là banner).
 *
 * Không có `data-layout-workspace` ở đây: thiết bị đo coi wrapper đó là lối lách (README, T17/T17b).
 */
export const LAYOUT_MAIN = "data-layout-main" as const;
export const LAYOUT_TOOLBAR = "data-layout-toolbar" as const;
export const LAYOUT_KPI = "data-layout-kpi" as const;
export const LAYOUT_AI = "data-layout-ai" as const;
export const LAYOUT_HEADER = "data-layout-header" as const;

/** Spread lên phần tử MAIN: `<div {...layoutMainProps("ecn-list")}>`. Giá trị chỉ để đọc log đo. */
export function layoutMainProps(name: string): Record<typeof LAYOUT_MAIN, string> {
  return { [LAYOUT_MAIN]: name };
}
