/**
 * Doc 81 Đợt 2 Task 15 fix round 1 — Ruling R-2-w: điều hướng KHÔNG BAO GIỜ hiện một route mà RouteGuard của chính
 * nó từ chối (lớp lỗi "một lối vào rồi từ chối", Khối D) — đo trên TOÀN APP, theo từng vai.
 *
 * Với mỗi vai trong seed `DEFAULT_ROLE_PERMISSIONS` (server/routers/permissionsRouter.ts — đọc mã nguồn, không chép
 * tay): mọi mục mà vai đó THẤY trong điều hướng (bộ tìm ⌘K = tập đầy đủ nhất, ⊇ thanh bên) phải được RouteGuard của
 * route đích trong App.tsx cho qua, theo ĐÚNG luật của `components/RouteGuard.tsx`:
 *   admin ⇒ qua · `navHref` ⇒ `hasAccessToItem(navHref)` · còn lại `requireRole` (nếu có) VÀ `requirePermission` canView.
 * Route chỉ là `<Redirect to>` ⇒ xét route đích (một chặng). Route không có RouteGuard ⇒ không chặn theo quyền.
 * `requireModule` (giấy phép) không thuộc phạm vi — điều hướng đã lọc giấy phép riêng.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolvePermissionModule } from "@shared/permissions";
import { getSearchNavGroups, getFilteredNavGroups, hasAccessToItem } from "./navigation";
import { scopeGroupsToApp } from "./apps";

type Row = { category: string; moduleName: string; canView: boolean; canEdit: boolean };
function seedRoles(): Record<string, Row[]> {
  const src = readFileSync(new URL("../../../server/routers/permissionsRouter.ts", import.meta.url), "utf8");
  const start = src.indexOf("const DEFAULT_ROLE_PERMISSIONS");
  const block = src.slice(start, src.indexOf("\n};", start));
  const out: Record<string, Row[]> = {};
  let role: string | null = null;
  for (const line of block.split("\n")) {
    const r = /^ {2}([a-z_]+): \[/.exec(line);
    if (r) { role = r[1]; out[role] = []; continue; }
    const m = /\{\s*category:\s*'([^']+)',\s*moduleName:\s*'([^']+)',\s*canView:\s*(true|false),\s*canCreate:\s*(?:true|false),\s*canEdit:\s*(true|false)/.exec(line);
    if (m && role) out[role].push({ category: m[1], moduleName: m[2], canView: m[3] === "true", canEdit: m[4] === "true" });
  }
  return out;
}
const ROLES = seedRoles();
const checkers = (role: string) => {
  const rows = ROLES[role];
  const hasPermission = (moduleName: string, action: string) => {
    const r = rows.find((x) => x.moduleName === resolvePermissionModule(moduleName));
    return !!r && (action === "canEdit" ? r.canEdit : action === "canView" ? r.canView : false);
  };
  const hasAnyCategoryPermission = (c: string) => rows.some((x) => x.category === c && x.canView);
  return { hasPermission, hasAnyCategoryPermission };
};

// ── App.tsx: path → cổng (RouteGuard props) hoặc đích Redirect ──
const APP = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
interface Gate { navHref?: string; requirePermission?: string; requireRole?: string[] }
const GATES = new Map<string, Gate | { redirect: string } | "open">();
for (const m of APP.matchAll(/<Route path="([^"]+)"[^>]*>([\s\S]{0,400}?)<\/Route>/g)) {
  const [, path, body] = m;
  if (GATES.has(path)) continue; // Switch: route ĐẦU TIÊN thắng
  const g = /<RouteGuard([^>]*)>/.exec(body);
  if (g) {
    const p = g[1];
    const roles = /requireRole=\{\[([^\]]*)\]\}/.exec(p)?.[1];
    GATES.set(path, {
      navHref: /navHref="([^"]+)"/.exec(p)?.[1],
      requirePermission: /requirePermission="([^"]+)"/.exec(p)?.[1],
      requireRole: roles ? Array.from(roles.matchAll(/"([^"]+)"/g), (x) => x[1]) : undefined,
    });
    continue;
  }
  const r = /^\s*<Redirect to="([^"]+)"\s*\/>\s*$/.exec(body);
  GATES.set(path, r ? { redirect: r[1] } : "open");
}

function allowed(role: string, href: string, hops = 0): boolean | "unknown" {
  if (role === "admin") return true;
  const path = href.split("?")[0];
  const g = GATES.get(path);
  if (g === undefined) return "unknown";
  if (g === "open") return true;
  if ("redirect" in g) return hops > 0 ? "unknown" : allowed(role, g.redirect, hops + 1);
  const { hasPermission } = checkers(role);
  if (g.navHref) return hasAccessToItem(g.navHref, role, hasPermission);
  const roleOk = !g.requireRole || g.requireRole.includes(role);
  const permOk = !g.requirePermission || hasPermission(g.requirePermission, "canView");
  return roleOk && permOk;
}

describe("★ R-2-w — mỗi vai: mục điều hướng nhìn thấy ⇒ RouteGuard của route đích cho qua (toàn app)", () => {
  it("thiết bị đo đọc được: seed có ≥6 vai, App.tsx có ≥100 route có cổng", () => {
    expect(Object.keys(ROLES).length).toBeGreaterThanOrEqual(6);
    expect([...GATES.values()].filter((g) => typeof g === "object" && !("redirect" in g)).length).toBeGreaterThan(100);
    // đối chứng dương: chính hai route của R-2-w được đọc đúng cổng
    expect(GATES.get("/robot-control")).toMatchObject({ requirePermission: "machine_control" });
    expect(GATES.get("/control-plane")).toMatchObject({ requirePermission: "machine_control" });
  });

  it.each(Object.keys(ROLES).filter((r) => r !== "admin"))("%s — 0 mục điều hướng bị chính RouteGuard của nó từ chối", (role) => {
    const c = checkers(role);
    const items = getSearchNavGroups(role, c.hasPermission, c.hasAnyCategoryPermission).flatMap((g) => g.items);
    const denied = items.filter((i) => allowed(role, i.href) === false).map((i) => i.href);
    expect(denied).toEqual([]);
  });

  it("operator trong app Kỹ thuật (phạm vi app, không chỉ nhóm 'engineering'): KHÔNG /robot-control, /control-plane", () => {
    const c = checkers("operator");
    const hrefs = scopeGroupsToApp(getFilteredNavGroups("operator", c.hasPermission, c.hasAnyCategoryPermission), "engineering")
      .flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).not.toContain("/robot-control");
    expect(hrefs).not.toContain("/control-plane");
    expect(hrefs.sort()).toEqual(["/equipment-integration", "/equipment-standards", "/fleet-orchestration", "/safety-workforce"]);
  });
});
