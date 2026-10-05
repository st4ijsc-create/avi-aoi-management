/**
 * Doc 81 Đợt 3 Task 3 — điều hướng theo vai VÀ theo giấy phép của Sản xuất › Ca (`/production/shifts`).
 *
 * Bảng nhân lực trước là tab `?tab=workforce` của /safety-workforce (nhóm Kỹ thuật, cổng `machine_status`, giấy phép
 * MOD_OT_CONTROL). "Không ai mất quyền truy cập ngoài ý muốn" — đo trên seed `DEFAULT_ROLE_PERMISSIONS` (đọc mã nguồn):
 *   TRƯỚC: thấy bảng ⇔ thấy mục `/safety-workforce` trong điều hướng (⌘K) — trang mở tab nhân lực cho mọi người xem được.
 *   SAU:   thấy `/production/shifts` (hoặc bí danh Kỹ thuật khi thiếu MOD_PRODUCTION) ⇔ ĐÚNG tập vai đó — không hẹp, không rộng.
 * Bẫy đã đo: nhóm Sản xuất khai `permissionCategory: "production"` ⇒ engineer/maintenance/viewer (có machine_status, không
 * có quyền nào loại production) bị ẩn CẢ NHÓM ⇒ mục khai `ignoreGroupCategory` (cổng là quyền của chính mục).
 * Giấy phép: route thuộc MOD_OT_CONTROL như /safety-workforce; nhóm Sản xuất (MOD_PRODUCTION) KHÔNG ẩn mục (licenseModule).
 * Launcher: mục nằm ở app Sản xuất; SKU có OT mà KHÔNG có MOD_PRODUCTION (ô Sản xuất là upsell) ⇒ bí danh ở nhóm Kỹ thuật
 * (khuôn R-3-d). Kiểm cho MỌI tổ hợp giấy phép có OT: thanh bên (launcher bật/tắt) và ⌘K đều tìm thấy.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolvePermissionModule } from "@shared/permissions";
import { getModuleByRoute } from "@shared/module-registry";
import {
  filterNavGroupsByLicense,
  filterNavGroupsByMode,
  getFilteredNavGroups,
  getSearchNavGroups,
  hasAccessToItem,
  navGroups,
  type NavGroup,
} from "./navigation";
import { getAppForRoute, isAppAllowed, listApps, scopeGroupsToApp } from "./apps";

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
const NON_ADMIN = Object.keys(ROLES).filter((r) => r !== "admin");
const checkers = (role: string) => {
  const rows = ROLES[role];
  const hasPermission = (moduleName: string, action: string) =>
    action === "canView" && !!rows.find((x) => x.moduleName === resolvePermissionModule(moduleName))?.canView;
  const hasAnyCategoryPermission = (c: string) => rows.some((x) => x.category === c && x.canView);
  return { hasPermission, hasAnyCategoryPermission };
};
const NEW = "/production/shifts";
const OLD = "/safety-workforce";
const ALIAS = "/engineering/production-shifts";
const hrefs = (g: NavGroup[]) => g.flatMap((x) => x.items.map((i) => i.href));
const sees = (role: string, href: string) => {
  const c = checkers(role);
  return hrefs(getSearchNavGroups(role, c.hasPermission, c.hasAnyCategoryPermission)).includes(href);
};
const seesSidebar = (role: string, href: string) => {
  const c = checkers(role);
  return hrefs(getFilteredNavGroups(role, c.hasPermission, c.hasAnyCategoryPermission)).includes(href);
};

/** Lọc giấy phép như DashboardLayout (nhóm → module của nhóm; mục `licenseModule` dùng giấy phép riêng; route → module). */
const GROUP_MODULE: Record<string, string> = { ai: "MOD_AI", engineering: "MOD_OT_CONTROL", production: "MOD_PRODUCTION" };
function licensed(groups: NavGroup[], sku: readonly string[]): NavGroup[] {
  const set = new Set(sku);
  return filterNavGroupsByLicense(
    groups,
    (id) => (GROUP_MODULE[id] ? set.has(GROUP_MODULE[id]) || (id === "engineering" && set.has("MOD_ENGINEERING")) : true),
    (code) => set.has(code),
    (href) => {
      const m = getModuleByRoute(href);
      return !m || m.isCore || set.has(m.code);
    },
  );
}

