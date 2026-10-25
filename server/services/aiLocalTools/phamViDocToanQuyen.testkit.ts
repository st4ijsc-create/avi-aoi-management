/**
 * Bộ đồ nghề CHỈ-TEST (L8, 2026-10-25): các test cũ của tool đọc mock CSDL nên không thể chạy bộ phân giải phạm vi thật. Chúng ép `phamViDoc` về TOÀN QUYỀN để tiếp tục đo đúng thứ chúng đo
 * (hình dạng kết quả · cổng RBAC). Phạm vi THẬT được đo trên CSDL ở `phamViDoc.db.test.ts`.
 * Dùng:  vi.mock("./phamViDoc", async (orig) => (await import("./phamViDocToanQuyen.testkit")).phamViDocToanQuyen(await orig<typeof import("./phamViDoc")>()));
 */
import type * as PhamViDoc from "./phamViDoc";

export function phamViDocToanQuyen(thuc: typeof PhamViDoc): typeof PhamViDoc {
  return {
    ...thuc,
    giaiPhamViMay: async () => ({ kind: "global" }),
    giaiPhamViDong: async () => ({ kind: "global" }),
    idsNhaMayCuaTool: async () => null,
    congLenhTool: async () => undefined,
    congCanhBaoDuDoanTool: async () => undefined,
    congSanPhamTool: async () => undefined,
    congCauHinhMayTool: async () => undefined,
    congRcaTool: async () => undefined,
    nguoiTrongPhamViTool: async () => null,
    congMaTool: async () => undefined,
    donViTool: async (_raw: unknown, serials: string[]) => new Set(serials),
    statsScopeArgs: () => ({}) as { userId: number; userRole: string },
  };
}
