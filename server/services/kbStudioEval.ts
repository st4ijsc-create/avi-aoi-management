/**
 * R1 (kế hoạch AI Local 2026-09-22 §4) — EVAL THẬT của Training Studio: bộ câu hỏi vàng × truy hồi
 * qua ĐÚNG đường sản xuất, chấm bằng máy, lưu theo lượt (`kb_eval_runs`, mig 0359).
 *
 * Hai tầng đo cho mỗi câu, không trộn:
 *   A. TRUY HỒI CORPUS (luôn chạy) — `embedQuestion` (hàm nhúng câu hỏi của trợ lý, export từ
 *      aiLocalKnowledgeService — không chép) → `searchCorpus(corpus, qVec, K)` (hàm Studio duy nhất
 *      mà `gatherStudioHits` gọi). Chấm: tệp kỳ vọng có trong top‑K (hạng, MRR), chunk trúng có qua
 *      `MIN_STUDIO_CITATION_SCORE` không, đáp án (regex) có trong văn bản top‑K không, câu ngoài
 *      corpus có bị chặn dưới ngưỡng không.
 *   B. ĐƯỜNG ỐNG THẬT (tuỳ chọn, `duongOng`) — `retrieveKnowledge(câu hỏi, 5, {callerRole})` nhánh
 *      web: thứ trợ lý THẬT SỰ trích dẫn sau khi trộn kho hệ thống + Studio + ngưỡng 0,18 + sắp lại.
 *      Trúng ⇔ một citation `studio:<corpus>:…` của tệp kỳ vọng nằm trong kết quả cuối. Tầng này trả
 *      lời câu người dùng thật sự hỏi: "tài liệu tôi nạp có tới được trợ lý không?".
 *
 * Không có bước sinh (LLM) ở bước đầu — đúng kế hoạch R1 ("không chấm bằng LLM ở bước đầu").
 *
 * ★ Không biết ≠ 0: câu hỏi nào không nhúng được (engine embed vắng) ⇒ CẢ lượt ghi
 *   `khong-do-duoc` + lý do, `tongHop` NULL. Một lượt nửa đo nửa không sẽ cho một tỷ lệ nhìn như thật.
 * ★ Bộ vàng có dòng lỗi ⇒ TỪ CHỐI chạy (thiết bị đo hỏng không được phát số).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { desc, eq, and } from "drizzle-orm";
import { getDb } from "../db/connection";
import { isMissingTable } from "../_core/dbErrors";
import { kbEvalRuns, type KbEvalRun } from "../../drizzle/schema/kbStudio";
import {
  phanTichBoVang,
  kiemDe,
  chamCau,
  tongHop,
  khopNguon,
  type KetQuaCau,
  type TongHopEval,
  type LoiBoVang,
} from "./kbStudioEvalCham";

export const THU_MUC_BO_VANG = path.join(process.cwd(), "knowledge", "studio-golden");
const TEN_BO_VANG = /^[a-z0-9][a-z0-9._-]{0,119}$/i;

export class KbEvalBoVangVangError extends Error {
  constructor(public readonly boVang: string) {
    super(`Không có bộ câu hỏi vàng "${boVang}" (knowledge/studio-golden/${boVang}.jsonl).`);
    this.name = "KbEvalBoVangVangError";
  }
}

export class KbEvalBoVangLoiError extends Error {
  constructor(public readonly boVang: string, public readonly loi: LoiBoVang[]) {
    super(`Bộ vàng "${boVang}" có ${loi.length} dòng lỗi — không chạy eval trên thiết bị đo hỏng.`);
    this.name = "KbEvalBoVangLoiError";
  }
}

export class KbEvalDangChayError extends Error {
  constructor() {
    super("Đang có một lượt eval chạy — chờ lượt đó xong.");
    this.name = "KbEvalDangChayError";
  }
}

export class KbEvalBangVangError extends Error {
  constructor() {
    super('kb_eval_runs chưa migrate (chạy "node scripts/apply-migration-0359.mjs" bằng owner "aoi").');
    this.name = "KbEvalBangVangError";
  }
}

export interface BoVangTomTat {
  ten: string;
  soCauTrong: number;
  soCauNgoai: number;
  soDongLoi: number;
  /** sha1 rút gọn của tệp — lượt eval ghi kèm, nên hai lượt khác bộ đề không bị so như cùng thước. */
  hash: string;
}

