/**
 * ★★★ Luồng AI — NODE `tich-hop.thong-bao`: gửi thông báo NỘI BỘ (notificationService → chuông trong ứng dụng / app cảnh báo) (lô Luồng-1, 2026-10-25).
 * Hạng `ngoai-ghi`, atMostOnce. CHỈ kênh nội bộ — KHÔNG email / Telegram / Zalo. Không bao giờ `safetyCritical`.
 * NGƯỜI NHẬN phải thấy được nhà máy của luồng: luồng gắn nhà máy F ⇒ mỗi người nhận có F trong phạm vi của CHÍNH họ; luồng toàn hệ thống (NULL) ⇒
 * người nhận phải toàn quyền. MỘT người nhận không hợp lệ ⇒ node LỖI và KHÔNG gửi cho ai (không gửi từng phần). Thông điệp lỗi không nêu người nào tồn tại.
 * ★ N3 (thiết kế, KHÔNG đổi): worker chết GIỮA vòng gửi ⇒ một phần người nhận đã nhận, phần còn lại KHÔNG được gửi lại (atMostOnce — thà thiếu còn hơn nhận đôi).
 * ★ Phạm vi MÁY: người nhận phải thấy mọi máy mà `du-lieu.so-lieu` đã đọc trong lượt (nhật ký `so-lieu.may-doc`). Trần tổng thông báo mỗi lượt-node: `TRAN_THONG_BAO_MOI_LUOT`.
 * Tham số: `nguoiNhan` (mảng id người dùng, ≤ 20) · `tieuDe` · `noiDung` · `loai` (REPORT | INFO | WARNING) · `uuTien` (LOW | NORMAL | HIGH) · `duongDan` (đường nội bộ tuỳ chọn).
 */
import { and, eq } from "drizzle-orm";
import { danhGiaThamSo } from "../../../../shared/flow/bieuThuc";
import { aiFlowEvents, users } from "../../../../drizzle/schema";
import { getDb } from "../../../db/connection";
import { idsTrongPhamVi } from "../../../db/hierarchy";
import { safeInternalPath } from "../../../../shared/internalPath";
import { dangKyNut, nguCanhItem, type KetQuaChay } from "../dangKyNut";
import { nhaMayChoPhep, nhaMayCuaLuong, nhaMayHopLe } from "../phamViLuong";
import { KIND_MAY_DOC } from "./soLieu";

export class LoiThongBao extends Error {
  constructor(message: string, readonly ma: string) {
    super(message);
  }
}

const TRAN_NGUOI_NHAN = 20;
/** Trần TỔNG thông báo mỗi lượt-node (item × người nhận) — chống webhook N item nhân bản thành bão thông báo. Vượt ⇒ LỖI, không gửi gì. */
export const TRAN_THONG_BAO_MOI_LUOT = 50;
const LOAI_CHO_PHEP = new Set(["REPORT", "INFO", "WARNING"]);
const UU_TIEN_CHO_PHEP = new Set(["LOW", "NORMAL", "HIGH"]);

type HamGui = (userId: number, p: { type: "REPORT" | "INFO" | "WARNING"; title: string; message: string; priority: "LOW" | "NORMAL" | "HIGH"; actionUrl?: string; metadata?: Record<string, unknown> }) => Promise<unknown>;
const guiMacDinh: HamGui = async (u, p) => (await import("../../notificationService")).sendNotification(u, p);
let hamGui: HamGui = guiMacDinh;
/** Chỉ lưới: thay hàm gửi. */
export function __datHamGuiThongBaoChoTest(f: HamGui | null): void {
  hamGui = f ?? guiMacDinh;
}

/**
 * MỘT luật nhà máy cho người nhận (dùng chung với danh sách chọn người nhận `flow.nguoiNhanChoLuong` — không viết lại): đang hoạt động VÀ
 * thấy được nhà máy của luồng bằng phạm vi của CHÍNH họ; luồng toàn hệ thống (NULL) ⇒ chỉ người toàn quyền.
 */
export async function nguoiNhanHopLeTheoNhaMay(u: { id: number; role: unknown; isActive: boolean | null }, nhaMayLuong: number | null): Promise<boolean> {
  if (u.isActive === false) return false;
  const cho = await nhaMayChoPhep({ userId: u.id, userRole: String(u.role) });
  return nhaMayLuong === null ? cho === null : nhaMayHopLe(nhaMayLuong, cho);
}

/** Người nhận hợp lệ ⇔ tồn tại, đang hoạt động, và thấy được nhà máy của luồng (NULL ⇒ phải toàn quyền). */
async function kiemNguoiNhan(ids: number[], nhaMayLuong: number | null, mayDoc: ReadonlySet<number>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  for (const id of ids) {
    const [u] = await db.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, id)).limit(1);
    if (!u || !(await nguoiNhanHopLeTheoNhaMay(u, nhaMayLuong))) return false;
    // ★ Phạm vi MÁY: số liệu tổng hợp của các máy mà node số liệu đã đọc trong lượt này — người nhận phải thấy TẤT CẢ các máy đó (người chỉ thuộc chuyền L1 không nhận báo cáo có máy L2).
    if (mayDoc.size > 0) {
      const may = await idsTrongPhamVi("machine", { userId: u.id, userRole: String(u.role) }, { strict: true });
      if (may !== null) {
        const co = new Set(may);
        for (const m of mayDoc) if (!co.has(m)) return false;
      }
    }
  }
  return true;
}

