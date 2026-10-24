/**
 * ★ Đợt 9 (2026-10-24, dieu-phoi duyệt) — ẢNH ĐÍNH KÈM cho trợ lý/tác nhân: kiểm ảnh + kiểm tài nguyên trước khi nạp sidecar thị giác.
 * Spec: docs/superpowers/specs/2026-10-24-ai-local-doc-anh-tro-ly-lap-trinh.md §6.
 *
 *   • `kiemAnhDataUrl` — chỉ `data:` URL (không http ⇒ không SSRF), MIME xác định bằng BYTE ĐẦU (không tin tiền tố), trần byte.
 *   • `kiemDanhSachAnh` — trần số ảnh / tổng byte của một yêu cầu (đếm trên CẢ lịch sử).
 *   • `kiemTaiNguyenSidecar` — ĐO ĐƯỢC 2026-10-24: Qwen3-VL-8B (7.825 MiB) nạp CẠNH 35B ⇒ VRAM 31,9 GB, đường chữ chậm ×4, commit trống
 *     tụt 3–5 GB (vùng sự cố hết bộ nhớ ảo). Chỉ cho nạp khi VRAM trống VÀ commit trống đủ; không đủ ⇒ lý do rõ, KHÔNG nạp chồng.
 */
import { execFile } from "node:child_process";

export type MaLoiAnh = "ANH_SAI_DINH_DANG" | "ANH_QUA_LON" | "QUA_NHIEU_ANH";
export interface AnhHopLe {
  mime: "image/png" | "image/jpeg" | "image/webp";
  byte: number;
  /** data URL CHUẨN HOÁ (MIME theo byte đầu) — thứ được gửi đi. */
  dataUrl: string;
  buffer: Buffer;
}

const soDuong = (raw: string | undefined, macDinh: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : macDinh;
};
export const tranAnh = (env: NodeJS.ProcessEnv = process.env) => ({
  byteMoiAnh: soDuong(env.AI_ANH_MAX_MB, 6) * 1024 * 1024,
  soAnh: Math.floor(soDuong(env.AI_ANH_MAX_SO_ANH, 4)),
  tongByte: soDuong(env.AI_ANH_MAX_TONG_MB, 12) * 1024 * 1024,
});

/** MIME theo byte đầu — PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF????WEBP`. Khác ⇒ null. */
export function mimeTheoByteDau(b: Buffer): AnhHopLe["mime"] | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Một ảnh `data:image/...;base64,…` (hoặc base64 trần khi `choPhepTran`). KHÔNG ném. */
export function kiemAnhDataUrl(
  raw: unknown,
  env: NodeJS.ProcessEnv = process.env,
  choPhepTran = false,
): AnhHopLe | { loi: MaLoiAnh; chiTiet: string } {
  if (typeof raw !== "string" || !raw.trim()) return { loi: "ANH_SAI_DINH_DANG", chiTiet: "ảnh rỗng" };
  const s = raw.trim();
  const m = s.match(/^data:([a-z0-9.+/-]+);base64,(.*)$/is);
  if (!m && !(choPhepTran && /^[A-Za-z0-9+/=\s]+$/.test(s))) {
    return { loi: "ANH_SAI_DINH_DANG", chiTiet: "chỉ nhận data:image/<png|jpeg|webp>;base64,… (không nhận http/https)" };
  }
  const b64 = (m ? m[2] : s).replace(/\s/g, "");
  const tran = tranAnh(env);
  if (b64.length > Math.ceil((tran.byteMoiAnh * 4) / 3) + 16) {
    return { loi: "ANH_QUA_LON", chiTiet: `ảnh vượt ${tran.byteMoiAnh / 1024 / 1024} MB` };
  }
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length === 0) return { loi: "ANH_SAI_DINH_DANG", chiTiet: "base64 rỗng/hỏng" };
  if (buffer.length > tran.byteMoiAnh) return { loi: "ANH_QUA_LON", chiTiet: `ảnh ${buffer.length} byte vượt ${tran.byteMoiAnh / 1024 / 1024} MB` };
  const mime = mimeTheoByteDau(buffer);
  if (!mime) return { loi: "ANH_SAI_DINH_DANG", chiTiet: "byte đầu không phải PNG/JPEG/WebP" };
  return { mime, byte: buffer.length, buffer, dataUrl: `data:${mime};base64,${buffer.toString("base64")}` };
}

