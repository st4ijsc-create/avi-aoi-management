/**
 * AI Local Đợt 5.2 — logic THUẦN của bảng "Eval mã" (A/B corpus) trong tab Đánh giá. Không React, không i18n.
 * Hình dạng `tongHop` khớp `server/services/kbStudioEvalMa.ts#TongHopEvalMa` (đọc phòng thủ: hàng cũ / méo ⇒ null).
 */

export type KetLuanEvalMa = "tut" | "nang" | "trong-nhieu" | "khong-ap-dung" | "khong-do-duoc";

export interface TongHopEvalMaVao {
  n: number;
  tat: { dat: number; cut: number };
  bat: { dat: number; cut: number };
  chenh: number;
  nguongNhieu: number;
  soLuotCoNguCanh: number;
  ketLuan: KetLuanEvalMa;
}

const KET_LUAN: ReadonlySet<string> = new Set(["tut", "nang", "trong-nhieu", "khong-ap-dung", "khong-do-duoc"]);

const so = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

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
