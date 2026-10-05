// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 15 — hai URL cũ của module Kỹ thuật CHUYỂN HƯỚNG, GIỮ NGUYÊN query:
//   /engineering-studio   ⇒ /engineering-home  (Studio gộp vào Hub thành chế độ danh mục: thêm tab=catalog nếu thiếu)
//   /programming-copilot  ⇒ /engineering       (trang Copilot riêng thành chế độ scratch của IDE: thêm copilot=scratch nếu thiếu)
// (+ /engineering/studio — cách viết trong brief, chưa từng là route thật — đi cùng đích với /engineering-studio.)
// Luật: chuỗi query cũ được CHÉP NGUYÊN VĂN (không mã hoá lại), tham số mặc định chỉ THÊM khi chưa có (không bao giờ
// ghi đè), và chuyển hướng là REPLACE (nút Back không quay lại URL cũ rồi bị đẩy đi lần nữa).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Route, Router, Switch, useLocation, useRouter } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import APP_SRC from "../App.tsx?raw";
import EQ_SRC from "../pages/EquipmentIntegration.tsx?raw";
import SAFETY_SRC from "../pages/SafetyWorkforce.tsx?raw";
import {
  ENGINEERING_LEGACY_REDIRECTS,
  ENGINEERING_LEGACY_TAB_REDIRECTS,
  LegacyTabRedirectGate,
  PRODUCTION_SHIFTS_PATH,
  engineeringLegacyRoutes,
  legacyRedirectTarget,
  legacyTabRedirectTarget,
  type LegacyTabRedirect,
} from "./engineeringLegacyRedirects";

afterEach(() => cleanup());

function Where() {
  const [path] = useLocation();
  // query THÔ (useSearch của wouter decodeURI — %20 ⇒ dấu cách — sẽ che mất việc chép nguyên văn)
  const router = useRouter();
  const search = router.searchHook(router);
  return <output data-testid="where">{search ? `${path}?${search}` : path}</output>;
}

/** Dựng ĐÚNG các <Route> mà App.tsx dựng (cùng hàm) trong một Switch, trước một route bắt-tất-cả. */
function go(start: string) {
  const loc = memoryLocation({ path: start, record: true });
  const r = render(
    <Router hook={loc.hook} searchHook={loc.searchHook}>
      <Switch>
        {engineeringLegacyRoutes()}
        <Route><Where /></Route>
      </Switch>
    </Router>,
  );
  return { where: () => r.getByTestId("where").textContent, history: loc.history! };
}

describe("chuyển hướng giữ query (mỗi URL cũ)", () => {
  it.each([
    ["/programming-copilot?projectId=3&q=a%20b&vendor=delta", "/engineering?projectId=3&q=a%20b&vendor=delta&copilot=scratch"],
    ["/programming-copilot", "/engineering?copilot=scratch"],
    ["/programming-copilot?copilot=scratch&x=1", "/engineering?copilot=scratch&x=1"],
    ["/engineering-studio?projectId=7&filter=pending", "/engineering-home?projectId=7&filter=pending&tab=catalog"],
    ["/engineering-studio", "/engineering-home?tab=catalog"],
    // tham số trùng tên KHÔNG bị ghi đè (giữ nguyên query là tuyệt đối)
    ["/engineering-studio?tab=inbox&scope=all", "/engineering-home?tab=inbox&scope=all"],
    ["/engineering/studio?a=1", "/engineering-home?a=1&tab=catalog"],
  ])("%s ⇒ %s (REPLACE)", (start, expected) => {
    const r = go(start);
    expect(r.where()).toBe(expected);
    // replace: lịch sử chỉ còn URL đích, URL cũ không còn để Back quay về
    expect(r.history).toEqual([expected]);
  });

  it("legacyRedirectTarget: chuỗi query chép nguyên văn (kể cả ký tự mã hoá, thứ tự, tham số lặp)", () => {
    expect(legacyRedirectTarget("/x", "?b=2&a=%2F&a=3", { c: "1" })).toBe("/x?b=2&a=%2F&a=3&c=1");
    expect(legacyRedirectTarget("/x", "b=2", {})).toBe("/x?b=2");
    expect(legacyRedirectTarget("/x", "", {})).toBe("/x");
    expect(legacyRedirectTarget("/x", "?", { c: "1" })).toBe("/x?c=1");
  });

  it("bảng chuyển hướng: đúng đích + tham số mặc định đã chốt", () => {
    const m = Object.fromEntries(ENGINEERING_LEGACY_REDIRECTS.map((r) => [r.from, `${r.to}|${JSON.stringify(r.add)}`]));
    expect(m["/engineering-studio"]).toBe('/engineering-home|{"tab":"catalog"}');
    expect(m["/programming-copilot"]).toBe('/engineering|{"copilot":"scratch"}');
  });
});