/** Trần của CẢ yêu cầu (sau khi từng ảnh đã hợp lệ). */
export function kiemDanhSachAnh(ds: AnhHopLe[], env: NodeJS.ProcessEnv = process.env): { loi: MaLoiAnh; chiTiet: string } | null {
  const tran = tranAnh(env);
  if (ds.length > tran.soAnh) return { loi: "QUA_NHIEU_ANH", chiTiet: `${ds.length} ảnh > trần ${tran.soAnh} ảnh/yêu cầu (đếm cả lịch sử)` };
  const tong = ds.reduce((a, x) => a + x.byte, 0);
  if (tong > tran.tongByte) return { loi: "ANH_QUA_LON", chiTiet: `tổng ảnh ${tong} byte vượt ${tran.tongByte / 1024 / 1024} MB` };
  return null;
}

// ─── Tài nguyên trước khi nạp sidecar thị giác ────────────────────────────────────────────────────────────

/** Commit TRỐNG của Windows (GB) — `Win32_OperatingSystem.FreeVirtualMemory`. Không phải Windows / đọc hỏng ⇒ null. Đệm 10 s. */
let demCommit: { luc: number; gb: number | null } | null = null;
export async function docCommitTrongGb(bayGio = Date.now()): Promise<number | null> {
  if (process.platform !== "win32") return null;
  if (demCommit && bayGio - demCommit.luc < 10_000) return demCommit.gb;
  const gb = await new Promise<number | null>((xong) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory"],
      { timeout: 8000, windowsHide: true },
      (err, out) => {
        const kb = Number(String(out ?? "").trim());
        xong(err || !Number.isFinite(kb) || kb <= 0 ? null : kb / 1024 / 1024);
      },
    );
  });
  demCommit = { luc: bayGio, gb };
  return gb;
}

export interface KetQuaTaiNguyen {
  du: boolean;
  lyDo?: string;
  vramTrongMb: number | null;
  commitTrongGb: number | null;
}

/**
 * Đủ chỗ nạp sidecar VL-8B CẠNH khe nặng không. Ngưỡng từ số đo 2026-10-24: sidecar 7.825 MiB VRAM + biên 700 ⇒ 8.500 MiB trống;
 * Private sidecar ≈ 6,3 GB (model + mmproj) + sàn cảnh báo 8 GB của canh-bo-nho ⇒ 15 GB commit trống. Không đọc được VRAM ⇒ KHÔNG đủ
 * (đóng theo mặc định); không đọc được commit (không phải Windows) ⇒ chỉ xét VRAM.
 */
export async function kiemTaiNguyenSidecar(
  doc: { vram: () => Promise<{ usedBytes: number; totalBytes: number } | null>; commit: () => Promise<number | null> },
  env: NodeJS.ProcessEnv = process.env,
): Promise<KetQuaTaiNguyen> {
  const canVram = soDuong(env.AI_ANH_SIDECAR_VRAM_TRONG_MB, 8500);
  const canCommit = soDuong(env.AI_ANH_SIDECAR_COMMIT_TRONG_GB, 15);
  const v = await doc.vram().catch(() => null);
  const vramTrongMb = v ? Math.round((v.totalBytes - v.usedBytes) / 1024 / 1024) : null;
  const commitTrongGb = await doc.commit().catch(() => null);
  if (vramTrongMb === null) return { du: false, lyDo: "không đọc được VRAM", vramTrongMb, commitTrongGb };
  if (vramTrongMb < canVram) {
    return { du: false, lyDo: `GPU còn ${vramTrongMb} MiB trống, cần ${canVram} MiB để nạp model đọc ảnh cạnh model đang chạy`, vramTrongMb, commitTrongGb };
  }
  if (commitTrongGb !== null && commitTrongGb < canCommit) {
    return { du: false, lyDo: `bộ nhớ ảo còn ${commitTrongGb.toFixed(1)} GB trống, cần ${canCommit} GB`, vramTrongMb, commitTrongGb };
  }
  return { du: true, vramTrongMb, commitTrongGb };
}