function bamBoVang(noiDung: string): string {
  return crypto.createHash("sha1").update(noiDung).digest("hex").slice(0, 16);
}

function docTepBoVang(ten: string): string {
  if (!TEN_BO_VANG.test(ten)) throw new KbEvalBoVangVangError(ten);
  const p = path.join(THU_MUC_BO_VANG, `${ten}.jsonl`);
  if (!fs.existsSync(p)) throw new KbEvalBoVangVangError(ten);
  return fs.readFileSync(p, "utf8");
}

export function listBoVang(): BoVangTomTat[] {
  if (!fs.existsSync(THU_MUC_BO_VANG)) return [];
  return fs
    .readdirSync(THU_MUC_BO_VANG)
    .filter((f) => f.endsWith(".jsonl") && TEN_BO_VANG.test(f.slice(0, -6)))
    .sort()
    .map((f) => {
      const noiDung = fs.readFileSync(path.join(THU_MUC_BO_VANG, f), "utf8");
      const r = phanTichBoVang(noiDung);
      return {
        ten: f.slice(0, -6),
        soCauTrong: r.cau.filter((c) => c.nguon.length > 0).length,
        soCauNgoai: r.cau.filter((c) => c.nguon.length === 0).length,
        soDongLoi: r.loi.length,
        hash: bamBoVang(noiDung),
      };
    });
}

export interface ChayEvalInput {
  corpus: string;
  /** Mặc định = tên corpus. Tách ra để chạy bộ vàng của corpus X trên corpus Y (fake‑bad: corpus rỗng). */
  boVang?: string;
  k?: number;
  duongOng?: boolean;
  callerRole?: string;
  userId?: number;
}

let dangChay = false;

function tenEmbedModel(): string {
  return path.basename(process.env.GGUF_EMBED_MODEL || "mxbai-embed-large-v1-f16.gguf");
}

