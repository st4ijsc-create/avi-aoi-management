/**
 * Doc 27 Đợt 5 / W5-E — gaps F3 + F9 (router layer):
 *  - machine.checkCode: duplicate-code pre-check for the onboarding wizard.
 *    Partial-unique semantics (Đợt 3): only ACTIVE machines hold a code —
 *    db.getMachineByCode already filters isActive, the router just relays.
 *  - machine.listPaged: bounded server-side search/pagination (default 50,
 *    hard max 200) so MachineRegistration stops filtering the full list
 *    client-side. machine.list is untouched (full-list consumers).
 *  - machine.registrationSummary: grouped status counts for summary cards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

const dbm = vi.hoisted(() => ({
  createAuditLog: vi.fn(async (): Promise<any> => ({ id: 1 })),
  getDb: vi.fn(async (): Promise<any> => ({ fake: true })),
  getMachineByCode: vi.fn(async (_code?: string, _pv?: any): Promise<any> => undefined),
  getMachinesPaged: vi.fn(async (_opts?: any, _pv?: any): Promise<any> => ({ items: [], total: 0 })),
  getMachineRegistrationSummary: vi.fn(async (_pv?: any): Promise<any> => ({
    pending: 2, approved: 10, rejected: 1, total: 13,
  })),
}));
vi.mock("../db", () => dbm);

import { machineRouter } from "./hierarchyRouters";

const userCtx = { user: { id: 7, name: "Admin", role: "admin" }, req: { headers: {} } } as any;

/**
 * ★ 2026-08-18 (đợt trả nợ phạm vi đọc) — **PHẠM VI NGƯỜI XEM là một đối số THẬT, nên nó được
 * canh chứ không được bỏ qua bằng `expect.anything()`.**
 *
 * Ba ô dưới đây từng ghim ĐÚNG MỘT đối số (`toHaveBeenCalledWith("AOI-02")`). Khi router bắt đầu
 * đưa `ctx.user` xuống tầng dữ liệu, chúng ĐỎ — và đó là lưới làm đúng việc: chữ ký lời gọi đã
 * đổi thật. Bản sửa KHÔNG nới lỏng phép so; nó ghim thêm ô mới, nên nếu ai đó lỡ tay bỏ phạm vi
 * đi (hoặc lấy danh tính từ `input`) thì ba ô này ĐỎ trở lại.
 */
const PHAM_VI = { userId: 7, userRole: "admin" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  dbm.getMachineByCode.mockResolvedValue(undefined);
  dbm.getMachinesPaged.mockResolvedValue({ items: [], total: 0 });
});

