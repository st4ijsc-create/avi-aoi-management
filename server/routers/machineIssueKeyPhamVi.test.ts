/**
 * `machineApi.issueKey` — ★★★ F5-nhanh (a) review (mục B): kiểm PHẠM VI MÁY như hai thủ tục anh em `rotateKey` / `revokeKey`.
 *
 * Lỗ được ghim: `issueKey` (admin_system/canCreate) đúc khoá mk_ cho `machineId` client gửi mà không kiểm phạm vi ⇒ người có quyền của
 * nhà máy A đúc khoá cho máy của nhà máy B; `rotateKey` / `revokeKey` thì đã qua `khoaMayGhi` (⇒ `viTriHopLe`). Nay cùng `viTriHopLe`:
 * máy ngoài phạm vi ≡ máy không có thật (NOT_FOUND machine), kiểm TRƯỚC khi đúc; toàn quyền ⇒ không kiểm.
 *
 * Không CSDL: `../db/hierarchy.idsTrongPhamVi` giả (phạm vi theo người), đúc khoá là spy. Mỗi ca âm có đối chứng dương.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_core/accessControl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_core/accessControl")>()),
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

const issueMachineKey = vi.hoisted(() =>
  vi.fn(async (o: { machineId: number }) => ({ id: 5, machineId: o.machineId, keyPrefix: "mk_abc", plaintextKey: "mk_" + "1".repeat(48) })),
);
vi.mock("../services/machineAuthService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/machineAuthService")>()),
  issueMachineKey: (...a: any[]) => (issueMachineKey as any)(...a),
}));

/** Phạm vi: admin ⇒ null (toàn quyền); user 3 ⇒ nhà máy 1, máy 61; lỗi khi `nem`. */
const pham = vi.hoisted(() => ({ nem: false }));
vi.mock("../db/hierarchy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/hierarchy")>()),
  idsTrongPhamVi: vi.fn(async (cap: string, pv: { userId?: number; userRole?: string }) => {
    if (pham.nem) throw new Error("db nac (gia lap)");
    if (pv?.userRole === "admin") return null;
    if (pv?.userId === 3) return cap === "factory" ? [1] : cap === "machine" ? [61] : [];
    return [];
  }),
}));

// thuTucGoc (trpc.ts) hỏi cổng buộc-đổi-mật-khẩu cho người không phải admin; kiểm toán ghi qua getDb ⇒ cả hai về giả (không CSDL).
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  phaiDoiMatKhau: vi.fn(async () => false),
  getDb: vi.fn(async () => null),
}));
vi.mock("../db/connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/connection")>()),
  getDb: vi.fn(async () => null),
}));

import { machineApiRouter } from "./machineApiRouters";

const regCtx = { user: { id: 3, name: "Ky su A", role: "engineer" }, req: { headers: {} } } as any;
const adminCtx = { user: { id: 7, name: "Admin", role: "admin", twoFactorEnabled: true }, req: { headers: {} } } as any;

async function loiCua(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e: any) {
    return { code: e?.code, message: e?.message };
  }
  throw new Error("thủ tục KHÔNG ném — đáng lẽ phải từ chối");
}

beforeEach(() => {
  issueMachineKey.mockClear();
  pham.nem = false;
});

describe("★★★ F5-nhanh (a) review B — machineApi.issueKey kiểm phạm vi máy", () => {
  it("(K1) máy 62 ngoài phạm vi ⇒ CÙNG NOT_FOUND như máy 999 không có thật, KHÔNG đúc; đối chứng: máy 61 trong phạm vi ⇒ đúc đúng 1 khoá", async () => {
    const ngoai = await loiCua(machineApiRouter.createCaller(regCtx).issueKey({ machineId: 62 }));
    const khongCo = await loiCua(machineApiRouter.createCaller(regCtx).issueKey({ machineId: 999 }));
    expect(ngoai).toEqual(khongCo);
    expect(ngoai.code).toBe("NOT_FOUND");
    expect(issueMachineKey).not.toHaveBeenCalled();
    const ok: any = await machineApiRouter.createCaller(regCtx).issueKey({ machineId: 61 });
    expect(ok.plaintextKey).toMatch(/^mk_/);
    expect(issueMachineKey).toHaveBeenCalledTimes(1);
    expect(issueMachineKey.mock.calls[0][0]).toMatchObject({ machineId: 61, createdBy: 3 });
  });

  it("(K2) admin (toàn quyền) đúc được khoá cho máy 62", async () => {
    await machineApiRouter.createCaller(adminCtx).issueKey({ machineId: 62 });
    expect(issueMachineKey).toHaveBeenCalledTimes(1);
  });

  it("(K3) tra phạm vi LỖI ⇒ từ chối, KHÔNG đúc", async () => {
    pham.nem = true;
    await expect(machineApiRouter.createCaller(regCtx).issueKey({ machineId: 61 })).rejects.toThrow();
    expect(issueMachineKey).not.toHaveBeenCalled();
  });
});
