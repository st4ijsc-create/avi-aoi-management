/**
 * ★★★ Đợt 2 — CHỈ MỤC NGỮ NGHĨA mã nguồn theo DỰ ÁN (tool `search_code` của agentCore gọi qua `index.ts`).
 *
 * Khảo sát tầng 5: dự án ngoài repo chính nhận 0 ngữ cảnh mã; câu "chỗ nào xử lý X" chỉ có `grep_repo` theo CHỮ —
 * model phải đoán đúng tên định danh trước khi tìm được nó. Bảng `ai_code_chunks` (mig 0391) giữ đoạn mã đã nhúng của
 * từng dự án để tìm theo NGHĨA.
 *
 * ── HỢP ĐỒNG (thiết kế §3, giữ chữ ký; trường thêm đều TUỲ CHỌN) ──────────────────────────────────────────────────
 *   • `dungChiMuc`  — dựng TOÀN BỘ: duyệt cây (hộp cát + `.gitignore`), tệp KHÔNG ĐỔI BĂM (và cùng model nhúng) thì
 *                     bỏ qua, tệp đổi ⇒ cắt đoạn + nhúng + thay hàng; hàng của tệp đã biến mất ⇒ xoá. Mức ưu tiên
 *                     `nen` (`chayVoiUuTien`), huỷ được (`signal` ⇒ AbortError), một lượt dựng mỗi dự án tại một thời
 *                     điểm (lượt gọi thứ hai NHẬP vào lượt đang chạy).
 *   • `lamTuoiTep`  — chỉ những đường đưa vào (gọi sau mỗi lượt ghi của agent). Chỉ mục chưa CHỐT `xong` ⇒ không làm
 *                     gì (lượt dựng tiếp theo nhặt thay đổi nhờ so băm).
 *   • `timMaNgu`    — cosine trên pgvector, LỌC `projectId` + `moHinh`, k mặc định 8. Chưa có hàng nào ⇒ trả NGAY
 *                     `chua-co` và KÍCH HOẠT dựng nền — KHÔNG dựng đồng bộ trong lượt tìm (một lượt dựng repo này là
 *                     hàng chục phút nhúng; lượt tool của agent không được treo chừng ấy).
 *   • `san-sang`    — CHỈ khi lượt dựng gần nhất cho (dự án, model) đã CHỐT `xong` trong `ai_code_index_state` (mig
 *                     0395). "Có hàng" KHÔNG đủ: đo sống 2026-10-17 lượt dựng chết ở 393/~50.000 đoạn khai `san-sang`
 *                     mãi. Xem khối TRẠNG THÁI LƯỢT DỰNG.
 *
 * ── QUYẾT ĐỊNH ────────────────────────────────────────────────────────────────────────────────────────────────────
 *   • Bộ nhúng TIÊM ĐƯỢC (`datBoNhung`). Mặc định = `aiGgufEngine.generateEmbeddings` in-process, CÙNG model với kho KB
 *     (`GGUF_EMBED_MODEL`, Qwen3-Embedding) — dùng lại hàm sẵn có nên không có điểm cấp phát VRAM mới (census
 *     `vramAllocationSites` không đổi). Câu hỏi nhúng kèm tiền tố Instruct của Qwen3 (`tienToNhungCauHoi`, đã đo ở KB).
 *   • `projectId` là KHOÁ CÁCH LY: mọi câu SQL có `WHERE "projectId" = …`. Thiếu `projectId` ⇒ phân giải theo gốc:
 *     bản đồ đã thấy ở `dungChiMuc` → danh sách dự án hộp cát (`danhSachDuAn`) → id suy từ băm đường gốc (`g-…`).
 *   • CHE BÍ MẬT hai lớp: `redactSecretsOnly` lúc đọc (cửa hộp cát) + `redactSecretsAndPII` trên TỪNG ĐOẠN trước khi
 *     nhúng/lưu (bảng sống lâu và đoạn đi thẳng vào ngữ cảnh model ⇒ che cả email/điện thoại). Vector cũng được tính
 *     trên bản đã che — không mã hoá bí mật vào không gian nhúng.
 *   • Không HNSW (xem mig 0391): quét chính xác theo btree `projectId`, có trần `TRAN_DOAN_DU_AN`.
 *   • Ghi một tệp = MỘT giao dịch: khoá tư vấn theo (dự án, tệp) ⇒ xoá ⇒ chèn. Dựng nền và làm tươi chạy chồng nhau
 *     trên cùng tệp không đẻ hàng trùng (kể cả giữa hai tiến trình).
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { DbUnavailableError, isMissingTable } from "../../../_core/dbErrors";
import { redactSecretsAndPII } from "../aiSafety";
import { chayVoiUuTien } from "../hangDoiUuTienLlm";
import { tienToNhungCauHoi } from "../tienToNhungCauHoi";
import { danhSachDuAn } from "../../aiLocalTools/repoProjects";
import { duoiDuocPhep, phanQuyetDuongDan } from "../../aiLocalTools/repoSandbox";
import { trichKyHieu } from "./kyHieu";
import { napBoQuaGit } from "./boQuaGit";
import { chuanHoaRel, dauVetTep, docTepChiMuc, duyetTepMa, ngonNguCuaTep, type NgonNgu } from "./hopCatChiMuc";

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TRẦN
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
/** Số chiều cột `embedding` (mig 0391). Bộ nhúng khác số chiều ⇒ từ chối (không cắt/đệm vector — làm hỏng cosine). */
export const SO_CHIEU_NHUNG = 1024;
/** Số tệp tối đa mỗi dự án (repo này: ~5.200 tệp mã theo dõi). Chạm ⇒ `catBot`. */
export const TRAN_TEP_NGU_NGHIA = 6_000;
/**
 * Byte tối đa đọc mỗi tệp cho chỉ mục ngữ nghĩa. Phần sau trần không được nhúng (khai `catBot`). ĐO (2026-10-17, repo
 * này): ở 256 KiB có 3 tệp bị cụt đuôi (`machineApiRouters.ts` 353 KB, `_core/index.ts` 338 KB, `TwinVanHanh.tsx`
 * 306 KB) ⇒ dùng chung trần 512 KiB với chỉ mục ký hiệu.
 */
