/**
 * ★ Pha 0 P0-2 — GHIM CHÍNH THỨC quyết định chủ dự án 2026-11-05 "Same rule for everyone" (Nhật ký 90): đổi hành vi này = hỏi chủ dự án.
 * STOP khi quyền KHÔNG kiểm được (DB chậm / mất):
 *   · mặc định (RBAC_SCOPED_ADMIN vắng / "true" / giá trị khác): admin KHÔNG god-mode ⇒ cần grant machine_control đã nhớ, như mọi vai;
 *   · RBAC_SCOPED_ADMIN=false (công tắc khẩn) ⇒ admin qua; vai khác không bao giờ qua theo nhánh này;
 *   · cùng nguồn với `checkPermission`: admin + hàng từ chối tường minh ⇒ qua ở checkPermission ĐÚNG KHI god-mode ở STOP.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const hang = vi.hoisted(() => ({ ds: [] as unknown[], khongDb: false }));
vi.mock("../../db/connection", async (orig) => ({
  ...(await orig<typeof import("../../db/connection")>()),
  getDb: async () => (hang.khongDb ? null : { select: () => ({ from: () => ({ where: () => ({ limit: async () => hang.ds }) }) }) }),
}));

import { adminQuaKhiQuyenSuyGiam, kiemQuyenStop } from "./robotStopAuth";
import { checkPermission } from "../../_core/accessControl";

const giu = process.env.RBAC_SCOPED_ADMIN;
afterEach(() => {
  if (giu === undefined) delete process.env.RBAC_SCOPED_ADMIN;
  else process.env.RBAC_SCOPED_ADMIN = giu;
  hang.ds = [];
  hang.khongDb = false;
});
const datCo = (v: string | undefined) => (v === undefined ? delete process.env.RBAC_SCOPED_ADMIN : (process.env.RBAC_SCOPED_ADMIN = v));

describe("P0-2 — admin trên STOP khi quyền suy giảm", () => {
  it("★★★ getDb() null ⇒ checkPermission từ chối mọi vai, nhưng quyền STOP là KHÔNG KIỂM ĐƯỢC (ném ⇒ đường suy giảm), không phải một lời từ chối", async () => {
    hang.khongDb = true;
    for (const vai of ["admin", "engineer"]) {
      expect(await checkPermission(1, vai, "machine_control", "canEdit"), vai).toBe(false);
      await expect(kiemQuyenStop({ id: 1, role: vai }), vai).rejects.toThrow(/database unavailable/);
    }
  });
  it("★★ có DB ⇒ kiemQuyenStop trả đúng checkPermission (hàng false ràng buộc admin)", async () => {
    expect(await kiemQuyenStop({ id: 1, role: "admin" })).toBe(true);
    expect(await kiemQuyenStop({ id: 2, role: "engineer" })).toBe(false);
    hang.ds = [{ canEdit: false, expiresAt: null }];
    expect(await kiemQuyenStop({ id: 1, role: "admin" })).toBe(false);
  });
  it("★★★ vắng cờ ⇒ admin KHÔNG qua (cần grant đã nhớ); RBAC_SCOPED_ADMIN=false ⇒ admin qua", () => {
    datCo(undefined);
    expect(adminQuaKhiQuyenSuyGiam("admin")).toBe(false);
    datCo("true");
    expect(adminQuaKhiQuyenSuyGiam("admin")).toBe(false);
    datCo("false");
    expect(adminQuaKhiQuyenSuyGiam("admin")).toBe(true);
  });
  it("★★ vai khác không bao giờ qua theo nhánh này (kể cả công tắc khẩn)", () => {
    for (const v of [undefined, "true", "false"]) {
      datCo(v);
      for (const vai of ["engineer", "supervisor", "operator", "", null, undefined]) expect(adminQuaKhiQuyenSuyGiam(vai), `${v} · ${vai}`).toBe(false);
    }
  });
  it("★★★ cùng nguồn với checkPermission: admin + hàng từ chối tường minh ⇒ checkPermission qua ĐÚNG KHI STOP god-mode", async () => {
    hang.ds = [{ canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false, expiresAt: null }];
    for (const v of [undefined, "true", "false", "1", "no", "", "FALSE"]) {
      datCo(v);
      expect(adminQuaKhiQuyenSuyGiam("admin"), `RBAC_SCOPED_ADMIN=${v}`).toBe(await checkPermission(1, "admin", "machine_control", "canEdit"));
    }
  });
  it("★★ ghim nối dây: nhánh từ chối STOP suy giảm dùng ĐÚNG hàm này, cùng điều kiện grant đã nhớ", () => {
    const src = readFileSync(join(__dirname, "robotStopAuth.ts"), "utf8");
    expect(src).toContain("if (!adminQuaKhiQuyenSuyGiam(user.role) && !rememberedMachineControlGrant(token, user.id)) {");
    expect(src.match(/adminQuaKhiQuyenSuyGiam\(/g)).toHaveLength(2); // định nghĩa + một nơi gọi
    expect(src).not.toMatch(/RBAC_SCOPED_ADMIN\s*!==/);
  });
});
