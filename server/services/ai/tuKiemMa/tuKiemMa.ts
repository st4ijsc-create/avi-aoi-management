/**
 * ★ T1 (2026-11-10, chu-du-an-HST duyệt phương án (i)) — TỰ KIỂM MÃ SAU KHI SINH ở chat coding (đường `/api/ai/local-kb/stream`,
 * codingMode): biên dịch / kiểm cú pháp khối mã duy nhất của câu trả lời; đỏ ⇒ gửi lỗi lại model trong CÙNG hội thoại, tối đa
 * `AI_CHAT_TU_KIEM_VONG` (2) vòng, trần tổng `TRAN_TONG_MS` (90 s). Cùng khuôn `ai/st/kiemBienDichSt.ts` (lõi thuần, I/O tiêm vào).
 *
 * LÝ DO (do-model, docs/ai/eval/2026-11-10-phan-tich-truot.md): H-cs2 hỏng 3/3 vì CS0122 (lớp ngoài gọi thành viên private của
 * lớp lồng) — LỖI BIÊN DỊCH mà trình biên dịch nói thẳng. Đường chat không có vòng nào chạy mã, nên model không bao giờ thấy lỗi.
 *
 * AN TOÀN: T1 CHỈ BIÊN DỊCH / KIỂM CÚ PHÁP — không bao giờ THỰC THI mã do model viết (dotnet build, tsc --noEmit,
 * python -m py_compile). T2 (model tự viết ca kiểm rồi chạy) là bước SAU, có số đo riêng.
 *
 * GIỚI HẠN TRUNG THỰC (ghi sẵn cho báo cáo): vòng chỉ sửa được cái trình biên dịch THẤY. H-ts3 (sai đặc tả), py-dang-ky (đề mơ hồ)
 * và phần lớn H-py3 (sai logic case biên) KHÔNG đổi ở T1; py_compile chỉ bắt lỗi cú pháp.
 *
 * Cờ: `AI_CHAT_TU_KIEM_MA=1` bật (mặc định TẮT ⇒ không một byte nào đổi); `AI_CHAT_TU_KIEM_VONG` (1–3, mặc định 2).
 */

export type NgonNguKiem = "cs" | "ts" | "py";

export const TRAN_VONG_MAC_DINH = 2;
export const TRAN_VONG_TOI_DA = 3;
/** Trần TỔNG cho phần thêm (kiểm + các lượt model sinh lại). */
export const TRAN_TONG_MS = 90_000;
/** Trần MỘT lượt biên dịch. */
export const TRAN_MOT_LUOT_MS = 10_000;

/** Cờ bật: CHỈ khi đúng `"1"` (mặc định TẮT). */
export function tuKiemMaBat(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AI_CHAT_TU_KIEM_MA ?? "").trim() === "1";
}

/** Số vòng sửa tối đa: số nguyên 1..3; vắng / sai ⇒ 2. */
export function soVongTuKiem(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(String(env.AI_CHAT_TU_KIEM_VONG ?? "").trim());
  if (!Number.isInteger(n) || n < 1) return TRAN_VONG_MAC_DINH;
  return Math.min(n, TRAN_VONG_TOI_DA);
}

const NHAN_NGON_NGU: Record<string, NgonNguKiem> = {
  cs: "cs",
  csharp: "cs",
  "c#": "cs",
  ts: "ts",
  typescript: "ts",
  py: "py",
  python: "py",
  python3: "py",
};

/** Khối KHÔNG phải mã (ví dụ đầu ra / lệnh) được phép đứng cạnh khối mã duy nhất. */
const NHAN_PHU = new Set(["", "text", "txt", "bash", "sh", "shell", "console", "json", "output"]);

export interface KhoiMaKiem {
  ngonNgu: NgonNguKiem;
  ma: string;
}

/**
 * Khối mã DUY NHẤT của câu trả lời có ngôn ngữ kiểm được. Hơn một khối mã (hoặc khối ngôn ngữ khác ngoài nhãn phụ) ⇒ `null`
 * (nhiều tệp / không rõ đơn vị biên dịch ⇒ bỏ qua, KHÔNG đoán).
 */
