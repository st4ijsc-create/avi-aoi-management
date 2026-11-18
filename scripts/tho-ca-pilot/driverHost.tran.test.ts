import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const mauQl = (ten: string) => ({
    ten,
    taoLuotChay: vi.fn(async () => ({ ok: true, luot: { id: `run-${ten}` } })),
    nghe: vi.fn(() => () => undefined),
    huy: vi.fn(async () => undefined),
    chiTiet: vi.fn(async () => ({ trangThai: "xong", lyDoDung: null })),
  });
  return { mauQl, dsQl: [] as Array<ReturnType<typeof mauQl>>, goi: [] as unknown[] };
});

vi.mock("../../server/services/ai/agent/quanLyLuotChay", () => ({
  quanLyLuotChay: (...args: unknown[]) => {
    h.goi.push(args);
    const ql = h.mauQl(`ql${h.dsQl.length}`);
    h.dsQl.push(ql);
    return ql;
  },
}));
vi.mock("../../server/services/ai/agent/thuTucLuotChay", () => ({ thuTucDuyet: vi.fn(), thuTucBac: vi.fn() }));
vi.mock("../../server/services/ai/agent/thuTucKeHoach", () => ({ thuTucDuyetKeHoach: vi.fn() }));

import { phuThuocHostThat } from "./driverHost";

const NGUOI = { id: 5, role: "engineer", name: "pilot" };
beforeEach(() => {
  h.dsQl.length = 0;
  h.goi.length = 0;
});

describe("phuThuocHostThat.taoLuot — trần lượt (HA-3)", () => {
  it("★★★ không có gioiHan ⇒ quản lý lượt dựng MỘT lần, không tham số (hành vi cũ)", async () => {
    const dep = await phuThuocHostThat({ nguoi: NGUOI });
    const kq = await dep.taoLuot({ cauHoi: "q", projectId: "p" });
    expect(kq).toEqual({ ok: true, runId: "run-ql0" });
    expect(h.goi).toEqual([[]]);
    expect(h.dsQl[0].taoLuotChay).toHaveBeenCalledTimes(1);
  });
  it("★★★ có gioiHan ⇒ dựng quản lý lượt MỚI với đúng gioiHan và tạo lượt trên bản mới", async () => {
    const dep = await phuThuocHostThat({ nguoi: NGUOI });
    const kq = await dep.taoLuot({ cauHoi: "q", projectId: "p", gioiHan: { soLuotToiDa: 20, msToiDa: 600_000 } });
    expect(h.goi).toEqual([[], [{ gioiHan: { soLuotToiDa: 20, msToiDa: 600_000 } }]]);
    expect(kq).toEqual({ ok: true, runId: "run-ql1" });
    expect(h.dsQl[0].taoLuotChay).not.toHaveBeenCalled();
    expect(h.dsQl[1].taoLuotChay).toHaveBeenCalledTimes(1);
  });
  it("★★★ nghe / huy / trạng thái lượt đi qua quản lý lượt MỚI (đúng bản đã tạo lượt)", async () => {
    const dep = await phuThuocHostThat({ nguoi: NGUOI });
    await dep.taoLuot({ cauHoi: "q", projectId: "p", gioiHan: { soLuotToiDa: 20 } });
    dep.nghe("run-ql1", () => undefined);
    dep.huy("run-ql1");
    await dep.trangThaiLuot("run-ql1");
    expect(h.dsQl[1].nghe).toHaveBeenCalledTimes(1);
    expect(h.dsQl[1].huy).toHaveBeenCalledTimes(1);
    expect(h.dsQl[1].chiTiet).toHaveBeenCalledTimes(1);
    expect(h.dsQl[0].nghe).not.toHaveBeenCalled();
    expect(h.dsQl[0].huy).not.toHaveBeenCalled();
    expect(h.dsQl[0].chiTiet).not.toHaveBeenCalled();
  });
  it("★★ không có gioiHan thì nghe / huy dùng quản lý lượt gốc", async () => {
    const dep = await phuThuocHostThat({ nguoi: NGUOI });
    await dep.taoLuot({ cauHoi: "q", projectId: "p" });
    dep.nghe("x", () => undefined);
    expect(h.dsQl[0].nghe).toHaveBeenCalledTimes(1);
  });
});
