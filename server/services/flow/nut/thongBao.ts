/**
 * ★★★ Luồng AI — NODE `tich-hop.thong-bao`: gửi thông báo NỘI BỘ (notificationService → chuông trong ứng dụng / app cảnh báo) (lô Luồng-1, 2026-10-25).
 * Hạng `ngoai-ghi`, atMostOnce. CHỈ kênh nội bộ — KHÔNG email / Telegram / Zalo. Không bao giờ `safetyCritical`.
 * NGƯỜI NHẬN phải thấy được nhà máy của luồng: luồng gắn nhà máy F ⇒ mỗi người nhận có F trong phạm vi của CHÍNH họ; luồng toàn hệ thống (NULL) ⇒
 * người nhận phải toàn quyền. MỘT người nhận không hợp lệ ⇒ node LỖI và KHÔNG gửi cho ai (không gửi từng phần). Thông điệp lỗi không nêu người nào tồn tại.
 * Tham số: `nguoiNhan` (mảng id người dùng, ≤ 20) · `tieuDe` · `noiDung` · `loai` (REPORT | INFO | WARNING) · `uuTien` (LOW | NORMAL | HIGH) · `duongDan` (đường nội bộ tuỳ chọn).
 */
import { eq } from "drizzle-orm";
import { danhGiaThamSo } from "../../../../shared/flow/bieuThuc";
import { users } from "../../../../drizzle/schema";
import { getDb } from "../../../db/connection";
import { dangKyNut, nguCanhItem, type KetQuaChay } from "../dangKyNut";
import { nhaMayChoPhep, nhaMayCuaLuong, nhaMayHopLe } from "../phamViLuong";

export class LoiThongBao extends Error {
  constructor(message: string, readonly ma: string) {
    super(message);
  }
}

const TRAN_NGUOI_NHAN = 20;
const LOAI_CHO_PHEP = new Set(["REPORT", "INFO", "WARNING"]);
const UU_TIEN_CHO_PHEP = new Set(["LOW", "NORMAL", "HIGH"]);

type HamGui = (userId: number, p: { type: "REPORT" | "INFO" | "WARNING"; title: string; message: string; priority: "LOW" | "NORMAL" | "HIGH"; actionUrl?: string; metadata?: Record<string, unknown> }) => Promise<unknown>;
const guiMacDinh: HamGui = async (u, p) => (await import("../../notificationService")).sendNotification(u, p);
let hamGui: HamGui = guiMacDinh;
/** Chỉ lưới: thay hàm gửi. */
export function __datHamGuiThongBaoChoTest(f: HamGui | null): void {
  hamGui = f ?? guiMacDinh;
}

/** Người nhận hợp lệ ⇔ tồn tại, đang hoạt động, và thấy được nhà máy của luồng (NULL ⇒ phải toàn quyền). */
async function kiemNguoiNhan(ids: number[], nhaMayLuong: number | null): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  for (const id of ids) {
    const [u] = await db.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, id)).limit(1);
    if (!u || u.isActive === false) return false;
    const cho = await nhaMayChoPhep({ userId: u.id, userRole: String(u.role) });
    if (nhaMayLuong === null ? cho !== null : !nhaMayHopLe(nhaMayLuong, cho)) return false;
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
    const ra = [];
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
      // chạy thử không gửi thật (node nằm ở nhóm XEM_TRUOC); lượt thật: kiểm TẤT CẢ người nhận trước khi gửi cho bất kỳ ai
      if (!(await kiemNguoiNhan(ids as number[], nhaMay))) {
        throw new LoiThongBao("Có người nhận không hợp lệ hoặc không thấy được nhà máy của luồng — không gửi cho ai.", "NGUOI_NHAN_NGOAI_PHAM_VI");
      }
      let daGui = 0;
      for (const id of ids as number[]) {
        const kq = await hamGui(id, {
          type: loai as "REPORT" | "INFO" | "WARNING",
          title: tieuDe,
          message: noiDung,
          priority: uuTien as "LOW" | "NORMAL" | "HIGH",
          ...(typeof t.duongDan === "string" ? { actionUrl: t.duongDan } : {}),
          metadata: { nguon: "luong-ai", flowId: ngu.flowId, runId: ngu.runId, nodeId: ngu.nodeId },
        });
        if (kq) daGui++; // sendNotification trả null khi người nhận tắt thông báo / giờ yên tĩnh
      }
      ra.push({ json: { ...item.json, thongBao: { nguoiNhan: ids.length, daGui, boQua: ids.length - daGui } } });
    }
    return { main: ra };
  },
});
