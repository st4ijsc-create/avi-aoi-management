/**
 * Đợt 11.4 / mục 7 — "SỬA TRỰC TIẾP CÓ LINTER": sau khi áp một đề xuất, so chẩn đoán (Problems) của tệp TRƯỚC và SAU để báo
 * lỗi do chính lần sửa ĐẶT THÊM. Logic THUẦN (không biết `vscode`). Chỉ BÁO — không tự hoàn tác, không ghi gì.
 *
 * So theo ĐA TẬP khoá `mức|mã|thông điệp` (không theo số dòng: chèn dòng làm lệch mọi dòng bên dưới ⇒ so dòng sẽ báo oan).
 * Chỉ tính mức `error` (warning/hint không làm ồn); lỗi cũ còn nguyên không bị báo lại.
 */
import { cheBiMat } from "./nguCanh";

export interface ChanDoanNhe {
  muc: "error" | "warning" | "info" | "hint";
  thongDiep: string;
  /** 1-based, chỉ để hiển thị. */
  dong: number;
  ma?: string;
}

export const TRAN_LOI_MOI_HIEN = 5;
const TRAN_KY_TU_MOT_LOI = 200;

const khoa = (d: ChanDoanNhe) => `${d.muc}|${d.ma ?? ""}|${d.thongDiep}`;

export function loiMoiSauSua(truoc: readonly ChanDoanNhe[], sau: readonly ChanDoanNhe[]): ChanDoanNhe[] {
  const con = new Map<string, number>();
  for (const d of truoc) if (d.muc === "error") con.set(khoa(d), (con.get(khoa(d)) ?? 0) + 1);
  const moi: ChanDoanNhe[] = [];
  for (const d of sau) {
    if (d.muc !== "error") continue;
    const n = con.get(khoa(d)) ?? 0;
    if (n > 0) con.set(khoa(d), n - 1);
    else moi.push(d);
  }
  return moi;
}

/** Chuỗi báo cho người dùng (chữ thuần, đã che bí mật, cắt dài). `null` ⇒ không có gì để báo. */
export function canhBaoLoiMoi(tenTep: string, moi: readonly ChanDoanNhe[]): string | null {
  if (moi.length === 0) return null;
  const dong = moi.slice(0, TRAN_LOI_MOI_HIEN).map((d) => {
    const nd = cheBiMat(d.thongDiep).replace(/\s+/g, " ").trim();
    return `  · dòng ${d.dong}: ${nd.length > TRAN_KY_TU_MOT_LOI ? `${nd.slice(0, TRAN_KY_TU_MOT_LOI - 1)}…` : nd}${d.ma ? ` (${cheBiMat(d.ma)})` : ""}`;
  });
  const thieu = moi.length - dong.length;
  return `⚠ Sau lần sửa này "${tenTep}" có thêm ${moi.length} lỗi (Problems):\n${dong.join("\n")}${thieu > 0 ? `\n  … và ${thieu} lỗi nữa` : ""}\nBạn có thể hoàn tác bằng Ctrl+Z hoặc nhờ Thợ Cả sửa tiếp.`;
}
