/**
 * ★★★ Luồng AI — DANH MỤC TRUY VẤN SỐ LIỆU có tên cho node `du-lieu.so-lieu` (lô Luồng-1, 2026-10-25; dieu-phoi duyệt).
 *
 * Luật cứng:
 *   • CHỈ truy vấn có tên trong `DANH_MUC` — KHÔNG SQL tự do, KHÔNG ghép chuỗi: mọi tham số là số nguyên bị chặn khoảng;
 *     mỗi truy vấn là mã drizzle cố định với tham số ràng buộc.
 *   • PHẠM VI = phạm vi của CHỦ LƯỢT tính LÚC CHẠY (`BoKiemPhamVi.phamVi`, dựng từ người dùng HIỆN TẠI — chủ bị khoá / mất vai ⇒ không có bộ
 *     kiểm ⇒ node từ chối), qua CHÍNH bộ phân giải tRPC (`idsTrongPhamVi("machine")`); luồng gắn nhà máy ⇒ giao thêm với MÁY CỦA NHÀ MÁY ĐÓ
 *     (dữ liệu ⊆ nhà máy của luồng — người nhận thông báo được kiểm theo cùng nhà máy). Tập máy RỖNG ⇒ NÉM (fail-closed, không trả bảng rỗng).
 *   • Chỉ ĐỌC. Kết quả là dữ liệu tổng hợp nhỏ (≤ 20 dòng).
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { idsTrongPhamVi, type PhamViNguoiXem } from "../../../db/hierarchy";
import { machines, measurementPointDefs, measurementResults, oeeMetrics, predictiveAlerts, productInspections, productionLines, stations, workshops } from "../../../../drizzle/schema";

export class LoiSoLieu extends Error {
  constructor(message: string, readonly ma: string) {
    super(message);
  }
}

export interface ThamSoSoLieu {
  /** Khoảng thời gian nhìn lại (giờ), 1..168. */
  gio: number;
  /** Số dòng tối đa, 1..20. */
  gioiHan: number;
}

export type DongSoLieu = Record<string, string | number | boolean | null>;
export interface KetQuaSoLieu {
  tong: DongSoLieu;
  dong: DongSoLieu[];
}

interface MucDanhMuc {
  moTa: string;
  chay(ids: number[], t: ThamSoSoLieu, tu: Date): Promise<KetQuaSoLieu>;
}

const lamTron = (n: number) => Math.round(n * 100) / 100;

