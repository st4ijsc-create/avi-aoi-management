/**
 * Doc 81 Đợt 3 Task 2 fix round 1 — CENSUS hai ô giấy phép riêng của mục điều hướng (navigation.tsx):
 *   - `licenseModule`        THAY giấy phép của nhóm khi lọc điều hướng (`filterNavGroupsByLicense`);
 *   - `onlyWhenModuleMissing` chỉ hiện mục khi module đó KHÔNG được cấp phép (bí danh R-3-d).
 *
 * Vì sao cần: `useLicenseModules.isModuleAllowed` trả `true` cho mã KHÔNG BIẾT (useLicenseModules.ts — "Unknown module →
 * allow"). Một `licenseModule` gõ sai sẽ âm thầm BỎ cổng giấy phép của nhóm (cổng route vẫn còn, nhưng menu hiện mục mà
 * khách chưa mua); một `onlyWhenModuleMissing` gõ sai làm bí danh KHÔNG BAO GIỜ hiện. Luật:
 *   1. mọi mã là mã module có thật trong shared/module-registry;
 *   2. `licenseModule` TRÙNG module sở hữu route của mục (`getModuleByRoute(href)`) — mục không thể khai giấy phép khác route;
 *   3. `onlyWhenModuleMissing` không phải module lõi (lõi luôn được phép ⇒ mục chết) và khác module của chính route.
 */
import { describe, expect, it } from "vitest";
import { getModuleByCode, getModuleByRoute } from "@shared/module-registry";
import { navGroups, type NavItem } from "./navigation";

type Item = Pick<NavItem, "href" | "licenseModule" | "onlyWhenModuleMissing">;

/** Vi phạm của một mục (rỗng = hợp lệ). Là THIẾT BỊ ĐO — cầu chì bên dưới chứng minh nó còn bắt được lỗi. */
function viPham(it: Item): string[] {
  const out: string[] = [];
  const routeMod = getModuleByRoute(it.href)?.code;
  if (it.licenseModule !== undefined) {
    if (!getModuleByCode(it.licenseModule)) out.push(`${it.href}: licenseModule "${it.licenseModule}" không phải mã module`);
    else if (routeMod !== it.licenseModule) out.push(`${it.href}: licenseModule "${it.licenseModule}" ≠ module của route (${routeMod ?? "không thuộc module nào"})`);
  }
  if (it.onlyWhenModuleMissing !== undefined) {
    const m = getModuleByCode(it.onlyWhenModuleMissing);
    if (!m) out.push(`${it.href}: onlyWhenModuleMissing "${it.onlyWhenModuleMissing}" không phải mã module`);
    else if (m.isCore) out.push(`${it.href}: onlyWhenModuleMissing "${it.onlyWhenModuleMissing}" là module lõi (luôn được phép ⇒ mục không bao giờ hiện)`);
    else if (routeMod === it.onlyWhenModuleMissing) out.push(`${it.href}: onlyWhenModuleMissing trùng module của chính route`);
  }
  return out;
}

const ALL: Item[] = navGroups.flatMap((g) => g.items);

describe("census — ô giấy phép riêng của mục điều hướng", () => {
  it("thiết bị đo thấy dữ liệu: có ≥1 mục `licenseModule` và ≥1 mục `onlyWhenModuleMissing`", () => {
    expect(ALL.filter((i) => i.licenseModule !== undefined).length).toBeGreaterThanOrEqual(1);
    expect(ALL.filter((i) => i.onlyWhenModuleMissing !== undefined).length).toBeGreaterThanOrEqual(1);
  });

  it("mọi `licenseModule` là mã có thật VÀ trùng module của route; mọi `onlyWhenModuleMissing` là mã không-lõi có thật", () => {
    expect(ALL.flatMap(viPham)).toEqual([]);
  });

  it("cầu chì: vị từ bắt được mã lạ, mã lệch route, mã lõi, và tha mục hợp lệ", () => {
    expect(viPham({ href: "/vision/acquisition", licenseModule: "MOD_OT" })).toHaveLength(1);
    expect(viPham({ href: "/vision/acquisition", licenseModule: "MOD_AI" })).toHaveLength(1);
    expect(viPham({ href: "/ai-chat", licenseModule: "MOD_OT_CONTROL" })).toHaveLength(1);
    expect(viPham({ href: "/x", onlyWhenModuleMissing: "MOD_A1" })).toHaveLength(1);
    const core = ["CORE_AUTH", "CORE_DASHBOARD", "CORE_ADMIN"].find((c) => getModuleByCode(c)?.isCore);
    expect(core, "registry phải có ít nhất một module lõi để thử").toBeTruthy();
    expect(viPham({ href: "/x", onlyWhenModuleMissing: core })).toHaveLength(1);
    expect(viPham({ href: "/vision/acquisition", licenseModule: "MOD_OT_CONTROL" })).toEqual([]);
    expect(viPham({ href: "/engineering/vision-acquisition", onlyWhenModuleMissing: "MOD_AI" })).toEqual([]);
  });
});
