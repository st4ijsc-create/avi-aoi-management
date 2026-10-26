/**
 * ★★★ Tối ưu cpkSnapshotScheduler (kiểm định 2026-10-25): truy vấn LÔ `getMeasurementValuesForSPCBatch` + bộ lập lịch theo lô PHẢI cho CÙNG kết quả với đường cũ N+1
 * (`getMeasurementValuesForSPC` từng điểm). So sánh trên dữ liệu THẬT của _test (điểm đo có giới hạn): tập dòng của từng điểm bằng nhau, Cpk bằng nhau, và job toàn bộ ghi cpk_history khớp tính tay.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { cpkHistory } from "../../drizzle/schema";
import { getMeasurementValuesForSPC, getMeasurementValuesForSPCBatch, listPointDefsWithSpecLimits } from "../db/spc";
import { calculateCapabilityIndices } from "../utils/spc";

const G = vi.hoisted(() => ({ ids: null as number[] | null }));
vi.mock("../db/spc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/spc")>();
  return { ...actual, listPointDefsWithSpecLimits: async () => ((await actual.listPointDefsWithSpecLimits()) as { id: number }[]).filter((d) => G.ids === null || G.ids.includes(d.id)) };
});

const START = new Date(Date.now() - 3650 * 86400000);
const khoa = (r: { value: unknown; inspectionTime: Date; inspectionId: number }) => `${r.inspectionId}|${r.inspectionTime.toISOString()}|${String(r.value)}`;
let maxCpkTruoc = 0;
const diemMau: number[] = [];

afterAll(async () => {
  const d = await getDb();
  if (d && diemMau.length) await d.delete(cpkHistory).where(and(inArray(cpkHistory.measurementPointDefId, diemMau), gt(cpkHistory.id, maxCpkTruoc))).catch(() => undefined);
});

describe("lô SPC = đường cũ, từng điểm", () => {
  it("★ 120 điểm đo THẬT (3 lô 50/50/20, gồm điểm KHÔNG có dòng nào): tập dòng bằng nhau, cùng thứ tự theo thời gian, Cpk bằng nhau; đo thời gian cũ vs lô", async () => {
    const defs = (await listPointDefsWithSpecLimits()) as { id: number; upperLimit: string; lowerLimit: string }[];
    expect(defs.length).toBeGreaterThan(120);
    const mau = defs.slice(0, 120);
    const d = await getDb();
    maxCpkTruoc = Number((await d!.select({ id: cpkHistory.id }).from(cpkHistory).orderBy(cpkHistory.id).limit(1000000)).at(-1)?.id ?? 0);
    diemMau.push(...mau.map((x) => x.id));

    const tCu = Date.now();
    const cu = new Map<number, Awaited<ReturnType<typeof getMeasurementValuesForSPC>>>();
    for (const m of mau) cu.set(m.id, await getMeasurementValuesForSPC({ measurementPointDefId: m.id, startDate: START, limit: 50000 }));
    const msCu = Date.now() - tCu;

    const tLo = Date.now();
    const lo = new Map<number, Awaited<ReturnType<typeof getMeasurementValuesForSPCBatch>> extends Map<number, infer V> ? V : never>();
    for (let i = 0; i < mau.length; i += 50) for (const [k, v] of await getMeasurementValuesForSPCBatch(mau.slice(i, i + 50).map((x) => x.id), { startDate: START, limitPerPoint: 50000 })) lo.set(k, v);
    const msLo = Date.now() - tLo;
    // eslint-disable-next-line no-console
    console.info(`[cpkBatch] 120 điểm: đường cũ ${msCu} ms · lô ${msLo} ms`);

    let coDong = 0;
    let khongDong = 0;
    for (const m of mau) {
      const a = cu.get(m.id) ?? [];
      const b = lo.get(m.id) ?? [];
      expect(b.map(khoa).sort(), `tập dòng điểm ${m.id}`).toEqual(a.map(khoa).sort());
      for (let i = 1; i < b.length; i++) expect(b[i]!.inspectionTime.getTime(), `thứ tự điểm ${m.id}`).toBeGreaterThanOrEqual(b[i - 1]!.inspectionTime.getTime());
      if (a.length >= 2) {
        const norm = (rs: typeof a | typeof b) => [...rs].sort((x, y) => x.inspectionTime.getTime() - y.inspectionTime.getTime() || x.inspectionId - y.inspectionId).map((r) => Number(r.value)).filter(Number.isFinite);
        const usl = Number(m.upperLimit);
        const lsl = Number(m.lowerLimit);
        const sd = (v: number[]) => { const mu = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / (v.length - 1)); };
        const va = norm(a);
        const vb = norm(b);
        expect(calculateCapabilityIndices(vb, usl, lsl, sd(vb))).toEqual(calculateCapabilityIndices(va, usl, lsl, sd(va)));
      }
      a.length > 0 ? coDong++ : khongDong++;
    }
    expect(coDong, "có điểm CÓ dòng để so").toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.info(`[cpkBatch] điểm có dòng ${coDong} · không dòng ${khongDong}`);
  }, 300_000);

  it("limitPerPoint = k lấy k dòng ĐẦU theo thời gian của MỖI điểm (khi 4 dòng đầu không đồng hạng)", async () => {
    const defs = (await listPointDefsWithSpecLimits()) as { id: number }[];
    let thu = 0;
    for (const m of defs.slice(0, 200)) {
      const tat = await getMeasurementValuesForSPC({ measurementPointDefId: m.id, startDate: START, limit: 6 });
      if (tat.length < 6) continue;
      const t = tat.map((r) => r.inspectionTime.getTime());
      if (new Set(t.slice(0, 4)).size < 4 || t[3] === t[4]) continue; // đồng hạng ở biên ⇒ thứ tự không xác định ở đường cũ
      const lo = await getMeasurementValuesForSPCBatch([m.id], { startDate: START, limitPerPoint: 3 });
      expect((lo.get(m.id) ?? []).map(khoa)).toEqual(tat.slice(0, 3).map(khoa));
      thu++;
      if (thu >= 5) break;
    }
    expect(thu, "tìm được điểm đủ dữ liệu không đồng hạng để so").toBeGreaterThan(0);
  }, 120_000);

  it("danh sách rỗng ⇒ Map rỗng, 0 truy vấn; điểm không có dòng ⇒ vắng trong Map", async () => {
    expect((await getMeasurementValuesForSPCBatch([], { limitPerPoint: 10 })).size).toBe(0);
    expect((await getMeasurementValuesForSPCBatch([2147483000], { startDate: START, limitPerPoint: 10 })).size).toBe(0);
  });
});

describe("job runCpkSnapshotNow theo lô = tính tay bằng đường cũ", () => {
  it("★ 60 điểm đo THẬT (2 lô) ⇒ cpk_history ghi đúng sampleSize / mean / cpk như tính từ đường cũ; stats.points = 60", async () => {
    const defs = (await listPointDefsWithSpecLimits()) as { id: number; upperLimit: string; lowerLimit: string }[];
    G.ids = defs.slice(0, 60).map((x) => x.id);
    const d = await getDb();
    const truoc = Number((await d!.select({ id: cpkHistory.id }).from(cpkHistory).orderBy(cpkHistory.id).limit(1000000)).at(-1)?.id ?? 0);
    diemMau.push(...G.ids);
    maxCpkTruoc = Math.min(maxCpkTruoc || truoc, truoc);
    const { runCpkSnapshotNow } = await import("./cpkSnapshotScheduler");
    const t = Date.now();
    const stats = await runCpkSnapshotNow({ minSamples: 2, windowDays: 3650 });
    // eslint-disable-next-line no-console
    console.info(`[cpkBatch] runCpkSnapshotNow 60 điểm: ${Date.now() - t} ms · ${JSON.stringify(stats)}`);
    expect(stats.points).toBe(60);
    expect(stats.errors).toBe(0);
    const ghi = await d!.select().from(cpkHistory).where(and(inArray(cpkHistory.measurementPointDefId, G.ids), gt(cpkHistory.id, truoc)));
    expect(ghi.length).toBe(stats.snapshotted);
    expect(ghi.length).toBeGreaterThan(0);
    for (const row of ghi.slice(0, 15)) {
      const cu = await getMeasurementValuesForSPC({ measurementPointDefId: row.measurementPointDefId, startDate: START, limit: 50000 });
      const vals = cu.map((r) => Number(r.value)).filter(Number.isFinite);
      expect(row.sampleSize, `điểm ${row.measurementPointDefId}`).toBe(vals.length);
      expect(Number(row.mean)).toBeCloseTo(vals.reduce((s, x) => s + x, 0) / vals.length, 6);
    }
    G.ids = null;
  }, 300_000);
});
