/**
 * ★ 2026-10-14 · Đợt 0.5 — CỔNG cho ĐƯỜNG LÙI OLLAMA: hỏi `/api/tags` TRƯỚC khi gọi một model.
 *
 * VÌ SAO: `aiLocalKnowledgeService` (và `aiImageEmbedding`) lùi sang Ollama khi GGUF hỏng/vắng, với
 * mặc định trong mã `qwen2.5:7b-instruct` / `mxbai-embed-large`. Khảo sát 7 tầng (2026-10-14) đo trên
 * máy dev: cả hai model ấy KHÔNG có trong Ollama ⇒ mỗi lượt lùi là một POST chắc chắn hỏng (404 hoặc
 * ECONNREFUSED) mà log không nói lý do — "lùi im lặng vào thứ không tồn tại". Bỏ mặc định thì phá chế
 * độ rollback `USE_LEGACY_OLLAMA=true` của người đang dựa vào nó; nên chọn cách KIỂM:
 *   • `/api/tags` (GET, rẻ) được hỏi một lần rồi ĐỆM `TTL_MS` theo `baseUrl`;
 *   • model vắng hoặc Ollama không trả lời ⇒ đường lùi KHÔNG gọi model, trả "không dùng được";
 *   • cảnh báo nêu ĐÍCH DANH model, biến env cần sửa, và danh sách model CÓ THẬT — một lần mỗi
 *     (baseUrl, model, lý do) trong `TTL_LOG_MS` để không spam log mỗi lượt hỏi.
 * Không thêm phụ thuộc: chỉ `fetch` toàn cục + `AbortSignal.timeout`.
 */

export type LyDoKiemOllama = "co" | "khong_co_model" | "khong_ket_noi";

export interface KetQuaKiemOllama {
  ok: boolean;
  lyDo: LyDoKiemOllama;
  /** Tên model Ollama đang có (rỗng khi không kết nối được). */
  danhSach: string[];
}

/** Đệm danh sách tags theo baseUrl — đủ ngắn để `ollama pull` xong là thấy trong một phút. */
const TTL_MS = 60_000;
/** Không lặp một cảnh báo y hệt quá một lần mỗi 10 phút. */
const TTL_LOG_MS = 10 * 60_000;
/** /api/tags là lời gọi cục bộ, rẻ; quá trần này coi như Ollama không trả lời. */
const TRAN_CHO_MS = 1_500;

const boDemTags = new Map<string, { luc: number; danhSach: string[] | null }>();
const daCanhBao = new Map<string, number>();

/** Đặt lại trạng thái module — CHỈ cho lưới. */
export function __datLaiOllamaLuiChoTest(): void {
  boDemTags.clear();
  daCanhBao.clear();
}

/**
 * Ollama coi `ten` không thẻ là `ten:latest`. Khớp ĐÚNG tên (không tiền tố, không bỏ thẻ khác):
 * `qwen3` KHÔNG khớp `qwen3:4b` — gọi `qwen3` khi chỉ có `qwen3:4b` vẫn hỏng.
 */
export function khopTenModelOllama(model: string, danhSach: readonly string[]): boolean {
  const m = model.trim();
  if (m === "") return false;
  const day = m.includes(":") ? m : `${m}:latest`;
  return danhSach.some((t) => t === m || t === day);
}

async function docTags(baseUrl: string): Promise<string[] | null> {
  const bay = Date.now();
  const dem = boDemTags.get(baseUrl);
  if (dem && bay - dem.luc < TTL_MS) return dem.danhSach;
  let danhSach: string[] | null = null;
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(TRAN_CHO_MS) });
    if (res.ok) {
      const j = (await res.json()) as { models?: Array<{ name?: unknown; model?: unknown }> };
      if (Array.isArray(j?.models)) {
        danhSach = j.models
          .flatMap((x) => [x?.name, x?.model])
          .filter((s): s is string => typeof s === "string" && s !== "");
      }
    }
  } catch {
    danhSach = null;
  }
  boDemTags.set(baseUrl, { luc: bay, danhSach });
  return danhSach;
}

/** Ollama tại `baseUrl` có `model` không. KHÔNG ném. */
export async function kiemModelOllama(baseUrl: string, model: string): Promise<KetQuaKiemOllama> {
  const ds = await docTags(baseUrl);
  if (ds === null) return { ok: false, lyDo: "khong_ket_noi", danhSach: [] };
  const uniq = Array.from(new Set(ds));
  return khopTenModelOllama(model, uniq)
    ? { ok: true, lyDo: "co", danhSach: uniq }
    : { ok: false, lyDo: "khong_co_model", danhSach: uniq };
}

/**
 * ★ Cổng dùng ở MỌI điểm lùi Ollama: `true` ⇔ được gọi model. `false` ⇒ người gọi trả "không có" (null
 * / ném lỗi rõ) như khi Ollama hỏng — nhưng nay có MỘT dòng log nói đúng vì sao.
 */
export async function ollamaDungDuoc(baseUrl: string, model: string, vaiTro: "qa" | "embed"): Promise<boolean> {
  const kq = await kiemModelOllama(baseUrl, model);
  if (kq.ok) return true;
  const khoa = `${baseUrl}|${model}|${kq.lyDo}`;
  const bay = Date.now();
  const lan = daCanhBao.get(khoa);
  if (lan === undefined || bay - lan >= TTL_LOG_MS) {
    daCanhBao.set(khoa, bay);
    const bien = vaiTro === "qa" ? "OLLAMA_QA_MODEL" : "OLLAMA_EMBED_MODEL";
    console.warn(
      kq.lyDo === "khong_co_model"
        ? `[ollamaLui] BỎ đường lùi Ollama (${vaiTro}): model "${model}" KHÔNG có trong ${baseUrl}/api/tags. ` +
            `Đặt ${bien} thành một model có thật hoặc 'ollama pull ${model}'. Đang có: ${kq.danhSach.join(", ") || "(trống)"}.`
        : `[ollamaLui] BỎ đường lùi Ollama (${vaiTro}): ${baseUrl}/api/tags không trả lời — Ollama không chạy? ` +
            `(model cấu hình: ${bien}="${model}").`,
    );
  }
  return false;
}
