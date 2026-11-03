/**
 * permissionsRouterDonCache.test.ts — ★★★ F5-nhanh S5: mọi đường đổi VAI / QUYỀN của một người dùng dọn auth cache của người đó.
 *
 * LỖI ĐƯỢC GHIM: `permissions.updateUserRole` (và `applyRolePermissions`) ghi `users.role` thẳng mà KHÔNG gọi `invalidateAuthUser`
 * như `user.update` / `user.updateRole` (db/auth.ts) ⇒ HTTP còn phục vụ vai cũ tới AUTH_CACHE_TTL_S (45 s): admin bị hạ vẫn qua
 * adminProcedure. Cùng lớp: các thủ tục ghi bảng `permissions`.
 *
 * Không CSDL: `getDb` trả một DB GIẢ ghi nhật ký từng câu ghi; `invalidateAuthUser` là spy ghi vào CÙNG nhật ký ⇒ đo được cả THỨ TỰ
 * (dọn SAU khi ghi). Đường db/auth (B1/B2/B5) đo cùng cách qua `./connection`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { users, permissions, userRoles } from "../../drizzle/schema";

const nhatKy: string[] = [];
let nemKhiInsertQuyen = false;
let hangQuyenCo: { id: number; userId: number } | null = null;

function tenBang(t: unknown): string {
  if (t === users) return "users";
  if (t === permissions) return "permissions";
  if (t === userRoles) return "userRoles";
  return "?";
}
function taoDbGia() {
  const ketQuaSelect = (bang: string) => {
    if (bang === "users") return [{ id: 7 }];
    if (bang === "userRoles") return [{ id: 3, permissions: [{ moduleName: "andon", canView: true }, { moduleName: "history_view", canView: true }] }];
    if (bang === "permissions") return hangQuyenCo ? [hangQuyenCo] : [];
    return [];
  };
  return {
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({ limit: async () => ketQuaSelect(tenBang(t)) }),
      }),
    }),
    update: (t: unknown) => ({
      set: () => ({ where: async () => { nhatKy.push(`update:${tenBang(t)}`); } }),
    }),
    delete: (t: unknown) => ({
      where: async () => { nhatKy.push(`delete:${tenBang(t)}`); },
    }),
    insert: (t: unknown) => ({
      values: () => {
        const chay = async () => {
          if (nemKhiInsertQuyen && tenBang(t) === "permissions") throw new Error("insert hong (gia lap)");
          nhatKy.push(`insert:${tenBang(t)}`);
          return [{ id: 99 }];
        };
        const p = chay();
        return Object.assign(p, { returning: () => p });
      },
    }),
  };
}
// F5 đầy đủ (mục 6) — các thủ tục nhiều câu nay chạy trong `db.transaction`: ở lưới này giao dịch CHUYỂN THẲNG (không hoàn tác) để giữ nguyên
// thứ tự nhật ký mà lưới đo (dọn SAU câu ghi cuối). Ngữ nghĩa hoàn tác được đo riêng ở `ghiQuyenMotGiaoDich.test.ts`.
const dbGia = Object.assign(taoDbGia(), { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(dbGia) });

vi.mock("../db/connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/connection")>()),
  getDb: vi.fn(async () => dbGia),
}));
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getDb: vi.fn(async () => dbGia),
}));
const invalidateAuthUser = vi.fn(async (userId?: number) => { nhatKy.push(`invalidate:${userId}`); });
vi.mock("../services/authSessionCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/authSessionCache")>()),
  invalidateAuthUser: (...a: [number?]) => invalidateAuthUser(...a),
}));

const { permissionsRouter } = await import("./permissionsRouter");
const adminCtx = { user: { id: 1, role: "admin", name: "Admin", twoFactorEnabled: true } } as any;
const caller = permissionsRouter.createCaller(adminCtx);

beforeEach(() => {
  nhatKy.length = 0;
  nemKhiInsertQuyen = false;
  hangQuyenCo = null;
  invalidateAuthUser.mockClear();
});

/** Lượt dọn cho `userId` có mặt, và đứng SAU câu ghi cuối cùng. */
function donSauGhi(userId: number) {
  expect(invalidateAuthUser).toHaveBeenCalledWith(userId);
  const viTriDon = nhatKy.lastIndexOf(`invalidate:${userId}`);
  const viTriGhiCuoi = Math.max(...nhatKy.map((d, i) => (/^(update|delete|insert):/.test(d) ? i : -1)));
  expect(viTriGhiCuoi).toBeGreaterThanOrEqual(0);
  expect(viTriDon).toBeGreaterThan(viTriGhiCuoi);
}