export const DANH_MUC: Readonly<Record<string, MucDanhMuc>> = {
  "san-luong.tong-quan": {
    moTa: "Số lần kiểm OK / NG / NTF và tỉ lệ NG trong khoảng giờ (máy trong phạm vi).",
    async chay(ids, _t, tu) {
      const d = (await getDb())!;
      const [r] = await d
        .select({
          tong: sql<number>`count(*)::int`,
          ok: sql<number>`count(*) filter (where ${productInspections.overallResult} = 'OK')::int`,
          ng: sql<number>`count(*) filter (where ${productInspections.overallResult} = 'NG')::int`,
          ntf: sql<number>`count(*) filter (where ${productInspections.overallResult} = 'NTF')::int`,
        })
        .from(productInspections)
        .where(and(gte(productInspections.inspectionTime, tu), inArray(productInspections.machineId, ids)));
      const tong = Number(r?.tong ?? 0);
      const ng = Number(r?.ng ?? 0);
      return { tong: { tong, ok: Number(r?.ok ?? 0), ng, ntf: Number(r?.ntf ?? 0), tiLeNg: tong > 0 ? lamTron((ng / tong) * 100) : 0 }, dong: [] };
    },
  },
  "oee.trung-binh": {
    moTa: "OEE trung bình (A·P·Q·OEE, %) theo máy trong khoảng giờ.",
    async chay(ids, t, tu) {
      const d = (await getDb())!;
      const rows = await d
        .select({
          may: oeeMetrics.machineCode,
          mau: sql<number>`count(*)::int`,
          a: sql<number>`avg(${oeeMetrics.availability})`,
          p: sql<number>`avg(${oeeMetrics.performance})`,
          q: sql<number>`avg(${oeeMetrics.quality})`,
          oee: sql<number>`avg(${oeeMetrics.oee})`,
        })
        .from(oeeMetrics)
        .where(and(gte(oeeMetrics.timestamp, tu), inArray(oeeMetrics.machineId, ids)))
        .groupBy(oeeMetrics.machineCode)
        .orderBy(sql`avg(${oeeMetrics.oee}) asc`)
        .limit(t.gioiHan);
      const dong = rows.map((r) => ({ may: r.may, mau: Number(r.mau), a: lamTron(Number(r.a) / 100), p: lamTron(Number(r.p) / 100), q: lamTron(Number(r.q) / 100), oee: lamTron(Number(r.oee) / 100) }));
      const n = dong.length;
      return { tong: { soMay: n, oeeTrungBinh: n > 0 ? lamTron(dong.reduce((s, x) => s + x.oee, 0) / n) : 0 }, dong };
    },
  },
  "ng.diem-do-hang-dau": {
    moTa: "Các điểm đo có nhiều NG nhất trong khoảng giờ (máy trong phạm vi).",
    async chay(ids, t, tu) {
      const d = (await getDb())!;
      const rows = await d
        .select({
          ma: measurementPointDefs.code,
          ten: measurementPointDefs.name,
          ng: sql<number>`count(*) filter (where ${measurementResults.result} = 'NG')::int`,
          tong: sql<number>`count(*)::int`,
        })
        .from(measurementResults)
        .innerJoin(productInspections, eq(productInspections.id, measurementResults.inspectionId))
        .innerJoin(measurementPointDefs, eq(measurementPointDefs.id, measurementResults.pointDefId))
        .where(and(gte(productInspections.inspectionTime, tu), inArray(productInspections.machineId, ids)))
        .groupBy(measurementPointDefs.code, measurementPointDefs.name)
        .having(sql`count(*) filter (where ${measurementResults.result} = 'NG') > 0`)
        .orderBy(desc(sql`count(*) filter (where ${measurementResults.result} = 'NG')`))
        .limit(t.gioiHan);
      const dong = rows.map((r) => ({ ma: r.ma, ten: r.ten, ng: Number(r.ng), tong: Number(r.tong), tiLeNg: Number(r.tong) > 0 ? lamTron((Number(r.ng) / Number(r.tong)) * 100) : 0 }));
      return { tong: { soDiemDo: dong.length, tongNg: dong.reduce((s, x) => s + x.ng, 0) }, dong };
    },
  },
  "may.trang-thai": {
    moTa: "Số máy theo trạng thái vận hành và danh sách máy đang lỗi (máy trong phạm vi).",
    async chay(ids, t) {
      const d = (await getDb())!;
      const dem = await d
        .select({ tt: machines.operationStatus, n: sql<number>`count(*)::int` })
        .from(machines)
        .where(and(eq(machines.isActive, true), inArray(machines.id, ids)))
        .groupBy(machines.operationStatus);
      const loi = await d
        .select({ ma: machines.code, ten: machines.name })
        .from(machines)
        .where(and(eq(machines.isActive, true), inArray(machines.id, ids), sql`${machines.operationStatus}::text = 'error'`))
        .orderBy(machines.code)
        .limit(t.gioiHan);
      const tong: DongSoLieu = { tongSoMay: dem.reduce((s, r) => s + Number(r.n), 0) };
      for (const r of dem) tong[`tt_${String(r.tt)}`] = Number(r.n);
      return { tong, dong: loi.map((r) => ({ ma: r.ma, ten: r.ten })) };
    },
  },
  "canh-bao.dang-mo": {
    moTa: "Cảnh báo dự đoán đang mở (ACTIVE) theo mức độ và các cảnh báo mới nhất (máy trong phạm vi).",
    async chay(ids, t) {
      const d = (await getDb())!;
      const dk = and(eq(predictiveAlerts.status, "ACTIVE"), inArray(predictiveAlerts.machineId, ids));
      const dem = await d.select({ sv: predictiveAlerts.severity, n: sql<number>`count(*)::int` }).from(predictiveAlerts).where(dk).groupBy(predictiveAlerts.severity);
      const moi = await d
        .select({ tieuDe: predictiveAlerts.title, may: predictiveAlerts.machineCode, sv: predictiveAlerts.severity })
        .from(predictiveAlerts)
        .where(dk)
        .orderBy(desc(predictiveAlerts.createdAt))
        .limit(t.gioiHan);
      const tong: DongSoLieu = { tongMo: dem.reduce((s, r) => s + Number(r.n), 0) };
      for (const r of dem) tong[`muc_${String(r.sv)}`] = Number(r.n);
      return { tong, dong: moi.map((r) => ({ tieuDe: r.tieuDe, may: r.may ?? null, muc: String(r.sv) })) };
    },
  },
};

