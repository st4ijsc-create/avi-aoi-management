/**
 * R1 (kế hoạch 2026-09-22 §4) — PHẦN CHẤM THUẦN của eval Training Studio: đọc bộ câu hỏi vàng,
 * chấm từng câu trên kết quả truy hồi, gộp thành tỷ lệ. Không I/O, không model — để lưới khoá
 * được CÁCH CHẤM độc lập với đường ống (đường ống ở `kbStudioEval.ts`).
 *
 * Bộ vàng: `knowledge/studio-golden/<tên>.jsonl`, mỗi dòng một câu:
 *   { "id", "cauHoi", "nguon": ["tệp.md", …], "dapAn"?: { "regex", "flags"? } }
 *   · `nguon` KHÁC rỗng = câu TRONG corpus: trúng khi một chunk của tệp kỳ vọng nằm trong top‑K.
 *   · `nguon` RỖNG     = câu NGOÀI corpus: đúng khi KHÔNG chunk nào qua ngưỡng trích dẫn — đo
 *     chính cái ngưỡng, thứ quyết định nhiễu có lọt vào prompt hay không.
 *   · `dapAn.regex` chấm bằng MÁY trên văn bản các chunk top‑K ("đáp án có trong ngữ cảnh") — không
 *     chấm bằng LLM ở bước đầu (kế hoạch R1).
 *
 * ★ Ba trạng thái, không gộp:
 *   - câu HỎNG: tệp kỳ vọng CÓ trong corpus nhưng regex không khớp BẤT KỲ chunk nào của nó ⇒ lỗi
 *     của BỘ ĐO (đề sai), không phải của truy hồi ⇒ loại khỏi mẫu số và báo riêng. Không có cơ chế
 *     này, một regex gõ sai sẽ hiện thành "RAG kém" — đúng lớp "thiết bị đo tự sinh giả".
 *   - tệp kỳ vọng VẮNG khỏi corpus ⇒ trượt THẬT (corpus thiếu tài liệu) — nhờ vậy corpus rỗng
 *     (`fake-bad`) ra 0 %, không ra "không đo được".
 *   - mẫu số 0 ⇒ `null` ("không biết"), không bao giờ 0.
 */
import { z } from "zod";

