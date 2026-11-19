import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const mauQl = (ten: string) => ({
    ten,
    taoLuotChay: vi.fn(async () => ({ ok: true, luot: { id: `run-${ten}` } })),
    nghe: vi.fn(() => () => undefined),
    huy: vi.fn(async () => undefined),
    chiTiet: vi.fn(async () => ({ trangThai: "xong", lyDoDung: null })),
  });
  return { mauQl, dsQl: [] as Array<ReturnType<typeof mauQl>>, goiQl: [] as unknown[][], goiTao: [] as unknown[][] };
});

// Mock đúng CHỮ KÝ THẬT: `quanLyLuotChay()` không tham số (bộ dùng chung); `taoQuanLyLuotChay(phuThuoc)` dựng bộ mới. Ghi đối số của từng hàm riêng.
vi.mock("../../server/services/ai/agent/quanLyLuotChay", () => ({
  quanLyLuotChay: (...args: unknown[]) => {
    h.goiQl.push(args);
    const ql = h.mauQl(`ql${h.dsQl.length}`);
    h.dsQl.push(ql);
    return ql;
  },
  taoQuanLyLuotChay: (...args: unknown[]) => {
    h.goiTao.push(args);
    const ql = h.mauQl(`ql${h.dsQl.length}`);
    h.dsQl.push(ql);
    return ql;
  },
}));
vi.mock("../../server/services/ai/agent/thuTucLuotChay", () => ({
  thuTucDuyet: vi.fn(async () => ({ ok: true, daGhi: true, status: "approved" })),
  thuTucBac: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../server/services/ai/agent/thuTucKeHoach", () => ({ thuTucDuyetKeHoach: vi.fn(async () => ({ ok: true, note: null })) }));

import { phuThuocHostThat } from "./driverHost";
import { thuTucDuyet, thuTucBac } from "../../server/services/ai/agent/thuTucLuotChay";
import { thuTucDuyetKeHoach } from "../../server/services/ai/agent/thuTucKeHoach";

// Chốt ở mức KIỂU: nếu `quanLyLuotChay` của máy chủ có thêm tham số bắt buộc thì dòng dưới không biên dịch nữa (mock phải đổi theo).
type ThamSoQuanLyThat = Parameters<typeof import("../../server/services/ai/agent/quanLyLuotChay").quanLyLuotChay>;
const soThamSoQuanLyThat: ThamSoQuanLyThat["length"] = 0;

const NGUOI = { id: 5, role: "engineer", name: "pilot" };
beforeEach(() => {
  h.dsQl.length = 0;
  h.goiQl.length = 0;
  h.goiTao.length = 0;
  vi.mocked(thuTucDuyet).mockClear();
  vi.mocked(thuTucBac).mockClear();
  vi.mocked(thuTucDuyetKeHoach).mockClear();
});

describe("phuThuocHostThat.taoLuot — trần lượt (HA-3)", () => {
  it("★★★ không có gioiHan ⇒ bộ dùng chung `quanLyLuotChay()` MỘT lần, không tham số; không dựng bộ mới; lượt tạo trên bộ dùng chung", async () => {
    const dep = await phuThuocHostThat({ nguoi: NGUOI });
    const kq = await dep.taoLuot({ cauHoi: "q", projectId: "p" });
    expect(kq).toEqual({ ok: true, runId: "run-ql0" });
    expect(h.goiQl).toEqual([[]]);
    expect(h.goiTao).toEqual([]);
    expect(soThamSoQuanLyThat).toBe(0);
    expect(h.dsQl[0]!.taoLuotChay).toHaveBeenCalledTimes(1);
  });
  it("★★★ có gioiHan ⇒ `taoQuanLyLuotChay({ gioiHan })` đúng một lần với đúng gioiHan; `quanLyLuotChay()` vẫn chỉ gọi không tham số; lượt tạo trên bản MỚI", async () => {
    const dep = await phuThuocHostThat({ nguoi: NGUOI });
    const kq = await dep.taoLuot({ cauHoi: "q", projectId: "p", gioiHan: { soLuotToiDa: 20, msToiDa: 600_000 } });
    expect(h.goiQl).toEqual([[]]);
    expect(h.goiTao).toEqual([[{ gioiHan: { soLuotToiDa: 20, msToiDa: 600_000 } }]]);
    expect(kq).toEqual({ ok: true, runId: "run-ql1" });
    expect(h.dsQl[0]!.taoLuotChay).not.toHaveBeenCalled();
    expect(h.dsQl[1]!.taoLuotChay).toHaveBeenCalledTimes(1);
  });
  it("★★★ lượt đầu (trần 20) rồi lượt SỬA TSC (phần còn lại 13, 1 120 000 ms): mỗi lượt có bộ quản lý RIÊNG nhận đúng gioiHan của nó", async () => {
    const dep = await phuThuocHostThat({ nguoi: NGUOI });
    await dep.taoLuot({ cauHoi: "q1", projectId: "p", gioiHan: { soLuotToiDa: 20, msToiDa: 1_200_000 } });
    const kq2 = await dep.taoLuot({ cauHoi: "q2", projectId: "p", gioiHan: { soLuotToiDa: 13, msToiDa: 1_120_000 } });
    expect(h.goiTao).toEqual([[{ gioiHan: { soLuotToiDa: 20, msToiDa: 1_200_000 } }], [{ gioiHan: { soLuotToiDa: 13, msToiDa: 1_120_000 } }]]);
    expect(kq2).toEqual({ ok: true, runId: "run-ql2" });
    expect(h.dsQl[1]!.taoLuotChay).toHaveBeenCalledTimes(1);
    expect(h.dsQl[2]!.taoLuotChay).toHaveBeenCalledTimes(1);
  });
  it("★★★ nghe / huy / trạng thái lượt đi qua quản lý lượt MỚI (đúng bản đã tạo lượt)", async () => {
    const dep = await phuThuocHostThat({ nguoi: NGUOI });
    await dep.taoLuot({ cauHoi: "q", projectId: "p", gioiHan: { soLuotToiDa: 20 } });
    dep.nghe("run-ql1", () => undefined);
    dep.huy("run-ql1");
    await dep.trangThaiLuot!("run-ql1");
    expect(h.dsQl[1]!.nghe).toHaveBeenCalledTimes(1);
    expect(h.dsQl[1]!.huy).toHaveBeenCalledTimes(1);
    expect(h.dsQl[1]!.chiTiet).toHaveBeenCalledTimes(1);
    expect(h.dsQl[0]!.nghe).not.toHaveBeenCalled();
    expect(h.dsQl[0]!.huy).not.toHaveBeenCalled();
    expect(h.dsQl[0]!.chiTiet).not.toHaveBeenCalled();
  });
  it("★★ không có gioiHan thì nghe / huy dùng quản lý lượt gốc", async () => {
    const dep = await phuThuocHostThat({ nguoi: NGUOI });
    await dep.taoLuot({ cauHoi: "q", projectId: "p" });
    dep.nghe("x", () => undefined);
    expect(h.dsQl[0]!.nghe).toHaveBeenCalledTimes(1);
  });
});

describe("duyệt hành động / bác / duyệt kế hoạch sau khi lượt nằm trên bộ quản lý MỚI", () => {
  it("★★★ duyet / bac / duyetKeHoach gọi thủ tục máy chủ với ĐÚNG hai đối số (không truyền bộ quản lý), và kết quả thủ tục được chuyển cho host", async () => {
    const dep = await phuThuocHostThat({ nguoi: NGUOI });
    await dep.taoLuot({ cauHoi: "q", projectId: "p", gioiHan: { soLuotToiDa: 2 } });
    expect(await dep.duyet("act-1")).toEqual({ ok: true, daGhi: true, status: "approved" });
    await dep.bac("act-2", "vì sao");
    expect(await dep.duyetKeHoach("run-ql1", "bam-1", "duyet")).toEqual({ ok: true, note: null });
    expect(vi.mocked(thuTucDuyet).mock.calls).toEqual([[NGUOI, { actionId: "act-1", lang: "vi" }]]);
    expect(vi.mocked(thuTucBac).mock.calls).toEqual([[NGUOI, { actionId: "act-2", lyDo: "vì sao" }]]);
    expect(vi.mocked(thuTucDuyetKeHoach).mock.calls).toEqual([[NGUOI, { runId: "run-ql1", bam: "bam-1", quyetDinh: "duyet" }]]);
  });
  // Ghim ĐỌC NGUỒN (mã máy chủ thật nặng DB, mock ở trên thay chúng): ba thủ tục KHÔNG dùng bộ quản lý ⇒ lượt nằm ở bộ mới vẫn được duyệt,
  // vì tín hiệu đi qua bus mức module theo actionId / runId.
  const doc = (rel: string) => fs.readFileSync(path.join(__dirname, "../../server/services/ai/agent", rel), "utf8");
  it("★★★ thuTucDuyet và thuTucBac (thuTucLuotChay.ts) không nhận / không gọi bộ quản lý lượt; thuTucKeHoach.ts và busDuyetAgent.ts không nhắc quanLyLuotChay", () => {
    const tl = doc("thuTucLuotChay.ts");
    const a = tl.indexOf("export async function thuTucDuyet(");
    const b = tl.indexOf("export async function thuTucBac(");
    const c = tl.indexOf("\nexport ", b + 10);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    for (const khoi of [tl.slice(a, b), tl.slice(b, c)]) {
      expect(khoi).not.toMatch(/quanLyLuotChay|QuanLyLuotChay|\bql\b/);
    }
    expect(doc("thuTucKeHoach.ts")).not.toMatch(/quanLyLuotChay/);
    expect(doc("busDuyetAgent.ts")).not.toMatch(/quanLyLuotChay/);
  });
});
