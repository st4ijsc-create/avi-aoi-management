/**
 * SCADA R1b-2b-1 Task 1 (mục 59, điều phối 2026-10-26 Q1 + điều kiện 6; ruling C6 / C11 / C16) — DANH SÁCH MÁY cho khối "DỪNG MÁY khẩn cấp"
 * trên trang BUỘC ĐỔI MẬT KHẨU (`client/src/components/scada/KhoiDungKhanCap.tsx`).
 *
 * Vì sao có thủ tục này: người vận hành bị buộc đổi mật khẩu chỉ thấy trang đổi mật khẩu (cổng client bọc `<Router/>`). `scadaCommands.dungMay`
 * đã được miễn cổng ở máy chủ (R1b-2a final-fix), nhưng không có trang nào cho người ấy bấm. Khối khẩn cấp cần MỘT lượt đọc tối thiểu —
 * thủ tục này là phần tử THỨ HAI (và cuối) của tập miễn cổng `THU_TUC_STOP_MIEN_CONG_DOI_MAT_KHAU` (`server/_core/trpc.ts`).
 *
 * HỢP ĐỒNG (ruling C16 — tối thiểu; fix round 1 + điều phối M4 phương án b): mỗi máy CHỈ gồm `machineId`, `ten` (nhãn máy "mã máy · tên
 * máy"), `chuyen` (nhãn chuyền), `coDung` (có adapter nhận STOP HMI không; null = không biết), `soAdapter` (số adapter nhận STOP HMI; null =
 * không biết) và `tongHop` (gợi ý cấp máy "du" | "mot_phan" | "khong_toi" | "khong_ro" — `shared/dungKhanCap.ts`). KHÔNG mã adapter,
 * edgeCode, tagKey, endpoint, kênh, lastError, stopValue hay giá trị ghim. Thứ tự kiểm:
 *   1. `SCADA_COMMANDS_ENABLED` tắt ⇒ rỗng (không chạm DB — cùng QĐ D-6 của dungMay);
 *   2. sàn vai mức 1 + `machine_control.canEdit` (`kiemCongVaiTro(nguoi, 1)` — CÙNG cổng 3 của dungMay) không đạt ⇒ rỗng (không ném: người
 *      không có quyền dừng chỉ không thấy khối — viewer không thấy gì);
 *   3. phạm vi máy `idsTrongPhamVi("machine", pv, {strict:true})` (cùng luật dungMay);
 *   4. máy "có nối" (`dieuKienMayCoNoi` — CÙNG vị từ của `scadaKenh.cheDo.danhSach`, ruling C11), ORDER BY mã máy, LIMIT TRẦN + 1 (điều
 *      kiện 6 / ruling C6: hàng thứ 201 chỉ để biết danh sách BỊ CẮT ⇒ `biCat`, client hiện "danh sách có thể chưa đủ — dùng E-STOP cứng");
 *   5. `coDung` / `soAdapter` / `tongHop` = `coGhim` / `soCoGhim` / `tongHopDungKhanCap` trên MỘT lượt `khaoSatKhaNangDungNhieu` (CÙNG hàm
 *      của cheDo.danhSach, không chép, không đường khảo sát thứ hai).
 * HẠN (fix round 1, review I1): cả thân (2–5) bọc `withDeadline(…, HAN_DANH_SACH_DUNG_KHAN_CAP_MS)` — quá hạn ⇒ ném (503) ⇒ client hiện "Không
 *   tải được danh sách máy — dùng E-STOP cứng tại máy". Khảo sát (5) có hạn CON riêng `HAN_KHAO_SAT_DUNG_KHAN_CAP_MS` (kẹp vào phần còn lại của
 *   hạn thân, chừa `DU_PHONG_TRA_VE_MS`) và tối đa `DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP` adapter kiểm đồng thời: một adapter chậm chỉ làm MÁY của
 *   nó thành "không kiểm được" (`coDung`/`soAdapter` null, `tongHop` "khong_ro") — danh sách vẫn về, nút DỪNG vẫn bấm được; dungMay tự quyết
 *   lúc gửi. ⚠ Giới hạn đã ghi (C16): lượt đọc cờ ở cổng và xác thực KHÔNG nằm trong hạn này (thủ tục không phải dungMay ⇒ không có
 *   `ctx.hanChotStopHmi`); DB treo ở đó ⇒ khối không hiện — E-STOP cứng vẫn là lớp an toàn thật.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { machines, productionLines, stations } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { idsTrongPhamVi, type PhamViNguoiXem } from "../../db/hierarchy";
import { appError } from "../../_core/appError";
import { withDeadline } from "../ot/drivers/boundedClose";
import { TRAN_MAY_DUNG_KHAN_CAP, type TongHopDungKhanCap } from "../../../shared/dungKhanCap";
import { coGhim, dieuKienMayCoNoi, khaoSatKhaNangDungNhieu, soCoGhim, tongHopDungKhanCap } from "./khaNangDung";
import { kiemCongVaiTro, lenhHmiBat, type NguoiGoiLenh } from "./lenhHmi";

export { TRAN_MAY_DUNG_KHAN_CAP };

/** Hạn của cả thân thủ tục (vai + phạm vi + máy + khảo sát). */
export const HAN_DANH_SACH_DUNG_KHAN_CAP_MS = 3000;
/** fix round 1 (I1) — hạn CON của khảo sát khả năng dừng; quá hạn ⇒ máy chưa kết luận "không kiểm được", danh sách vẫn về. */
export const HAN_KHAO_SAT_DUNG_KHAN_CAP_MS = 1500;
/** fix round 1 (I1) — số adapter khảo sát đồng thời tối đa (không bắn cả loạt truy vấn vào pool dùng chung với dungMay). */
export const DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP = 16;
/** Phần hạn thân chừa lại sau khảo sát để dựng và trả danh sách. */
const DU_PHONG_TRA_VE_MS = 250;

