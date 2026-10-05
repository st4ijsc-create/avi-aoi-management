/**
 * Doc 81 Đợt 3 Task 2 — điều hướng theo vai của Vision › Thu ảnh (`/vision/acquisition`), [QĐ-3c]: GIỮ ĐÚNG cổng cũ
 * (machine_alerts/canView + cờ thu ảnh trực tiếp của server), KHÔNG thêm `MOD_AI` dù mục nằm trong khu Vision.
 *
 * "Ai thấy mục này trước thì vẫn thấy" — đo trên seed `DEFAULT_ROLE_PERMISSIONS` (đọc mã nguồn, không chép tay):
 *   TRƯỚC: thấy worker thu ảnh ⇔ thấy mục `/equipment-integration` trong điều hướng (⌘K, tập đầy đủ nhất) VÀ có
 *          `machine_alerts/canView` (tab hiện câu khoá khi thiếu — không phải thấy worker).
 *   SAU:   thấy mục `/vision/acquisition` ⇔ `machine_alerts/canView`; RouteGuard của route (navHref) cho qua.
 * Giấy phép: route thuộc `MOD_OT_CONTROL` như `/equipment-integration`; nhóm AI (MOD_AI) KHÔNG ẩn mục (licenseModule).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolvePermissionModule } from "@shared/permissions";
import { getModuleByRoute } from "@shared/module-registry";
import { filterNavGroupsByLicense, getFilteredNavGroups, getSearchNavGroups, hasAccessToItem, navGroups } from "./navigation";
import { getAppForRoute, scopeGroupsToApp } from "./apps";

type Row = { moduleName: string; category: string; canView: boolean };
function seedRoles(): Record<string, Row[]> {
  const src = readFileSync(new URL("../../../server/routers/permissionsRouter.ts", import.meta.url), "utf8");
  const start = src.indexOf("const DEFAULT_ROLE_PERMISSIONS");
  const block = src.slice(start, src.indexOf("\n};", start));
  const out: Record<string, Row[]> = {};
  let role: string | null = null;
  for (const line of block.split("\n")) {
    const r = /^ {2}([a-z_]+): \[/.exec(line);
    if (r) { role = r[1]; out[role] = []; continue; }
    const m = /\{\s*category:\s*'([^']+)',\s*moduleName:\s*'([^']+)',\s*canView:\s*(true|false)/.exec(line);
    if (m && role) out[role].push({ category: m[1], moduleName: m[2], canView: m[3] === "true" });
  }
  return out;
}
const ROLES = seedRoles();
const checkers = (role: string) => {
  const rows = ROLES[role];
  const hasPermission = (moduleName: string, action: string) =>
    action === "canView" && !!rows.find((x) => x.moduleName === resolvePermissionModule(moduleName))?.canView;
  const hasAnyCategoryPermission = (c: string) => rows.some((x) => x.category === c && x.canView);
  return { hasPermission, hasAnyCategoryPermission };
};
const sees = (role: string, href: string) => {
  const c = checkers(role);
  return getSearchNavGroups(role, c.hasPermission, c.hasAnyCategoryPermission).some((g) => g.items.some((i) => i.href === href));
};
const NEW = "/vision/acquisition";
const OLD = "/equipment-integration";

describe("Vision › Thu ảnh — điều hướng theo vai (QĐ-3c)", () => {
  it("thiết bị đo đọc được seed: ≥6 vai; có vai CÓ và vai KHÔNG có machine_alerts/canView (đối chứng hai phía)", () => {
    expect(Object.keys(ROLES).length).toBeGreaterThanOrEqual(6);
    const withAlerts = Object.keys(ROLES).filter((r) => r !== "admin" && checkers(r).hasPermission("machine_alerts", "canView"));
    const without = Object.keys(ROLES).filter((r) => r !== "admin" && !checkers(r).hasPermission("machine_alerts", "canView"));
    expect(withAlerts).toEqual(expect.arrayContaining(["engineer", "maintenance"]));
    expect(without).toEqual(expect.arrayContaining(["operator", "viewer"]));
  });

  it.each(Object.keys(ROLES).filter((r) => r !== "admin"))("%s — ai thấy worker trước thì vẫn thấy; mục mới ⇔ machine_alerts/canView; RouteGuard cho qua", (role) => {
    const c = checkers(role);
    const sawBefore = sees(role, OLD) && c.hasPermission("machine_alerts", "canView");
    const seesNow = sees(role, NEW);
    if (sawBefore) expect(seesNow).toBe(true);
    expect(seesNow).toBe(c.hasPermission("machine_alerts", "canView"));
    if (seesNow) expect(hasAccessToItem(NEW, role, c.hasPermission)).toBe(true);
  });

  it("mục nằm ở nhóm AI, section visionLab; quyền machine_alerts; KHÔNG khai vai/nhóm admin", () => {
    const g = navGroups.find((x) => x.items.some((i) => i.href === NEW))!;
    expect(g.id).toBe("ai");
    const item = g.items.find((i) => i.href === NEW)!;
    expect(item.section).toBe("visionLab");
    expect(item.requiredPermission).toBe("machine_alerts");
    expect(item.requiredRole).toBeUndefined();
    expect(item.licenseModule).toBe("MOD_OT_CONTROL");
  });

  it("App.tsx: route mới dùng RouteGuard navHref (= cổng điều hướng), KHÔNG requireModule MOD_AI", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const line = app.split("\n").find((l) => l.includes(`<Route path="${NEW}">`));
    expect(line).toBeTruthy();
    expect(line).toMatch(new RegExp(`<RouteGuard navHref="${NEW}">`));
    expect(line).not.toMatch(/MOD_AI/);
  });

  it("giấy phép: route thuộc CÙNG module với /equipment-integration (MOD_OT_CONTROL); app = AI (khu Vision)", () => {
    expect(getModuleByRoute(NEW)?.code).toBe("MOD_OT_CONTROL");
    expect(getModuleByRoute(NEW)?.code).toBe(getModuleByRoute(OLD)?.code);
    expect(getAppForRoute(NEW)?.appId).toBe("ai");
  });

  it("lọc giấy phép: SKU có OT mà KHÔNG có MOD_AI ⇒ mục VẪN hiện (các mục AI khác ẩn); không có OT ⇒ ẩn như /equipment-integration", () => {
    const groups = getFilteredNavGroups("admin");
    const run = (allowed: string[]) => {
      const set = new Set(allowed);
      const groupModule: Record<string, string> = { ai: "MOD_AI", engineering: "MOD_OT_CONTROL" };
      const isNavGroupAllowed = (id: string) => (groupModule[id] ? set.has(groupModule[id]) : true);
      const isModuleAllowed = (code: string) => set.has(code);
      const isRouteAllowed = (href: string) => {
        const m = getModuleByRoute(href);
        return !m || m.isCore || set.has(m.code);
      };
      return filterNavGroupsByLicense(groups, isNavGroupAllowed, isModuleAllowed, isRouteAllowed).flatMap((g) => g.items.map((i) => i.href));
    };
    const otOnly = run(["MOD_OT_CONTROL"]);
    expect(otOnly).toContain(NEW);
    expect(otOnly).toContain(OLD);
    expect(otOnly).not.toContain("/ai-advanced-vision-lab");
    const aiOnly = run(["MOD_AI"]);
    expect(aiOnly).not.toContain(NEW);
    expect(aiOnly).not.toContain(OLD);
    expect(aiOnly).toContain("/ai-advanced-vision-lab");
  });

  it("lọc giấy phép: mục KHÔNG khai licenseModule giữ đúng luật cũ (nhóm bị chặn ⇒ ẩn hết; route bị chặn ⇒ ẩn mục)", () => {
    const groups = getFilteredNavGroups("admin");
    const before = groups
      .filter((g) => g.id !== "ai")
      .map((g) => ({ ...g, items: g.items.filter((i) => i.href !== "/equipment-standards") }))
      .filter((g) => g.items.length > 0)
      .flatMap((g) => g.items.map((i) => i.href))
      .filter((h) => h !== NEW);
    const after = filterNavGroupsByLicense(groups, (id) => id !== "ai", () => false, (h) => h !== "/equipment-standards").flatMap((g) => g.items.map((i) => i.href));
    expect(after).toEqual(before);
  });

  it("launcher: engineer trong app AI thấy mục ở Vision; app Kỹ thuật KHÔNG còn mục này", () => {
    const c = checkers("engineer");
    const g = getFilteredNavGroups("engineer", c.hasPermission, c.hasAnyCategoryPermission);
    expect(scopeGroupsToApp(g, "ai").flatMap((x) => x.items.map((i) => i.href))).toContain(NEW);
    expect(scopeGroupsToApp(g, "engineering").flatMap((x) => x.items.map((i) => i.href))).not.toContain(NEW);
  });

  // ── Fix round 1 (Ruling R-3-d) — bí danh trong nhóm Kỹ thuật CHỈ khi giấy phép KHÔNG có MOD_AI ───────────────────
  const ALIAS = "/engineering/vision-acquisition";
  const runLic = (allowed: string[], role = "admin") => {
    const c = checkers(role === "admin" ? "engineer" : role);
    const groups = role === "admin" ? getFilteredNavGroups("admin") : getFilteredNavGroups(role, c.hasPermission, c.hasAnyCategoryPermission);
    const set = new Set(allowed);
    const groupModule: Record<string, string> = { ai: "MOD_AI", engineering: "MOD_OT_CONTROL" };
    const isNavGroupAllowed = (id: string) => (groupModule[id] ? set.has(groupModule[id]) : true);
    const isModuleAllowed = (code: string) => set.has(code);
    const isRouteAllowed = (href: string) => {
      const m = getModuleByRoute(href);
      return !m || m.isCore || set.has(m.code);
    };
    return filterNavGroupsByLicense(groups, isNavGroupAllowed, isModuleAllowed, isRouteAllowed);
  };
  const hrefs = (g: ReturnType<typeof runLic>) => g.flatMap((x) => x.items.map((i) => i.href));

  it("R-3-d: bí danh ở nhóm Kỹ thuật (section standardsIntegration), cùng quyền machine_alerts, chỉ hiện khi KHÔNG có MOD_AI", () => {
    const g = navGroups.find((x) => x.items.some((i) => i.href === ALIAS))!;
    expect(g.id).toBe("engineering");
    const item = g.items.find((i) => i.href === ALIAS)!;
    expect(item.section).toBe("standardsIntegration");
    expect(item.requiredPermission).toBe("machine_alerts");
    expect(item.onlyWhenModuleMissing).toBe("MOD_AI");
  });

  it("R-3-d: App.tsx — bí danh = RouteGuard navHref của CHÍNH nó (RBAC-01) bọc <Redirect> tới /vision/acquisition; cùng quyền với trang đích", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(app).toMatch(new RegExp(`<Route path="${ALIAS}"><RouteGuard navHref="${ALIAS}"><Redirect to="${NEW}" /></RouteGuard></Route>`));
    const alias = navGroups.flatMap((g) => g.items).find((i) => i.href === ALIAS)!;
    const target = navGroups.flatMap((g) => g.items).find((i) => i.href === NEW)!;
    expect(alias.requiredPermission).toBe(target.requiredPermission);
    expect(alias.requiredRole).toBe(target.requiredRole);
  });

  it("R-3-d: SKU chỉ OT ⇒ bí danh hiện, nằm trong app Kỹ thuật khi bật launcher; có MOD_AI ⇒ bí danh ẩn (mục Vision hiện, không trùng); không OT ⇒ ẩn cả hai", () => {
    const ot = runLic(["MOD_OT_CONTROL"], "engineer");
    expect(hrefs(ot)).toContain(ALIAS);
    expect(hrefs(scopeGroupsToApp(ot, "engineering"))).toContain(ALIAS);
    expect(getAppForRoute(ALIAS)?.appId).toBe("engineering");
    const both = runLic(["MOD_OT_CONTROL", "MOD_AI"], "engineer");
    expect(hrefs(both)).not.toContain(ALIAS);
    expect(hrefs(both)).toContain(NEW);
    expect(hrefs(scopeGroupsToApp(both, "ai"))).toContain(NEW);
    const aiOnly = runLic(["MOD_AI"], "engineer");
    expect(hrefs(aiOnly)).not.toContain(ALIAS);
    expect(hrefs(aiOnly)).not.toContain(NEW);
    // vai không có machine_alerts (operator) ⇒ không bí danh dù chỉ có OT
    expect(hrefs(runLic(["MOD_OT_CONTROL"], "operator"))).not.toContain(ALIAS);
  });

  it.each(Object.keys(ROLES).filter((r) => r !== "admin"))("R-3-d %s — bí danh ⇔ machine_alerts/canView; RouteGuard của trang đích cho qua", (role) => {
    const c = checkers(role);
    const seesAlias = sees(role, ALIAS);
    expect(seesAlias).toBe(c.hasPermission("machine_alerts", "canView"));
    if (seesAlias) expect(hasAccessToItem(NEW, role, c.hasPermission)).toBe(true);
  });
});
