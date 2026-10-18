/**
 * ★★ Đợt 2 (2026-10-17) — `search_docs` của vòng agent: DÙNG LẠI truy hồi sẵn có, KHÔNG viết bộ tìm thứ hai, KHÔNG gọi LLM
 * sinh chữ (spec Đợt 2 §5).
 *
 * Nguồn (đọc mã, đo trước khi chọn):
 *   • `retrieveKnowledge(q, k, {route:"vscode", callerRole})` — nhánh LẬP TRÌNH (`retrieveProgrammingKnowledgeForVscode`):
 *     tài liệu hãng (`searchProgrammingKb`, ngưỡng 0,5 + cổng "câu hỏi phải nêu hãng") ∪ kho Training Studio (ngưỡng
 *     `MIN_STUDIO_CITATION_SCORE` 0,44, cổng vai `canAccessStudioCorpus` fail-closed). Nhánh này KHÔNG chạm kho vận hành
 *     và KHÔNG gọi `dichTruyVan` (chỉ nhánh web dịch câu hỏi bằng LLM) — chỉ một lượt nhúng câu hỏi.
 *     Chọn nhánh này chứ không phải nhánh web: câu hỏi của agent là câu hỏi LẬP TRÌNH; nhánh web giữ top‑1 dù yếu
 *     (MIN_CITATION_SCORE 0,18) — đúng thứ §5 cấm ("dưới ngưỡng ⇒ không thấy", không bịa).
 *   • `knowledge/api-ref/dotnet-using.json` — chỉ mục kiểu .NET ⇒ namespace (nguồn của `boSungUsingCSharp`): khớp
 *     NGUYÊN TỪ tên kiểu trong câu hỏi ⇒ một dòng "Type → using Namespace;". Tất định, không nhúng.
 *
 * Kết quả là DỮ LIỆU: bộ thực thi đưa qua `lamSachChoModel` (che bí mật + quét chỉ thị) và cắt trần như tool đọc khác.
 */
import fs from "node:fs";
import path from "node:path";

export type KhoTaiLieu = "all" | "vendor" | "studio" | "api";

export interface DoanTaiLieu {
  nguon: string;
  loai: "vendor" | "studio" | "api";
  diem: number;
  noiDung: string;
}

export interface KetQuaTimTaiLieu {
  doan: DoanTaiLieu[];
  /** kho đã thực sự tìm (để model nói thật "đã tìm ở đâu") */
  daTim: Array<"vendor" | "studio" | "api">;
}

export type TimTaiLieu = (y: { query: string; corpus: KhoTaiLieu; vaiTro: string; k?: number }) => Promise<KetQuaTimTaiLieu>;

/** Trần chữ mỗi đoạn trả về (đoạn corpus thường ~1–2k ký tự). */
const TRAN_KY_TU_MOI_DOAN = 2_000;
const SO_DOAN_MAC_DINH = 5;
/** Trần số khớp api-ref mỗi câu (một câu hỏi nêu vài kiểu là nhiều). */
const TRAN_KHOP_API = 8;

// ─── api-ref ─────────────────────────────────────────────────────────────────────────────────

interface ChiMucApi {
  nguon?: string[];
  kieu?: Record<string, string[]>;
}

let _api: ChiMucApi | null | undefined;

function napApiRef(): ChiMucApi | null {
  if (_api !== undefined) return _api;
  try {
    const p = path.join(process.cwd(), "knowledge", "api-ref", "dotnet-using.json");
    _api = fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as ChiMucApi) : null;
  } catch {
    _api = null;
  }
  return _api;
}

/** Khớp NGUYÊN TỪ tên kiểu .NET trong câu hỏi ⇒ đoạn "Type → using Ns;". Thuần trên chỉ mục truyền vào. */
export function timTrongApiRef(query: string, chiMuc: ChiMucApi | null): DoanTaiLieu[] {
  const kieu = chiMuc?.kieu;
  if (!kieu || typeof kieu !== "object") return [];
  const tu = new Set(String(query).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
  const ra: DoanTaiLieu[] = [];
  for (const t of tu) {
    if (t.length < 3) continue;
    const ns = Object.prototype.hasOwnProperty.call(kieu, t) ? kieu[t] : undefined;
    if (!Array.isArray(ns) || ns.length === 0) continue;
    ra.push({
      nguon: `api-ref: .NET (${(chiMuc?.nguon ?? []).join(", ") || "dotnet-using.json"})`,
      loai: "api",
      diem: 1,
      noiDung: `${t} → ${ns.map((n) => `using ${n};`).join(" or ")}`,
    });
    if (ra.length >= TRAN_KHOP_API) break;
  }
  return ra;
}

// ─── mặc định ────────────────────────────────────────────────────────────────────────────────

/** `search_docs` mặc định: api-ref (tất định) + nhánh lập trình của `retrieveKnowledge` (hãng ∪ Studio). Không ném. */
export const timTaiLieuMacDinh: TimTaiLieu = async ({ query, corpus, vaiTro, k }) => {
  const daTim: KetQuaTimTaiLieu["daTim"] = [];
  const doan: DoanTaiLieu[] = [];
  if (corpus === "all" || corpus === "api") {
    daTim.push("api");
    doan.push(...timTrongApiRef(query, napApiRef()));
  }
  if (corpus !== "api") {
    if (corpus === "all" || corpus === "vendor") daTim.push("vendor");
    if (corpus === "all" || corpus === "studio") daTim.push("studio");
    try {
      const { retrieveKnowledge } = await import("../../aiLocalKnowledgeService");
      const r = await retrieveKnowledge(query, k ?? SO_DOAN_MAC_DINH, { route: "vscode", callerRole: vaiTro });
      r.citations.forEach((c, i) => {
        const loai: DoanTaiLieu["loai"] = c.sourceType === "studio" || c.origin === "studio" ? "studio" : "vendor";
        if (corpus !== "all" && corpus !== loai) return;
        const noiDung = String(r.contexts[i] ?? "").trim();
        if (!noiDung) return;
        doan.push({ nguon: c.title || c.sourcePath, loai, diem: Number(c.score) || 0, noiDung: noiDung.slice(0, TRAN_KY_TU_MOI_DOAN) });
      });
    } catch (e) {
      console.warn("[agent/search_docs] truy hồi hỏng (trả phần đã có):", e instanceof Error ? e.message : String(e));
    }
  }
  return { doan, daTim };
};

/** Chỉ cho lưới. */
export function _datLaiApiRef(): void {
  _api = undefined;
}
