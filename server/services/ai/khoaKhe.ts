/**
 * ★ Đợt 9 (2026-10-21, dieu-phoi duyệt) — KHOÁ KHE llama-server.
 *
 * Sự cố 14:00: bộ lập lịch khe nặng của :3000 đổi khe sang 35B (start-llama-server.ps1 -Force ⇒ Stop-Process) GIỮA một lượt
 * đo 27B của tiến trình khác ⇒ mất 4 lượt + cả lượt giữ lại. Khoá: tệp `LLAMA_WATCHDOG_PAUSE_FILE` (cùng tệp tạm dừng bộ
 * giám sát — một tệp, mọi bên đã biết đường) mang NỘI DUNG JSON `{chu, lyDo, hetHan}`; người giữ (phép đo, doi-model.ps1)
 * GIA HẠN định kỳ và gỡ khi xong; chết giữa chừng ⇒ khoá tự hết hạn.
 *
 *  • JSON còn hạn ⇒ khoá. Hết hạn ⇒ coi như không có.
 *  • Tệp HỎNG (không phải JSON khoá — vd định dạng chữ cũ của doi-model / lượt đổi API) ⇒ khoá NGẮN `KHOA_HONG_MS` tính từ
 *    mtime (fail-safe về phía KHÔNG giết) + log một lần mỗi mtime.
 * Người đọc: bộ lập lịch khe nặng (không đổi / không về nhà), bộ định tuyến (`kheBiKhoa` ⇒ không chọn profile nặng khe
 * không giữ), tRPC Trung tâm Model (hiển thị). Đọc đồng bộ, nhớ đệm 2 s (gọi trên đường định tuyến).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const KHOA_HONG_MS = 2 * 60_000;
const DEM_MS = 2_000;

export interface KhoaKhe {
  chu: string;
  lyDo: string;
  /** epoch ms */
  hetHan: number;
  /** tệp không đúng định dạng ⇒ khoá ngắn tính từ mtime */
  hong: boolean;
}

export function duongKhoaKhe(env: NodeJS.ProcessEnv = process.env): string {
  return (env.LLAMA_WATCHDOG_PAUSE_FILE || "").trim() || path.join(env.TEMP || os.tmpdir(), "llama-watchdog.pause");
}

let dem: { duong: string; luc: number; kq: KhoaKhe | null } | null = null;
let daLogHongMtime = 0;

/** Khoá đang hiệu lực tại `bayGio`, hoặc null. KHÔNG BAO GIỜ ném. */
export function docKhoaKhe(duong: string = duongKhoaKhe(), bayGio: number = Date.now()): KhoaKhe | null {
  if (dem && dem.duong === duong && bayGio - dem.luc < DEM_MS && (!dem.kq || dem.kq.hetHan > bayGio)) return dem.kq;
  let kq: KhoaKhe | null = null;
  try {
    const st = fs.statSync(duong);
    const noiDung = fs.readFileSync(duong, "utf8");
    let j: { chu?: unknown; lyDo?: unknown; hetHan?: unknown } | null = null;
    try {
      j = JSON.parse(noiDung.replace(/^\uFEFF/, ""));
    } catch {
      j = null;
    }
    const hetHan = j && typeof j === "object" ? (typeof j.hetHan === "number" ? j.hetHan : Date.parse(String(j.hetHan ?? ""))) : NaN;
    if (j && typeof j.chu === "string" && Number.isFinite(hetHan)) {
      kq = hetHan > bayGio ? { chu: j.chu, lyDo: String(j.lyDo ?? ""), hetHan, hong: false } : null;
    } else {
      const hetHanHong = st.mtimeMs + KHOA_HONG_MS;
      if (hetHanHong > bayGio) {
        kq = { chu: "không rõ (tệp khoá không đúng định dạng)", lyDo: noiDung.slice(0, 120).trim(), hetHan: hetHanHong, hong: true };
        if (daLogHongMtime !== st.mtimeMs) {
          daLogHongMtime = st.mtimeMs;
          console.warn(`[khoa-khe] tệp ${duong} không phải JSON khoá {chu, lyDo, hetHan} — coi là KHOÁ NGẮN tới ${new Date(hetHanHong).toISOString()} (không đổi khe).`);
        }
      }
    }
  } catch {
    kq = null; // không có tệp
  }
  dem = { duong, luc: bayGio, kq };
  return kq;
}

/** Chỉ lưới. */
export function __xoaBoNhoKhoaKhe(): void {
  dem = null;
  daLogHongMtime = 0;
}
