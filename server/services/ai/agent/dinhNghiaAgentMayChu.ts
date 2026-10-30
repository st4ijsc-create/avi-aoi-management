/**
 * ★★★ Đợt 11.8 · T6 — NẠP định nghĩa agent đặt tên (`.thoca/agents/*.md`) từ gốc dự án + TIN-LẦN-ĐẦU theo băm.
 *
 * ⚠ Tệp nằm trong repo của người dùng ⇒ KHÔNG TIN CẬY; thân tệp là CHỈ THỊ cho agent con. Ba lớp:
 *   1. đọc qua các tầng hộp cát (`confineDirUnder`/`confineTargetUnder`/`readConfined`: chính sách tên, realpath/junction, hard link,
 *      trần byte); symlink/thư mục/loại lạ trong thư mục bị BỎ; trần số tệp;
 *   2. bộ phân tích THUẦN `shared/agentCore/dinhNghiaAgent.ts` (chỉ thu hẹp quyền, cấm `ngoai:`, `tu-dong`, ký tự ẩn…);
 *   3. băm nội dung phải KHỚP một hàng `ai_agent_def_trust` của CHÍNH người chạy: băm TÍNH LẠI từ nội dung vừa đọc ở MỖI lần
 *      `tra()` (KHÔNG đệm) ⇒ tệp đổi giữa lúc xem và lúc chạy ⇒ lệch ⇒ `DINH_NGHIA_CHUA_TIN`.
 * Xác nhận (`xacNhanDinhNghia`) nhận (tên, băm đã xem), ĐỌC LẠI tệp và so băm — lệch ⇒ từ chối (TOCTOU).
 * Agent dựng sẵn không cần tin cậy (mã của hệ thống) và không bị tệp repo ghi đè.
 */
import {
  DINH_NGHIA_DUNG_SAN,
  coKyTuAn,
  locDinhNghiaTuRepo,
  TRAN_BYTE_TEP_DINH_NGHIA,
  TRAN_SO_TEP_DINH_NGHIA,
  type CanhBaoDinhNghia,
  type DinhNghiaAgent,
  type KetQuaTraAgent,
  type TepDinhNghiaTho,
} from "@shared/agentCore";
import { confineDirUnder, confineTargetUnder, listConfined, readConfined } from "../../aiLocalTools/readToolsProgramming";
import { phanQuyetDuongDan } from "../../aiLocalTools/repoSandbox";
import * as khoTinCay from "../../../db/aiAgentDefTrust";

export const THU_MUC_DINH_NGHIA = ".thoca/agents";

/** Đọc các tệp `*.md` trong `.thoca/agents` (một nấc). Không ném; thư mục vắng/bị từ chối ⇒ []. */
export function docTepDinhNghia(gocDuAn: string): TepDinhNghiaTho[] {
  const ra: TepDinhNghiaTho[] = [];
  try {
    if (phanQuyetDuongDan(THU_MUC_DINH_NGHIA) !== null) return ra;
    const d = confineDirUnder(gocDuAn, THU_MUC_DINH_NGHIA);
    if (!d.ok) return ra;
    const ds = listConfined(d.dir, 4 * TRAN_SO_TEP_DINH_NGHIA);
    if (!ds.ok) return ra;
    for (const e of ds.entries) {
      if (e.kind !== "file" || !/\.md$/i.test(e.name)) continue; // symlink / thư mục / loại lạ: bỏ
      if (ra.length >= TRAN_SO_TEP_DINH_NGHIA + 1) break;
      try {
        if (phanQuyetDuongDan(e.relPath) !== null) continue;
        const c = confineTargetUnder(gocDuAn, e.relPath);
        if (!c.ok || !c.target.exists) continue;
        const rd = readConfined(c.target, TRAN_BYTE_TEP_DINH_NGHIA + 1);
        if (!rd.ok) continue;
        ra.push({ ten: e.name, noiDung: rd.content });
      } catch {
        /* một tệp hỏng không làm hỏng cả thư mục */
      }
    }
  } catch {
    return ra;
  }
  return ra;
}

export interface DinhNghiaDaNap {
  nhan: DinhNghiaAgent[];
  canhBao: CanhBaoDinhNghia[];
  /** nội dung thô của tệp hợp lệ, theo tên agent — để HIỂN THỊ cho người xác nhận (chữ thuần). */
  tho: Map<string, string>;
}

/** Nạp MỚI mỗi lần (không đệm). */
export function napDinhNghiaTuRepo(gocDuAn: string): DinhNghiaDaNap {
  const tep = docTepDinhNghia(gocDuAn);
  const { nhan, canhBao } = locDinhNghiaTuRepo(tep);
  const tho = new Map<string, string>();
  for (const dn of nhan) {
    const t = tep.find((x) => x.ten === `${dn.ten}.md`);
    if (t) tho.set(dn.ten, t.noiDung);
  }
  return { nhan, canhBao, tho };
}

export interface PhuThuocTra {
  daTinCay: typeof khoTinCay.daTinCay;
  nap: (goc: string) => DinhNghiaDaNap;
}
const PHU_THUOC_THAT: PhuThuocTra = { daTinCay: khoTinCay.daTinCay, nap: napDinhNghiaTuRepo };

