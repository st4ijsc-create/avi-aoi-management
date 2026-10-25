/**
 * ★★★ Luồng AI — KÍCH HOẠT THEO SỰ KIỆN NỘI BỘ: node `kich-hoat.su-kien` + bộ nghe eventBus (lô Luồng-2, 2026-10-25; dieu-phoi duyệt).
 *
 *   • MẶC ĐỊNH TẮT THEO NODE: node phải khai `bat: true` TƯỜNG MINH (tham số của phiên bản đã duyệt) thì mới được nghe; vắng / false ⇒ không bao giờ bắn.
 *   • CHỈ danh sách trắng sự kiện (`SU_KIEN_CHO_PHEP`), mỗi sự kiện phải mang `machineId` số nguyên dương. Sự kiện khác bị bỏ qua.
 *   • PHẠM VI (fail-closed) tính LÚC BẮN, không tin tên nhà máy trong payload: máy → nhà máy tra từ CSDL; CHỦ LUỒNG (người bật phiên bản)
 *     dựng lại bộ kiểm từ người dùng HIỆN TẠI (khoá / mất vai ⇒ không bắn); máy phải trong phạm vi chủ; luồng gắn nhà máy F ⇒ máy phải thuộc F.
 *     Sự kiện nhà máy B không bao giờ kích luồng của chủ chỉ thuộc A. Không xác định được nhà máy của máy ⇒ bỏ.
 *   • IDEMPOTENT theo khoá sự kiện + cửa sổ (`cuaSoPhut`, mặc định 10): cùng (loại, máy) trong một cửa sổ ⇒ MỘT lượt (cột UNIQUE
 *     `idempotencyKey` ⇒ nhiều tiến trình / Redis fan-out vẫn một lượt). `downtime.start` khoá theo id sự kiện.
 *   • TRẦN lượt/giờ mỗi luồng (`min(tranMoiGio, TRAN_LUOT_SU_KIEN_MOI_GIO)`) — chống bão sự kiện; vượt ⇒ BỎ, có log.
 *   • Bus chỉ chạy trong tiến trình phát sự kiện (API) ⇒ bộ nghe khởi ở `_core/index.ts`. KHÔNG đụng OT: bus chỉ mang thông báo/telemetry.
 * Item ra là DỮ LIỆU KHÔNG TIN CẬY chỉ gồm trường gọn lấy từ payload (đã ép kiểu, cắt ngắn).
 */
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { machines, productionLines, stations, workshops } from "../../../../drizzle/schema";
import { eventBus } from "../../../_core/eventBus";
import { getDb } from "../../../db/connection";
import type { FlowDefinition } from "../../../../shared/flow/model";
import { boKiemChoChuLuong } from "../boKiemPhamVi";
import { dangKyNut } from "../dangKyNut";
import { laTrungKhoa } from "./lich";

export const LOAI_SU_KIEN = "kich-hoat.su-kien";
export const SU_KIEN_CHO_PHEP: readonly string[] = ["ng.alert", "yield.warning", "downtime.start"];
/** Trần cứng lượt bắn theo sự kiện MỖI GIỜ mỗi luồng (tham số `tranMoiGio` chỉ có thể thấp hơn). */
export const TRAN_LUOT_SU_KIEN_MOI_GIO = 30;
export const TRAN_NODE_SU_KIEN_MOI_LUONG = 3;
const CUA_SO_MAC_DINH = 10;
const TRAN_MAC_DINH = 10;
const TTL_MUC_MS = 15_000;