dangKyNut({
  type: "tich-hop.thong-bao",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "ngoai-ghi",
  lapLai: "atMostOnce",
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    const nhaMay = ngu.flowId === "chay-thu" ? undefined : await nhaMayCuaLuong(ngu.flowId);
    if (nhaMay === undefined) throw new LoiThongBao("Không xác định được nhà máy của luồng — từ chối gửi.", "LUONG_KHONG_XAC_DINH");
    const vao = ngu.inputs.main ?? [{ json: {} }];
    // Lượt 1 — PARSE + KIỂM tất cả item trước; chưa gửi gì. Một item sai / vượt trần ⇒ lỗi, KHÔNG gửi cho ai (không gửi từng phần).
    type KeHoach = { item: (typeof vao)[number]; ids: number[]; loai: "REPORT" | "INFO" | "WARNING"; uuTien: "LOW" | "NORMAL" | "HIGH"; tieuDe: string; noiDung: string; duongDan?: string };
    const keHoach: KeHoach[] = [];
    let tong = 0;
    for (const item of vao) {
      const t = danhGiaThamSo(thamSo, nguCanhItem(ngu, item, vao)) as Record<string, unknown>;
      const ds = Array.isArray(t.nguoiNhan) ? t.nguoiNhan : [];
      const ids = Array.from(new Set(ds.map((x) => (typeof x === "number" ? x : typeof x === "string" && /^\d{1,12}$/.test(x) ? Number(x) : NaN))));
      if (ids.length === 0 || ids.length > TRAN_NGUOI_NHAN || ids.some((x) => !Number.isSafeInteger(x) || x <= 0)) {
        throw new LoiThongBao(`nguoiNhan phải là danh sách 1–${TRAN_NGUOI_NHAN} id người dùng`, "THAM_SO_SAI");
      }
      const loai = String(t.loai ?? "REPORT");
      const uuTien = String(t.uuTien ?? "NORMAL");
      if (!LOAI_CHO_PHEP.has(loai) || !UU_TIEN_CHO_PHEP.has(uuTien)) throw new LoiThongBao("loai / uuTien không hợp lệ (loai: REPORT|INFO|WARNING; uuTien: LOW|NORMAL|HIGH)", "THAM_SO_SAI");
      const tieuDe = String(t.tieuDe ?? "").slice(0, 200);
      const noiDung = String(t.noiDung ?? "").slice(0, 4000);
      if (!tieuDe) throw new LoiThongBao("tieuDe là bắt buộc", "THAM_SO_SAI");
      // duongDan: CÙNG luật với thông báo/chuông (safeInternalPath) — kiểm cả lúc LƯU (kiemThamSoNutMoi) lẫn lúc chạy (biểu thức chỉ biết lúc chạy).
      const duongDan = typeof t.duongDan === "string" && t.duongDan !== "" ? t.duongDan : undefined;
      if (t.duongDan !== undefined && t.duongDan !== null && t.duongDan !== "" && (duongDan === undefined || safeInternalPath(duongDan) === null)) {
        throw new LoiThongBao("duongDan phải là đường dẫn nội bộ bắt đầu bằng một dấu / (không URL ngoài)", "THAM_SO_SAI");
      }
      tong += ids.length;
      if (tong > TRAN_THONG_BAO_MOI_LUOT) {
        throw new LoiThongBao(`Tổng thông báo của node trong một lượt vượt trần ${TRAN_THONG_BAO_MOI_LUOT} (item × người nhận) — không gửi gì.`, "QUA_TRAN_THONG_BAO");
      }
      keHoach.push({ item, ids: ids as number[], loai: loai as KeHoach["loai"], uuTien: uuTien as KeHoach["uuTien"], tieuDe, noiDung, ...(duongDan !== undefined ? { duongDan } : {}) });
    }
    // Tập MÁY mà các node số liệu của lượt này đã đọc (nhật ký lượt do `du-lieu.so-lieu` ghi) — mọi người nhận phải thấy đủ.
    const mayDoc = new Set<number>();
    const db = await getDb();
    if (!db) throw new LoiThongBao("Không đọc được nhật ký lượt — từ chối gửi.", "LUONG_KHONG_XAC_DINH");
    for (const e of await db.select({ payload: aiFlowEvents.payload }).from(aiFlowEvents).where(and(eq(aiFlowEvents.runId, ngu.runId), eq(aiFlowEvents.kind, KIND_MAY_DOC)))) {
      for (const m of ((e.payload as { may?: unknown } | null)?.may as unknown[]) ?? []) if (typeof m === "number") mayDoc.add(m);
    }
    const moiNguoi = Array.from(new Set(keHoach.flatMap((k) => k.ids)));
    if (!(await kiemNguoiNhan(moiNguoi, nhaMay, mayDoc))) {
      throw new LoiThongBao("Có người nhận không hợp lệ hoặc không thấy được nhà máy / máy của số liệu trong lượt — không gửi cho ai.", "NGUOI_NHAN_NGOAI_PHAM_VI");
    }
    // Lượt 2 — gửi.
    const ra = [];
    for (const k of keHoach) {
      let daGui = 0;
      for (const id of k.ids) {
        const kq = await hamGui(id, {
          type: k.loai,
          title: k.tieuDe,
          message: k.noiDung,
          priority: k.uuTien,
          ...(k.duongDan !== undefined ? { actionUrl: k.duongDan } : {}),
          metadata: { nguon: "luong-ai", flowId: ngu.flowId, runId: ngu.runId, nodeId: ngu.nodeId },
        });
        if (kq) daGui++; // sendNotification trả null khi người nhận tắt thông báo / giờ yên tĩnh
      }
      ra.push({ json: { ...k.item.json, thongBao: { nguoiNhan: k.ids.length, daGui, boQua: k.ids.length - daGui } } });
    }
    return { main: ra };
  },
});
