/** Đợt 11.3-C — thân thủ tục `aiAgent.{keHoachDangCho, duyetKeHoach}`: quyền fail-closed, lỗi trong THÂN, chỉ đánh thức SAU khi ghi sổ thành công. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const co = vi.hoisted(() => ({ quyen: true, nem: false }));
vi.mock("../../../_core/accessControl", () => ({
  checkPermission: async () => {
    if (co.nem) throw new Error("db chết");
    return co.quyen;
  },
}));
import { thuTucDuyetKeHoach, thuTucKeHoachDangCho } from "./thuTucKeHoach";
import type { HangKeHoach, KetQuaQuyetKeHoach } from "../../../db/aiAgentKeHoach";

const U = { id: 5, role: "engineer" };
const R = "22222222-2222-4222-8222-222222222222";
const BAM = "a".repeat(64);
const hang = (): HangKeHoach => ({ bam: BAM, viec: [{ noiDung: "a", trangThai: "cho" }], trangThai: "cho", nopLuc: new Date("2026-10-31T00:00:00.000Z"), duyetLuc: null, duyetBoi: null });

beforeEach(() => {
  co.quyen = true;
  co.nem = false;
});

describe("thuTucKeHoachDangCho", () => {
  it("★★★ không quyền ⇒ PERMISSION_DENIED và KHÔNG đọc sổ; quyền ném ⇒ cũng từ chối (fail-closed)", async () => {
    let doc = 0;
    const dep = { doc: async () => (doc++, hang()) };
    co.quyen = false;
    expect(await thuTucKeHoachDangCho(U, R, dep)).toMatchObject({ ok: false, note: "PERMISSION_DENIED", viec: [], bam: null });
    co.quyen = true;
    co.nem = true;
    expect(await thuTucKeHoachDangCho(U, R, dep)).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    expect(doc).toBe(0);
  });
  it("có kế hoạch ⇒ viec + bam + trạng thái + giờ ISO; không có ⇒ NOT_FOUND trong thân", async () => {
    expect(await thuTucKeHoachDangCho(U, R, { doc: async () => hang() })).toEqual({
      ok: true,
      note: null,
      viec: [{ noiDung: "a", trangThai: "cho" }],
      bam: BAM,
      trangThai: "cho",
      nopLuc: "2026-10-31T00:00:00.000Z",
      duyetLuc: null,
    });
    expect(await thuTucKeHoachDangCho(U, R, { doc: async () => null })).toMatchObject({ ok: false, note: "NOT_FOUND" });
  });
  it("userId từ phiên được truyền xuống tầng dữ liệu (không có đường khác)", async () => {
    let thay: [number, string] | null = null;
    await thuTucKeHoachDangCho(U, R, { doc: async (u, r) => ((thay = [u, r]), null) });
    expect(thay).toEqual([5, R]);
  });
});

describe("thuTucDuyetKeHoach", () => {
  const y = { runId: R, bam: BAM, quyetDinh: "duyet" as const };
  it("★★★ không quyền ⇒ PERMISSION_DENIED, KHÔNG ghi, KHÔNG đánh thức", async () => {
    let quyet = 0;
    let dt = 0;
    co.quyen = false;
    const kq = await thuTucDuyetKeHoach(U, y, { quyet: async () => (quyet++, { ok: true, trangThai: "duyet", luc: new Date() }), danhThuc: () => dt++ });
    expect(kq).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    expect(quyet + dt).toBe(0);
  });
  it("★★★ thành công ⇒ đánh thức SAU khi ghi; trả giờ ISO", async () => {
    const thuTu: string[] = [];
    const kq = await thuTucDuyetKeHoach(U, y, {
      quyet: async () => (thuTu.push("ghi"), { ok: true, trangThai: "duyet", luc: new Date("2026-10-31T02:00:00.000Z") }),
      danhThuc: (r) => thuTu.push("thuc:" + r),
    });
    expect(kq).toEqual({ ok: true, note: null, trangThai: "duyet", luc: "2026-10-31T02:00:00.000Z" });
    expect(thuTu).toEqual(["ghi", "thuc:" + R]);
  });
  it("★★★ mọi lỗi tầng dữ liệu ⇒ ok:false + mã trong thân, KHÔNG đánh thức", async () => {
    for (const ma of ["NOT_FOUND", "CONFLICT", "DA_QUYET", "LOI_CSDL"] as const) {
      let dt = 0;
      const kq = await thuTucDuyetKeHoach(U, y, { quyet: async (): Promise<KetQuaQuyetKeHoach> => ({ ok: false, ma }), danhThuc: () => dt++ });
      expect(kq).toMatchObject({ ok: false, note: ma, trangThai: null });
      expect(dt).toBe(0);
    }
  });
  it("chuyển đúng (userId phiên, runId, băm, quyết định) xuống tầng dữ liệu", async () => {
    let got: unknown[] = [];
    await thuTucDuyetKeHoach(U, { runId: R, bam: BAM, quyetDinh: "bac" }, { quyet: async (...a) => ((got = a), { ok: false, ma: "NOT_FOUND" }), danhThuc: () => undefined });
    expect(got).toEqual([5, R, BAM, "bac"]);
  });
});
