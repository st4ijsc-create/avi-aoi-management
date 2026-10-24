/**
 * CỔNG CSDL THẬT — lô L6a-1 (rà bảo mật tRPC, 2026-10-25): ĐỌC của paretoAnalysis (6 thủ tục) theo PHẠM VI người dùng.
 * Lỗ: người nhà máy A xem Pareto lỗi theo loại / máy / chuyền / thời gian / lớp lỗi / gói linh kiện gồm số lỗi của MỌI nhà máy (và tên máy, tên chuyền nhà máy khác).
 * Luật: chỉ lần kiểm của máy trong phạm vi (lần kiểm không gắn máy bị loại với người hẹp); phạm vi rỗng ⇒ kết quả rỗng; admin không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedHaiNhaMayDo, type HaiNhaMayDo } from "../testing/haiNhaMayDoLuong";

const RUN = `l6p${process.pid}${Date.now().toString(36)}`;
let H!: HaiNhaMayDo;
let router: typeof import("./paretoAnalysisRouter").paretoAnalysisRouter;
const goi = (u: { id: number; role: string; name: string }) => router.createCaller({ user: { ...u, twoFactorEnabled: true } } as never);
const homQua = new Date(Date.now() - 86_400_000).toISOString();
const ngayMai = new Date(Date.now() + 86_400_000).toISOString();
const ngay = (iso: string) => iso.slice(0, 10);

beforeAll(async () => {
  H = await seedHaiNhaMayDo(RUN, "l6p");
  router = (await import("./paretoAnalysisRouter")).paretoAnalysisRouter;
}, 240_000);
afterAll(async () => { await H?.don(); });

const cats = (r: { items: { category: string }[] }) => r.items.map((i) => i.category);

describe("★★★ paretoAnalysis — ĐỌC theo phạm vi", () => {
  it("byMachine — A chỉ thấy máy A (tên máy B không lộ); admin thấy cả hai; không gán nhà máy ⇒ rỗng", async () => {
    const kA = { startDate: new Date(homQua), endDate: new Date(ngayMai), lineId: H.A.lid, limit: 100 };
    const kB = { ...kA, lineId: H.B.lid };
    expect(cats(await goi(H.uA).byMachine(kA))).toContain(H.A.code);
    expect(cats(await goi(H.uA).byMachine(kB))).not.toContain(H.B.code);
    expect(cats(await goi(H.uAdmin).byMachine(kA))).toContain(H.A.code);
    expect(cats(await goi(H.uAdmin).byMachine(kB))).toContain(H.B.code);
    expect(cats(await goi(H.uRong).byMachine(kA))).not.toContain(H.A.code);
  });
  it("byLine — A chỉ thấy chuyền A", async () => {
    const ids = (r: { items: { categoryId?: number }[] }) => r.items.map((i) => i.categoryId);
    const kA = { startDate: new Date(homQua), endDate: new Date(ngayMai), workshopId: H.A.wid, limit: 100 };
    const kB = { ...kA, workshopId: H.B.wid };
    expect(ids(await goi(H.uA).byLine(kA))).toContain(H.A.lid);
    expect(ids(await goi(H.uA).byLine(kB))).not.toContain(H.B.lid);
    expect(ids(await goi(H.uAdmin).byLine(kB))).toContain(H.B.lid);
    expect(ids(await goi(H.uRong).byLine(kA))).not.toContain(H.A.lid);
  });
  it("byDefectType — số lỗi của điểm đo chung chỉ tính phần của A (1), admin thấy 2", async () => {
    const dem = (r: { items: { category: string; count: number }[] }) => r.items.find((i) => i.category === H.RUN + "-P")?.count ?? 0;
    expect(dem(await goi(H.uA).byDefectType({ startDate: new Date(homQua), endDate: new Date(ngayMai), limit: 100 }))).toBe(1);
    expect(dem(await goi(H.uAdmin).byDefectType({ startDate: new Date(homQua), endDate: new Date(ngayMai), limit: 100 }))).toBe(2);
    expect(dem(await goi(H.uRong).byDefectType({ startDate: new Date(homQua), endDate: new Date(ngayMai), limit: 100 }))).toBe(0);
  });
  it("byTimePeriod — tổng lỗi theo máy: khai machineId của B vẫn không thấy; A không thấy phần B", async () => {
    const tong = (r: { totalDefects: number }) => r.totalDefects;
    const a = await goi(H.uA).byTimePeriod({ startDate: new Date(homQua), endDate: new Date(ngayMai), groupBy: "day", machineId: H.B.mid, limit: 100 });
    expect(tong(a)).toBe(0);
    const aMay = await goi(H.uA).byTimePeriod({ startDate: new Date(homQua), endDate: new Date(ngayMai), groupBy: "day", machineId: H.A.mid, limit: 100 });
    expect(tong(aMay)).toBe(1);
    expect(tong(await goi(H.uAdmin).byTimePeriod({ startDate: new Date(homQua), endDate: new Date(ngayMai), groupBy: "day", machineId: H.B.mid, limit: 100 }))).toBe(1);
    // không khai máy: số của A < số của admin (≥ 1 lần kiểm của B bị loại)
    const tA = tong(await goi(H.uA).byTimePeriod({ startDate: new Date(homQua), endDate: new Date(ngayMai), groupBy: "day", limit: 100 }));
    const tAdm = tong(await goi(H.uAdmin).byTimePeriod({ startDate: new Date(homQua), endDate: new Date(ngayMai), groupBy: "day", limit: 100 }));
    expect(tAdm - tA).toBeGreaterThanOrEqual(1);
  });
  it("byDefectClass / byPackage — tổng lỗi chỉ của A (1) trên mẫu sản phẩm chung; admin 2", async () => {
    const khung = { startDate: ngay(homQua), endDate: ngay(ngayMai), productModelId: H.modelId };
    expect((await goi(H.uA).byDefectClass(khung)).totalDefects).toBe(1);
    expect((await goi(H.uAdmin).byDefectClass(khung)).totalDefects).toBe(2);
    expect((await goi(H.uRong).byDefectClass(khung)).totalDefects).toBe(0);
    expect((await goi(H.uA).byPackage(khung)).totalDefects).toBe(1);
    expect((await goi(H.uAdmin).byPackage(khung)).totalDefects).toBe(2);
    expect((await goi(H.uRong).byPackage(khung)).totalDefects).toBe(0);
  });
});