describe("Sản xuất › Ca — điều hướng theo vai: ai thấy bảng nhân lực trước thì vẫn thấy, không thêm ai", () => {
  it("thiết bị đo đọc được seed: ≥6 vai; có vai thấy Safety mà KHÔNG có quyền loại production (đúng chỗ bẫy nhóm)", () => {
    expect(NON_ADMIN.length).toBeGreaterThanOrEqual(6);
    const trap = NON_ADMIN.filter((r) => sees(r, OLD) && !checkers(r).hasAnyCategoryPermission("production"));
    expect(trap).toEqual(expect.arrayContaining(["engineer", "maintenance"]));
    expect(NON_ADMIN.filter((r) => !sees(r, OLD)).length).toBeGreaterThanOrEqual(1);
  });

  it.each(NON_ADMIN)("%s — ⌘K và thanh bên: thấy mục mới ⇔ thấy /safety-workforce trước; RouteGuard cho qua", (role) => {
    const c = checkers(role);
    expect(sees(role, NEW)).toBe(sees(role, OLD));
    expect(seesSidebar(role, NEW)).toBe(seesSidebar(role, OLD));
    if (sees(role, NEW)) expect(hasAccessToItem(NEW, role, c.hasPermission)).toBe(true);
    else expect(hasAccessToItem(NEW, role, c.hasPermission)).toBe(hasAccessToItem(OLD, role, c.hasPermission));
  });

  it.each(NON_ADMIN)("%s — chế độ Đơn giản: hiện ⇔ Safety hiện (như cũ: mục kỹ sư, ẩn ở Đơn giản)", (role) => {
    const c = checkers(role);
    const simple = hrefs(filterNavGroupsByMode(getFilteredNavGroups(role, c.hasPermission, c.hasAnyCategoryPermission), "simple"));
    expect(simple.includes(NEW)).toBe(simple.includes(OLD));
  });

  it("mục nằm ở nhóm Sản xuất; cổng = CHÍNH quyền của mục Safety (machine_status), không vai/nhóm admin; giấy phép MOD_OT_CONTROL", () => {
    const g = navGroups.find((x) => x.items.some((i) => i.href === NEW))!;
    expect(g.id).toBe("production");
    const item = g.items.find((i) => i.href === NEW)!;
    const old = navGroups.flatMap((x) => x.items).find((i) => i.href === OLD)!;
    expect(item.requiredPermission).toBe(old.requiredPermission);
    expect(item.requiredPermission).toBe("machine_status");
    expect(item.requiredRole).toBeUndefined();
    expect(item.licenseModule).toBe("MOD_OT_CONTROL");
    expect(item.ignoreGroupCategory).toBe(true);
    expect(item.tier).toBe("advanced");
  });

  it("App.tsx: route mới dùng RouteGuard navHref (= cổng của mục = machine_status như route /safety-workforce)", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const line = app.split("\n").find((l) => l.includes(`<Route path="${NEW}">`));
    expect(line).toBeTruthy();
    expect(line).toMatch(new RegExp(`<RouteGuard navHref="${NEW}">`));
    expect(line).not.toMatch(/requireModule/);
    expect(app).toMatch(/<Route path="\/safety-workforce"><RouteGuard requirePermission="machine_status">/);
  });

  it("giấy phép: route thuộc CÙNG module với /safety-workforce (MOD_OT_CONTROL); app = Sản xuất", () => {
    expect(getModuleByRoute(NEW)?.code).toBe("MOD_OT_CONTROL");
    expect(getModuleByRoute(NEW)?.code).toBe(getModuleByRoute(OLD)?.code);
    expect(getAppForRoute(NEW)?.appId).toBe("production");
  });

  it("`ignoreGroupCategory` chỉ đổi đúng mục khai nó: mọi mục khác của mọi vai giữ nguyên tập (so với luật nhóm cũ)", () => {
    for (const role of NON_ADMIN) {
      const c = checkers(role);
      const now = hrefs(getSearchNavGroups(role, c.hasPermission, c.hasAnyCategoryPermission)).filter((h) => h !== NEW);
      // Luật cũ: nhóm bị loại khi thiếu quyền loại của nhóm — tính lại độc lập, không qua mã mới.
      const before = navGroups
        .filter((g) => !(g.requiredRole === "admin") && (!g.permissionCategory || c.hasAnyCategoryPermission(g.permissionCategory)))
        .flatMap((g) => g.items.filter((i) => hasAccessToItem(i.href, role, c.hasPermission)).map((i) => i.href))
        .filter((h) => h !== NEW);
      // passesNavAuthoringGate có thể bớt mục ở `now` — so tập con hai chiều trên các mục không có authoringPermission.
      const authoring = new Set(navGroups.flatMap((g) => g.items).filter((i) => i.authoringPermission).map((i) => i.href));
      expect(now.filter((h) => !authoring.has(h)).sort(), role).toEqual(before.filter((h) => !authoring.has(h)).sort());
    }
  });
});

