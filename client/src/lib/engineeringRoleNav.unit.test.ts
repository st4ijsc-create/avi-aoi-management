/**
 * Doc 81 Đợt 2 Task 15 — điều hướng THEO VAI TRÒ cho module "Kỹ thuật & Điều khiển" (doc 81 §1.4, FE1 §4).
 *
 * Đo được (FE1 §4): operator VÀO ĐƯỢC IR / POU / Copilot (công cụ soạn thảo/AI) trong khi chỉ nên thấy màn giám
 * sát chỉ đọc. Luật Task 15: công cụ SOẠN THẢO chỉ hiện trong ĐIỀU HƯỚNG (thanh bên, ⌘K, lối tắt, danh mục Hub) cho
 * người giữ quyền soạn thảo (`authoringPermission`, = quyền server dùng để lưu/build). KHÔNG đổi cổng route
 * (`hasAccessToItem` / RouteGuard) và KHÔNG đổi quyền server: deep link cũ vẫn mở chế độ chỉ-xem như trước.
 *
 * Quyền của từng vai KHÔNG chép tay: đọc từ chính seed `DEFAULT_ROLE_PERMISSIONS`
 * (server/routers/permissionsRouter.ts) — đổi seed thì lưới này tự thấy.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolvePermissionModule } from "@shared/permissions";
import {
  getFilteredNavGroups,
  getSearchNavGroups,
  hasAccessToItem,
  getRequiredPermissionForHref,
  navGroups,
  passesNavAuthoringGate,
  type NavGroup,
} from "./navigation";
import { resolveSidebarGroups } from "./sidebarGroups";
import { getAppById, resolveAppLandingHref } from "./apps";

type Row = { category: string; moduleName: string; canView: boolean; canEdit: boolean };

/** Đọc DEFAULT_ROLE_PERMISSIONS từ mã nguồn server (mỗi quyền một dòng `{ category: '…', moduleName: '…', … }`). */
function seedRoles(): Record<string, Row[]> {
  const src = readFileSync(new URL("../../../server/routers/permissionsRouter.ts", import.meta.url), "utf8");
  const start = src.indexOf("const DEFAULT_ROLE_PERMISSIONS");
  const end = src.indexOf("\n};", start);
  const block = src.slice(start, end);
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

function checkers(role: string) {
  const rows = ROLES[role];
  const hasPermission = (moduleName: string, action: string) => {
    const r = rows.find((x) => x.moduleName === resolvePermissionModule(moduleName));
    if (!r) return false;
    return action === "canEdit" ? r.canEdit : action === "canView" ? r.canView : false;
  };
  const hasAnyCategoryPermission = (category: string) => rows.some((x) => x.category === category && x.canView);
  return { hasPermission, hasAnyCategoryPermission };
}

const hrefsOf = (groups: NavGroup[], groupId = "engineering") =>
  (groups.find((g) => g.id === groupId)?.items ?? []).map((i) => i.href);

function sidebarFor(role: string) {
  const c = checkers(role);
  return getFilteredNavGroups(role, c.hasPermission, c.hasAnyCategoryPermission);
}
function searchFor(role: string) {
  const c = checkers(role);
  return getSearchNavGroups(role, c.hasPermission, c.hasAnyCategoryPermission);
}

const AUTHORING = ["/engineering", "/engineering-changes", "/recipes", "/ir-editor", "/pou-studio", "/orchestration-studio"];
const MONITORING = ["/fleet-orchestration", "/safety-workforce", "/equipment-standards", "/equipment-integration"];

describe("seed vai trò đọc được (thiết bị đo của lưới này)", () => {
  it("operator / viewer chỉ có machine_status; supervisor / engineer / maintenance có machine_control", () => {
    for (const r of ["operator", "viewer", "supervisor", "engineer", "maintenance"]) expect(ROLES[r]?.length ?? 0, r).toBeGreaterThan(0);
    const has = (r: string, m: string) => ROLES[r].some((x) => x.moduleName === m && x.canView);
    expect(has("operator", "machine_status")).toBe(true);
    expect(has("operator", "machine_control")).toBe(false);
    expect(has("viewer", "machine_control")).toBe(false);
    for (const r of ["supervisor", "engineer", "maintenance"]) expect(has(r, "machine_control"), r).toBe(true);
  });
});

describe("★ Operator chỉ thấy màn giám sát chỉ đọc — KHÔNG mục soạn thảo (doc 81 §1.4)", () => {
  it.each(["operator", "viewer"])("%s — thanh bên: đúng 4 màn giám sát, 0 công cụ soạn thảo/AI", (role) => {
    const items = hrefsOf(sidebarFor(role));
    expect(items.sort()).toEqual([...MONITORING].sort());
    for (const h of AUTHORING) expect(items, h).not.toContain(h);
  });

  it.each(["operator", "viewer"])("%s — ⌘K (bộ tìm không thu gọn) cũng không có công cụ soạn thảo", (role) => {
    const items = hrefsOf(searchFor(role));
    for (const h of AUTHORING) expect(items, h).not.toContain(h);
    for (const h of MONITORING) expect(items, h).toContain(h);
  });

  it("operator — chế độ Đơn giản (mặc định của operator) rơi về danh sách đủ: danh sách đó cũng không có IR/POU", () => {
    const { sidebar, simpleFallback } = resolveSidebarGroups({
      accessible: sidebarFor("operator"),
      mode: "simple",
      launcherOn: true,
      appId: "engineering",
    });
    expect(simpleFallback).toBe(true);
    const items = sidebar.flatMap((g) => g.items.map((i) => i.href));
    expect(items).not.toContain("/ir-editor");
    expect(items).not.toContain("/pou-studio");
    expect(items).toContain("/safety-workforce");
  });

  it("quyền ROUTE và quyền server KHÔNG đổi: operator vẫn qua RouteGuard của /ir-editor, /pou-studio (chế độ chỉ-xem cũ)", () => {
    const { hasPermission } = checkers("operator");
    for (const h of ["/ir-editor", "/pou-studio"]) {
      expect(getRequiredPermissionForHref(h), h).toBe("machine_status");
      expect(hasAccessToItem(h, "operator", hasPermission), h).toBe(true);
    }
  });
});

describe("Vai trò soạn thảo không mất gì", () => {
  it.each(["engineer", "supervisor", "maintenance"])("%s — vẫn thấy IR / POU / IDE", (role) => {
    const items = hrefsOf(sidebarFor(role));
    for (const h of ["/ir-editor", "/pou-studio", "/engineering"]) expect(items, `${role} ${h}`).toContain(h);
  });

  it("admin — thấy mọi mục (bypass như cũ)", () => {
    const items = hrefsOf(getFilteredNavGroups("admin", () => false, () => false));
    for (const h of [...AUTHORING, ...MONITORING, "/engineering-home"]) expect(items, h).toContain(h);
  });

  it("supervisor — Hub (/engineering-home) có trong điều hướng; operator thì không (Hub đòi machine_control như cũ)", () => {
    expect(hrefsOf(sidebarFor("supervisor"))).toContain("/engineering-home");
    expect(hrefsOf(sidebarFor("operator"))).not.toContain("/engineering-home");
  });
});

describe("Lưới tĩnh — mọi công cụ soạn thảo có cổng điều hướng", () => {
  const eng = navGroups.find((g) => g.id === "engineering")!;
  it("mọi mục section 'authoring' hoặc đòi machine_control, hoặc khai authoringPermission", () => {
    for (const item of eng.items.filter((i) => i.section === "authoring")) {
      expect(
        item.requiredPermission === "machine_control" || item.authoringPermission === "machine_control",
        item.href,
      ).toBe(true);
    }
  });

  it("Studio và trang Copilot riêng không còn là mục điều hướng (đã gộp: Hub ?tab=catalog / IDE ?copilot=scratch)", () => {
    const all = navGroups.flatMap((g) => g.items.map((i) => i.href.split("?")[0]));
    expect(all).not.toContain("/engineering-studio");
    expect(all).not.toContain("/programming-copilot");
  });

  it("passesNavAuthoringGate: không có checker ⇒ hiện (tương thích cũ); có checker ⇒ theo quyền soạn thảo", () => {
    const ir = eng.items.find((i) => i.href === "/ir-editor")!;
    expect(passesNavAuthoringGate(ir, "operator")).toBe(true);
    expect(passesNavAuthoringGate(ir, "operator", checkers("operator").hasPermission)).toBe(false);
    expect(passesNavAuthoringGate(ir, "engineer", checkers("engineer").hasPermission)).toBe(true);
    expect(passesNavAuthoringGate(ir, "admin", () => false)).toBe(true);
  });
});

describe("Mở app Kỹ thuật từ App Launcher theo vai trò (landing)", () => {
  const eng = () => getAppById("engineering")!;
  it("supervisor / engineer ⇒ Hub (/engineering-home) như cũ", () => {
    for (const role of ["supervisor", "engineer"]) {
      expect(resolveAppLandingHref(eng(), searchFor(role)), role).toBe("/engineering-home");
    }
  });
  it("operator / viewer (Hub bị chặn — machine_control) ⇒ màn giám sát ĐẦU TIÊN họ được vào, KHÔNG mở trang 'Không có quyền'", () => {
    for (const role of ["operator", "viewer"]) {
      const href = resolveAppLandingHref(eng(), searchFor(role));
      expect(MONITORING, role).toContain(href);
    }
  });
  it("landing không phải mục nav (không biết quyền) ⇒ giữ nguyên landing, không đoán", () => {
    const fake = { ...eng(), landingHref: "/khong-phai-muc-nav" };
    expect(resolveAppLandingHref(fake, searchFor("operator"))).toBe("/khong-phai-muc-nav");
  });
});

describe("Fix 1 — supervisor ở chế độ Đơn giản (mặc định của supervisor) KHÔNG trống trong app Kỹ thuật", () => {
  it("thanh bên rơi về danh sách đủ của app: có Hub + màn duyệt (ECN, Recipe, Interlock), không trống", () => {
    const { sidebar, simpleFallback } = resolveSidebarGroups({
      accessible: sidebarFor("supervisor"),
      mode: "simple",
      launcherOn: true,
      appId: "engineering",
    });
    const items = sidebar.flatMap((g) => g.items.map((i) => i.href));
    expect(items.length).toBeGreaterThan(0);
    expect(simpleFallback).toBe(true);
    for (const h of ["/engineering-home", "/engineering-changes", "/recipes", "/interlock-rules"]) expect(items, h).toContain(h);
  });
});