describe("F3 — machine.checkCode", () => {
  it("free code → available (no holder leaked)", async () => {
    const res = await machineRouter.createCaller(userCtx).checkCode({ code: "AOI-NEW-01" });
    expect(res).toEqual({ available: true, holder: null });
    expect(dbm.getMachineByCode).toHaveBeenCalledWith("AOI-NEW-01", PHAM_VI);
  });

  it("code held by an ACTIVE machine → unavailable with holder identity", async () => {
    dbm.getMachineByCode.mockResolvedValue({
      id: 9, code: "AOI-01", name: "Old AOI", apiKey: "mach_SECRET", stationId: 4,
    });
    const res = await machineRouter.createCaller(userCtx).checkCode({ code: "AOI-01" });
    expect(res.available).toBe(false);
    expect(res.holder).toEqual({ id: 9, code: "AOI-01", name: "Old AOI" });
    // The holder projection must NOT leak the apiKey or other columns.
    expect(JSON.stringify(res)).not.toContain("mach_SECRET");
  });

  it("excludeId: a machine's own code is not a conflict (edit flows)", async () => {
    dbm.getMachineByCode.mockResolvedValue({ id: 9, code: "AOI-01", name: "Self" });
    const res = await machineRouter.createCaller(userCtx).checkCode({ code: "AOI-01", excludeId: 9 });
    expect(res).toEqual({ available: true, holder: null });
  });

  it("input is trimmed and bounded (empty / >50 chars rejected)", async () => {
    const caller = machineRouter.createCaller(userCtx);
    await expect(caller.checkCode({ code: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.checkCode({ code: "X".repeat(51) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Trim applies BEFORE the lookup.
    dbm.getMachineByCode.mockResolvedValue(undefined);
    await caller.checkCode({ code: "  AOI-02  " });
    expect(dbm.getMachineByCode).toHaveBeenCalledWith("AOI-02", PHAM_VI);
  });
});

describe("F9 — machine.listPaged", () => {
  it("no input → bounded defaults (limit 50, offset 0)", async () => {
    await machineRouter.createCaller(userCtx).listPaged();
    expect(dbm.getMachinesPaged).toHaveBeenCalledWith({ limit: 50, offset: 0 }, PHAM_VI);
  });

  it("passes search + registrationStatus + paging through to the db layer", async () => {
    dbm.getMachinesPaged.mockResolvedValue({ items: [{ id: 1 }], total: 120 });
    const res = await machineRouter.createCaller(userCtx).listPaged({
      search: "aoi", registrationStatus: "approved", limit: 25, offset: 50,
    });
    expect(dbm.getMachinesPaged).toHaveBeenCalledWith({
      search: "aoi", registrationStatus: "approved", limit: 25, offset: 50,
    }, PHAM_VI);
    expect(res).toEqual({ items: [{ id: 1 }], total: 120 });
  });

  it("rejects out-of-bounds paging params (limit > 200, negative offset)", async () => {
    const caller = machineRouter.createCaller(userCtx);
    await expect(caller.listPaged({ limit: 201 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.listPaged({ limit: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.listPaged({ offset: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(dbm.getMachinesPaged).not.toHaveBeenCalled();
  });

  it("rejects an invalid registrationStatus", async () => {
    await expect(
      machineRouter.createCaller(userCtx).listPaged({ registrationStatus: "bogus" as any }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── Doc 56 Đ0-A (MGMTUI-3/REG-1) — listPaged must NEVER return the plaintext
  // ingest apiKey. The db layer (getMachinesPaged) strips it and derives
  // hasApiKey; this test feeds the router a REGRESSED full-row db result to
  // prove the route-level belt-and-braces strip seals the leak regardless.
  it("Đ0-A: items never contain apiKey — derived hasApiKey survives", async () => {
    dbm.getMachinesPaged.mockResolvedValue({
      items: [
        { id: 1, code: "AOI-01", name: "AOI 1", apiKey: "mach_SECRET_KEY", hasApiKey: true },
        { id: 2, code: "AOI-02", name: "AOI 2", apiKey: null, hasApiKey: false },
      ],
      total: 2,
    });
    const res = await machineRouter.createCaller(userCtx).listPaged();
    expect(res.total).toBe(2);
    expect(res.items).toHaveLength(2);
    for (const item of res.items as Array<Record<string, unknown>>) {
      expect(Object.keys(item)).not.toContain("apiKey");
      expect(item).toHaveProperty("hasApiKey");
    }
    expect(res.items[0]).toMatchObject({ id: 1, code: "AOI-01", hasApiKey: true });
    expect(res.items[1]).toMatchObject({ id: 2, code: "AOI-02", hasApiKey: false });
    // The secret must not survive anywhere in the serialized response.
    expect(JSON.stringify(res)).not.toContain("mach_SECRET_KEY");
  });
});

describe("F9 — machine.registrationSummary", () => {
  it("returns the grouped counts from the db layer", async () => {
    const res = await machineRouter.createCaller(userCtx).registrationSummary();
    expect(res).toEqual({ pending: 2, approved: 10, rejected: 1, total: 13 });
    expect(dbm.getMachineRegistrationSummary).toHaveBeenCalledTimes(1);
    expect(dbm.getMachineRegistrationSummary).toHaveBeenCalledWith(PHAM_VI);
  });
});