/** Một máy của khối DỪNG khẩn cấp — ĐÚNG sáu trường (ruling C16 + điều phối M4 phương án b). */
export type MayDungKhanCap = {
  machineId: number;
  /** nhãn máy: "mã máy · tên máy" */
  ten: string;
  /** nhãn chuyền (tên chuyền, không có thì mã chuyền); null ⇒ không xác định */
  chuyen: string | null;
  /** có ≥ 1 adapter nhận STOP HMI (`coGhim`); null = không biết (khảo sát lỗi / quá hạn) */
  coDung: boolean | null;
  /** số adapter nhận STOP HMI (`soCoGhim`); null = không biết */
  soAdapter: number | null;
  /** gợi ý: STOP HMI tới thiết bị thật tới đâu (`tongHopDungKhanCap`); KHÔNG BAO GIỜ dùng để ẩn / khoá nút */
  tongHop: TongHopDungKhanCap;
};

export type DanhSachDungKhanCap = {
  /** tối đa TRAN_MAY_DUNG_KHAN_CAP + 1 hàng (hàng thừa chỉ báo cắt — client hiện TRAN_MAY_DUNG_KHAN_CAP) */
  may: MayDungKhanCap[];
  /** số máy trong phạm vi vượt TRAN_MAY_DUNG_KHAN_CAP ⇒ danh sách có thể chưa đủ */
  biCat: boolean;
};

const rong = (): DanhSachDungKhanCap => ({ may: [], biCat: false });

async function than(nguoi: NguoiGoiLenh, pv: PhamViNguoiXem, batDau: number): Promise<DanhSachDungKhanCap> {
  // 2. sàn vai mức 1 + machine_control.canEdit — không đạt ⇒ rỗng (người không có quyền dừng không thấy khối)
  const vai = await kiemCongVaiTro(nguoi, 1);
  if (!vai.ok) return rong();

  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");

  // 3. phạm vi máy (cùng luật dungMay)
  const idsMay = await idsTrongPhamVi("machine", pv, { strict: true });
  if (idsMay !== null && idsMay.length === 0) return rong();

  // 4. máy có nối (cùng vị từ cheDo.danhSach), thứ tự mã máy, TRẦN + 1
  const coNoi = dieuKienMayCoNoi();
  const rows = await db
    .select({ id: machines.id, code: machines.code, name: machines.name, lineCode: productionLines.code, lineName: productionLines.name })
    .from(machines)
    .leftJoin(stations, eq(stations.id, machines.stationId))
    .leftJoin(productionLines, eq(productionLines.id, stations.lineId))
    .where(idsMay === null ? coNoi : and(inArray(machines.id, idsMay), coNoi))
    .orderBy(asc(machines.code), asc(machines.id))
    .limit(TRAN_MAY_DUNG_KHAN_CAP + 1);
  if (rows.length === 0) return rong();

  // 5. khả năng dừng — CÙNG hàm của cheDo.danhSach, có hạn CON + giới hạn đồng thời (I1); chỉ lấy số đếm + gợi ý cấp máy (C16)
  const hanKhaoSat = Math.min(HAN_KHAO_SAT_DUNG_KHAN_CAP_MS, batDau + HAN_DANH_SACH_DUNG_KHAN_CAP_MS - DU_PHONG_TRA_VE_MS - Date.now());
  const khaNang = await khaoSatKhaNangDungNhieu(
    db,
    rows.map((r) => r.id),
    { hanMs: Math.max(0, hanKhaoSat), dongThoiToiDa: DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP },
  );
  return {
    may: rows.map((r) => ({
      machineId: r.id,
      ten: r.name ? `${r.code} · ${r.name}` : r.code,
      chuyen: r.lineName || r.lineCode || null,
      coDung: coGhim(khaNang.get(r.id)),
      soAdapter: soCoGhim(khaNang.get(r.id)),
      tongHop: tongHopDungKhanCap(khaNang.get(r.id)),
    })),
    biCat: rows.length > TRAN_MAY_DUNG_KHAN_CAP,
  };
}

/**
 * Máy trong phạm vi mà người gọi được dừng (khối DỪNG khẩn cấp). Không bao giờ lộ chi tiết adapter. Quá hạn ⇒ ném `OPERATION_FAILED`
 * (SERVICE_UNAVAILABLE) — client đọc lỗi (trừ tường giấy phép) thành "Không tải được danh sách máy — dùng E-STOP cứng tại máy".
 */
export async function mayDungKhanCap(nguoi: NguoiGoiLenh, pv: PhamViNguoiXem): Promise<DanhSachDungKhanCap> {
  // 1. cờ — không chạm DB
  if (!lenhHmiBat()) return rong();
  return withDeadline(than(nguoi, pv, Date.now()), HAN_DANH_SACH_DUNG_KHAN_CAP_MS, "mayDungKhanCap", {
    unref: true,
    loi: () =>
      appError(
        "SERVICE_UNAVAILABLE",
        "OPERATION_FAILED",
        { operation: "mayDungKhanCap" },
        `Danh sách máy DỪNG khẩn cấp quá hạn ${HAN_DANH_SACH_DUNG_KHAN_CAP_MS} ms — dùng E-STOP cứng tại máy.`,
      ),
  });
}
