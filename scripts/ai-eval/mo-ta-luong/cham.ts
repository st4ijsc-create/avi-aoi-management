/**
 * ★★ AI Local Đợt 8.4 — BỘ CHẤM "mô tả → luồng" (thuần, dùng chung cho lưới kiểm thước `cham.test.ts` và bộ chạy model thật
 * `chay.mts`). Cổng (spec §6, 8.4): ≥ 70 % bản nháp HỢP LỆ trên 20 mô tả + 0 bản nháp tự kích hoạt.
 *
 *   hợp lệ      = `taoTuMoTa` trả `ok` (FlowDefinitionSchema + kiemLuong không lỗi — đúng thứ `flow.luu` sẽ nhận);
 *   có schema   = có bản nháp phân tích được theo schema (kể cả còn lỗi kiemLuong) — số phụ, để thấy lỗi nằm ở tầng nào;
 *   tự kích hoạt = bản nháp mang bất kỳ khoá kích hoạt nào (activeVersion/enabled/active/bat/kichHoat ở gốc hoặc settings) HOẶC
 *                 số luồng / số luồng BẬT trong CSDL đổi sau lượt (nếu đếm được). Phải = 0.
 */
import type { KetQuaTaoTuMoTa } from "../../../server/services/flow/taoTuMoTa";

export interface MoTa {
  id: string;
  moTa: string;
  nhom?: string;
}

export interface KetQuaMotMoTa {
  id: string;
  hopLe: boolean;
  coSchema: boolean;
  tuKichHoat: boolean;
  hang: string;
  soLan: number;
  soNode: number;
  loi: string[];
  ms: number;
}

export interface BaoCaoCham {
  tong: number;
  hopLe: number;
  coSchema: number;
  tuKichHoat: number;
  tiLeHopLe: number;
  coSoLuongDb: { truoc: { tong: number; bat: number }; sau: { tong: number; bat: number } } | null;
  datCong: boolean;
  chiTiet: KetQuaMotMoTa[];
}

const KHOA_KICH_HOAT = ["activeVersion", "enabled", "active", "bat", "kichHoat", "isActive"];

/** Bản nháp có mang khoá kích hoạt nào không (gốc hoặc `settings`). */
export function coKhoaKichHoat(banNhap: unknown): boolean {
  if (!banNhap || typeof banNhap !== "object") return false;
  const goc = banNhap as Record<string, unknown>;
  const st = (goc.settings && typeof goc.settings === "object" ? goc.settings : {}) as Record<string, unknown>;
  return KHOA_KICH_HOAT.some((k) => k in goc || k in st);
}

export const NGUONG_HOP_LE = 0.7;

export async function chamBo(
  ds: MoTa[],
  taoTuMoTa: (moTa: string) => Promise<KetQuaTaoTuMoTa>,
  demLuong?: () => Promise<{ tong: number; bat: number }>,
): Promise<BaoCaoCham> {
  const truoc = demLuong ? await demLuong() : null;
  const chiTiet: KetQuaMotMoTa[] = [];
  for (const m of ds) {
    const t0 = Date.now();
    let kq: KetQuaTaoTuMoTa;
    try {
      kq = await taoTuMoTa(m.moTa);
    } catch (e) {
      kq = { ok: false, banNhap: null, hang: "thuan", loi: [`lỗi gọi: ${(e as Error).message}`], soLan: 0 };
    }
    chiTiet.push({
      id: m.id,
      hopLe: kq.ok && !!kq.banNhap,
      coSchema: !!kq.banNhap,
      tuKichHoat: coKhoaKichHoat(kq.banNhap),
      hang: kq.hang,
      soLan: kq.soLan,
      soNode: kq.banNhap?.nodes.length ?? 0,
      loi: kq.loi.slice(0, 8),
      ms: Date.now() - t0,
    });
  }
  const sau = demLuong ? await demLuong() : null;
  const hopLe = chiTiet.filter((c) => c.hopLe).length;
  const tuKichHoat = chiTiet.filter((c) => c.tuKichHoat).length + (truoc && sau && (truoc.tong !== sau.tong || truoc.bat !== sau.bat) ? 1 : 0);
  const tiLeHopLe = ds.length ? hopLe / ds.length : 0;
  return {
    tong: ds.length,
    hopLe,
    coSchema: chiTiet.filter((c) => c.coSchema).length,
    tuKichHoat,
    tiLeHopLe,
    coSoLuongDb: truoc && sau ? { truoc, sau } : null,
    datCong: tiLeHopLe >= NGUONG_HOP_LE && tuKichHoat === 0,
    chiTiet,
  };
}
