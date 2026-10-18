/**
 * AI Local Đợt 5.2 — logic THUẦN của bảng "Eval mã" (A/B corpus) trong tab Đánh giá. Không React, không i18n.
 * Hình dạng `tongHop` khớp `server/services/kbStudioEvalMa.ts#TongHopEvalMa` (đọc phòng thủ: hàng cũ / méo ⇒ null).
 * HAI THƯỚC (2026-10-17): `ketLuan` chính theo TẬP CON "bài có đoạn"; thước toàn bộ (`chenh`, `nguongNhieu`,
 * `ketLuanToanBo`) vẫn hiển thị. Hàng CŨ (trước thước tập con) không có `tapCoDoan` ⇒ null, `ketLuanToanBo` = `ketLuan`.
 */

export type KetLuanEvalMa = "tut" | "nang" | "trong-nhieu" | "khong-ap-dung" | "khong-do-duoc" | "khong-du-bai-co-doan";

export interface TapCoDoanVao {
  n: number;
  soBai: number;
  tat: number;
  bat: number;
  chenh: number;
  nguongNhieu: number;
}

export interface TongHopEvalMaVao {
  n: number;
  tat: { dat: number; cut: number };
  bat: { dat: number; cut: number };
  chenh: number;
  nguongNhieu: number;
  soLuotCoNguCanh: number;
  ketLuan: KetLuanEvalMa;
  /** Kết luận thước TOÀN BỘ (thước cũ). */
  ketLuanToanBo: KetLuanEvalMa;
  /** Thước TẬP CON — null ở hàng cũ / méo. */
  tapCoDoan: TapCoDoanVao | null;
  /** Lượt ĐỐI CHỨNG A/A (hai nhánh cùng prompt TẮT). */
  doiChung: boolean;
}

const KET_LUAN: ReadonlySet<string> = new Set(["tut", "nang", "trong-nhieu", "khong-ap-dung", "khong-do-duoc", "khong-du-bai-co-doan"]);

const so = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

function docTapCoDoan(o: unknown): TapCoDoanVao | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const n = so(r.n);
  const chenh = so(r.chenh);
  const nguong = so(r.nguongNhieu);
  if (n === null || chenh === null || nguong === null) return null;
  const dat = (x: unknown) => so((x as Record<string, unknown> | undefined)?.dat) ?? 0;
  return { n, soBai: so(r.soBai) ?? 0, tat: dat(r.tat), bat: dat(r.bat), chenh, nguongNhieu: nguong };
}

export function docTongHop(o: unknown): TongHopEvalMaVao | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const tat = r.tat as Record<string, unknown> | undefined;
  const bat = r.bat as Record<string, unknown> | undefined;
  const n = so(r.n);
  const chenh = so(r.chenh);
  const nguong = so(r.nguongNhieu);
  if (n === null || chenh === null || nguong === null || !tat || !bat || !KET_LUAN.has(String(r.ketLuan))) return null;
  return {
    n,
    tat: { dat: so(tat.dat) ?? 0, cut: so(tat.cut) ?? 0 },
    bat: { dat: so(bat.dat) ?? 0, cut: so(bat.cut) ?? 0 },
    chenh,
    nguongNhieu: nguong,
    soLuotCoNguCanh: so(r.soLuotCoNguCanh) ?? 0,
    ketLuan: r.ketLuan as KetLuanEvalMa,
    ketLuanToanBo: KET_LUAN.has(String(r.ketLuanToanBo)) ? (r.ketLuanToanBo as KetLuanEvalMa) : (r.ketLuan as KetLuanEvalMa),
    tapCoDoan: docTapCoDoan(r.tapCoDoan),
    doiChung: r.doiChung === true,
  };
}

/** Kiểu huy hiệu cho kết luận cổng. */
export function kieuHuyHieu(k: KetLuanEvalMa): "destructive" | "default" | "secondary" | "outline" {
  if (k === "tut") return "destructive";
  if (k === "nang") return "default";
  if (k === "trong-nhieu") return "secondary";
  return "outline";
}

export const dauChenh = (c: number) => (c > 0 ? `+${c}` : String(c));

/** Còn lượt nào đang chạy ⇒ hỏi lại định kỳ. */
export function conDangChay(runs: ReadonlyArray<{ trangThai?: unknown }>): boolean {
  return runs.some((r) => r.trangThai === "dang-chay");
}
