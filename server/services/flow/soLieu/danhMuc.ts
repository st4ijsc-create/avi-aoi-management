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
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { idsTrongPhamVi, type PhamViNguoiXem } from "../../../db/hierarchy";
import { downtimeEvents, machines, maintenanceWorkOrders, measurementPointDefs, measurementResults, oeeMetrics, predictiveAlerts, productInspections, productionLines, sparePartsInventory, stations, workshops } from "../../../../drizzle/schema";
import { soMayDungPhuTung } from "../../../routers/_cauHinhPhamVi";
import { nguongCanNhap } from "../../khoVatTu/mucTonToiThieu";

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
  /** `nhaMay`: nhà máy được phép cho truy vấn THEO NHÀ MÁY (kho phụ tùng) — `null` = mọi nhà máy KỂ CẢ hàng chưa gán (chỉ chủ toàn quyền + luồng toàn hệ thống). */
  chay(ids: number[], t: ThamSoSoLieu, tu: Date, nhaMay: number[] | null): Promise<KetQuaSoLieu>;
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
  "dung-may.tong-hop": {
    moTa: "Dừng máy trong khoảng giờ: số lần, tổng phút (chỉ lần đã kết thúc có `duration`), số lần đang dừng, theo loại và máy dừng nhiều nhất.",
    async chay(ids, t) {
      const d = (await getDb())!;
      // Cửa sổ thời gian tính BẰNG SQL (`now() − N giờ`): cột `timestamp` không múi giờ ⇒ không đi qua Date của JS (tránh lệch múi giờ phiên).
      const dk = and(sql`${downtimeEvents.startTime} >= now() - (${t.gio}::int * interval '1 hour')`, inArray(downtimeEvents.machineId, ids));
      const [r] = await d
        .select({
          soLan: sql<number>`count(*)::int`,
          phut: sql<number>`coalesce(sum(${downtimeEvents.duration}), 0)::int`,
          dangDung: sql<number>`count(*) filter (where ${downtimeEvents.endTime} is null)::int`,
        })
        .from(downtimeEvents)
        .where(dk);
      const theoLoai = await d
        .select({ loai: downtimeEvents.category, soLan: sql<number>`count(*)::int`, phut: sql<number>`coalesce(sum(${downtimeEvents.duration}), 0)::int` })
        .from(downtimeEvents)
        .where(dk)
        .groupBy(downtimeEvents.category);
      const theoMay = await d
        .select({ ma: downtimeEvents.machineCode, soLan: sql<number>`count(*)::int`, phut: sql<number>`coalesce(sum(${downtimeEvents.duration}), 0)::int` })
        .from(downtimeEvents)
        .where(dk)
        .groupBy(downtimeEvents.machineCode)
        .orderBy(desc(sql`coalesce(sum(${downtimeEvents.duration}), 0)`), desc(sql`count(*)`))
        .limit(t.gioiHan);
      const tong: DongSoLieu = { soLan: Number(r?.soLan ?? 0), tongPhut: Number(r?.phut ?? 0), dangDung: Number(r?.dangDung ?? 0) };
      for (const x of theoLoai) {
        tong[`lan_${String(x.loai)}`] = Number(x.soLan);
        tong[`phut_${String(x.loai)}`] = Number(x.phut);
      }
      return { tong, dong: theoMay.map((x) => ({ ma: x.ma, soLan: Number(x.soLan), phut: Number(x.phut) })) };
    },
  },
  "phieu-bao-tri.dang-mo": {
    moTa: "Phiếu bảo trì đang mở (OPEN / SCHEDULED / IN_PROGRESS / ON_HOLD) theo mức ưu tiên và các phiếu mở lâu nhất (máy trong phạm vi).",
    async chay(ids, t) {
      const d = (await getDb())!;
      const dk = and(inArray(maintenanceWorkOrders.machineId, ids), inArray(maintenanceWorkOrders.status, ["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"]));
      const dem = await d
        .select({ uuTien: maintenanceWorkOrders.priority, n: sql<number>`count(*)::int` })
        .from(maintenanceWorkOrders)
        .where(dk)
        .groupBy(maintenanceWorkOrders.priority);
      const cu = await d
        .select({ so: maintenanceWorkOrders.workOrderNumber, ma: maintenanceWorkOrders.machineCode, uuTien: maintenanceWorkOrders.priority, tt: maintenanceWorkOrders.status, gio: sql<number>`floor(extract(epoch from (now() - ${maintenanceWorkOrders.openedAt})) / 3600)::int`, tieuDe: maintenanceWorkOrders.title })
        .from(maintenanceWorkOrders)
        .where(dk)
        .orderBy(maintenanceWorkOrders.openedAt, maintenanceWorkOrders.id)
        .limit(t.gioiHan);
      const tong: DongSoLieu = { tongMo: dem.reduce((s, r) => s + Number(r.n), 0) };
      for (const r of dem) tong[`uuTien_${r.uuTien}`] = Number(r.n);
      return { tong, dong: cu.map((r) => ({ soPhieu: r.so, may: r.ma ?? null, uuTien: Number(r.uuTien), trangThai: String(r.tt), moGio: Math.max(0, Number(r.gio)), tieuDe: r.tieuDe })) };
    },
  },
  "phieu-bao-tri.dong-gan-day": {
    moTa: "Phiếu bảo trì đã ĐÓNG (COMPLETED) trong khoảng giờ: số phiếu và thời gian từ MỞ đến ĐÓNG phiếu (phút; KHÔNG phải MTTR chuẩn). Loại phiếu thiếu thời điểm mở/đóng hoặc đóng trước khi mở.",
    async chay(ids, t) {
      const d = (await getDb())!;
      const phut = sql`extract(epoch from (${maintenanceWorkOrders.closedAt} - ${maintenanceWorkOrders.openedAt})) / 60`;
      const dk = and(
        inArray(maintenanceWorkOrders.machineId, ids),
        eq(maintenanceWorkOrders.status, "COMPLETED"),
        isNotNull(maintenanceWorkOrders.closedAt),
        isNotNull(maintenanceWorkOrders.openedAt),
        sql`${maintenanceWorkOrders.closedAt} >= now() - (${t.gio}::int * interval '1 hour')`,
        sql`${maintenanceWorkOrders.closedAt} >= ${maintenanceWorkOrders.openedAt}`,
      );
      const [r] = await d
        .select({
          n: sql<number>`count(*)::int`,
          trungVi: sql<number | null>`percentile_cont(0.5) within group (order by ${phut})`,
          trungBinh: sql<number | null>`avg(${phut})`,
        })
        .from(maintenanceWorkOrders)
        .where(dk);
      const lau = await d
        .select({ so: maintenanceWorkOrders.workOrderNumber, ma: maintenanceWorkOrders.machineCode, phut: sql<number>`round((${phut})::numeric)::int` })
        .from(maintenanceWorkOrders)
        .where(dk)
        .orderBy(desc(phut), maintenanceWorkOrders.id)
        .limit(t.gioiHan);
      const n = Number(r?.n ?? 0);
      return {
        tong: { soPhieu: n, moDenDongTrungViPhut: n > 0 ? lamTron(Number(r.trungVi)) : 0, moDenDongTrungBinhPhut: n > 0 ? lamTron(Number(r.trungBinh)) : 0 },
        dong: lau.map((x) => ({ soPhieu: x.so, may: x.ma ?? null, moDenDongPhut: Number(x.phut) })),
      };
    },
  },
  "ton-kho.sap-het": {
    moTa: "Phụ tùng cần nhập: tồn ≤ ngưỡng = max(mức đã khai, mức tối thiểu theo số máy của nhà máy — cùng hàm với màn Kho). Theo NHÀ MÁY (không theo máy); hàng chưa gán nhà máy chỉ chủ toàn quyền thấy.",
    async chay(_ids, t, _tu, nhaMay) {
      const d = (await getDb())!;
      if (nhaMay !== null && nhaMay.length === 0) return { tong: { soLoai: 0, tongThieu: 0 }, dong: [] };
      const loc = nhaMay === null ? undefined : inArray(sparePartsInventory.factoryId, nhaMay);
      const hang = await d.select().from(sparePartsInventory).where(loc); // loc undefined ⇒ mọi hàng (kể cả factoryId NULL) — chỉ khi nhaMay = null (chủ toàn quyền, luồng toàn hệ thống)
      const soMay = await soMayDungPhuTung();
      const can = hang
        .map((p) => {
          const nguong = nguongCanNhap(p.reorderLevel, p.factoryId == null ? null : (soMay.get(`${p.partCode}|${p.factoryId}`) ?? null));
          return { ma: p.partCode, ten: p.partName, ton: p.quantityOnHand, nguong };
        })
        .filter((p) => p.ton <= p.nguong)
        .sort((a, b) => a.ton - a.nguong - (b.ton - b.nguong) || a.ma.localeCompare(b.ma));
      return { tong: { soLoai: can.length, tongThieu: can.reduce((s, p) => s + Math.max(0, p.nguong - p.ton), 0) }, dong: can.slice(0, t.gioiHan) };
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
  // Nhà máy cho truy vấn THEO NHÀ MÁY: phạm vi nhà máy của chủ ∩ nhà máy luồng. null = mọi nhà máy (chủ toàn quyền + luồng toàn hệ thống).
  const nhaMayChu = await idsTrongPhamVi("factory", pv, { strict: true });
  const nhaMay = nhaMayLuong === null ? nhaMayChu : nhaMayChu === null || nhaMayChu.includes(nhaMayLuong) ? [nhaMayLuong] : [];
  return { ...(await muc.chay(ids, t, tu, nhaMay)), soMay: ids.length, may: ids };
}