/**
 * `cfg.tra` cho lõi: dựng sẵn ⇒ ok; còn lại phải có trong repo VÀ băm vừa tính khớp tin cậy của CHÍNH người chạy.
 * Chưa tin / không có ⇒ `{ok:false}` (lõi không bắt đầu con, host không ghi hàng sổ).
 */
export function taoTraDinhNghia(y: { userId: number; projectId: string; gocDuAn: string }, dep: PhuThuocTra = PHU_THUOC_THAT) {
  return async (ten: string): Promise<KetQuaTraAgent> => {
    const ds = DINH_NGHIA_DUNG_SAN.find((d) => d.ten === ten);
    if (ds) return { ok: true, dn: ds };
    const nap = dep.nap(y.gocDuAn);
    const dn = nap.nhan.find((d) => d.ten === ten);
    if (!dn) return { ok: false, ma: "AGENT_KHONG_CO", thongDiep: `no usable sub-agent named "${ten.slice(0, 32)}"` };
    if (!(await dep.daTinCay(y.userId, y.projectId, dn.ten, dn.bam))) {
      return {
        ok: false,
        ma: "DINH_NGHIA_CHUA_TIN",
        thongDiep: `the definition of "${dn.ten}" comes from a project file the user has not confirmed (or it changed since); ask the user to review and confirm it, then try again.`,
      };
    }
    return { ok: true, dn };
  };
}

export type KetQuaXacNhan =
  | { ok: true; bam: string }
  | { ok: false; ma: "KHONG_CO" | "BAM_LECH" | "LOI_LUU" | "THAM_SO_SAI" };

/** Chỉ gọi từ thủ tục tRPC của NGƯỜI. ĐỌC LẠI tệp và so băm với băm người đã xem. */
export async function xacNhanDinhNghia(
  y: { userId: number; projectId: string; gocDuAn: string; ten: string; bamDaXem: string },
  dep: Pick<PhuThuocTra, "nap"> & { xacNhan: typeof khoTinCay.xacNhanTinCay } = { nap: napDinhNghiaTuRepo, xacNhan: khoTinCay.xacNhanTinCay },
): Promise<KetQuaXacNhan> {
  if (!/^[0-9a-f]{64}$/.test(y.bamDaXem) || !/^[a-z][a-z0-9-]{0,31}$/.test(y.ten)) return { ok: false, ma: "THAM_SO_SAI" };
  const dn = dep.nap(y.gocDuAn).nhan.find((d) => d.ten === y.ten);
  if (!dn) return { ok: false, ma: "KHONG_CO" };
  if (dn.bam !== y.bamDaXem) return { ok: false, ma: "BAM_LECH" };
  const ok = await dep.xacNhan(y.userId, y.projectId, dn.ten, dn.bam);
  return ok ? { ok: true, bam: dn.bam } : { ok: false, ma: "LOI_LUU" };
}

/** Thoát mọi ký tự không in được thành \uXXXX (lớp phòng thủ thứ hai sau bộ lọc của bộ phân tích). */
export function thoatKyTuLa(s: string): string {
  let ra = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp !== 0x0a && cp !== 0x09 && coKyTuAn(ch)) ra += `\\u{${cp.toString(16).toUpperCase()}}`;
    else ra += ch;
  }
  return ra;
}

export interface MucDinhNghiaChoNguoi {
  ten: string;
  moTa: string;
  nguon: "dungSan" | "tuRepo";
  congCu: string[];
  model: string;
  cheDo: "hoi" | "sua";
  maxLuot: number | null;
  bam: string;
  daTinCay: boolean;
  /** Nội dung CHỮ THUẦN (đã thoát ký tự lạ) để người đọc trước khi xác nhận — chỉ có với `tuRepo`. */
  noiDungHienThi: string | null;
}

/** Danh sách cho UI: dựng sẵn + tệp repo hợp lệ + cảnh báo của tệp bị bỏ (chỉ mã + tên tệp). */
export async function xemDinhNghia(
  y: { userId: number; projectId: string; gocDuAn: string },
  dep: { danhSachTinCay: typeof khoTinCay.danhSachTinCay; nap: (g: string) => DinhNghiaDaNap } = { danhSachTinCay: khoTinCay.danhSachTinCay, nap: napDinhNghiaTuRepo },
): Promise<{ muc: MucDinhNghiaChoNguoi[]; canhBao: Array<{ tep: string; ma: string }> }> {
  const nap = dep.nap(y.gocDuAn);
  const tin = await dep.danhSachTinCay(y.userId, y.projectId);
  const dang = (d: DinhNghiaAgent, noiDung: string | null, daTin: boolean): MucDinhNghiaChoNguoi => ({
    ten: d.ten,
    moTa: thoatKyTuLa(d.moTa),
    nguon: d.nguon,
    congCu: [...d.congCu],
    model: d.model,
    cheDo: d.cheDo,
    maxLuot: d.maxLuot ?? null,
    bam: d.bam,
    daTinCay: daTin,
    noiDungHienThi: noiDung === null ? null : thoatKyTuLa(noiDung),
  });
  const muc = [
    ...DINH_NGHIA_DUNG_SAN.map((d) => dang(d, null, true)),
    ...nap.nhan.map((d) => dang(d, nap.tho.get(d.ten) ?? null, tin.get(d.ten)?.has(d.bam) === true)),
  ];
  return { muc, canhBao: nap.canhBao.map((c) => ({ tep: c.ten.slice(0, 64), ma: c.ma })) };
}

