/**
 * SCADA R0 Task 11 — quy tắc HIỂN THỊ thuần của M10: nhãn trạng thái kết nối của adapter và kiểu hiển thị chất lượng một giá trị.
 * Không React, không i18n ở đây (trả KHOÁ i18n + tone); màu do component ánh xạ sang token ISA có sẵn.
 *
 * D10 (spec §H): `uncertain` ⇒ viền chấm XÁM (không vàng — trùng cảnh báo medium); `bad` / cũ (stale) ⇒ gạch tím "không tin được".
 * `edge_chua_co_so_lieu` (adapter do edge sở hữu, R0 chưa có số liệu) là MUTED — không bao giờ `bad`/mất kết nối.
 */
import type { CSSProperties } from "react";

export type TrangThaiM10 = "connecting" | "connected" | "lost" | "disabled" | "khong_ro" | "edge_chua_co_so_lieu";
export type ToneTrangThai = "ok" | "warn" | "bad" | "muted";
export type DonViThoiGian = { giay: string; phut: string; gio: string; ngay: string };

/** Khoảng từ `tuMs` tới `now`, một đơn vị ("5 s", "3 ph", "1 giờ", "2 ngày"). Mốc null / ở tương lai ⇒ null (không in số âm). */
function khoangThoiGian(tuMs: number | null, now: number, dv: DonViThoiGian): string | null {
  if (tuMs === null || !Number.isFinite(tuMs) || tuMs > now) return null;
  const s = Math.floor((now - tuMs) / 1000);
  if (s < 60) return `${s} ${dv.giay}`;
  const ph = Math.floor(s / 60);
  if (ph < 60) return `${ph} ${dv.phut}`;
  const gio = Math.floor(ph / 60);
  if (gio < 24) return `${gio} ${dv.gio}`;
  return `${Math.floor(gio / 24)} ${dv.ngay}`;
}

export function nhanTrangThai(
  tt: TrangThaiM10,
  tuMs: number | null,
  now: number,
  donVi: DonViThoiGian,
): { nhan: string; thoiGian: string | null; tone: ToneTrangThai } {
  switch (tt) {
    case "lost":
      return { nhan: "scada.diag.matKetNoi", thoiGian: khoangThoiGian(tuMs, now, donVi), tone: "bad" };
    case "connected":
      return { nhan: "scada.diag.trangThai.connected", thoiGian: khoangThoiGian(tuMs, now, donVi), tone: "ok" };
    case "connecting":
      return { nhan: "scada.diag.trangThai.connecting", thoiGian: khoangThoiGian(tuMs, now, donVi), tone: "warn" };
    case "disabled":
      return { nhan: "scada.diag.trangThai.disabled", thoiGian: null, tone: "muted" };
    case "edge_chua_co_so_lieu":
      return { nhan: "scada.diag.edgeChuaCoSoLieu", thoiGian: null, tone: "muted" };
    default:
      return { nhan: "scada.diag.trangThai.khong_ro", thoiGian: null, tone: "warn" };
  }
}

export type KieuChatLuong = "tot" | "nghi_ngo" | "xau" | "cu";
export type VienChatLuong = "none" | "dotted-grey" | "purple-strike";

/** D10: xấu ⇒ gạch tím; cũ ⇒ gạch tím (không tin được dù q còn "good"); uncertain tươi ⇒ viền chấm xám; còn lại ⇒ không viền. */
export function hienChatLuong(q: "good" | "uncertain" | "bad", stale: boolean): { kieu: KieuChatLuong; vien: VienChatLuong } {
  if (q === "bad") return { kieu: "xau", vien: "purple-strike" };
  if (stale) return { kieu: "cu", vien: "purple-strike" };
  if (q === "uncertain") return { kieu: "nghi_ngo", vien: "dotted-grey" };
  return { kieu: "tot", vien: "none" };
}

/**
 * Tuổi hiển thị: null / âm / không hữu hạn ⇒ "—" (máy chủ đã chặn ≥ 0; đây là phòng thủ rẻ). Đơn vị VÀ dấu thập phân theo ngôn ngữ
 * đang dùng (`donVi` từ i18n, `locale` = ngôn ngữ giao diện) — không có mặc định ngầm.
 */
export function dinhDangTuoi(ageMs: number | null | undefined, donVi: DonViThoiGian, locale: string): string {
  if (ageMs === null || ageMs === undefined || !Number.isFinite(ageMs) || ageMs < 0) return "—";
  if (ageMs < 60_000) {
    let so: string;
    try {
      so = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ageMs / 1000);
    } catch {
      so = (ageMs / 1000).toFixed(1);
    }
    return `${so} ${donVi.giay}`;
  }
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)} ${donVi.phut}`;
  return `${Math.floor(ageMs / 3_600_000)} ${donVi.gio}`;
}

/**
 * Tên biến CSS (token ISA có sẵn trong index.css) theo tone. Trạng thái bình thường dùng đồ hoạ trung tính (ISA-101: màu bão hoà chỉ
 * dành cho bất thường). Gạch tím dùng token họ PackML `--packml-held` (hue 300) — token tím DUY NHẤT sẵn có, tách khỏi bảng cảnh báo.
 */
export const BIEN_MAU_TONE: Record<ToneTrangThai, string> = {
  ok: "--isa-graphic",
  warn: "--alarm-medium",
  bad: "--alarm-critical",
  muted: "--isa-graphic-muted",
};
export const BIEN_MAU_GACH_TIM = "--packml-held";
export const BIEN_MAU_VIEN_XAM = "--isa-graphic-muted";

/** Kiểu CSS của ô giá trị theo viền D10 — chỉ token ISA có sẵn, không màu cứng. */
export function kieuVien(vien: VienChatLuong, cu: boolean): CSSProperties {
  if (vien === "purple-strike") {
    return {
      textDecorationLine: "line-through",
      textDecorationColor: `var(${BIEN_MAU_GACH_TIM})`,
      textDecorationThickness: "2px",
      borderBottom: `2px solid var(${BIEN_MAU_GACH_TIM})`,
      opacity: cu ? 0.6 : 1,
    };
  }
  if (vien === "dotted-grey") return { border: `1px dotted var(${BIEN_MAU_VIEN_XAM})`, borderRadius: 4, padding: "0 4px" };
  return {};
}