describe("★★★ F5-nhanh S5 — permissions.* đổi VAI dọn auth cache", () => {
  it("(B3) permissions.updateUserRole ⇒ UPDATE users rồi invalidateAuthUser(userId)", async () => {
    await caller.updateUserRole({ userId: 7, role: "operator" });
    expect(nhatKy).toContain("update:users");
    donSauGhi(7);
  });

  it("(B4) permissions.applyRolePermissions ⇒ dọn sau UPDATE vai; INSERT quyền hỏng giữa chừng (DELETE đã chạy) ⇒ VẪN dọn, lỗi vẫn ném", async () => {
    await caller.applyRolePermissions({ userId: 7, role: "viewer" });
    expect(nhatKy).toEqual(expect.arrayContaining(["delete:permissions", "update:users"]));
    donSauGhi(7);

    nhatKy.length = 0;
    invalidateAuthUser.mockClear();
    nemKhiInsertQuyen = true;
    await expect(caller.applyRolePermissions({ userId: 7, role: "viewer" })).rejects.toThrow();
    expect(nhatKy).toEqual(["delete:permissions", "invalidate:7"]);
  });
});

describe("★★ F5-nhanh S5 — permissions.* đổi QUYỀN dọn auth cache", () => {
  it("(D1) upsertPermission — nhánh tạo và nhánh sửa đều dọn", async () => {
    await caller.upsertPermission({ userId: 7, category: "dashboard" as any, moduleName: "andon" });
    expect(nhatKy).toContain("insert:permissions");
    donSauGhi(7);
    nhatKy.length = 0;
    hangQuyenCo = { id: 5, userId: 7 };
    await caller.upsertPermission({ userId: 7, category: "dashboard" as any, moduleName: "andon" });
    expect(nhatKy).toContain("update:permissions");
    donSauGhi(7);
  });

  it("(D2) batchUpdateUserPermissions dọn", async () => {
    await caller.batchUpdateUserPermissions({ userId: 7, permissions: [{ category: "dashboard" as any, moduleName: "andon" } as any] });
    donSauGhi(7);
  });

  it("(D3) deletePermission dọn cho CHỦ hàng quyền (userId đọc từ hàng, input chỉ có id)", async () => {
    hangQuyenCo = { id: 5, userId: 7 };
    await caller.deletePermission({ id: 5 });
    donSauGhi(7);
  });

  it("(D4) deleteUserPermissions dọn", async () => {
    await caller.deleteUserPermissions({ userId: 7 });
    donSauGhi(7);
  });

  it("(D5) applyRoleToUser dọn", async () => {
    await caller.applyRoleToUser({ roleId: 3, userId: 7, overwrite: true });
    donSauGhi(7);
  });

  it("(D6) applyBuiltInRoleToUser dọn", async () => {
    await caller.applyBuiltInRoleToUser({ builtInRole: "viewer", userId: 7, overwrite: true });
    donSauGhi(7);
  });
});

describe("★★ F5-nhanh S5 — đường db/auth (B1 user.update · B2 user.updateRole · B5 user.delete) vẫn dọn", () => {
  it("updateUserRole / updateUser(role, isActive) / deleteUser ⇒ invalidateAuthUser(userId) sau câu ghi", async () => {
    const auth = await import("../db/auth");
    await auth.updateUserRole(7, "user" as any);
    donSauGhi(7);
    nhatKy.length = 0;
    await auth.updateUser(7, { role: "user" as any });
    donSauGhi(7);
    nhatKy.length = 0;
    await auth.deleteUser(7);
    donSauGhi(7);
  });
});
