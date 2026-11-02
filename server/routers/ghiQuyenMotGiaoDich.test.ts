/**
 * ghiQuyenMotGiaoDich.test.ts — ★★★ F5 đầy đủ (mục 6): mọi lượt ghi quyền / phân công NHIỀU câu chạy trong MỘT giao dịch.
 *
 * LỖI ĐƯỢC GHIM (kiểm kê §5.3): `reassignCorporate` / `reassignFactory` (DELETE rồi INSERT), `permissions.applyRolePermissions` (DELETE quyền,
 * INSERT quyền, UPDATE vai), `batchUpdateUserPermissions`, `applyRoleToUser`, `applyBuiltInRoleToUser` (vòng DELETE/INSERT) là các câu autocommit
 * RỜI ⇒ sập giữa DELETE và INSERT để người dùng MẤT phạm vi / MẤT quyền (nửa trạng thái), và với trigger 0435 còn phát hai thông báo.
 *
 * Không CSDL: DB GIẢ có ngữ nghĩa giao dịch — câu ghi trên `db` (ngoài giao dịch) vào sổ NGAY; câu ghi trên `tx` vào bộ đệm, chỉ vào sổ khi
 * hàm giao dịch xong, bị BỎ khi nó ném. Lỗi tiêm SAU câu DELETE (ở INSERT kế tiếp) ⇒ sổ phải KHÔNG đổi gì. Đột biến "bỏ giao dịch" (ghi thẳng
 * trên `db`) ⇒ DELETE lọt vào sổ ⇒ ĐỎ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { users, permissions, userRoles, userFactoryAssignments, userCorporateAssignments } from "../../drizzle/schema";

const so: string[] = []; // sổ ĐÃ COMMIT
let nemKhiInsert = false;

function tenBang(t: unknown): string {
  if (t === users) return "users";
  if (t === permissions) return "permissions";
  if (t === userRoles) return "userRoles";
  if (t === userFactoryAssignments) return "ufa";
  if (t === userCorporateAssignments) return "uca";
  return "?";
}
function taoBoGhi(ghi: (d: string) => void) {
  const ketQuaSelect = (bang: string) => {
    if (bang === "users") return [{ id: 7 }];
    if (bang === "userRoles") return [{ id: 3, permissions: [{ moduleName: "andon", canView: true }, { moduleName: "history_view", canView: true }] }];
    return [];
  };
  return {
    select: () => ({
      from: (t: unknown) => {
        const r = ketQuaSelect(tenBang(t));
        const kq = Object.assign(Promise.resolve(r), { limit: async () => r });
        return { where: () => kq, limit: async () => r };
      },
    }),
    update: (t: unknown) => ({ set: () => ({ where: async () => ghi(`update:${tenBang(t)}`) }) }),
    delete: (t: unknown) => ({ where: async () => ghi(`delete:${tenBang(t)}`) }),
    insert: (t: unknown) => ({
      values: () => {
        const chay = async () => {
          if (nemKhiInsert) throw new Error("sap giua chung (gia lap) — sau DELETE");
          ghi(`insert:${tenBang(t)}`);
          return [{ id: 99 }];
        };
        const p = chay();
        p.catch(() => undefined);
        return Object.assign(p, { returning: () => p });
      },
    }),
  };
}
const dbGia = {
  ...taoBoGhi((d) => so.push(`NGOAI ${d}`)),
  transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const tam: string[] = [];
    const kq = await fn(taoBoGhi((d) => tam.push(`TX ${d}`))); // ném ⇒ `tam` bị bỏ (ROLLBACK)
    so.push(...tam); // COMMIT
    return kq;
  },
};

vi.mock("../db/connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/connection")>()),
  getDb: vi.fn(async () => dbGia),
}));
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getDb: vi.fn(async () => dbGia),
}));
vi.mock("../services/authSessionCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/authSessionCache")>()),
  invalidateAuthUser: vi.fn(async () => undefined),
}));

const { permissionsRouter } = await import("./permissionsRouter");
const auth = await import("../db/auth");
const caller = permissionsRouter.createCaller({ user: { id: 1, role: "admin", name: "Admin", twoFactorEnabled: true } } as any);

beforeEach(() => {
  so.length = 0;
  nemKhiInsert = false;
});

const CA: Array<[string, () => Promise<unknown>, string[]]> = [
  ["reassignFactory (A6)", () => auth.reassignFactory(7, "F-A", "F-B", 1), ["TX delete:ufa", "TX insert:ufa"]],
  ["reassignCorporate (A5)", () => auth.reassignCorporate(7, "C-A", "C-B", 1), ["TX delete:uca", "TX insert:uca"]],
  ["permissions.applyRolePermissions (B4)", () => caller.applyRolePermissions({ userId: 7, role: "viewer" }), ["TX delete:permissions", "TX insert:permissions", "TX update:users"]],
  ["permissions.batchUpdateUserPermissions (D2)", () => caller.batchUpdateUserPermissions({ userId: 7, permissions: [{ category: "dashboard" as any, moduleName: "andon" } as any] }), ["TX delete:permissions", "TX insert:permissions"]],
  ["permissions.applyRoleToUser (D5)", () => caller.applyRoleToUser({ roleId: 3, userId: 7, overwrite: true }), ["TX delete:permissions", "TX insert:permissions", "TX delete:permissions", "TX insert:permissions"]],
  ["permissions.applyBuiltInRoleToUser (D6)", () => caller.applyBuiltInRoleToUser({ builtInRole: "viewer", userId: 7, overwrite: true }), ["TX delete:permissions", "TX insert:permissions"]],
];

describe("★★★ F5 đầy đủ mục 6 — ghi quyền / phân công nhiều câu = MỘT giao dịch", () => {
  for (const [ten, goi, moiCau] of CA) {
    it(`${ten}: lỗi tiêm SAU DELETE ⇒ KHÔNG gì đổi (sổ rỗng), lỗi vẫn ném; đối chứng: chạy trọn ⇒ mọi câu vào sổ cùng lúc, trong giao dịch`, async () => {
      nemKhiInsert = true;
      await expect(goi()).rejects.toThrow();
      expect(so, "nửa trạng thái lọt vào sổ").toEqual([]);
      nemKhiInsert = false;
      await goi();
      expect(so.slice(0, moiCau.length)).toEqual(moiCau);
      expect(so.filter((d) => d.startsWith("NGOAI")), "câu ghi NGOÀI giao dịch").toEqual([]);
    });
  }
});
