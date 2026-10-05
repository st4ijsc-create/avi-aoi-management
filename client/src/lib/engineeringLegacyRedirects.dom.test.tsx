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
import {
  ENGINEERING_LEGACY_REDIRECTS,
  ENGINEERING_LEGACY_TAB_REDIRECTS,
  LegacyTabRedirectGate,
  engineeringLegacyRoutes,
  legacyRedirectTarget,
  legacyTabRedirectTarget,
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
function goGate(start: string, when?: boolean) {
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
    "/equipment-integration?tab=acquisition",
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

  it("bảng: đúng đích + giá trị tab đích; legacyTabRedirectTarget chép nguyên văn phần còn lại", () => {
    const m = Object.fromEntries(ENGINEERING_LEGACY_TAB_REDIRECTS.map((r) => [`${r.from}?tab=${r.tab}`, `${r.to}?tab=${r.tabTo}`]));
    expect(m).toEqual({ "/equipment-integration?tab=recipes": "/recipes?tab=versions", "/equipment-integration?tab=history": "/recipes?tab=history" });
    expect(legacyTabRedirectTarget("/r", "?a=%2F&tab=x&b=1", "h")).toBe("/r?a=%2F&tab=h&b=1");
    expect(legacyTabRedirectTarget("/r", "a=1", "h")).toBe("/r?tab=h&a=1");
  });

  it("EquipmentIntegration.tsx bọc trang bằng LegacyTabRedirectGate từ đúng đường dẫn của nó, chỉ chuyển người mở được /recipes (R-3-b)", () => {
    expect(EQ_SRC).toMatch(/<LegacyTabRedirectGate from=\{BASE_PATH\} when=\{hasPermission\("machine_control", "canView"\)\}>/);
    expect(EQ_SRC).toMatch(/const BASE_PATH = "\/equipment-integration";/);
  });
});