/** Tập máy được phép dùng cho một lần chạy: phạm vi CHỦ LƯỢT ∩ máy của nhà máy luồng (nếu luồng gắn nhà máy). RỖNG ⇒ NÉM (fail-closed). */
export async function maTrongPhamViLuong(pv: PhamViNguoiXem, nhaMayLuong: number | null): Promise<number[]> {
  const idsMay = await idsTrongPhamVi("machine", pv, { strict: true });
  const d = (await getDb())!;
  let ids: number[];
  if (nhaMayLuong === null) {
    ids = idsMay === null ? (await d.select({ id: machines.id }).from(machines)).map((r) => r.id) : idsMay;
  } else {
    const cuaNhaMay = (
      await d
        .select({ id: machines.id })
        .from(machines)
        .innerJoin(stations, eq(stations.id, machines.stationId))
        .innerJoin(productionLines, eq(productionLines.id, stations.lineId))
        .innerJoin(workshops, eq(workshops.id, productionLines.workshopId))
        .where(eq(workshops.factoryId, nhaMayLuong))
    ).map((r) => r.id);
    ids = idsMay === null ? cuaNhaMay : cuaNhaMay.filter((x) => idsMay.includes(x));
  }
  if (ids.length === 0) {
    throw new LoiSoLieu("Chủ luồng không có máy nào trong phạm vi (đã mất gán nhà máy hoặc luồng gắn nhà máy ngoài phạm vi) — từ chối đọc số liệu.", "PHAM_VI_RONG");
  }
  return ids;
}

const nguyenTrong = (v: unknown, ten: string, min: number, max: number, macDinh: number): number => {
  const n = v === undefined || v === null || v === "" ? macDinh : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new LoiSoLieu(`tham số '${ten}' phải là số nguyên trong [${min}, ${max}]`, "THAM_SO_SAI");
  return n;
};

export function chuanHoaThamSo(t: Record<string, unknown>): ThamSoSoLieu {
  return { gio: nguyenTrong(t.gio, "gio", 1, 168, 8), gioiHan: nguyenTrong(t.gioiHan, "gioiHan", 1, 20, 10) };
}

export async function chaySoLieu(ten: string, t: ThamSoSoLieu, pv: PhamViNguoiXem, nhaMayLuong: number | null): Promise<KetQuaSoLieu & { soMay: number; may: number[] }> {
  const muc = Object.prototype.hasOwnProperty.call(DANH_MUC, ten) ? DANH_MUC[ten] : undefined;
  if (!muc) throw new LoiSoLieu(`truy vấn '${String(ten).slice(0, 60)}' không có trong danh mục`, "TRUY_VAN_LA");
  const ids = await maTrongPhamViLuong(pv, nhaMayLuong);
  const tu = new Date(Date.now() - t.gio * 3600_000);
  return { ...(await muc.chay(ids, t, tu)), soMay: ids.length, may: ids };
}
