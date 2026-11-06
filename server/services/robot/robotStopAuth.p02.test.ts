/**
 * ★ Pha 0 P0-2 — GHIM CHÍNH THỨC quyết định chủ dự án 2026-11-05 "Same rule for everyone" (Nhật ký 90): đổi hành vi này = hỏi chủ dự án.
 * STOP khi quyền KHÔNG kiểm được (DB chậm / mất):
 *   · mặc định (RBAC_SCOPED_ADMIN vắng / "true" / giá trị khác): admin KHÔNG god-mode ⇒ cần grant machine_control đã nhớ, như mọi vai;
 *   · RBAC_SCOPED_ADMIN=false (công tắc khẩn) ⇒ admin qua; vai khác không bao giờ qua theo nhánh này;
 *   · cùng nguồn với `checkPermission`: admin + hàng từ chối tường minh ⇒ qua ở checkPermission ĐÚNG KHI god-mode ở STOP.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const hang = vi.hoisted(() => ({
  ds: [] as unknown[],
  khongDb: false,
  goiQuyen: [] as unknown[][],
  canhBao: [] as string[],
  soAudit: [] as string[],
}));
vi.mock("../../db/connection", async (orig) => ({
  ...(await orig<typeof import("../../db/connection")>()),
  getDb: async () => (hang.khongDb ? null : { select: () => ({ from: () => ({ where: () => ({ limit: async () => hang.ds }) }) }) }),
}));

// Bọc checkPermission THẬT để ghi tham số: mock DB trả cùng một hàng cho mọi module / bit nên kết quả không phân biệt được chúng.
vi.mock("../../_core/accessControl", async (goc) => {
  const that = await goc<typeof import("../../_core/accessControl")>();
  return {
    ...that,
    checkPermission: (...a: Parameters<typeof that.checkPermission>) => {
      hang.goiQuyen.push(a);
      return that.checkPermission(...a);
    },
  };
});
// Phiên hợp lệ nhưng DB không xác minh được người dùng (lỗi KHÔNG chắc chắn) ⇒ middleware dùng danh tính đã nhớ.
vi.mock("../../_core/sdk", () => ({
  sdk: {
    verifySession: async () => ({ openId: "stop-p02" }),
    authenticateRequest: async () => {
      throw new Error("database unavailable (auth)");
    },
  },
}));
vi.mock("./criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: { message: string }) => {
    hang.canhBao.push(a.message);
  },
}));
vi.mock("../auditTrailService", () => ({
  logCrudOperation: async (_nguoi: unknown, muc: { action: string }) => {
    hang.soAudit.push(muc.action);
  },
}));

import { z } from "zod";
import { router } from "../../_core/trpc";
import { adminQuaKhiQuyenSuyGiam, kiemQuyenStop, robotStopProcedure, type StopAuthInfo } from "./robotStopAuth";
import { _resetStopAuthMemoForTests, noteAuthenticatedUser, noteMachineControlGrant, STOP_AUTH_MEMO_TTL_MS } from "./robotStopAuthMemo";
import { checkPermission } from "../../_core/accessControl";

const giu = process.env.RBAC_SCOPED_ADMIN;
afterEach(() => {
  if (giu === undefined) delete process.env.RBAC_SCOPED_ADMIN;
  else process.env.RBAC_SCOPED_ADMIN = giu;
  hang.ds = [];
  hang.khongDb = false;
  hang.goiQuyen = [];
  hang.canhBao = [];
  hang.soAudit = [];
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
  it("★★★ kiemQuyenStop hỏi ĐÚNG machine_control + canEdit, đúng người", async () => {
    await kiemQuyenStop({ id: 3, role: "engineer" });
    expect(hang.goiQuyen).toEqual([[3, "engineer", "machine_control", "canEdit"]]);
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

// R-10-bb qua middleware THẬT (không dùng CSDL): getDb() null ⇒ quyền KHÔNG KIỂM ĐƯỢC ⇒ chỉ grant đã nhớ quyết định.
describe("P0-2 — stopAuthMiddleware khi getDb() null", () => {
  const TOKEN = "phien-stop-p02";
  const CUA_SO_PHUT = STOP_AUTH_MEMO_TTL_MS / 60_000;
  const goi = () =>
    router({ stop: robotStopProcedure.input(z.object({ robotId: z.number(), command: z.string() })).mutation(({ ctx }) => (ctx as { stopAuth?: StopAuthInfo }).stopAuth) })
      .createCaller({ sessionToken: TOKEN, user: null, req: { ip: "127.0.0.1", headers: {} } } as never)
      .stop({ robotId: 7, command: "stop" });
  const nhoDanhTinh = (vai: string) => noteAuthenticatedUser({ id: 11, openId: "stop-p02", role: vai, name: "N", twoFactorEnabled: true, isActive: true } as never, TOKEN);
  /** Grant `phut` phút trước; đặt đồng hồ lùi để chỉ grant già đi, danh tính phiên vẫn còn hạn. */
  const nhoGrant = (vai: string, phut: number) => {
    const dongHo = vi.spyOn(Date, "now").mockReturnValue(Date.now() - phut * 60_000);
    noteMachineControlGrant(TOKEN, 11, vai);
    dongHo.mockRestore();
  };
  beforeEach(() => {
    delete process.env.RBAC_SCOPED_ADMIN;
    _resetStopAuthMemoForTests();
    hang.khongDb = true;
  });

  for (const vai of ["admin", "engineer"]) {
    it(`★★★ ${vai} có grant đã nhớ trong cửa sổ ⇒ STOP QUA, degraded, có cảnh báo + audit`, async () => {
      nhoDanhTinh(vai);
      nhoGrant(vai, CUA_SO_PHUT - 1);
      const r = await goi();
      expect(r?.degraded).toBe(true);
      expect(r?.reasons.join(" ")).toContain("permission check failed (database unavailable (STOP permission))");
      await vi.waitFor(() => {
        expect(hang.canhBao.join(" ")).toContain("STOP accepted on degraded auth");
        expect(hang.soAudit).toContain("robot.stop.degradedAuth");
      });
      expect(hang.canhBao.join(" ")).not.toContain("STOP REFUSED");
    });

    it(`★★★ ${vai} KHÔNG có grant ⇒ từ chối, chỉ đường E-STOP cứng, có cảnh báo`, async () => {
      nhoDanhTinh(vai);
      await expect(goi()).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("use the hardware E-STOP") });
      await vi.waitFor(() => expect(hang.canhBao.join(" ")).toContain("STOP REFUSED on degraded auth"));
      expect(hang.soAudit).not.toContain("robot.stop.degradedAuth");
    });

    it(`★★★ ${vai} grant quá cửa sổ ${CUA_SO_PHUT} phút ⇒ từ chối như không có grant`, async () => {
      nhoDanhTinh(vai);
      nhoGrant(vai, CUA_SO_PHUT + 1);
      await expect(goi()).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("use the hardware E-STOP") });
    });
  }
});
