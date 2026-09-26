/**
 * R1 — logic thuần của EvalTab (Training Studio). Tách khỏi TSX để lưới khoá được mà không cần DOM.
 * Hình dạng dữ liệu là của server (`server/services/kbStudioEvalCham.ts`) — import KIỂU, không chép.
 */
import type { KetQuaCau, TongHopEval } from "../../../../server/services/kbStudioEvalCham";

export type { KetQuaCau, TongHopEval };

/** Tỷ lệ 0..1 → "83 %". `null` = không đo được / mẫu số 0 ⇒ "—", KHÔNG BAO GIỜ "0 %". */
export function phanTram(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${Math.round(x * 100)} %`;
}

export function diem(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return x.toFixed(3);
}

export interface LuotTomTat {
  id: number;
  createdAt: string | Date;
  trangThai: string;
  soChunk: number;
  soNguon: number;
  lanNapCuoi: string | Date | null;
  boVangHash: string;
  tongHop: unknown;
}

function thoiGian(x: string | Date | null): number | null {
  if (x === null) return null;
  const t = new Date(x).getTime();
  return Number.isFinite(t) ? t : null;
}

export interface DiemBieuDo {
  id: number;
  nhan: string;
  trungNguon: number | null;
  dapAnNguCanh: number | null;
  duongOng: number | null;
  /** Lượt này đứng SAU một lần nạp mới so với lượt liền trước (số chunk/nguồn hoặc mốc nạp đổi). */
  sauNap: boolean;
  /** Bộ đề đổi so với lượt trước — hai điểm không cùng thước. */
  doiDe: boolean;
}

/**
 * Chuỗi điểm theo THỜI GIAN TĂNG (server trả mới-nhất-trước). Lượt `khong-do-duoc` vẫn có mặt với
 * giá trị null (đồ thị đứt, không rơi về 0). Điểm tính ×100 cho trục phần trăm.
 */
export function chuoiBieuDo(runs: readonly LuotTomTat[]): DiemBieuDo[] {
  const tang = [...runs].sort((a, b) => (thoiGian(a.createdAt) ?? 0) - (thoiGian(b.createdAt) ?? 0));
  return tang.map((r, i) => {
    const truoc = i > 0 ? tang[i - 1] : null;
    const t = (r.tongHop ?? null) as TongHopEval | null;
    const x100 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100));
    return {
      id: r.id,
      nhan: `#${r.id}`,
      trungNguon: x100(t?.trungNguon),
      dapAnNguCanh: x100(t?.dapAnNguCanh),
      duongOng: x100(t?.duongOng),
      sauNap:
        !!truoc &&
        (truoc.soChunk !== r.soChunk ||
          truoc.soNguon !== r.soNguon ||
          thoiGian(truoc.lanNapCuoi) !== thoiGian(r.lanNapCuoi)),
      doiDe: !!truoc && truoc.boVangHash !== r.boVangHash,
    };
  });
}

/** Một câu là SAI khi trượt ở bất kỳ phép chấm nào đã chạy (null = không chấm, không tính là sai). */
export function laCauSai(k: KetQuaCau): boolean {
  if (k.de === "hong") return true;
  if (k.loai === "ngoai") return k.tuChoiDung === false || k.duongOng === false;
  return k.hangNguon === null || !k.quaNguong || k.dapAnNguCanh === false || k.duongOng === false;
}

export function locCau(ds: readonly KetQuaCau[], chiSai: boolean): KetQuaCau[] {
  return chiSai ? ds.filter(laCauSai) : [...ds];
}