dangKyNut({
  type: LOAI_SU_KIEN,
  typeVersion: 1,
  laKichHoat: true,
  congVao: [],
  congRa: ["main"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(_t, ngu) {
    return { main: ngu.inputs.main ?? [{ json: {} }] };
  },
});

const laSoNguyen = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** Kiểm tham số các node sự kiện (router gọi trước khi lưu). Trả danh sách lỗi (rỗng = hợp lệ). */
export function kiemThamSoSuKien(raw: unknown): string[] {
  const nodes = (raw as { nodes?: unknown })?.nodes;
  if (!Array.isArray(nodes)) return [];
  const loi: string[] = [];
  const ds = (nodes as { id?: unknown; type?: unknown; parameters?: Record<string, unknown> }[]).filter((n) => n?.type === LOAI_SU_KIEN);
  for (const n of ds) {
    const p = n.parameters ?? {};
    const id = String(n.id);
    if (typeof p.suKien !== "string" || !SU_KIEN_CHO_PHEP.includes(p.suKien)) loi.push(`node '${id}': suKien phải là một trong ${SU_KIEN_CHO_PHEP.join(" | ")}`);
    if (p.bat !== undefined && typeof p.bat !== "boolean") loi.push(`node '${id}': bat phải là true/false`);
    if (p.cuaSoPhut !== undefined && !laSoNguyen(p.cuaSoPhut, 1, 1440)) loi.push(`node '${id}': cuaSoPhut phải là số nguyên 1..1440`);
    if (p.tranMoiGio !== undefined && !laSoNguyen(p.tranMoiGio, 1, TRAN_LUOT_SU_KIEN_MOI_GIO)) loi.push(`node '${id}': tranMoiGio phải là số nguyên 1..${TRAN_LUOT_SU_KIEN_MOI_GIO}`);
  }
  if (ds.length > TRAN_NODE_SU_KIEN_MOI_LUONG) loi.push(`luồng có ${ds.length} node sự kiện — tối đa ${TRAN_NODE_SU_KIEN_MOI_LUONG} mỗi luồng`);
  return loi;
}

// ── mục nghe (luồng BẬT + node `bat: true`) ─────────────────────────────────────────────────────

export interface MucSuKien {
  flowId: string;
  version: number;
  nodeId: string;
  suKien: string;
  cuaSoPhut: number;
  tran: number;
  /** nhà máy của luồng (NULL = toàn hệ thống) */
  nhaMayLuong: number | null;
  /** chủ luồng = người bật phiên bản (approvedBy ?? createdBy) */
  chuLuong: number | null;
}

export async function docMucSuKien(tienToFlow?: string): Promise<MucSuKien[]> {
  const db = await getDb();
  if (!db) return [];
  const loc = tienToFlow ? sql`AND f.id LIKE ${tienToFlow.replace(/[\\%_]/g, (c) => "\\" + c) + "%"}` : sql``;
  const rows = (await db.execute(sql`
    SELECT f.id AS "flowId", f."activeVersion" AS version, f."factoryId" AS "factoryId", COALESCE(v."approvedBy", v."createdBy") AS "chuLuong", v.definition
      FROM ai_flows f JOIN ai_flow_versions v ON v."flowId" = f.id AND v.version = f."activeVersion"
     WHERE f.enabled AND f."activeVersion" IS NOT NULL ${loc}
     ORDER BY f.id`)) as unknown as { flowId: string; version: number; factoryId: number | null; chuLuong: number | null; definition: FlowDefinition }[];
  const ra: MucSuKien[] = [];
  for (const r of rows) {
    let da = 0;
    for (const n of r.definition?.nodes ?? []) {
      if (n.type !== LOAI_SU_KIEN || n.disabled) continue;
      if (++da > TRAN_NODE_SU_KIEN_MOI_LUONG) break;
      const p = n.parameters ?? {};
      if (p.bat !== true) continue; // MẶC ĐỊNH TẮT
      if (typeof p.suKien !== "string" || !SU_KIEN_CHO_PHEP.includes(p.suKien)) continue;
      ra.push({
        flowId: r.flowId,
        version: r.version,
        nodeId: n.id,
        suKien: p.suKien,
        cuaSoPhut: laSoNguyen(p.cuaSoPhut, 1, 1440) ? (p.cuaSoPhut as number) : CUA_SO_MAC_DINH,
        tran: Math.min(laSoNguyen(p.tranMoiGio, 1, TRAN_LUOT_SU_KIEN_MOI_GIO) ? (p.tranMoiGio as number) : TRAN_MAC_DINH, TRAN_LUOT_SU_KIEN_MOI_GIO),
        nhaMayLuong: r.factoryId ?? null,
        chuLuong: r.chuLuong ?? null,
      });
    }
  }
  return ra;
}

let bo: { luc: number; muc: MucSuKien[] } | null = null;
/** Xoá bộ nhớ đệm mục nghe (gọi khi luồng bật/tắt/đổi phiên bản; lưới dùng để thấy ngay). */
export function napLaiSuKien(): void {
  bo = null;
}
async function mucHienHanh(): Promise<MucSuKien[]> {
  if (bo && Date.now() - bo.luc < TTL_MUC_MS) return bo.muc;
  const muc = await docMucSuKien();
  bo = { luc: Date.now(), muc };
  return muc;
}

// ── xử lý một sự kiện ─────────────────────────────────────────────────────────────────────────────

export type KetQuaBan = "chay" | "ngoai-pham-vi" | "trung" | "vuot-tran" | "qua-dong-thoi";
export interface BanSuKien {
  flowId: string;
  nodeId: string;
  ketQua: KetQuaBan;
  runId?: string;
}

/** Nhà máy THẬT của máy (tra CSDL; không tin payload). `null` = không xác định. */
export async function nhaMayCuaMay(machineId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const [r] = await db
    .select({ f: workshops.factoryId })
    .from(machines)
    .innerJoin(stations, eq(stations.id, machines.stationId))
    .innerJoin(productionLines, eq(productionLines.id, stations.lineId))
    .innerJoin(workshops, eq(workshops.id, productionLines.workshopId))
    .where(eq(machines.id, machineId))
    .limit(1);
  return r?.f ?? null;
}

const chuoi = (v: unknown, n: number): string | null => (typeof v === "string" ? v.slice(0, n) : null);
const so = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Item gọn từ payload sự kiện (ép kiểu, cắt ngắn; KHÔNG chép nguyên payload). */
function itemTuSuKien(loai: string, p: Record<string, unknown>, idMay: number): { json: Record<string, unknown> } {
  const goc: Record<string, unknown> = { suKien: loai, idMay, maMay: chuoi(p.machineCode, 64) };
  if (loai === "downtime.start") Object.assign(goc, { idDungMay: chuoi(p.id, 64), loaiDung: chuoi(p.category, 32), lyDo: chuoi(p.reason, 200) });
  else Object.assign(goc, { soSeri: chuoi(p.serialNumber, 64), ketQua: chuoi(p.result, 8), tiLeDat: so(p.yieldRate), nguong: so(p.threshold) });
  return { json: goc };
}

function khoaSuKien(m: MucSuKien, loai: string, p: Record<string, unknown>, idMay: number, tsMs: number): string {
  const khoaSk = loai === "downtime.start" && typeof p.id === "string" ? `${loai}:${p.id.slice(0, 64)}` : `${loai}:${idMay}`;
  const cua = Math.floor(tsMs / (m.cuaSoPhut * 60_000));
  const k = `${m.flowId}:${m.nodeId}:sk:${createHash("sha256").update(khoaSk).digest("hex").slice(0, 16)}:${cua}`;
  return k.length <= 128 ? k : `sha256:${createHash("sha256").update(k).digest("hex")}`;
}

/** Máy (đã tra nhà máy thật) có được phép kích luồng này không: chủ HIỆN TẠI thấy máy + nhà máy khớp nhà máy luồng. */
async function trongPhamViLuong(m: MucSuKien, idMay: number, nhaMayMay: number): Promise<boolean> {
  if (m.nhaMayLuong !== null && m.nhaMayLuong !== nhaMayMay) return false;
  const boKiem = await boKiemChoChuLuong(m.chuLuong);
  if (!boKiem) return false; // chủ vắng / khoá / chỉ-đọc ⇒ đóng
  return boKiem.may(idMay);
}

/**
 * Xử lý MỘT sự kiện bus. Trả kết cục từng (luồng, node) khớp loại để lưới đo. `tsMs` mặc định lúc gọi; bus truyền `evt.ts` ⇒ hai tiến trình
 * cùng nhận (Redis fan-out) ra CÙNG cửa sổ.
 */
export async function xuLySuKien(loai: string, payload: unknown, tsMsVao: number = Date.now()): Promise<BanSuKien[]> {
  // ts vắng / hỏng ⇒ dùng thời điểm NHẬN; khoá cửa sổ = floor(ts / cửa sổ) nên vẫn tất định theo cửa sổ.
  const tsMs = Number.isFinite(tsMsVao) && tsMsVao > 0 ? tsMsVao : Date.now();
  if (!SU_KIEN_CHO_PHEP.includes(loai)) return [];
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const idMay = p.machineId;
  if (typeof idMay !== "number" || !Number.isInteger(idMay) || idMay <= 0) return [];
  const khop = (await mucHienHanh()).filter((m) => m.suKien === loai);
  if (!khop.length) return [];
  const nhaMayMay = await nhaMayCuaMay(idMay);
  const ra: BanSuKien[] = [];
  for (const m of khop) {
    const dau = { flowId: m.flowId, nodeId: m.nodeId };
    if (nhaMayMay === null || !(await trongPhamViLuong(m, idMay, nhaMayMay))) {
      ra.push({ ...dau, ketQua: "ngoai-pham-vi" });
      continue;
    }
    try {
      const { batDauRun } = await import("../dongCo");
      const runId = await batDauRun({
        flowId: m.flowId,
        version: m.version,
        nutKichHoat: m.nodeId,
        triggerKind: "su-kien",
        mayCuaSuKien: idMay,
        tranLuotMoiGio: m.tran, // đếm + chèn nguyên tử trong taoRunTx (khoá cố vấn theo luồng)
        idempotencyKey: khoaSuKien(m, loai, p, idMay, tsMs),
        items: [itemTuSuKien(loai, p, idMay)],
      });
      ra.push({ ...dau, ketQua: "chay", runId });
    } catch (e) {
      if (laTrungKhoa(e)) ra.push({ ...dau, ketQua: "trung" });
      else if (e instanceof Error && e.name === "LoiLuong" && (e as { code?: string }).code === "QUA_TRAN_LUOT_GIO") {
        console.warn(`[luong-ai] sự kiện ${m.flowId}#${m.nodeId}: ${e.message} — BỎ sự kiện ${loai}`);
        ra.push({ ...dau, ketQua: "vuot-tran" });
      }
      else if (e instanceof Error && e.name === "LoiLuong" && (e as { code?: string }).code === "QUA_TRAN_DONG_THOI") {
        console.warn(`[luong-ai] sự kiện ${m.flowId}#${m.nodeId}: ${e.message} — BỎ sự kiện ${loai}`);
        ra.push({ ...dau, ketQua: "qua-dong-thoi" });
      } else throw e;
    }
  }
  return ra;
}

// ── bộ nghe (một mỗi tiến trình) ─────────────────────────────────────────────────────────────────

let huy: (() => void)[] | null = null;
export function khoiChaySuKien(): void {
  if (huy) return;
  huy = SU_KIEN_CHO_PHEP.map((loai) =>
    eventBus.subscribe(loai, async (evt) => {
      try {
        await xuLySuKien(loai, evt.payload, evt.ts);
      } catch (e) {
        console.warn(`[luong-ai] sự kiện ${loai}: không bắt đầu được lượt — ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      }
    }),
  );
}
export function dungSuKien(): void {
  for (const h of huy ?? []) h();
  huy = null;
  napLaiSuKien();
}
