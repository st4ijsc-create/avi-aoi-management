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
import { ENGINEERING_LEGACY_REDIRECTS, engineeringLegacyRoutes, legacyRedirectTarget } from "./engineeringLegacyRedirects";

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