export const TRAN_BYTE_TEP_NGU_NGHIA = 512 * 1024;
/** Số đoạn tối đa mỗi dự án — cũng là trần của phép quét cosine chính xác. */
export const TRAN_DOAN_DU_AN = 60_000;
/** Tổng thời gian một lượt dựng. */
export const TRAN_THOI_GIAN_DUNG_MS = 45 * 60_000;
/** Số đoạn mỗi lô nhúng (điểm kiểm huỷ giữa các lô). */
const LO_NHUNG = 16;
/** Ký tự tối đa một đoạn (≈ 1.500 token — dưới ngữ cảnh nhúng). */
// ⚠ Đo sống 2026-10-17: 6.000 ký tự (mã có chú thích tiếng Việt ≈ 2 ký tự/token) VƯỢT ngữ cảnh nhúng 2.048 token
//   (`GGUF_EMBED_CTX`) ⇒ "Input is longer than the context size" ⇒ lượt dựng repo chính chết ở đoạn 393. 3.000 ký tự
//   ≈ ≤ 1.500 token cả ở ca xấu; đoạn vẫn vượt thì `nhungLoAnToan` rút ngắn dần.
const TRAN_KY_TU_DOAN = 3_000;
/** Ký tự tối đa của `doan` trả về cho model. */
const TRAN_KY_TU_KET_QUA = 3_000;
const K_MAC_DINH = 8;
const K_TOI_DA = 30;

const RE_ID_DU_AN = /^[A-Za-z0-9_-]{1,64}$/;
/** Đuôi KHÔNG có bộ trích ký hiệu nhưng vẫn là mã đáng tìm — cắt theo cửa sổ dòng. */
const DUOI_CUA_SO: ReadonlySet<string> = new Set([".sql", ".vue", ".svelte", ".st", ".scl"]);

function laTepNguNghia(ten: string): boolean {
  if (!duoiDuocPhep(ten)) return false;
  return ngonNguCuaTep(ten) !== null || DUOI_CUA_SO.has(path.extname(ten).toLowerCase());
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// BỘ NHÚNG (tiêm được)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export interface BoNhung {
  /** Tên model — lưu vào cột `moHinh`; tìm kiếm lọc theo nó. */
  readonly moHinh: string;
  readonly soChieu: number;
  nhungTaiLieu(van: string[], signal?: AbortSignal): Promise<number[][]>;
  nhungCauHoi(cauHoi: string, signal?: AbortSignal): Promise<number[]>;
}

function tenModelNhungMacDinh(): string {
  return path.basename(process.env.GGUF_EMBED_MODEL || "mxbai-embed-large-v1-f16.gguf", ".gguf");
}

/** Bộ nhúng mặc định: hàm in-process SẴN CÓ của `aiGgufEngine` (nạp lười — import module này không chạm GPU). */
const boNhungMacDinh: BoNhung = {
  get moHinh() {
    return tenModelNhungMacDinh();
  },
  soChieu: SO_CHIEU_NHUNG,
  async nhungTaiLieu(van) {
    const { generateEmbeddings } = await import("../../aiGgufEngine");
    return (await generateEmbeddings(van, tenModelNhungMacDinh())).embeddings;
  },
  async nhungCauHoi(cauHoi) {
    const { generateEmbedding } = await import("../../aiGgufEngine");
    const ten = tenModelNhungMacDinh();
    return (await generateEmbedding(tienToNhungCauHoi(ten) + cauHoi, ten)).embedding;
  },
};

let boNhungTiem: BoNhung | null = null;

/** Tiêm bộ nhúng (lưới; hoặc agent muốn bộ nhúng khác). `null` ⇒ về mặc định. */
export function datBoNhung(b: BoNhung | null): void {
  boNhungTiem = b;
}

