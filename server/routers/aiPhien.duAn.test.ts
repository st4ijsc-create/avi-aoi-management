/**
 * G3 — thủ tục THEO ID của aiPhien soát lại danh sách trắng dự án: phiên của dự án đã rời allowlist ⇒ NOT_FOUND, kho KHÔNG bị gọi (hàng không đổi);
 * `xoa` vẫn cho phép. Không DB (kho và phanGiaiGoc là bản giả). Bản thật ở aiPhien.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.LICENSE_BYPASS = "true";

const duAnCuaPhien = vi.fn(async (..._a: unknown[]): Promise<string | null | undefined> => "da-1");
const hamKho = (ra: object) => vi.fn(async (..._a: unknown[]) => ({ ok: true, ...ra }) as Record<string, unknown>);
const kho = {
  duAnCuaPhien: (...a: unknown[]) => duAnCuaPhien(...a),
  mo: hamKho({ phien: { id: "x" } }),
  themLuot: hamKho({ version: 4, turnCount: 2 }),
  doiTen: hamKho({ title: "t" }),
  nhanBan: hamKho({ id: "n" }),
  nopTomTat: hamKho({ id: "n" }),
  xoa: hamKho({}),
  TRAN_LUOT_MOI_LAN_GHI: 40,
  TRAN_KY_TU_TOM_TAT_PHIEN: 4000,
};
vi.mock("../db/aiPhien", () => kho);

const phanGiai = vi.fn((..._a: unknown[]) => ({ ok: true }) as { ok: boolean });
vi.mock("../services/aiLocalTools/repoProjects", () => ({ phanGiaiGoc: (...a: unknown[]) => phanGiai(...a) }));
vi.mock("../_core/accessControl", () => ({ checkPermission: async () => true }));

const ID = "11111111-1111-4111-8111-111111111111";
type Goi = Awaited<ReturnType<typeof goi>>;
const goi = async () => {
  const { aiPhienRouter } = await import("./aiPhienRouter");
  return aiPhienRouter.createCaller({ user: { id: 7, role: "engineer", name: "e" }, req: {} } as never);
};
const CAC_THU_TUC: Array<[string, (c: Goi) => Promise<{ ok: boolean; note: string | null }>, ReturnType<typeof vi.fn>]> = [
  ["mo", (c) => c.mo({ sessionId: ID }) as never, kho.mo],
  ["themLuot", (c) => c.themLuot({ sessionId: ID, expectedVersion: 3, luot: [{ role: "user", content: "a" }] }) as never, kho.themLuot],
  ["doiTen", (c) => c.doiTen({ sessionId: ID, title: "x" }) as never, kho.doiTen],
  ["nhanBan", (c) => c.nhanBan({ sessionId: ID }) as never, kho.nhanBan],
  ["nopTomTat", (c) => c.nopTomTat({ sessionId: ID, expectedVersion: 3, tomTat: "t" }) as never, kho.nopTomTat],
];

beforeEach(() => {
  vi.clearAllMocks();
  duAnCuaPhien.mockResolvedValue("da-1");
  phanGiai.mockReturnValue({ ok: true });
});

describe("G3 — dự án đã rời allowlist ⇒ NOT_FOUND ở thủ tục theo id", () => {
  for (const [ten, chay, khoFn] of CAC_THU_TUC) {
    it(`★ ${ten}: dự án ngoài allowlist ⇒ NOT_FOUND và kho KHÔNG bị gọi (hàng không đổi)`, async () => {
      phanGiai.mockReturnValue({ ok: false });
      const r = await chay(await goi());
      expect(r).toMatchObject({ ok: false, note: "NOT_FOUND" });
      expect(khoFn).not.toHaveBeenCalled();
      expect(phanGiai.mock.calls[0][0]).toBe("da-1"); // soát đúng dự án CỦA HÀNG, không phải dự án client khai
    });
    it(`${ten}: dự án còn trong allowlist ⇒ gọi kho bình thường`, async () => {
      const r = await chay(await goi());
      expect(r.ok).toBe(true);
      expect(khoFn).toHaveBeenCalledTimes(1);
    });
    it(`${ten}: hàng di sản projectId=null ⇒ không soát allowlist, chỉ chủ (kho quyết)`, async () => {
      duAnCuaPhien.mockResolvedValue(null);
      phanGiai.mockReturnValue({ ok: false }); // dù phanGiaiGoc sẽ từ chối, null không đi qua nó
      const r = await chay(await goi());
      expect(r.ok).toBe(true);
      expect(phanGiai).not.toHaveBeenCalled();
    });
    it(`${ten}: không có hàng của người này ⇒ để kho trả NOT_FOUND (không phân biệt)`, async () => {
      duAnCuaPhien.mockResolvedValue(undefined);
      await chay(await goi());
      expect(khoFn).toHaveBeenCalledTimes(1);
      expect(phanGiai).not.toHaveBeenCalled();
    });
  }
  it("★ xoa VẪN cho phép khi dự án đã rời allowlist (dọn phiên của chính mình) — không soát", async () => {
    phanGiai.mockReturnValue({ ok: false });
    const r = await (await goi()).xoa({ sessionId: ID });
    expect(r).toMatchObject({ ok: true });
    expect(kho.xoa).toHaveBeenCalledTimes(1);
    expect(duAnCuaPhien).not.toHaveBeenCalled();
  });
});

describe("G1 ở router", () => {
  it("★ themLuot chuyển ngoaiCallIds xuống kho; DAU_NGUON_LECH của kho đi ra nguyên vẹn (ok:false + note, không ném)", async () => {
    await (await goi()).themLuot({ sessionId: ID, expectedVersion: 3, luot: [{ role: "assistant", content: "a" }], ngoaiCallIds: [5, 6] });
    expect(kho.themLuot.mock.calls[0][1]).toMatchObject({ ngoaiCallIds: [5, 6] });
    kho.themLuot.mockResolvedValueOnce({ ok: false, ma: "DAU_NGUON_LECH" });
    expect(await (await goi()).themLuot({ sessionId: ID, expectedVersion: 3, luot: [{ role: "assistant", content: "a" }], ngoaiCallIds: [9] })).toMatchObject({ ok: false, note: "DAU_NGUON_LECH" });
  });
  it("ngoaiCallIds sai hình (>50) bị zod từ chối ở cổng", async () => {
    await expect((await goi()).themLuot({ sessionId: ID, expectedVersion: 3, luot: [{ role: "user", content: "a" }], ngoaiCallIds: new Array(51).fill(1) })).rejects.toThrow();
  });
});