export function trichKhoiMaKiem(chu: string): KhoiMaKiem | null {
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  const khoi: KhoiMaKiem[] = [];
  for (const m of String(chu ?? "").matchAll(re)) {
    const nhan = (m[1] ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
    const nn = NHAN_NGON_NGU[nhan];
    if (nn) {
      khoi.push({ ngonNgu: nn, ma: m[2] ?? "" });
      continue;
    }
    if (!NHAN_PHU.has(nhan)) return null; // khối mã của ngôn ngữ khác ⇒ không phải một đơn vị biên dịch đơn
  }
  if (khoi.length !== 1) return null;
  return khoi[0]!.ma.trim() ? khoi[0]! : null;
}

export interface ChanDoanMa {
  dong: number | null;
  cot: number | null;
  ma: string | null;
  thongDiep: string;
}

export interface KetQuaBienDichMa {
  trangThai: "ok" | "loi" | "khong-kiem-duoc";
  chanDoan: ChanDoanMa[];
  lyDo?: string;
}

export type TrangThaiTuKiem = "bo-qua" | "sach" | "da-sua" | "con-loi" | "khong-kiem-duoc";

export interface KetQuaTuKiemMa {
  trangThai: TrangThaiTuKiem;
  lyDo: string | null;
  ngonNgu: NgonNguKiem | null;
  /** số lượt model sinh LẠI đã gọi thật */
  soVong: number;
  /** số lỗi của bản ĐẦU đã sửa hết (chỉ khi "da-sua") */
  soLoiDaSua: number;
  chanDoanCuoi: ChanDoanMa[];
  cauTraLoiDau: string;
  cauTraLoiCuoi: string;
  /** tổng ký tự do các lượt sinh lại trả về — thước đo token thêm (thô) */
  kyTuSinhThem: number;
  msThem: number;
}

export interface TuyChonTuKiemMa {
  cauTraLoi: string;
  /** Gửi `tinSua` vào CÙNG hội thoại sau câu trả lời `lanTruoc`; trả câu trả lời mới. */
  goiLai: (tinSua: string, lanTruoc: string) => Promise<string>;
  bienDich: (khoi: KhoiMaKiem, tranMs: number, signal?: AbortSignal) => Promise<KetQuaBienDichMa>;
  vongToiDa?: number;
  tranMs?: number;
  tranMotLuotMs?: number;
  bayGio?: () => number;
  signal?: AbortSignal;
}

/** Lời nhắc sửa (tiếng Anh — model coding đọc tiếng Anh ổn định hơn; lỗi trình biên dịch vốn tiếng Anh). */
export function cauNhacSuaMa(ngonNgu: NgonNguKiem, chanDoan: ChanDoanMa[]): string {
  const ten = ngonNgu === "cs" ? "C# compiler" : ngonNgu === "ts" ? "TypeScript compiler" : "Python parser";
  const nhan = ngonNgu === "cs" ? "csharp" : ngonNgu === "ts" ? "typescript" : "python";
  return (
    `Your code did not compile. The ${ten} reported:\n${chanDoanChoModel(chanDoan)}\n\n` +
    `Fix ONLY these compile errors. Keep the behaviour and the public API required by the task. ` +
    `Reply with the COMPLETE corrected code in ONE \`\`\`${nhan} block and no other code block.`
  );
}

/** Chẩn đoán ⇒ chữ gửi model (≤ 20 dòng). */
export function chanDoanChoModel(ds: ChanDoanMa[]): string {
  return ds
    .slice(0, 20)
    .map((d) => `line ${d.dong ?? "?"}${d.cot !== null ? `:${d.cot}` : ""} ${d.ma ? `error ${d.ma}` : "error"}: ${d.thongDiep}`)
    .join("\n");
}

export async function kiemVaSuaMa(y: TuyChonTuKiemMa): Promise<KetQuaTuKiemMa> {
  const bayGio = y.bayGio ?? Date.now;
  const t0 = bayGio();
  const vongToiDa = Math.max(0, y.vongToiDa ?? TRAN_VONG_MAC_DINH);
  const tranMs = y.tranMs ?? TRAN_TONG_MS;
  const tranMotLuot = y.tranMotLuotMs ?? TRAN_MOT_LUOT_MS;
  let kyTuSinhThem = 0;
  const kq = (p: Partial<KetQuaTuKiemMa>): KetQuaTuKiemMa => ({
    trangThai: "bo-qua", lyDo: null, ngonNgu: null, soVong: 0, soLoiDaSua: 0, chanDoanCuoi: [],
    cauTraLoiDau: y.cauTraLoi, cauTraLoiCuoi: y.cauTraLoi, kyTuSinhThem, msThem: bayGio() - t0, ...p,
  });
  const conLai = () => Math.max(1, Math.min(tranMotLuot, tranMs - (bayGio() - t0)));

  const dau = trichKhoiMaKiem(y.cauTraLoi);
  if (!dau) return kq({ lyDo: "khong-co-khoi-ma-duy-nhat" });
  let rd: KetQuaBienDichMa;
  try {
    rd = await y.bienDich(dau, conLai(), y.signal);
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    return kq({ trangThai: "khong-kiem-duoc", ngonNgu: dau.ngonNgu, lyDo: `loi-ha-tang: ${String((e as Error)?.message ?? e).slice(0, 200)}` });
  }
  if (rd.trangThai === "khong-kiem-duoc") return kq({ trangThai: "khong-kiem-duoc", ngonNgu: dau.ngonNgu, lyDo: rd.lyDo ?? "khong-ro" });
  if (rd.trangThai === "ok") return kq({ trangThai: "sach", ngonNgu: dau.ngonNgu });

  const loiDau = rd.chanDoan.length;
  let tot = { chu: y.cauTraLoi, chanDoan: rd.chanDoan };
  let lanTruoc = y.cauTraLoi;
  let chanDoan = rd.chanDoan;
  let daGoi = 0;
  for (let vong = 1; vong <= vongToiDa; vong++) {
    if (y.signal?.aborted) break;
    if (bayGio() - t0 >= tranMs) break;
    let moi: string;
    try {
      daGoi = vong;
      moi = await y.goiLai(cauNhacSuaMa(dau.ngonNgu, chanDoan), lanTruoc);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      break; // model lỗi giữa vòng ⇒ trả bản tốt nhất đã có
    }
    kyTuSinhThem += String(moi ?? "").length;
    const khoi = trichKhoiMaKiem(moi);
    if (!khoi || khoi.ngonNgu !== dau.ngonNgu) break; // bản sửa không còn đúng một khối cùng ngôn ngữ ⇒ giữ bản tốt nhất
    let r: KetQuaBienDichMa;
    try {
      r = await y.bienDich(khoi, conLai(), y.signal);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      break;
    }
    if (r.trangThai === "khong-kiem-duoc") break;
    lanTruoc = moi;
    if (r.trangThai === "ok") return kq({ trangThai: "da-sua", ngonNgu: dau.ngonNgu, soVong: vong, soLoiDaSua: loiDau, cauTraLoiCuoi: moi });
    chanDoan = r.chanDoan;
    if (r.chanDoan.length < tot.chanDoan.length) tot = { chu: moi, chanDoan: r.chanDoan };
  }
  return kq({ trangThai: "con-loi", ngonNgu: dau.ngonNgu, soVong: daGoi, chanDoanCuoi: tot.chanDoan, cauTraLoiCuoi: y.cauTraLoi });
}

/** Tóm tắt máy đọc trên `done.tuKiemMa` — cùng khuôn `kiemBienDichST`; kèm ký tự sinh thêm (thước token thô) và ms. */
export function headerTuKiemMa(k: KetQuaTuKiemMa): string {
  if (k.trangThai === "bo-qua") return "ok=skip";
  const ok = k.trangThai === "sach" || k.trangThai === "da-sua" ? "1" : k.trangThai === "khong-kiem-duoc" ? "na" : "0";
  return `ok=${ok}; trang-thai=${k.trangThai}; ngon-ngu=${k.ngonNgu ?? "-"}; vong=${k.soVong}; sua=${k.soLoiDaSua}; con=${k.chanDoanCuoi.length}; ky-tu-them=${k.kyTuSinhThem}; ms=${k.msThem}`;
}

/** Dòng ghi chú nối vào bản đã sửa (không thay lặng lẽ). */
export function ghiChuDaSua(k: KetQuaTuKiemMa): string {
  return `\n\n---\n_Đã tự biên dịch thử và sửa ${k.soLoiDaSua} lỗi biên dịch sau ${k.soVong} vòng — bản trên là bản đã sửa._`;
}