function boNhung(): BoNhung {
  return boNhungTiem ?? boNhungMacDinh;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CẮT ĐOẠN (thuần)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export interface Doan {
  /** 1-based, bao gồm. */
  dongDau: number;
  dongCuoi: number;
  noiDung: string;
}

export interface TuyChonCat {
  /** Đoạn ngắn hơn (dòng) được gộp vào đoạn sau. Mặc định 5. */
  toiThieu?: number;
  /** Đoạn dài hơn (dòng) bị chia. Mặc định 80. */
  toiDa?: number;
  /** Cửa sổ rơi về (dòng). Mặc định 60. */
  cuaSo?: number;
  /** Phần chồng giữa hai cửa sổ (dòng). Mặc định 10. */
  chong?: number;
}

const LA_CHU_THICH_HOAC_TRANG_TRI = /^\s*(?:\/\/|\/\*|\*|#(?!include|define|if|endif|pragma)|@[A-Za-z]|\[[A-Za-z])/;

function cuaSo(batDau: number, ketThuc: number, co: number, chong: number): Array<[number, number]> {
  const ra: Array<[number, number]> = [];
  const buoc = Math.max(1, co - chong);
  for (let s = batDau; s <= ketThuc; s += buoc) {
    const e = Math.min(ketThuc, s + co - 1);
    ra.push([s, e]);
    if (e >= ketThuc) break;
  }
  return ra;
}

/**
 * Cắt nội dung MỘT tệp thành đoạn: ranh giới = định nghĩa KHÔNG phải phương thức (kéo lên cả khối chú thích/
 * decorator ngay trên nó); đoạn quá dài ⇒ chia ở ranh giới phương thức bên trong, còn dài ⇒ cửa sổ; không có định nghĩa
 * ⇒ cửa sổ `cuaSo`/`chong`. Không mất dòng nào; đoạn chỉ có khoảng trắng bị bỏ.
 */
export function catDoan(noiDung: string, ngonNgu: NgonNgu | null, tc: TuyChonCat = {}): Doan[] {
  const toiThieu = tc.toiThieu ?? 5;
  const toiDa = tc.toiDa ?? 80;
  const co = tc.cuaSo ?? 60;
  const chong = tc.chong ?? 10;
  const dongs = noiDung.split(/\r?\n/);
  if (dongs.length > 0 && dongs[dongs.length - 1] === "") dongs.pop();
  const n = dongs.length;
  if (n === 0) return [];

  const kyHieu = ngonNgu ? trichKyHieu(noiDung, ngonNgu) : [];
  const keoLen = (d: number): number => {
    let s = d;
    while (s > 1 && LA_CHU_THICH_HOAC_TRANG_TRI.test(dongs[s - 2]!)) s--;
    return s;
  };
  const ranhGioi = [...new Set(kyHieu.filter((k) => k.kind !== "method").map((k) => keoLen(k.dong)))].sort((a, b) => a - b);
  const phuongThuc = [...new Set(kyHieu.filter((k) => k.kind === "method").map((k) => keoLen(k.dong)))].sort((a, b) => a - b);

  let khoang: Array<[number, number]> = [];
  if (ranhGioi.length === 0) {
    khoang = cuaSo(1, n, co, chong);
  } else {
    const moc = ranhGioi[0] === 1 ? ranhGioi : [1, ...ranhGioi];
    for (let i = 0; i < moc.length; i++) khoang.push([moc[i]!, (moc[i + 1] ?? n + 1) - 1]);
    // Gộp đoạn quá ngắn vào đoạn SAU (đoạn cuối ngắn ⇒ gộp vào đoạn TRƯỚC), miễn tổng không vượt `toiDa`.
    const gop: Array<[number, number]> = [];
    for (const k of khoang) {
      const truoc = gop[gop.length - 1];
      if (truoc && truoc[1] - truoc[0] + 1 < toiThieu && k[1] - truoc[0] + 1 <= toiDa) truoc[1] = k[1];
      else gop.push([k[0], k[1]]);
    }
    if (gop.length > 1) {
      const cuoi = gop[gop.length - 1]!;
      const keCuoi = gop[gop.length - 2]!;
      if (cuoi[1] - cuoi[0] + 1 < toiThieu && cuoi[1] - keCuoi[0] + 1 <= toiDa) {
        keCuoi[1] = cuoi[1];
        gop.pop();
      }
    }
    // Chia đoạn quá dài: ở ranh giới phương thức trước, còn dài thì cửa sổ.
    khoang = [];
    for (const [s, e] of gop) {
      if (e - s + 1 <= toiDa) {
        khoang.push([s, e]);
        continue;
      }
      const trong = phuongThuc.filter((m) => m > s && m <= e);
      const con: Array<[number, number]> = [];
      const moc2 = [s, ...trong];
      for (let i = 0; i < moc2.length; i++) con.push([moc2[i]!, (moc2[i + 1] ?? e + 1) - 1]);
      for (const [a, b] of con) {
        if (b - a + 1 <= toiDa) khoang.push([a, b]);
        else khoang.push(...cuaSo(a, b, co, chong));
      }
    }
  }

  const ra: Doan[] = [];
  for (const [s, e] of khoang) {
    const than = dongs.slice(s - 1, e).join("\n");
    if (than.trim() === "") continue;
    if (than.length <= TRAN_KY_TU_DOAN) {
      ra.push({ dongDau: s, dongCuoi: e, noiDung: than });
      continue;
    }
    // Dòng rất dài (mã rút gọn/dữ liệu nhúng): chia theo ký tự, giữ ranh giới dòng khi được.
    let a = s;
    while (a <= e) {
      let b = a;
      let len = Math.min(dongs[a - 1]!.length, TRAN_KY_TU_DOAN);
      while (b + 1 <= e && len + 1 + dongs[b]!.length <= TRAN_KY_TU_DOAN) {
        b++;
        len += 1 + dongs[b - 1]!.length;
      }
      const t = dongs.slice(a - 1, b).join("\n").slice(0, TRAN_KY_TU_DOAN);
      if (t.trim() !== "") ra.push({ dongDau: a, dongCuoi: b, noiDung: t });
      a = b + 1;
    }
  }
  return ra;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DỰ ÁN · GỐC
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const duAnTheoGoc = new Map<string, string>();

function khoaGoc(goc: string): string {
  const r = path.resolve(goc);
  return process.platform === "win32" ? r.toLowerCase() : r;
}

function gocHopLe(gocDuAn: unknown): string | null {
  if (typeof gocDuAn !== "string" || gocDuAn.trim() === "" || !path.isAbsolute(gocDuAn)) return null;
  const goc = path.resolve(gocDuAn);
  try {
    return fs.statSync(goc).isDirectory() ? goc : null;
  } catch {
    return null;
  }
}

/**
 * projectId cho một gốc: tường minh (đã kiểm hình dạng) → đã thấy ở `dungChiMuc` → dự án hộp cát có cùng gốc →
 * id suy từ băm đường gốc. Ba nguồn sau chỉ là đường lùi khi agent không truyền `projectId`.
 */
export function phanGiaiDuAn(goc: string, projectId?: string): string {
  if (projectId !== undefined) {
    if (!RE_ID_DU_AN.test(projectId)) throw new LoiChiMucMa("PROJECT_ID_KHONG_HOP_LE", `chiMucMa: projectId không hợp lệ (${JSON.stringify(projectId).slice(0, 80)})`);
    duAnTheoGoc.set(khoaGoc(goc), projectId);
    return projectId;
  }
  const k = khoaGoc(goc);
  const daThay = duAnTheoGoc.get(k);
  if (daThay) return daThay;
  try {
    const d = danhSachDuAn().find((x) => khoaGoc(x.goc) === k);
    if (d && RE_ID_DU_AN.test(d.id)) return d.id;
  } catch {
    /* danh sách dự án hỏng ⇒ rơi về id suy từ gốc */
  }
  return "g-" + createHash("sha256").update(k, "utf8").digest("hex").slice(0, 24);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DB
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function vecLiteral(v: readonly number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
}

/** Khoá tư vấn (dự án, tệp). ⚠ KHÔNG dùng `\0` làm dấu ngăn: Postgres từ chối byte 0x00 trong tham số văn bản (22021). */
function khoaKhoa(projectId: string, duong: string): string {
  return `ai_code_chunks|${projectId}|${duong}`;
}

function bam(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

async function bamDaLuu(db: Db, projectId: string): Promise<Map<string, { bam: string; moHinh: string; soDoan: number; nhieu: boolean }>> {
  const rows = (await db.execute(sql`
    SELECT duong, bam, "moHinh", count(*)::int AS n FROM public.ai_code_chunks
    WHERE "projectId" = ${projectId} GROUP BY duong, bam, "moHinh"`)) as unknown as Array<{ duong: string; bam: string; moHinh: string; n: number }>;
  const m = new Map<string, { bam: string; moHinh: string; soDoan: number; nhieu: boolean }>();
  for (const r of rows) {
    const cu = m.get(r.duong);
    if (cu) cu.nhieu = true; // hai phiên bản cùng tệp ⇒ coi như đổi, nhúng lại cho sạch
    else m.set(r.duong, { bam: r.bam.trim(), moHinh: r.moHinh, soDoan: Number(r.n), nhieu: false });
  }
  return m;
}

async function xoaTep(db: Db, projectId: string, duong: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${khoaKhoa(projectId, duong)}, 0))`);
    await tx.execute(sql`DELETE FROM public.ai_code_chunks WHERE "projectId" = ${projectId} AND duong = ${duong}`);
  });
}

async function ghiTep(
  db: Db,
  projectId: string,
  duong: string,
  bamTep: string,
  moHinh: string,
  doan: ReadonlyArray<Doan & { vec: number[] }>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${khoaKhoa(projectId, duong)}, 0))`);
    await tx.execute(sql`DELETE FROM public.ai_code_chunks WHERE "projectId" = ${projectId} AND duong = ${duong}`);
    for (const d of doan) {
      await tx.execute(sql`
        INSERT INTO public.ai_code_chunks ("projectId", duong, bam, "dongDau", "dongCuoi", "noiDung", "moHinh", embedding)
        VALUES (${projectId}, ${duong}, ${bamTep}, ${d.dongDau}, ${d.dongCuoi}, ${d.noiDung}, ${moHinh}, ${vecLiteral(d.vec)}::vector)`);
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// XỬ LÝ MỘT TỆP
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Lỗi có mã của chỉ mục ngữ nghĩa. Mọi chỗ ném đi tới KẾT QUẢ TOOL của agent / nhật ký dựng nền — không tới tRPC dưới dạng
 * câu chữ cho người dùng ⇒ theo luật (a)+(b) của rawErrorCensus F3: không đẻ mã appError, chỉ gắn `code` để máy đọc,
 * message GIỮ NGUYÊN VĂN (lưới khớp regex + LLM đọc).
 */
export class LoiChiMucMa extends Error {
  constructor(
    readonly code: "PROJECT_ID_KHONG_HOP_LE" | "GOC_KHONG_HOP_LE" | "BO_NHUNG_SAI_HOP_DONG",
    message: string,
  ) {
    super(message);
    this.name = "LoiChiMucMa";
  }
}

function loiHuy(): Error {
  const e = new Error("chiMucMa: đã huỷ");
  e.name = "AbortError";
  return e;
}

interface NguCanhTep {
  db: Db;
  goc: string;
  projectId: string;
  bo: BoNhung;
  tranByte: number;
  signal?: AbortSignal;
}

type KetQuaTep = { loai: "giu"; soDoan: number } | { loai: "nhung"; soDoan: number; catBot: boolean } | { loai: "bo" };

/**
 * Đọc ⇒ băm ⇒ so với bản đã lưu ⇒ (đổi) cắt + che + nhúng + ghi. `daLuu` = trạng thái đã lưu của tệp (nếu có).
 * Tệp không còn đọc được ⇒ xoá hàng của nó (nếu có) và trả `bo`.
 */
async function xuLyTep(
  nc: NguCanhTep,
  rel: string,
  daLuu: { bam: string; moHinh: string; soDoan: number; nhieu: boolean } | undefined,
): Promise<KetQuaTep> {
  const doc = docTepChiMuc(nc.goc, rel, nc.tranByte);
  if (!doc.ok) {
    if (daLuu) await xoaTep(nc.db, nc.projectId, rel);
    return { loai: "bo" };
  }
  const bamTep = bam(doc.noiDung);
  if (daLuu && !daLuu.nhieu && daLuu.bam === bamTep && daLuu.moHinh === nc.bo.moHinh) return { loai: "giu", soDoan: daLuu.soDoan };

  const doan = catDoan(doc.noiDung, ngonNguCuaTep(rel.split("/").pop() ?? "")).map((d) => ({
    ...d,
    // `\0` bị Postgres từ chối trong cột text (22021) — tệp "văn bản" có byte rỗng không được làm hỏng cả lượt dựng.
    noiDung: redactSecretsAndPII(d.noiDung).text.replace(/\0/g, ""),
  }));
  const coVec: Array<Doan & { vec: number[] }> = [];
  for (let i = 0; i < doan.length; i += LO_NHUNG) {
    if (nc.signal?.aborted) throw loiHuy();
    const lo = doan.slice(i, i + LO_NHUNG);
    const vecs = await nhungLoAnToan(nc, lo.map((d) => `${rel}\n${d.noiDung}`));
    if (nc.signal?.aborted) throw loiHuy();
    if (vecs.length !== lo.length) throw new LoiChiMucMa("BO_NHUNG_SAI_HOP_DONG", `chiMucMa: bộ nhúng trả ${vecs.length} vector cho ${lo.length} đoạn`);
    lo.forEach((d, j) => {
      const v = vecs[j]!;
      if (v.length !== SO_CHIEU_NHUNG) throw new LoiChiMucMa("BO_NHUNG_SAI_HOP_DONG", `chiMucMa: vector ${v.length} chiều, bảng cần ${SO_CHIEU_NHUNG}`);
      coVec.push({ ...d, vec: v });
    });
  }
  if (coVec.length === 0) {
    if (daLuu) await xoaTep(nc.db, nc.projectId, rel);
    return { loai: "nhung", soDoan: 0, catBot: doc.catBot };
  }
  await ghiTep(nc.db, nc.projectId, rel, bamTep, nc.bo.moHinh, coVec);
  return { loai: "nhung", soDoan: coVec.length, catBot: doc.catBot };
}

/** Lỗi "văn bản dài hơn ngữ cảnh" của node-llama-cpp (đo nguyên văn trên lượt dựng sống 2026-10-17). */
function laLoiQuaNguCanh(e: unknown): boolean {
  return /longer than the context size/i.test(String((e as { message?: unknown })?.message ?? e));
}

/**
 * Nhúng một lô; lô hỏng vì QUÁ NGỮ CẢNH ⇒ nhúng TỪNG đoạn, đoạn nào vẫn quá thì rút còn một nửa tới khi vừa (sàn 200 ký tự
 * — vẫn quá ⇒ ném). Lỗi KHÁC đi thẳng lên (tầng dựng bỏ qua cả tệp, không giết lượt dựng).
 */
async function nhungLoAnToan(nc: NguCanhTep, van: string[]): Promise<number[][]> {
  try {
    return await nc.bo.nhungTaiLieu(van, nc.signal);
  } catch (e) {
    if (!laLoiQuaNguCanh(e)) throw e;
  }
  const ra: number[][] = [];
  for (const t of van) {
    let x = t;
    for (;;) {
      if (nc.signal?.aborted) throw loiHuy();
      try {
        ra.push((await nc.bo.nhungTaiLieu([x], nc.signal))[0]!);
        break;
      } catch (e) {
        if (!laLoiQuaNguCanh(e) || x.length <= 200) throw e;
        x = x.slice(0, Math.floor(x.length / 2));
      }
    }
  }
  return ra;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DỰNG
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export interface TuyChonDung {
  tranTep?: number;
  tranByteTep?: number;
  tranDoan?: number;
  tranMs?: number;
}

export interface KetQuaDung {
  /**
   * Trạng thái lượt dựng đã chốt vào `ai_code_index_state` (mig 0395): `xong` ⇔ duyệt hết cây (kể cả `catBot` vì trần
   * CẤU TRÚC — dựng lại cũng ra y vậy); `do-dang` ⇔ hết trần THỜI GIAN (lượt sau đi tiếp); `loi` ⇔ quá nhiều tệp nhúng hỏng.
   */
  trangThai: "xong" | "do-dang" | "loi";
  soTep: number;
  soDoan: number;
  ms: number;
  /** Chạm một trần (tệp/byte/đoạn/thời gian/thư mục) — chỉ mục THIẾU một phần. */
  catBot: boolean;
  /** Số tệp phải nhúng (lại) trong lượt này. */
  soTepNhung: number;
  /** Số tệp đã bị xoá khỏi chỉ mục (tệp biến mất / bị bỏ qua). */
  soTepXoa: number;
}

const dangDung = new Map<string, { hua: Promise<KetQuaDung>; ac: AbortController }>();

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// TRẠNG THÁI LƯỢT DỰNG (mig 0395 `ai_code_index_state`, khoá dự án × model nhúng)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// ★★★ Đo sống 2026-10-17: "có hàng trong `ai_code_chunks`" ≠ "đã dựng trọn" — lượt dựng repo chính chết ở 393/~50.000
// đoạn và chỉ mục khai `san-sang` MÃI. Chỉ một bản ghi CHỐT lượt dựng mới cho phép nói `san-sang`.
//   • Lượt dựng ghi `dang-dung` lúc bắt đầu (kèm `tienTrinh` + `luot`), gõ nhịp `capNhat` mỗi `NHIP_DUNG_MS`, chốt
//     `xong`/`do-dang`/`loi` lúc kết thúc — chỉ lượt mang đúng `luot` được chốt hàng của nó.
//   • Hàng `dang-dung` mà KHÔNG có lượt nào chạy trong tiến trình này: của chính tiến trình này ⇒ mồ côi ngay; của tiến
//     trình khác ⇒ mồ côi khi mất nhịp quá `HAN_MO_COI_GIAY` (tiến trình chết / restart giữa chừng) — người đọc ghi
//     nó thành `do-dang` ⇒ `chua-co` ⇒ agent kích hoạt dựng lại (tệp không đổi băm được bỏ qua ⇒ đi tiếp rẻ).
//   • Bảng vắng (0395 chưa áp) ⇒ đọc = `chua-co`; ghi = bỏ qua. Không bao giờ quay về "có hàng là đủ".
type TrangThaiDung = "dang-dung" | "xong" | "do-dang" | "loi";

const NHIP_DUNG_MS = 30_000;
/** Mất nhịp quá chừng này (6 nhịp) ⇒ hàng `dang-dung` của tiến trình khác là mồ côi. */
export const HAN_MO_COI_GIAY = 180;
/** Lượt dựng có hơn tỉ lệ này số tệp nhúng hỏng ⇒ `loi` (bộ nhúng hỏng — không khai một chỉ mục rỗng là trọn). */
const TY_LE_TEP_LOI_TOI_DA = 0.05;
const TIEN_TRINH = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`.slice(0, 120);

function rutGonLoi(e: unknown): string {
  return redactSecretsAndPII(String((e as { message?: unknown })?.message ?? e))
    .text.replace(/\0/g, "")
    .slice(0, 480);
}

/** Ghi trạng thái là việc PHỤ của lượt dựng: hỏng ⇒ cảnh báo, không giết lượt dựng (mất nhịp ⇒ người đọc tự sửa). */
async function ghiTrangThaiAnToan(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (isMissingTable(e)) return;
    console.warn(`[chiMucMa] ghi trạng thái lượt dựng hỏng: ${rutGonLoi(e)}`);
  }
}

async function batDauTrangThai(db: Db, projectId: string, moHinh: string, luot: string): Promise<void> {
  await ghiTrangThaiAnToan(async () => {
    await db.execute(sql`
      INSERT INTO public.ai_code_index_state
        ("projectId", "moHinh", "trangThai", "batDau", "ketThuc", "soTep", "soDoan", "catBot", loi, "tienTrinh", luot, "capNhat")
      VALUES (${projectId}, ${moHinh}, 'dang-dung', now(), NULL, 0, 0, false, NULL, ${TIEN_TRINH}, ${luot}, now())
      ON CONFLICT ("projectId", "moHinh") DO UPDATE SET
        "trangThai" = 'dang-dung', "batDau" = now(), "ketThuc" = NULL, "soTep" = 0, "soDoan" = 0, "catBot" = false,
        loi = NULL, "tienTrinh" = EXCLUDED."tienTrinh", luot = EXCLUDED.luot, "capNhat" = now()`);
    // Lượt dựng bằng model này nhúng lại MỌI tệp (băm cùng, model khác) và THAY hàng của chúng ⇒ chỉ mục model khác
    // từng `xong` không còn trọn nữa.
    await db.execute(sql`
      UPDATE public.ai_code_index_state
         SET "trangThai" = 'do-dang', "ketThuc" = now(), "capNhat" = now(),
             loi = ${("chỉ mục đang được dựng lại bằng model nhúng " + moHinh).slice(0, 480)}
       WHERE "projectId" = ${projectId} AND "moHinh" <> ${moHinh} AND "trangThai" = 'xong'`);
  });
}

async function chotTrangThai(
  db: Db,
  projectId: string,
  moHinh: string,
  luot: string,
  tt: Exclude<TrangThaiDung, "dang-dung">,
  y: { soTep: number; soDoan: number; catBot: boolean; loi: string | null },
): Promise<void> {
  await ghiTrangThaiAnToan(() =>
    db.execute(sql`
      UPDATE public.ai_code_index_state
         SET "trangThai" = ${tt}, "ketThuc" = now(), "soTep" = ${y.soTep}, "soDoan" = ${y.soDoan}, "catBot" = ${y.catBot},
             loi = ${y.loi === null ? null : y.loi.slice(0, 480)}, "capNhat" = now()
       WHERE "projectId" = ${projectId} AND "moHinh" = ${moHinh} AND luot = ${luot}`),
  );
}

/**
 * Trạng thái lượt dựng đã ghi cho (dự án, model), sau khi xử lý mồ côi; `null` ⇔ không có bản ghi (kể cả di sản trước
 * 0395: có hàng đoạn mà chưa lượt nào chốt). Bảng vắng ⇒ ném (người gọi bắt `isMissingTable`).
 */
async function docTrangThaiDung(db: Db, projectId: string, moHinh: string): Promise<TrangThaiDung | null> {
  const rows = (await db.execute(sql`
    SELECT "trangThai", "tienTrinh", luot, ("capNhat" < now() - ${HAN_MO_COI_GIAY}::int * interval '1 second') AS "quaHan"
      FROM public.ai_code_index_state WHERE "projectId" = ${projectId} AND "moHinh" = ${moHinh}`)) as unknown as Array<{
    trangThai: TrangThaiDung;
    tienTrinh: string;
    luot: string;
    quaHan: boolean;
  }>;
  const h = rows[0];
  if (!h) return null;
  if (h.trangThai !== "dang-dung") return h.trangThai;
  if (dangDung.has(projectId)) return "dang-dung";
  if (!h.quaHan && h.tienTrinh !== TIEN_TRINH) return "dang-dung"; // tiến trình khác, còn nhịp ⇒ đang dựng thật
  const lyDo = h.quaHan
    ? `tiến trình dựng mất nhịp quá ${HAN_MO_COI_GIAY} s (chết / khởi động lại giữa chừng)`
    : "lượt dựng của chính tiến trình này không còn chạy";
  await ghiTrangThaiAnToan(() =>
    db.execute(sql`
      UPDATE public.ai_code_index_state SET "trangThai" = 'do-dang', "ketThuc" = "capNhat", loi = ${lyDo}
       WHERE "projectId" = ${projectId} AND "moHinh" = ${moHinh} AND luot = ${h.luot} AND "trangThai" = 'dang-dung'`),
  );
  return "do-dang";
}

async function dungThat(goc: string, projectId: string, ac: AbortController, tc: TuyChonDung): Promise<KetQuaDung> {
  const t0 = Date.now();
  const db = await getDb();
  if (!db) throw new DbUnavailableError("chiMucMa: không có kết nối CSDL");
  const bo = boNhung();
  if (bo.soChieu !== SO_CHIEU_NHUNG) throw new LoiChiMucMa("BO_NHUNG_SAI_HOP_DONG", `chiMucMa: bộ nhúng ${bo.soChieu} chiều, bảng cần ${SO_CHIEU_NHUNG}`);
  const moHinh = bo.moHinh;
  const luot = randomUUID();
  const tienDo = { soTep: 0, soDoan: 0 };
  await batDauTrangThai(db, projectId, moHinh, luot);
  const nhip = setInterval(() => {
    void ghiTrangThaiAnToan(() =>
      db.execute(sql`
        UPDATE public.ai_code_index_state SET "capNhat" = now(), "soTep" = ${tienDo.soTep}, "soDoan" = ${tienDo.soDoan}
         WHERE "projectId" = ${projectId} AND "moHinh" = ${moHinh} AND luot = ${luot} AND "trangThai" = 'dang-dung'`),
    );
  }, NHIP_DUNG_MS);
  nhip.unref?.();
  try {
    const kq = await duyetVaNhung(db, bo, goc, projectId, ac, tc, t0, tienDo);
    const tong = kq.soTep + kq.soTepLoi;
    const trangThai: KetQuaDung["trangThai"] =
      kq.soTepLoi > 0 && kq.soTepLoi > tong * TY_LE_TEP_LOI_TOI_DA ? "loi" : kq.hetGio ? "do-dang" : "xong";
    const loi =
      kq.soTepLoi > 0
        ? `bỏ qua ${kq.soTepLoi} tệp lỗi nhúng / ${tong} (vd ${kq.loiDau ?? "?"})`
        : kq.hetGio
          ? "chạm trần thời gian một lượt dựng — lượt sau đi tiếp"
          : null;
    await chotTrangThai(db, projectId, moHinh, luot, trangThai, { soTep: kq.soTep, soDoan: kq.soDoan, catBot: kq.catBot, loi });
    return {
      trangThai,
      soTep: kq.soTep,
      soDoan: kq.soDoan,
      ms: kq.ms,
      catBot: kq.catBot,
      soTepNhung: kq.soTepNhung,
      soTepXoa: kq.soTepXoa,
    };
  } catch (e) {
    const huy = ac.signal.aborted || (e as { name?: string })?.name === "AbortError";
    await chotTrangThai(db, projectId, moHinh, luot, huy ? "do-dang" : "loi", {
      ...tienDo,
      catBot: false,
      loi: huy ? "lượt dựng bị huỷ" : rutGonLoi(e),
    });
    throw e;
  } finally {
    clearInterval(nhip);
  }
}

async function duyetVaNhung(
  db: Db,
  bo: BoNhung,
  goc: string,
  projectId: string,
  ac: AbortController,
  tc: TuyChonDung,
  t0: number,
  tienDo: { soTep: number; soDoan: number },
): Promise<Omit<KetQuaDung, "trangThai"> & { soTepLoi: number; loiDau: string | null; hetGio: boolean }> {
  const hanChot = t0 + Math.max(1, tc.tranMs ?? TRAN_THOI_GIAN_DUNG_MS);
  const tranDoan = Math.max(1, tc.tranDoan ?? TRAN_DOAN_DU_AN);
  const boQua = napBoQuaGit(goc);

  const dt = duyetTepMa(goc, {
    tranTep: Math.max(1, Math.floor(tc.tranTep ?? TRAN_TEP_NGU_NGHIA)),
    hanChot,
    loc: laTepNguNghia,
    boQua,
    signal: ac.signal,
  });
  if (ac.signal.aborted) throw loiHuy();
  let catBot = dt.catBot;
  // Trần THỜI GIAN khác trần CẤU TRÚC (tệp/đoạn/byte/thư mục): dựng lại sẽ đi tiếp nhờ so băm ⇒ lượt này `do-dang`.
  let hetGio = dt.catBot && Date.now() >= hanChot;
  const daLuu = await bamDaLuu(db, projectId);
  const nc: NguCanhTep = { db, goc, projectId, bo, tranByte: Math.max(1, tc.tranByteTep ?? TRAN_BYTE_TEP_NGU_NGHIA), signal: ac.signal };

  let soTep = 0;
  let soDoan = 0;
  let soTepNhung = 0;
  let soTepLoi = 0;
  let loiDau: string | null = null;
  const daThay = new Set<string>();
  for (const rel of dt.tep) {
    if (ac.signal.aborted) throw loiHuy();
    if (Date.now() >= hanChot) {
      hetGio = true;
      catBot = true;
      break;
    }
    if (soDoan >= tranDoan) {
      catBot = true;
      break;
    }
    daThay.add(rel);
    // ★ Một tệp hỏng KHÔNG được giết cả lượt dựng (đo sống 2026-10-17: một đoạn quá ngữ cảnh ⇒ chỉ mục repo dừng ở 393).
    let kq: Awaited<ReturnType<typeof xuLyTep>>;
    try {
      kq = await xuLyTep(nc, rel, daLuu.get(rel));
    } catch (e) {
      if (ac.signal.aborted) throw e;
      soTepLoi++;
      loiDau ??= `${rel}: ${rutGonLoi(e).slice(0, 200)}`;
      if (soTepLoi <= 5) console.warn(`[chiMucMa] bỏ qua ${rel}: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
      continue;
    }
    if (kq.loai === "bo") continue;
    soTep++;
    soDoan += kq.soDoan;
    tienDo.soTep = soTep;
    tienDo.soDoan = soDoan;
    if (kq.loai === "nhung") {
      soTepNhung++;
      if (kq.catBot) catBot = true;
    }
  }

  // Dọn hàng của tệp KHÔNG được thấy lượt này: duyệt trọn ⇒ xoá hết; bị cắt ⇒ chỉ xoá tệp đã biến mất/bị loại
  // (tệp còn đó nhưng nằm ngoài trần giữ nguyên — không xoá chỉ mục cũ chỉ vì lượt này dừng sớm).
  let soTepXoa = 0;
  for (const duong of daLuu.keys()) {
    if (daThay.has(duong)) continue;
    const conHopLe =
      dauVetTep(goc, duong) !== null && laTepNguNghia(duong.split("/").pop() ?? "") && !(boQua?.(duong, false) ?? false);
    if (!catBot || !conHopLe) {
      await xoaTep(db, projectId, duong);
      soTepXoa++;
    }
  }
  return { soTep, soDoan, ms: Date.now() - t0, catBot, soTepNhung, soTepXoa, soTepLoi, loiDau, hetGio };
}

/**
 * Dựng TOÀN BỘ chỉ mục ngữ nghĩa của một dự án (xem đầu tệp). Lượt đang chạy cho cùng `projectId` ⇒ NHẬP vào nó.
 * `signal` huỷ ⇒ AbortError (hàng của tệp đã ghi xong vẫn giữ — lượt sau chỉ làm phần còn lại nhờ so băm).
 */
export async function dungChiMuc(
  y: { gocDuAn: string; projectId: string; signal?: AbortSignal } & TuyChonDung,
): Promise<KetQuaDung> {
  if (typeof y.projectId !== "string" || !RE_ID_DU_AN.test(y.projectId)) {
    throw new LoiChiMucMa("PROJECT_ID_KHONG_HOP_LE", `chiMucMa: projectId không hợp lệ (${JSON.stringify(y.projectId).slice(0, 80)})`);
  }
  const goc = gocHopLe(y.gocDuAn);
  if (goc === null) throw new LoiChiMucMa("GOC_KHONG_HOP_LE", "chiMucMa: gốc dự án phải là đường TUYỆT ĐỐI tới một thư mục tồn tại");
  phanGiaiDuAn(goc, y.projectId);

  const dang = dangDung.get(y.projectId);
  if (dang) return dang.hua;

  const ac = new AbortController();
  const huyNgoai = () => ac.abort();
  if (y.signal?.aborted) ac.abort();
  else y.signal?.addEventListener("abort", huyNgoai, { once: true });
  const hua = chayVoiUuTien("nen", () => dungThat(goc, y.projectId, ac, y)).finally(() => {
    y.signal?.removeEventListener("abort", huyNgoai);
    if (dangDung.get(y.projectId)?.hua === hua) dangDung.delete(y.projectId);
  });
  dangDung.set(y.projectId, { hua, ac });
  return hua;
}

/** Kích hoạt dựng NỀN (không chờ). Lỗi chỉ ghi log — lượt tìm sau sẽ lại thấy `chua-co` và thử lại. */
export function kichHoatDungNen(y: { gocDuAn: string; projectId: string }): void {
  if (dangDung.has(y.projectId)) return;
  dungChiMuc(y).catch((e: unknown) => {
    if ((e as { name?: string })?.name === "AbortError") return;
    console.warn(`[chiMucMa] dựng nền ${y.projectId} lỗi: ${e instanceof Error ? e.message : String(e)}`);
  });
}

/** Huỷ lượt dựng đang chạy của một dự án (nếu có). */
export function huyDungChiMuc(projectId: string): boolean {
  const d = dangDung.get(projectId);
  if (!d) return false;
  d.ac.abort();
  return true;
}

/** Chờ lượt dựng đang chạy (nếu có) kết thúc — không ném. Dùng ở lưới và khi tắt máy chủ. */
export async function choDungXong(projectId: string): Promise<void> {
  const d = dangDung.get(projectId);
  if (d) await d.hua.catch(() => undefined);
}

export function dangDungChiMuc(projectId: string): boolean {
  return dangDung.has(projectId);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// LÀM TƯƠI
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
/** Đường do người gọi đưa ⇒ tương đối POSIX trong gốc; `null` nếu thoát gốc / sai hình dạng. */
function relTrongGoc(goc: string, duong: unknown): string | null {
  if (typeof duong !== "string" || duong.trim() === "") return null;
  let rel = duong.trim();
  if (path.isAbsolute(rel)) {
    const r = path.relative(goc, path.resolve(rel));
    if (r === "" || r.startsWith("..") || path.isAbsolute(r)) return null;
    rel = r;
  }
  rel = chuanHoaRel(rel);
  return phanQuyetDuongDan(rel) === null ? rel : null;
}

/**
 * Làm tươi đúng các đường đưa vào (sau một lượt ghi của agent): đổi băm ⇒ nhúng lại; biến mất/bị loại ⇒ xoá khỏi
 * chỉ mục; không đổi ⇒ không làm gì. Chỉ mục chưa `xong` (chưa dựng / dở dang) ⇒ không làm gì (xem đầu tệp). Không
 * ném vì một đường xấu.
 */
export async function lamTuoiTep(y: { gocDuAn: string; duongs: string[]; projectId?: string; signal?: AbortSignal }): Promise<void> {
  const goc = gocHopLe(y.gocDuAn);
  if (goc === null || !Array.isArray(y.duongs) || y.duongs.length === 0) return;
  const projectId = phanGiaiDuAn(goc, y.projectId);
  const db = await getDb();
  if (!db) return;
  const bo = boNhung();
  // Chỉ làm tươi chỉ mục ĐÃ TRỌN (`xong` cho đúng model) hoặc đang dựng trong tiến trình này. Chỉ mục dở dang (có hàng
  // nhưng chưa chốt) ⇒ không làm gì: lượt dựng tiếp theo sẽ nhặt thay đổi nhờ so băm.
  if (!dangDung.has(projectId)) {
    try {
      if ((await docTrangThaiDung(db, projectId, bo.moHinh)) !== "xong") return;
    } catch (e) {
      if (isMissingTable(e)) return;
      throw e;
    }
  }

  const boQua = napBoQuaGit(goc);
  const nc: NguCanhTep = { db, goc, projectId, bo, tranByte: TRAN_BYTE_TEP_NGU_NGHIA, signal: y.signal };
  const daLuu = await bamDaLuu(db, projectId);
  const rels = [...new Set(y.duongs.map((d) => relTrongGoc(goc, d)).filter((r): r is string => r !== null))];
  await chayVoiUuTien("nen", async () => {
    for (const rel of rels) {
      if (y.signal?.aborted) throw loiHuy();
      const ten = rel.split("/").pop() ?? "";
      const hopLe = laTepNguNghia(ten) && dauVetTep(goc, rel) !== null && !(boQua?.(rel, false) ?? false);
      if (!hopLe) {
        if (daLuu.has(rel)) await xoaTep(db, projectId, rel);
        continue;
      }
      await xuLyTep(nc, rel, daLuu.get(rel));
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TRẠNG THÁI (tuỳ chọn trong hợp đồng — cầu nối agent dùng để chỉ dựng nền khi `chua-co`)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * `dang-dung` ⇔ có lượt dựng đang chạy (tiến trình này, hoặc tiến trình khác còn nhịp); `san-sang` ⇔ lượt dựng gần nhất
 * cho (dự án, model nhúng hiện hành) đã CHỐT `xong`; còn lại `chua-co` — kể cả CÓ hàng đoạn mà lượt dựng dở dang / lỗi /
 * mồ côi / di sản chưa chốt (đo sống: 393/~50.000 đoạn từng khai `san-sang` mãi), chưa áp mig 0391/0395, không có CSDL.
 * Không kích hoạt dựng — chỉ hỏi (có thể ghi một hàng `dang-dung` mồ côi thành `do-dang`).
 */
export async function trangThaiChiMuc(y: { gocDuAn: string; projectId?: string }): Promise<KetQuaTimMaNgu["trangThai"]> {
  const goc = gocHopLe(y.gocDuAn);
  if (goc === null) return "chua-co";
  const projectId = phanGiaiDuAn(goc, y.projectId);
  if (dangDung.has(projectId)) return "dang-dung";
  const db = await getDb();
  if (!db) return "chua-co";
  try {
    const tt = await docTrangThaiDung(db, projectId, boNhung().moHinh);
    return tt === "xong" ? "san-sang" : tt === "dang-dung" ? "dang-dung" : "chua-co";
  } catch (e) {
    if (isMissingTable(e)) return "chua-co";
    throw e;
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TÌM
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export interface KetQuaTimMaNgu {
  ketQua: Array<{ duong: string; dongDau: number; dongCuoi: number; doan: string; diem: number }>;
  trangThai: "san-sang" | "dang-dung" | "chua-co";
}

/**
 * Tìm theo nghĩa trong chỉ mục của DỰ ÁN (lọc `projectId` + `moHinh`). Chưa có hàng nào ⇒ `chua-co` NGAY + kích
 * hoạt dựng nền; đang dựng ⇒ trả kết quả trên phần đã có, `dang-dung`.
 *
 * QUYẾT ĐỊNH (mig 0395): CÓ hàng nhưng lượt dựng CHƯA chốt `xong` (dở dang / lỗi / mồ côi / di sản) ⇒ vẫn tìm trên phần
 * đã có (tốt hơn không gì), RỒI kích hoạt dựng nền, và khai `dang-dung` (agent thêm "kết quả có thể thiếu") — hoặc
 * `chua-co` nếu không dựng được. `san-sang` CHỈ khi đã `xong` và không có lượt dựng nào đang chạy. Tìm TRƯỚC khi kích
 * hoạt để kết quả không lẫn hàng do chính lượt vừa kích hoạt ghi giữa chừng.
 */
export async function timMaNgu(y: {
  gocDuAn: string;
  cauHoi: string;
  k?: number;
  signal?: AbortSignal;
  projectId?: string;
}): Promise<KetQuaTimMaNgu> {
  const chuaCo: KetQuaTimMaNgu = { ketQua: [], trangThai: "chua-co" };
  const goc = gocHopLe(y.gocDuAn);
  const cauHoi = typeof y.cauHoi === "string" ? y.cauHoi.trim().slice(0, 2_000) : "";
  if (goc === null || cauHoi === "") return chuaCo;
  const projectId = phanGiaiDuAn(goc, y.projectId);
  const db = await getDb();
  if (!db) return chuaCo;
  const bo = boNhung();
  const k = Math.max(1, Math.min(Math.floor(y.k ?? K_MAC_DINH), K_TOI_DA));

  let coHang: boolean;
  let tt: TrangThaiDung | null;
  try {
    const r = (await db.execute(sql`
      SELECT EXISTS (SELECT 1 FROM public.ai_code_chunks WHERE "projectId" = ${projectId} AND "moHinh" = ${bo.moHinh}) AS co`)) as unknown as Array<{ co: boolean }>;
    coHang = Boolean(r[0]?.co);
    tt = await docTrangThaiDung(db, projectId, bo.moHinh);
  } catch (e) {
    // mig 0391 chưa áp — không có gì để dựng vào; 0395 chưa áp — không nói được "trọn" ⇒ `chua-co` (agent kích hoạt dựng).
    if (isMissingTable(e)) return chuaCo;
    throw e;
  }
  const dang = dangDung.has(projectId) || tt === "dang-dung";
  if (!coHang) {
    if (dang) return { ketQua: [], trangThai: "dang-dung" };
    kichHoatDungNen({ gocDuAn: goc, projectId });
    return chuaCo;
  }

  if (y.signal?.aborted) throw loiHuy();
  const q = await bo.nhungCauHoi(cauHoi, y.signal);
  if (q.length !== SO_CHIEU_NHUNG) throw new LoiChiMucMa("BO_NHUNG_SAI_HOP_DONG", `chiMucMa: vector câu hỏi ${q.length} chiều, bảng cần ${SO_CHIEU_NHUNG}`);
  const qv = vecLiteral(q);
  const rows = (await db.execute(sql`
    SELECT duong, "dongDau", "dongCuoi", "noiDung", 1 - (embedding <=> ${qv}::vector) AS diem
    FROM public.ai_code_chunks
    WHERE "projectId" = ${projectId} AND "moHinh" = ${bo.moHinh}
    ORDER BY embedding <=> ${qv}::vector
    LIMIT ${k}`)) as unknown as Array<{ duong: string; dongDau: number; dongCuoi: number; noiDung: string; diem: number }>;
  let trangThai: KetQuaTimMaNgu["trangThai"] = dang ? "dang-dung" : "san-sang";
  if (tt !== "xong" && !dang) {
    kichHoatDungNen({ gocDuAn: goc, projectId });
    trangThai = dangDung.has(projectId) ? "dang-dung" : "chua-co";
  }
  return {
    ketQua: rows.map((r) => ({
      duong: r.duong,
      dongDau: Number(r.dongDau),
      dongCuoi: Number(r.dongCuoi),
      doan: r.noiDung.length > TRAN_KY_TU_KET_QUA ? r.noiDung.slice(0, TRAN_KY_TU_KET_QUA - 1) + "…" : r.noiDung,
      diem: Math.round(Number(r.diem) * 10_000) / 10_000,
    })),
    trangThai,
  };
}