describe("App.tsx dùng đúng bảng này (không còn trang cũ)", () => {
  it("App.tsx gọi engineeringLegacyRoutes() trong Switch và không còn route/trang riêng cho hai URL cũ", () => {
    expect(APP_SRC).toMatch(/\{engineeringLegacyRoutes\(\)\}/);
    expect(APP_SRC).not.toMatch(/<Route path="\/engineering-studio"/);
    expect(APP_SRC).not.toMatch(/<Route path="\/programming-copilot"/);
    expect(APP_SRC).not.toMatch(/pages\/EngineeringStudioHub/);
    expect(APP_SRC).not.toMatch(/pages\/ProgrammingCopilot"/);
  });

  it("không route nào ĐỨNG TRƯỚC trong App.tsx nuốt hai URL cũ (vị trí gọi nằm trước catch-all/NotFound)", () => {
    const at = APP_SRC.indexOf("{engineeringLegacyRoutes()}");
    const nf = APP_SRC.search(/<Route component=\{NotFound\}|<Route>\s*<NotFound|path="\/:rest\*"/);
    expect(at).toBeGreaterThan(0);
    if (nf > 0) expect(at).toBeLessThan(nf);
  });
});

// ── Doc 81 Đợt 3 Task 1 — tab cũ của Equipment Integration dời sang Recipes ────────────────────────────────────
// `/equipment-integration?tab=recipes|history` ⇒ `/recipes?tab=versions|history`, query cũ NGUYÊN VĂN (giữ `?code=` /
// `?machineId=` / mọi tham số khác), chỉ GIÁ TRỊ của `tab` đổi; REPLACE. Tab còn lại (status/acquisition) KHÔNG chuyển.
function GateProbe() {
  const [path] = useLocation();
  const router = useRouter();
  const search = router.searchHook(router);
  return <output data-testid="where">{search ? `${path}?${search}` : path}</output>;
}
function goGate(start: string, when?: boolean | ((r: LegacyTabRedirect) => boolean)) {
  const loc = memoryLocation({ path: start, record: true });
  const r = render(
    <Router hook={loc.hook} searchHook={loc.searchHook}>
      <LegacyTabRedirectGate from="/equipment-integration" when={when}>
        <span data-testid="page">trang cũ</span>
      </LegacyTabRedirectGate>
      <GateProbe />
    </Router>,
  );
  return { where: () => r.getByTestId("where").textContent, page: () => r.queryByTestId("page"), history: loc.history! };
}

describe("chuyển hướng theo TAB (Đợt 3 Task 1): Integration → Recipes", () => {
  it.each([
    ["/equipment-integration?tab=recipes&code=RCP-1", "/recipes?tab=versions&code=RCP-1"],
    ["/equipment-integration?tab=history&machineId=3", "/recipes?tab=history&machineId=3"],
    ["/equipment-integration?code=A%20B&tab=recipes&x=1&x=2", "/recipes?code=A%20B&tab=versions&x=1&x=2"],
    ["/equipment-integration?tab=recipes&code=RCP-1&flyout=eq-recipe-load&flyoutId=102", "/recipes?tab=versions&code=RCP-1&flyout=eq-recipe-load&flyoutId=102"],
    // `tab` lặp: URLSearchParams lấy giá trị ĐẦU ⇒ chuyển; các `tab` gộp về một ở vị trí đầu
    ["/equipment-integration?tab=history&code=C&tab=status", "/recipes?tab=history&code=C"],
  ])("%s ⇒ %s (REPLACE, query giữ nguyên văn)", (start, expected) => {
    const r = goGate(start);
    expect(r.where()).toBe(expected);
    expect(r.history).toEqual([expected]);
  });

  it.each([
    "/equipment-integration",
    "/equipment-integration?tab=status&connector=adapter:ot-s7",
    "/equipment-integration?tab=bogus",
  ])("%s — tab còn ở Integration ⇒ KHÔNG chuyển, dựng trang", (start) => {
    const r = goGate(start);
    expect(r.where()).toBe(start);
    expect(r.page()).toBeTruthy();
  });

  it("Fix round 1 (R-3-b): `when={false}` (người dùng KHÔNG mở được đích) ⇒ KHÔNG chuyển, dựng trang cũ; mặc định/`true` ⇒ chuyển", () => {
    let r = goGate("/equipment-integration?tab=history&machineId=3", false);
    expect(r.where()).toBe("/equipment-integration?tab=history&machineId=3");
    expect(r.page()).toBeTruthy();
    cleanup();
    r = goGate("/equipment-integration?tab=history&machineId=3", true);
    expect(r.where()).toBe("/recipes?tab=history&machineId=3");
  });

  it("chỉ áp cho đúng đường dẫn `from` (cổng nằm ở trang khác thì không chuyển)", () => {
    const r = goGate("/somewhere-else?tab=recipes&code=X");
    expect(r.where()).toBe("/somewhere-else?tab=recipes&code=X");
    expect(r.page()).toBeTruthy();
  });

  it("bảng: đúng đích + giá trị tab đích (Đợt 3 Task 2: acquisition ⇒ trang KHÔNG tab, bỏ `tab`); legacyTabRedirectTarget chép nguyên văn phần còn lại", () => {
    const m = Object.fromEntries(ENGINEERING_LEGACY_TAB_REDIRECTS.map((r) => [`${r.from}?tab=${r.tab}`, r.tabTo ? `${r.to}?tab=${r.tabTo}` : r.to]));
    expect(m).toEqual({
      "/equipment-integration?tab=recipes": "/recipes?tab=versions",
      "/equipment-integration?tab=history": "/recipes?tab=history",
      "/equipment-integration?tab=acquisition": "/vision/acquisition",
      // Đợt 3 Task 3 — bảng nhân lực của Safety ⇒ Sản xuất › Ca (trang KHÔNG tab).
      "/safety-workforce?tab=workforce": "/production/shifts",
    });
    expect(legacyTabRedirectTarget("/r", "?a=%2F&tab=x&b=1", "h")).toBe("/r?a=%2F&tab=h&b=1");
    expect(legacyTabRedirectTarget("/r", "a=1", "h")).toBe("/r?tab=h&a=1");
    // không có tab đích ⇒ GỠ mọi `tab`, phần còn lại nguyên văn; không còn gì ⇒ đường dẫn trần
    expect(legacyTabRedirectTarget("/r", "?a=%2F&tab=x&b=1&tab=y", undefined)).toBe("/r?a=%2F&b=1");
    expect(legacyTabRedirectTarget("/r", "?tab=x", undefined)).toBe("/r");
  });

  it("EquipmentIntegration.tsx bọc trang bằng LegacyTabRedirectGate từ đúng đường dẫn của nó; mỗi đích chỉ chuyển người MỞ ĐƯỢC đích (R-3-b; Đợt 3 Task 2)", () => {
    // ĐỔI BỘ CHỌN (Đợt 3 Task 2): `when` thành hàm theo từng chuyển hướng — /recipes ⇒ machine_control/canView (R-3-b),
    // /vision/acquisition ⇒ machine_alerts/canView (cổng của trang mới, QĐ-3c).
    expect(EQ_SRC).toMatch(/<LegacyTabRedirectGate from=\{BASE_PATH\} when=\{\(r\) => \(r\.to === VISION_ACQUISITION_PATH \? canViewAcq : canOpenRecipes\)\}>/);
    expect(EQ_SRC).toMatch(/const canOpenRecipes = hasPermission\("machine_control", "canView"\);/);
    expect(EQ_SRC).toMatch(/const canViewAcq = hasPermission\("machine_alerts", "canView"\);/);
    expect(EQ_SRC).toMatch(/const BASE_PATH = "\/equipment-integration";/);
  });
});

// ── Doc 81 Đợt 3 Task 2 — tab "Worker thu ảnh" của Integration dời sang Vision › Thu ảnh (trang KHÔNG tab) ───────────
describe("chuyển hướng theo TAB (Đợt 3 Task 2): Integration ?tab=acquisition → /vision/acquisition", () => {
  it.each([
    ["/equipment-integration?tab=acquisition", "/vision/acquisition"],
    ["/equipment-integration?tab=acquisition&flyout=acq-start", "/vision/acquisition?flyout=acq-start"],
    ["/equipment-integration?x=a%20b&tab=acquisition&x=2", "/vision/acquisition?x=a%20b&x=2"],
  ])("%s ⇒ %s (REPLACE, query giữ nguyên văn, bỏ `tab`)", (start, expected) => {
    const r = goGate(start);
    expect(r.where()).toBe(expected);
    expect(r.history).toEqual([expected]);
  });

  it("`when` theo từng đích: người KHÔNG mở được /vision/acquisition ở lại (không bị đẩy vào trang từ chối); đích khác không ảnh hưởng", () => {
    const onlyRecipes = (r: LegacyTabRedirect) => r.to === "/recipes";
    let g = goGate("/equipment-integration?tab=acquisition&flyout=acq-start", onlyRecipes);
    expect(g.where()).toBe("/equipment-integration?tab=acquisition&flyout=acq-start");
    expect(g.page()).toBeTruthy();
    cleanup();
    g = goGate("/equipment-integration?tab=history&machineId=3", onlyRecipes);
    expect(g.where()).toBe("/recipes?tab=history&machineId=3");
    cleanup();
    g = goGate("/equipment-integration?tab=history&machineId=3", (r) => r.to !== "/recipes");
    expect(g.where()).toBe("/equipment-integration?tab=history&machineId=3");
    cleanup();
    g = goGate("/equipment-integration?tab=acquisition", (r) => r.to !== "/recipes");
    expect(g.where()).toBe("/vision/acquisition");
  });
});

// ── Doc 81 Đợt 3 Task 3 — tab "Nhân lực" của Safety dời sang Sản xuất › Ca (trang KHÔNG tab) ────────────────────────────
function goSafety(start: string, when?: boolean | ((r: LegacyTabRedirect) => boolean)) {
  const loc = memoryLocation({ path: start, record: true });
  const r = render(
    <Router hook={loc.hook} searchHook={loc.searchHook}>
      <LegacyTabRedirectGate from="/safety-workforce" when={when}>
        <span data-testid="page">trang cũ</span>
      </LegacyTabRedirectGate>
      <GateProbe />
    </Router>,
  );
  return { where: () => r.getByTestId("where").textContent, page: () => r.queryByTestId("page"), history: loc.history! };
}

describe("chuyển hướng theo TAB (Đợt 3 Task 3): Safety ?tab=workforce → /production/shifts", () => {
  it("đích là hằng PRODUCTION_SHIFTS_PATH = /production/shifts", () => {
    expect(PRODUCTION_SHIFTS_PATH).toBe("/production/shifts");
  });

  it.each([
    ["/safety-workforce?tab=workforce", "/production/shifts"],
    ["/safety-workforce?tab=workforce&flyout=workforce-reassign&flyoutId=3", "/production/shifts?flyout=workforce-reassign&flyoutId=3"],
    ["/safety-workforce?x=a%20b&tab=workforce&x=2", "/production/shifts?x=a%20b&x=2"],
    // Deep link SHEET phân công cũ (không kèm `tab`, sheet mở trên tab mặc định) — sheet đã dời theo ⇒ cũng chuyển.
    ["/safety-workforce?flyout=workforce-assign", "/production/shifts?flyout=workforce-assign"],
    ["/safety-workforce?tab=cockpit&flyout=workforce-reassign&flyoutId=5", "/production/shifts?flyout=workforce-reassign&flyoutId=5"],
  ])("%s ⇒ %s (REPLACE, query giữ nguyên văn, bỏ `tab`)", (start, expected) => {
    const r = goSafety(start);
    expect(r.where()).toBe(expected);
    expect(r.history).toEqual([expected]);
  });

  it.each([
    "/safety-workforce",
    "/safety-workforce?tab=cockpit",
    "/safety-workforce?filter=pending",
    // Phối hợp Ở LẠI Safety: sheet bắt đầu phối hợp và sheet báo cáo tiệm cận KHÔNG chuyển.
    "/safety-workforce?flyout=collab-start",
    "/safety-workforce?flyout=safety-proximity",
  ])("%s — nội dung còn ở Safety ⇒ KHÔNG chuyển, dựng trang", (start) => {
    const r = goSafety(start);
    expect(r.where()).toBe(start);
    expect(r.page()).toBeTruthy();
  });

  it("`when` = false (người KHÔNG mở được /production/shifts) ⇒ ở lại Safety như cũ; bảng Integration không bị ảnh hưởng", () => {
    let g = goSafety("/safety-workforce?tab=workforce&flyout=workforce-assign", false);
    expect(g.where()).toBe("/safety-workforce?tab=workforce&flyout=workforce-assign");
    expect(g.page()).toBeTruthy();
    cleanup();
    // flyout của Safety không làm Integration chuyển hướng (khớp theo `from`).
    g = goGate("/equipment-integration?flyout=workforce-assign");
    expect(g.where()).toBe("/equipment-integration?flyout=workforce-assign");
  });

  it("SafetyWorkforce.tsx bọc trang bằng LegacyTabRedirectGate từ đúng đường dẫn; chỉ chuyển người MỞ ĐƯỢC /production/shifts (quyền của mục điều hướng đích)", () => {
    expect(SAFETY_SRC).toMatch(/<LegacyTabRedirectGate from=\{BASE_PATH\} when=\{canOpenShifts\}>/);
    expect(SAFETY_SRC).toMatch(/const canOpenShifts = [^;]*hasPermission\(getRequiredPermissionForHref\(PRODUCTION_SHIFTS_PATH\)/);
    expect(SAFETY_SRC).toMatch(/const BASE_PATH = "\/safety-workforce";/);
  });
});