export async function chayEval(input: ChayEvalInput): Promise<KbEvalRun> {
  const corpus = input.corpus.trim();
  const boVang = (input.boVang ?? corpus).trim();
  const k = Math.max(1, Math.min(input.k ?? 5, 20));
  const tangDuongOng = input.duongOng ?? true;

  const noiDung = docTepBoVang(boVang);
  const bo = phanTichBoVang(noiDung);
  if (bo.loi.length > 0) throw new KbEvalBoVangLoiError(boVang, bo.loi);

  if (dangChay) throw new KbEvalDangChayError();
  dangChay = true;
  const t0 = Date.now();
  try {
    const db = await getDb();
    if (!db) throw new KbEvalBangVangError();

    const { listCorpusChunksForTraining, listCorpora } = await import("./kbStudioService");
    const { searchCorpus } = await import("./kbVectorStore");
    const { embedQuestion, retrieveKnowledge, MIN_STUDIO_CITATION_SCORE } = await import("./aiLocalKnowledgeService");

    const tatCa = (await listCorpusChunksForTraining(corpus, 20000)).chunks;
    const soNguon = new Set(tatCa.map((c) => c.sourceRef)).size;
    const dk = (await listCorpora()).corpora.find((c) => c.name === corpus);
    const lanNapCuoi = dk?.lastIngestAt ?? null;

    const ketQua: KetQuaCau[] = [];
    let lyDoKhongDo: string | null = null;
    for (const cau of bo.cau) {
      const qVec = await embedQuestion(cau.cauHoi);
      if (!qVec) {
        lyDoKhongDo = `Không nhúng được câu hỏi "${cau.id}" — engine embedding (${tenEmbedModel()}) không sẵn sàng.`;
        break;
      }
      const hits = await searchCorpus(corpus, qVec, k);
      let duongOng: boolean | null = null;
      let duongOngBatKy: boolean | null = null;
      let trichDan: KetQuaCau["trichDan"] = [];
      if (tangDuongOng) {
        const r = await retrieveKnowledge(cau.cauHoi, 5, { callerRole: input.callerRole });
        const laCuaCorpus = (id: string) => id.startsWith(`studio:${corpus}:`);
        const cuaCorpus = r.citations.filter((c) => laCuaCorpus(c.id));
        duongOng =
          cau.nguon.length === 0
            ? cuaCorpus.length === 0
            : cuaCorpus.some((c) => khopNguon(c.sourcePath, cau.nguon));
        duongOngBatKy = cau.nguon.length === 0 ? null : r.citations.some((c) => khopNguon(c.sourcePath, cau.nguon));
        trichDan = r.citations.map((c) => ({ sourcePath: c.sourcePath, score: c.score, studio: laCuaCorpus(c.id) }));
      }
      ketQua.push(
        chamCau(cau, hits, { nguong: MIN_STUDIO_CITATION_SCORE, de: kiemDe(cau, tatCa), duongOng, duongOngBatKy, trichDan }),
      );
    }

    const hang = {
      corpus,
      boVang,
      trangThai: (lyDoKhongDo ? "khong-do-duoc" : "xong") as "xong" | "khong-do-duoc",
      lyDo: lyDoKhongDo,
      k,
      nguong: MIN_STUDIO_CITATION_SCORE,
      tangDuongOng,
      soChunk: tatCa.length,
      soNguon,
      lanNapCuoi,
      embedModel: tenEmbedModel(),
      boVangHash: bamBoVang(noiDung),
      tongHop: lyDoKhongDo ? null : (tongHop(ketQua) as TongHopEval),
      ketQua,
      msTong: Date.now() - t0,
      createdBy: input.userId ?? null,
    };
    try {
      const [row] = await db.insert(kbEvalRuns).values(hang).returning();
      return row!;
    } catch (e) {
      if (isMissingTable(e)) throw new KbEvalBangVangError();
      throw e;
    }
  } finally {
    dangChay = false;
  }
}

export interface ListEvalRunsResult {
  tableAvailable: boolean;
  /** Không kèm `ketQua` (nặng) — lấy chi tiết một lượt qua {@link getEvalRun}. */
  runs: Array<Omit<KbEvalRun, "ketQua">>;
}

export async function listEvalRuns(corpus: string, limit = 30): Promise<ListEvalRunsResult> {
  const db = await getDb();
  if (!db) return { tableAvailable: false, runs: [] };
  try {
    const rows = await db
      .select({
        id: kbEvalRuns.id,
        corpus: kbEvalRuns.corpus,
        boVang: kbEvalRuns.boVang,
        trangThai: kbEvalRuns.trangThai,
        lyDo: kbEvalRuns.lyDo,
        k: kbEvalRuns.k,
        nguong: kbEvalRuns.nguong,
        tangDuongOng: kbEvalRuns.tangDuongOng,
        soChunk: kbEvalRuns.soChunk,
        soNguon: kbEvalRuns.soNguon,
        lanNapCuoi: kbEvalRuns.lanNapCuoi,
        embedModel: kbEvalRuns.embedModel,
        boVangHash: kbEvalRuns.boVangHash,
        tongHop: kbEvalRuns.tongHop,
        msTong: kbEvalRuns.msTong,
        createdBy: kbEvalRuns.createdBy,
        createdAt: kbEvalRuns.createdAt,
      })
      .from(kbEvalRuns)
      .where(eq(kbEvalRuns.corpus, corpus.trim()))
      .orderBy(desc(kbEvalRuns.createdAt))
      .limit(Math.max(1, Math.min(limit, 200)));
    return { tableAvailable: true, runs: rows };
  } catch (e) {
    if (isMissingTable(e)) return { tableAvailable: false, runs: [] };
    throw e;
  }
}

export async function getEvalRun(id: number, corpus: string): Promise<KbEvalRun | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select()
      .from(kbEvalRuns)
      .where(and(eq(kbEvalRuns.id, id), eq(kbEvalRuns.corpus, corpus.trim())))
      .limit(1);
    return row ?? null;
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}