export const CauVangSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    cauHoi: z.string().trim().min(3).max(1000),
    nguon: z.array(z.string().trim().min(1).max(500)).max(20),
    dapAn: z
      .object({
        regex: z.string().min(1).max(500),
        flags: z.string().regex(/^[imsu]*$/).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CauVang = z.infer<typeof CauVangSchema>;

export interface LoiBoVang {
  dong: number;
  lyDo: string;
}

export interface BoVangDaDoc {
  cau: CauVang[];
  loi: LoiBoVang[];
}

/** Đọc JSONL; dòng trống/`//` bỏ qua. Mọi dòng lỗi được KỂ RA (số dòng + lý do), không nuốt. */
export function phanTichBoVang(noiDung: string): BoVangDaDoc {
  const cau: CauVang[] = [];
  const loi: LoiBoVang[] = [];
  const daThay = new Set<string>();
  const dong = noiDung.split(/\r?\n/);
  for (let i = 0; i < dong.length; i++) {
    const s = dong[i].trim();
    if (!s || s.startsWith("//")) continue;
    let tho: unknown;
    try {
      tho = JSON.parse(s);
    } catch {
      loi.push({ dong: i + 1, lyDo: "JSON không hợp lệ" });
      continue;
    }
    const kq = CauVangSchema.safeParse(tho);
    if (!kq.success) {
      loi.push({ dong: i + 1, lyDo: kq.error.issues.map((x) => `${x.path.join(".") || "(dòng)"}: ${x.message}`).join("; ") });
      continue;
    }
    const c = kq.data;
    if (daThay.has(c.id)) {
      loi.push({ dong: i + 1, lyDo: `id trùng "${c.id}"` });
      continue;
    }
    if (c.nguon.length === 0 && c.dapAn) {
      loi.push({ dong: i + 1, lyDo: "câu ngoài corpus (nguon rỗng) không được có dapAn" });
      continue;
    }
    if (c.dapAn) {
      try {
        new RegExp(c.dapAn.regex, c.dapAn.flags ?? "i");
      } catch (e) {
        loi.push({ dong: i + 1, lyDo: `regex không biên dịch được: ${(e as Error).message}` });
        continue;
      }
    }
    daThay.add(c.id);
    cau.push(c);
  }
  return { cau, loi };
}

function tenTep(p: string): string {
  const s = p.replace(/\\/g, "/");
  return s.slice(s.lastIndexOf("/") + 1).toLowerCase();
}

/** Khớp theo TÊN TỆP, không phân biệt hoa thường — `sourceRef` là tên lúc nạp, có thể kèm thư mục. */
export function khopNguon(sourceRef: string, nguon: readonly string[]): boolean {
  const t = tenTep(sourceRef);
  return nguon.some((n) => tenTep(n) === t);
}

export function chamDapAn(vanBan: string, dapAn: NonNullable<CauVang["dapAn"]>): boolean {
  return new RegExp(dapAn.regex, dapAn.flags ?? "i").test(vanBan);
}

export interface ChunkCorpus {
  sourceRef: string;
  text: string;
}

export type TinhTrangDe = "ok" | "hong" | "vang-tep";

/**
 * Kiểm ĐỀ trên toàn bộ corpus (không phải top‑K): tệp kỳ vọng có mặt không, và nếu có thì đáp án
 * có nằm trong một chunk của nó không. `hong` = lỗi bộ đo, loại khỏi mẫu số.
 */
export function kiemDe(cau: CauVang, tatCa: readonly ChunkCorpus[]): TinhTrangDe {
  if (cau.nguon.length === 0) return "ok";
  const cuaNguon = tatCa.filter((c) => khopNguon(c.sourceRef, cau.nguon));
  if (cuaNguon.length === 0) return "vang-tep";
  if (!cau.dapAn) return "ok";
  return cuaNguon.some((c) => chamDapAn(c.text, cau.dapAn!)) ? "ok" : "hong";
}

export interface HitTruyHoi {
  sourceRef: string;
  text: string;
  score: number;
}

export interface KetQuaCau {
  id: string;
  cauHoi: string;
  loai: "trong" | "ngoai";
  de: TinhTrangDe;
  /** Hạng (1‑based) của chunk ĐẦU TIÊN thuộc tệp kỳ vọng trong top‑K; null = không có. */
  hangNguon: number | null;
  diemNguon: number | null;
  /** Chunk trúng đó có qua ngưỡng trích dẫn (tức là thật sự tới được prompt) không. */
  quaNguong: boolean;
  /** null khi câu không có `dapAn`. */
  dapAnNguCanh: boolean | null;
  top1: { sourceRef: string; score: number } | null;
  /** Chỉ cho câu ngoài corpus: top1 dưới ngưỡng. */
  tuChoiDung: boolean | null;
  /** Tầng "đường ống thật" (retrieveKnowledge): trích dẫn cuối có đoạn của tệp kỳ vọng TỪ CORPUS NÀY.
   * null = không chạy tầng này. */
  duongOng: boolean | null;
  /** Cùng tầng, nhưng tệp kỳ vọng tới từ BẤT KỲ kho nào (kho hệ thống có thể giữ bản sao cùng tên).
   * Tách hai số để phân biệt "tài liệu nạp bị lấn át bởi bản sao hệ thống" với "trợ lý không có nguồn
   * đúng". null = không chạy tầng / câu ngoài corpus. */
  duongOngBatKy: boolean | null;
  /** Trích dẫn cuối trợ lý thật sự dùng (gọn) — để người đọc thấy CÁI GÌ đã thắng chỗ. */
  trichDan: Array<{ sourcePath: string; score: number; studio: boolean }>;
  /** Hit gọn để hiện trên bảng (không kèm văn bản đầy đủ). */
  hits: Array<{ sourceRef: string; score: number }>;
}

export function chamCau(
  cau: CauVang,
  hits: readonly HitTruyHoi[],
  opts: {
    nguong: number;
    de: TinhTrangDe;
    duongOng?: boolean | null;
    duongOngBatKy?: boolean | null;
    trichDan?: KetQuaCau["trichDan"];
  },
): KetQuaCau {
  const loai = cau.nguon.length === 0 ? "ngoai" : "trong";
  const top1 = hits[0] ? { sourceRef: hits[0].sourceRef, score: hits[0].score } : null;
  const gon = hits.map((h) => ({ sourceRef: h.sourceRef, score: h.score }));
  if (loai === "ngoai") {
    return {
      id: cau.id,
      cauHoi: cau.cauHoi,
      loai,
      de: opts.de,
      hangNguon: null,
      diemNguon: null,
      quaNguong: false,
      dapAnNguCanh: null,
      top1,
      tuChoiDung: !(top1 && top1.score >= opts.nguong),
      duongOng: opts.duongOng ?? null,
      duongOngBatKy: null,
      trichDan: opts.trichDan ?? [],
      hits: gon,
    };
  }
  const idx = hits.findIndex((h) => khopNguon(h.sourceRef, cau.nguon));
  const trung = idx >= 0 ? hits[idx] : null;
  return {
    id: cau.id,
    cauHoi: cau.cauHoi,
    loai,
    de: opts.de,
    hangNguon: trung ? idx + 1 : null,
    diemNguon: trung ? trung.score : null,
    quaNguong: !!trung && trung.score >= opts.nguong,
    dapAnNguCanh: cau.dapAn ? chamDapAn(hits.map((h) => h.text).join("\n\n"), cau.dapAn) : null,
    top1,
    tuChoiDung: null,
    duongOng: opts.duongOng ?? null,
    duongOngBatKy: opts.duongOngBatKy ?? null,
    trichDan: opts.trichDan ?? [],
    hits: gon,
  };
}

export interface TongHopEval {
  soCau: number;
  soCauTrong: number;
  soCauNgoai: number;
  /** Câu trong corpus có đề hỏng — đã loại khỏi mọi mẫu số dưới đây. */
  soCauHong: number;
  /** Các tỷ lệ 0..1; null = mẫu số 0 (không biết, không phải 0). */
  trungNguon: number | null;
  mrr: number | null;
  quaNguong: number | null;
  dapAnNguCanh: number | null;
  duongOng: number | null;
  duongOngBatKy: number | null;
  tuChoiDung: number | null;
}

function tyLe(tu: number, mau: number): number | null {
  return mau > 0 ? tu / mau : null;
}

export function tongHop(kq: readonly KetQuaCau[]): TongHopEval {
  const trong = kq.filter((k) => k.loai === "trong");
  const hopLe = trong.filter((k) => k.de !== "hong");
  const ngoai = kq.filter((k) => k.loai === "ngoai");
  const coDapAn = hopLe.filter((k) => k.dapAnNguCanh !== null);
  const coOng = hopLe.filter((k) => k.duongOng !== null);
  const coOngBatKy = hopLe.filter((k) => k.duongOngBatKy !== null);
  return {
    soCau: kq.length,
    soCauTrong: trong.length,
    soCauNgoai: ngoai.length,
    soCauHong: trong.length - hopLe.length,
    trungNguon: tyLe(hopLe.filter((k) => k.hangNguon !== null).length, hopLe.length),
    mrr: hopLe.length > 0 ? hopLe.reduce((s, k) => s + (k.hangNguon ? 1 / k.hangNguon : 0), 0) / hopLe.length : null,
    quaNguong: tyLe(hopLe.filter((k) => k.quaNguong).length, hopLe.length),
    dapAnNguCanh: tyLe(coDapAn.filter((k) => k.dapAnNguCanh).length, coDapAn.length),
    duongOng: tyLe(coOng.filter((k) => k.duongOng).length, coOng.length),
    duongOngBatKy: tyLe(coOngBatKy.filter((k) => k.duongOngBatKy).length, coOngBatKy.length),
    tuChoiDung: tyLe(ngoai.filter((k) => k.tuChoiDung).length, ngoai.length),
  };
}