describe("Sản xuất › Ca — tìm thấy ở MỌI tổ hợp giấy phép có OT (thanh bên launcher bật/tắt, ⌘K)", () => {
  const SKUS: string[][] = [
    ["MOD_OT_CONTROL"],
    ["MOD_OT_CONTROL", "MOD_PRODUCTION"],
    ["MOD_OT_CONTROL", "MOD_ENGINEERING"],
    ["MOD_OT_CONTROL", "MOD_PRODUCTION", "MOD_ENGINEERING"],
    ["MOD_OT_CONTROL", "MOD_AI"],
  ];
  const viewers = NON_ADMIN.filter((r) => sees(r, OLD));

  it("bí danh ở nhóm Kỹ thuật, CÙNG quyền với mục đích, chỉ khi KHÔNG có MOD_PRODUCTION; App.tsx: RouteGuard navHref riêng + Redirect", () => {
    const g = navGroups.find((x) => x.items.some((i) => i.href === ALIAS))!;
    expect(g.id).toBe("engineering");
    const alias = g.items.find((i) => i.href === ALIAS)!;
    const target = navGroups.flatMap((x) => x.items).find((i) => i.href === NEW)!;
    expect(alias.onlyWhenModuleMissing).toBe("MOD_PRODUCTION");
    expect(alias.requiredPermission).toBe(target.requiredPermission);
    expect(alias.requiredRole).toBe(target.requiredRole);
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(app).toMatch(new RegExp(`<Route path="${ALIAS}"><RouteGuard navHref="${ALIAS}"><Redirect to="${NEW}" /></RouteGuard></Route>`));
    expect(getModuleByRoute(ALIAS)?.code).toBe("MOD_OT_CONTROL");
    expect(getAppForRoute(ALIAS)?.appId).toBe("engineering");
  });

  for (const sku of SKUS) {
    it.each(viewers)(`SKU ${sku.join("+")} — %s: launcher bật (ô MỞ ĐƯỢC chứa mục), launcher tắt, ⌘K`, (role) => {
      const c = checkers(role);
      const side = licensed(getFilteredNavGroups(role, c.hasPermission, c.hasAnyCategoryPermission), sku);
      const search = licensed(getSearchNavGroups(role, c.hasPermission, c.hasAnyCategoryPermission), sku);
      const found = (g: NavGroup[]) => hrefs(g).some((h) => h === NEW || h === ALIAS);
      expect(found(side), "launcher tắt").toBe(true);
      expect(found(search), "⌘K").toBe(true);
      const allowed = new Set(sku);
      const openableApps = listApps().filter((a) => isAppAllowed(a, allowed) && scopeGroupsToApp(side, a.appId).length > 0);
      expect(openableApps.some((a) => found(scopeGroupsToApp(side, a.appId))), "launcher bật").toBe(true);
      // Không trùng khi có MOD_PRODUCTION: bí danh ẩn.
      if (allowed.has("MOD_PRODUCTION")) expect(hrefs(side)).not.toContain(ALIAS);
    });
  }

  it("không có OT ⇒ ẩn cả mục lẫn bí danh, như /safety-workforce", () => {
    const g = licensed(getFilteredNavGroups("admin"), ["MOD_PRODUCTION", "MOD_ENGINEERING"]);
    expect(hrefs(g)).not.toContain(NEW);
    expect(hrefs(g)).not.toContain(ALIAS);
    expect(hrefs(g)).not.toContain(OLD);
  });
});
