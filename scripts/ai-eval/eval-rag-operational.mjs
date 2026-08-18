#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * EVAL RAG VẬN HÀNH — LUẬT HIT CHẶT, có precision@5 / MRR / nDCG@10 / recall@5.
 * G0 phần A, nhiệm vụ 2.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHÔNG DÙNG `scripts/ai-kb/eval-rag.mjs` NỮA: THƯỚC ẤY ĐÃ BÃO HOÀ.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `knowledge/rag-eval-results.json` báo **recall@5 = 151/151 = 1,000** suốt 7 lần chạy. Đọc kỹ
 * luật hit của nó (`scripts/ai-kb/eval-rag.mjs:195-201`):
 *
 *     srcOk = expectSourceContains.some(s => sourcePath.INCLUDES(s))   // "order", "production"…
 *     kwOk  = expectKeywords.some(k => text.INCLUDES(k))
 *     hit   = srcOk || kwOk
 *
 * Hai chỗ hỏng, và chúng CỘNG DỒN:
 *   1. **Khớp CHUỖI CON trên đường dẫn.** Mong đợi "order" khớp `productionOrdersRouter.ts`,
 *      `workOrderService.ts`, `orderBy`… Trên kho **7.306 chunk** (golden set cũ dựng khi kho mới
 *      có 2.170) thì gần như MỌI truy vấn đều tìm được một đường dẫn chứa từ ấy.
 *   2. **`||` với từ khoá trong TEXT.** Chỉ cần một chunk bất kỳ chứa từ "OEE" là TRÚNG — kể cả
 *      khi nó là mã nguồn của router chứ không phải tài liệu trả lời được câu hỏi.
 *   ⇒ 1,000 không phải "kho tốt", nó là **"thước không phân biệt được tốt với hỏng"**. Một thước
 *      như vậy KHÔNG BAO GIỜ đỏ được, nên nó không canh gì cả.
 *
 * ★ LUẬT HIT Ở ĐÂY: một chunk TRÚNG **khi và chỉ khi** `sourcePath` **BẰNG ĐÚNG** một mục trong
 *   `expectPaths`, **hoặc** bắt đầu bằng một mục trong `expectPrefixes` (phải kết thúc bằng "/").
 *   **CẤM** khớp chuỗi con, **CẤM** khớp theo từ khoá trong text. So khớp sau khi chuẩn hoá "\" → "/".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * CHỈ SỐ (mỗi cái trả lời một câu hỏi KHÁC nhau — đó là lý do có bốn cái, không phải một)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   hitRateAt5    — có ÍT NHẤT MỘT chunk đúng trong top-5. Cùng ĐỊNH NGHĨA với "recall@5" của bộ
 *                   cũ (nên so sánh trực tiếp được), chỉ khác ở chỗ luật hit nay chặt.
 *   precisionAt5  — |chunk đúng ∩ top-5| / 5. *"Trong 5 đoạn nhét vào ngữ cảnh LLM, mấy đoạn đáng?"*
 *                   Đây là chỉ số trực tiếp lái CHẤT LƯỢNG CÂU TRẢ LỜI; hitRate thì không.
 *   mrr           — 1/thứ hạng của chunk đúng ĐẦU TIÊN (quét trong top-`--mrr-window`, mặc định 50;
 *                   0 nếu không có). Đo ĐỘ ĐÚNG CỦA THỨ TỰ — thứ reranker sinh ra để sửa.
 *   ndcgAt10      — nDCG nhị phân trên top-10, IDCG lý tưởng = min(10, R). Vừa nhìn thứ tự vừa
 *                   nhìn số lượng.
 *   recallAt5     — |chunk đúng ∩ top-5| / R, với R = TỔNG số chunk đúng CÓ THẬT trong kho.
 *                   ⚠ Trần của nó là 5/R: một tài liệu 12 chunk thì recall@5 KHÔNG THỂ quá 0,42.
 *                   Ghi ở đây để không ai đọc số thấp thành "retrieval hỏng". `recallAt5Capped`
 *                   (chia cho min(5,R)) là bản đã bỏ trần ấy.
 *   distractorAboveRate — tỉ lệ ca có ≥1 tài liệu NHIỄU đứng TRÊN tài liệu đúng đầu tiên. Chỉ số
 *                   này KHÔNG suy ra được từ recall, và là thứ duy nhất ở đây đo được "hệ có bị
 *                   tài liệu gần giống dắt đi sai không".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `--rerank` VÀ `--graph`: LẦN ĐẦU GHI ĐƯỢC **LIFT**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `knowledge/rag-eval-results.json` để `reranked: null` và `graphRag: null` **suốt 7 lần chạy** —
 * nghĩa là chưa từng có phép đo nào nói hai cơ chế ấy có ích hay không, dù `RAG_RERANKER_ENABLED`
 * và `KB_GRAPHRAG_ENABLED` đều đang **BẬT** trong `.env`.
 *   --rerank  → chấm lại top-`--pool` bằng model text (cùng prompt với `server/services/aiReranker.ts`),
 *               rồi in lift của CẢ BỐN chỉ số. Cổng `RAG_RERANKER_ENABLED` được tôn trọng như
 *               production; `--force-rerank` bỏ qua cổng.
 *   --graph   → gọi **HÀM SẢN PHẨM THẬT** `loadSemanticGraph`/`expandWithGraph`
 *               (`server/services/aiSemanticGraph.ts`) — không phải bản chép lại.
 *
 * ⚠ CẢ HAI ĐỀU **KHÔNG BAO GIỜ IM LẶNG**: xin đo mà không đo được thì in khối `✗ KHÔNG ĐO ĐƯỢC`
 *   kèm lý do, ghi `available:false` + `reason` vào report, và `--ci` coi đó là **THẤT BẠI**.
 *   (Cùng lớp lỗi "glob rỗng ⇒ cổng khai xanh" repo này đã dính.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * CÁCH CHẠY  (cần model NHÚNG cho mọi lượt đo thật; `--selfcheck` thì KHÔNG)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   node scripts/ai-eval/eval-rag-operational.mjs --selfcheck     # KHÔNG nạp model
 *   node scripts/ai-eval/eval-rag-operational.mjs                 # baseline cosine (nạp model nhúng)
 *   node scripts/ai-eval/eval-rag-operational.mjs --rerank        # + lift reranker (nạp thêm model text)
 *   node scripts/ai-eval/eval-rag-operational.mjs --graph         # + lift GraphRAG (không cần model text)
 *   GGUF_GPU=false node scripts/ai-eval/eval-rag-operational.mjs  # ép CPU (khi GPU đang bận)
 *
 * ⚠ `GGUF_EMBED_MODEL` **PHẢI** khớp `knowledge/embeddings-meta.json.model`. Lệch model ⇒ vector
 *   truy vấn rơi vào một KHÔNG GIAN KHÁC và mọi con số dưới đây là rác. Harness tự đối chiếu và
 *   **THOÁT 1** khi lệch (không cảnh báo suông rồi vẫn in bảng đẹp).
 *
 * CỜ: --k N · --pool N · --mrr-window N · --limit N · --only <id> · --domain <d> · --label <tên> ·
 *     --cases <path> · --out <dir> · --rerank/--force-rerank/--no-rerank · --graph · --ci ·
 *     --min <float> · --selfcheck · --quiet
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KDIR = path.join(ROOT, "knowledge");
const EMB_FILE = path.join(KDIR, "embeddings.jsonl");
const CHUNKS_FILE = path.join(KDIR, "chunks.jsonl");
const META_FILE = path.join(KDIR, "embeddings-meta.json");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const SELFCHECK = has("--selfcheck");
const TOP_K = Number(val("--k", "5"));
const NDCG_K = 10;
const POOL = Number(val("--pool", process.env.RAG_RERANKER_POOL ?? "20"));
const MRR_WINDOW = Number(val("--mrr-window", "50"));
const LIMIT = Number(val("--limit", "0")) || 0;
const ONLY = val("--only", null);
const DOMAIN = val("--domain", null);
const LABEL = val("--label", new Date().toISOString().slice(0, 10));
const CASES_FILE = path.resolve(val("--cases", path.join(HERE, "rag-operational-cases.json")));
const OUT_DIR = path.resolve(val("--out", path.join(HERE, "reports")));
const DO_CI = has("--ci");
const CI_MIN = Number(val("--min", "0.70"));
const QUIET = has("--quiet");

const RERANKER_ENABLED = /^(1|true|yes|on)$/i.test(process.env.RAG_RERANKER_ENABLED || "");
const RERANK_REQUESTED = has("--rerank") || has("--force-rerank");
const DO_RERANK = !has("--no-rerank") && (has("--force-rerank") || (has("--rerank") && RERANKER_ENABLED));
const DO_GRAPH = has("--graph");
// ★ G4-B — xem khối "PARITY" bên dưới.
const DO_SWEEP = has("--sweep");
const DO_PARITY = has("--parity") || DO_SWEEP;
const PROBE = val("--probe", null);
// ★★ G4-C — `--allow-missing-expect`: CHỈ dùng cho phép đo "thêm tài liệu này vào kho thì ĐƯỢC gì".
//
// Mặc định, một `expectPaths` không có trong kho là LỖI CHẾT (`validateCases`) — cầu chì đúng, vì
// một đường dẫn gõ sai cho recall 0 và bị đọc nhầm thành "retrieval hỏng".
//
// Nhưng phép đo "kho CHƯA có thẻ X" ⇔ "expectPaths trỏ vào X mà X vắng mặt" là **đúng cái cầu chì
// ấy đang chặn**, và đó là lý do duy nhất cờ này tồn tại: mốc so (a)/(b) phải chạy được trên CÙNG
// bộ ca với (c), nếu không thì ba cấu hình không so được với nhau.
//
// ⚠ Cờ này KHÔNG làm cầu chì im: mọi đường dẫn vắng mặt được IN RA kèm tên ca, ghi vào report
//   (`absentExpectPaths`), và `--ci` **vẫn coi là THẤT BẠI**. Ca có R=0 vẫn nằm trong MẪU SỐ và
//   ăn điểm 0 trên mọi chỉ số — đó chính là con số cần đọc ("chưa có tài liệu ⇒ không thể trúng"),
//   không phải một ca bị lặng lẽ bỏ qua.
const ALLOW_MISSING_EXPECT = has("--allow-missing-expect");

const log = (...a) => { if (!QUIET) console.log(...a); };

// ─── I/O ─────────────────────────────────────────────────────────────────────
function parseJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}
function cosine(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ PARITY — XẾP HẠNG BẰNG CÔNG THỨC SẢN PHẨM (G4-B). VÌ SAO KHỐI NÀY PHẢI TỒN TẠI.
// ════════════════════════════════════════════════════════════════════════════════════════════
// Baseline ở file này xếp hạng bằng **cosine THUẦN**:
//     scored = embeddings.map(e => ({ id, cos: cosine(qVec, e.embedding) })); scored.sort(...)
// Nhưng `retrieveKnowledge()` (đường SẢN PHẨM) xếp hạng bằng:
//     base   = cos*0.72 + tanh(keyword/15)*0.28
//     score  = base × langWeight × typeWeight × devJournalWeight × routeWeight × feedbackWeight
//     rồi LỌC TRÙNG NGUỒN: mỗi sourcePath tối đa PER_SOURCE_CAP=2 chunk trước khi cắt top-K.
//
// ⇒ Hệ quả đo được, và nó nghiêm trọng: **đổi bất kỳ trọng số nào thì baseline nhúc nhích ĐÚNG
//   0,0000.** Suốt thời gian bảng `typeWeight` tồn tại, KHÔNG có phép đo nào ở repo này từng phát
//   biểu được nó đúng hay sai; và một yêu cầu "quét vài mức trọng số rồi chọn theo số" là **bất
//   khả thi về cấu tạo** chứ không phải khó. Đúng lớp lỗi "thiết bị đo MÙ đúng thứ nó được dựng
//   ra để đo" — nên phải sửa THƯỚC TRƯỚC, rồi mới quét.
//
// ⚠ Baseline cosine **được giữ nguyên** (không thay bằng parity) để mọi con số đã ghi trong các
//   report cũ còn so sánh được. Parity là một khối THÊM, in cạnh nó.
//
// ⚠ MỘT NỬA CHÉP TAY, MỘT NỬA IMPORT — và ranh giới là cố ý:
//   · Phần **TRỌNG SỐ** (thứ đang được quét) `import` THẲNG từ `server/services/aiKbSourceWeights.ts`
//     ⇒ không thể trôi khỏi production, vì nó LÀ production.
//   · Phần tokenize/keywordScore là bản SOI GƯƠNG (cùng lý do với `llmRerank` ở dưới:
//     `aiLocalKnowledgeService.ts` kéo theo cả cây phụ thuộc server + engine GGUF, không nạp được
//     trong một script `node` trần). Nếu ai sửa `keywordScore` bên kia mà quên bên này, con số
//     parity sẽ lệch — ghi ở đây để người sau biết chỗ phải nhìn.
const KW_TITLE = 2.5, KW_PATH = 2, KW_KEYWORD = 2, KW_TEXT = 1;
const SEM_W = 0.72, KW_W = 0.28, KW_TANH = 15;
const PER_SOURCE_CAP = 2;

function normalizeText(input) {
  return String(input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_\-/.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const STOP_WORDS = new Set([
  "la","co","cua","va","voi","cho","hay","thi","de","khong","den","tu","nhu","nay","do","can","se",
  "da","dang","mot","hai","ba","ai","gi","sao","nao","khi","the","toi","ban","minh","chi","ra","len",
  "vao","hon","nhung","hoac","neu",
  "the","a","an","of","to","in","on","for","and","or","is","are","be","this","that","it","as","at",
  "by","with","from","how","what","why","can","do","does","did","i","you","we",
]);
function tokenize(input) {
  return normalizeText(input).split(" ").filter((t) => t.length >= 2 && !STOP_WORDS.has(t)).slice(0, 40);
}
/** Soi gương `detectLanguage()`. Bộ ca vận hành là tiếng Việt nên nhánh vi gần như luôn trúng. */
function detectLanguage(q) {
  if (/[一-鿿]/.test(q)) return "zh";
  if (/[ĂăÂÊÔƠƯĐà-ỹ]/.test(q)) return "vi";
  if (/(lam sao|huong dan|khac phuc|loi|du lieu|he thong|quan tri|nguoi dung|kiem tra)/i.test(normalizeText(q))) return "vi";
  return "en";
}
/**
 * Bộ nhớ đệm dạng chuẩn hoá của TỪNG chunk. Các trường này KHÔNG phụ thuộc câu hỏi, nên chuẩn hoá
 * lại cho mỗi câu là 54 × 7.321 lượt `normalizeText` trên chuỗi 3 KB — đủ chậm để không ai chịu
 * quét, và "không quét được" thì lại quay về chọn trọng số bằng cảm giác. Đệm một lần: 7.321 lượt.
 */
const _normCache = new Map();
function normedChunk(chunk) {
  let n = _normCache.get(chunk.id);
  if (!n) {
    n = {
      title: normalizeText(chunk.title),
      text: normalizeText(String(chunk.text ?? "").slice(0, 3000)),
      path: normalizeText(chunk.sourcePath),
      kws: new Set((chunk.keywords ?? []).map(normalizeText)),
    };
    _normCache.set(chunk.id, n);
  }
  return n;
}
function keywordScore(chunk, tokens) {
  const n = normedChunk(chunk);
  let s = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (n.title.includes(t)) s += KW_TITLE;
    if (n.path.includes(t)) s += KW_PATH;
    if (n.kws.has(t)) s += KW_KEYWORD;
    if (n.text.includes(t)) s += KW_TEXT;
  }
  return s;
}
/**
 * Điểm NỀN (không phụ thuộc trọng số) cho mọi chunk của một câu hỏi. Tính MỘT LẦN rồi tái dùng
 * cho mọi mức trọng số trong lượt quét — nếu tính lại mỗi mức thì một lượt quét 10 mức phải chạy
 * 10 × 54 × 7.3k lần `keywordScore`, và không ai đủ kiên nhẫn để quét, tức là lại chọn bằng cảm giác.
 */
function parityBaseRows(qVec, question, chunks, embeddings, byId) {
  const tokens = tokenize(question);
  const rows = [];
  for (const e of embeddings) {
    const c = byId.get(e.id);
    if (!c) continue;
    const sem = cosine(qVec, e.embedding);
    const base = sem * SEM_W + Math.tanh(keywordScore(c, tokens) / KW_TANH) * KW_W;
    rows.push({ chunk: c, sourcePath: e.sourcePath, sourceType: e.sourceType, base });
  }
  return rows;
}
/** Áp trọng số + LỌC TRÙNG NGUỒN, trả danh sách chunk đã xếp hạng — đúng thứ production cắt top-K. */
function parityRank(rows, lang, W, overrides, limit) {
  const scored = rows.map((r) => ({
    r,
    s: r.base * W.sourceWeight(r.sourcePath, r.sourceType, lang, overrides),
  }));
  scored.sort((a, b) => b.s - a.s);
  const seen = new Map();
  const out = [];
  for (const x of scored) {
    const n = seen.get(x.r.sourcePath) ?? 0;
    if (n >= PER_SOURCE_CAP) continue;
    seen.set(x.r.sourcePath, n + 1);
    out.push(x.r.chunk);
    if (out.length >= limit) break;
  }
  return out;
}

// ─── LUẬT HIT CHẶT ───────────────────────────────────────────────────────────
/**
 * ⚠⚠ ĐÂY LÀ TOÀN BỘ SỰ KHÁC BIỆT so với bộ đã bão hoà. KHÔNG có nhánh `includes()` nào, KHÔNG có
 * nhánh từ khoá trong text nào. Ai thêm một nhánh "cho dễ trúng" vào đây là dựng lại đúng cái
 * thước 1,000 mà file này thay thế.
 */
const norm = (p) => String(p ?? "").replace(/\\/g, "/").toLowerCase();
function makeMatcher(c) {
  const exact = new Set((c.expectPaths ?? []).map(norm));
  const prefixes = (c.expectPrefixes ?? []).map(norm);
  for (const p of prefixes) {
    if (!p.endsWith("/")) throw new Error(`${c.id}: expectPrefixes phải kết thúc bằng "/" — "${p}"`);
  }
  const distractors = new Set((c.distractors ?? []).map(norm));
  return {
    isRelevant: (chunk) => {
      const sp = norm(chunk.sourcePath);
      return exact.has(sp) || prefixes.some((p) => sp.startsWith(p));
    },
    isDistractor: (chunk) => distractors.has(norm(chunk.sourcePath)),
  };
}

// ─── Chỉ số ──────────────────────────────────────────────────────────────────
function dcg(rels) {
  return rels.reduce((s, r, i) => s + r / Math.log2(i + 2), 0);
}
/** Tỉ lệ — `null` khi mẫu số 0. Một tỉ lệ không tồn tại KHÔNG được phép trông như 1.0. */
const rate = (h, t) => (t > 0 ? Number((h / t).toFixed(4)) : null);
const mean = (xs) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4)) : null);

/**
 * Chấm một danh sách đã xếp hạng (mảng chunk) cho một ca.
 * `fullRanked` dùng để tính MRR trong cửa sổ rộng hơn top-K (thứ hạng thật của chunk đúng đầu tiên).
 */
function scoreRanking(topK, top10, fullRanked, m, totalRelevant) {
  const relTopK = topK.filter(m.isRelevant).length;
  const rel10 = top10.map((c) => (m.isRelevant(c) ? 1 : 0));
  const idealLen = Math.min(NDCG_K, totalRelevant);
  const ideal = Array.from({ length: NDCG_K }, (_, i) => (i < idealLen ? 1 : 0));
  const idcg = dcg(ideal);

  let firstRelRank = 0;
  for (let i = 0; i < fullRanked.length; i++) {
    if (m.isRelevant(fullRanked[i])) { firstRelRank = i + 1; break; }
  }
  // Nhiễu chen lên trên: có tài liệu distractor nào đứng TRƯỚC chunk đúng đầu tiên không?
  const cut = firstRelRank > 0 ? firstRelRank - 1 : Math.min(fullRanked.length, NDCG_K);
  const distractorsAbove = fullRanked.slice(0, cut).filter(m.isDistractor).length;

  return {
    hitAt5: relTopK > 0,
    precisionAt5: Number((relTopK / Math.max(1, Math.min(TOP_K, topK.length))).toFixed(4)),
    relevantInTopK: relTopK,
    recallAt5: totalRelevant > 0 ? Number((relTopK / totalRelevant).toFixed(4)) : null,
    recallAt5Capped: totalRelevant > 0 ? Number((relTopK / Math.min(TOP_K, totalRelevant)).toFixed(4)) : null,
    rr: firstRelRank > 0 && firstRelRank <= MRR_WINDOW ? Number((1 / firstRelRank).toFixed(4)) : 0,
    firstRelRank,
    ndcgAt10: idcg > 0 ? Number((dcg(rel10) / idcg).toFixed(4)) : null,
    distractorsAbove,
    distractorsInTopK: topK.filter(m.isDistractor).length,
    top1: topK[0]?.sourcePath ?? "(none)",
  };
}

function aggregate(rows) {
  return {
    n: rows.length,
    hitRateAt5: rate(rows.filter((r) => r.hitAt5).length, rows.length),
    precisionAt5: mean(rows.map((r) => r.precisionAt5)),
    mrr: mean(rows.map((r) => r.rr)),
    ndcgAt10: mean(rows.map((r) => r.ndcgAt10 ?? 0)),
    recallAt5: mean(rows.map((r) => r.recallAt5 ?? 0)),
    recallAt5Capped: mean(rows.map((r) => r.recallAt5Capped ?? 0)),
    distractorAboveRate: rate(rows.filter((r) => r.distractorsAbove > 0).length, rows.length),
    avgDistractorsInTopK: mean(rows.map((r) => r.distractorsInTopK)),
  };
}

// ─── Reranker cục bộ (SOI GƯƠNG `server/services/aiReranker.ts`) ─────────────
/**
 * ⚠ Không phải "một reranker khác": cùng prompt chấm điểm một-lượt và cùng công thức pha
 * `RAG_RERANKER_BLEND` với production. Lý do phải chép: `aiReranker.ts` kéo theo engine GGUF viết
 * bằng TS, không nạp được từ một `.mjs` chạy bằng `node` trần — đúng lý lẽ đã ghi ở
 * `scripts/ai-kb/eval-rag.mjs`. Mọi lệch pha giữa hai bên là NỢ đã biết, ghi ở đây chứ không giấu.
 */
let _llama = null, _model = null, _session = null;
async function loadFastModel() {
  if (_session) return _session;
  const { getLlama, LlamaChatSession } = await import("node-llama-cpp");
  _llama = await getLlama({ gpu: process.env.GGUF_GPU === "false" ? false : "auto" });
  const dir = process.env.GGUF_MODELS_DIR ? path.resolve(process.env.GGUF_MODELS_DIR) : path.join(ROOT, "uploads", "gguf-models");
  const raw = process.env.GGUF_FAST_MODEL || "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf";
  const file = raw.endsWith(".gguf") ? raw : `${raw}.gguf`;
  const modelPath = path.isAbsolute(file) ? file : path.join(dir, file);
  if (!fs.existsSync(modelPath)) throw new Error(`Không tìm thấy model text để rerank: ${modelPath}`);
  /**
   * ★★★ **`gpuLayers: "max"` — KHÔNG PHẢI `-1`. ĐÃ ĐO, KHÔNG SUY.**
   *
   * Trong node-llama-cpp v3 (bản cài: 3.19.0) `gpuLayers` nhận `"auto" | "max" | number | {…}`.
   * Một **SỐ** là **số lớp đem lên GPU**, không phải quy ước `-1 = tất cả` của llama.cpp CLI.
   * Đo trực tiếp trên chính máy này, cùng model, cùng `getLlama({gpu:"auto"})` (backend = cuda):
   *
   *     gpuLayers=-1     → model.gpuLayers = 0    ⇒ CHẠY TOÀN BỘ TRÊN CPU
   *     gpuLayers="max"  → model.gpuLayers = 37
   *
   * Hậu quả đo được trước khi sửa: lượt `--rerank` 54 ca **chạy quá 20 phút chưa xong**, GPU chỉ
   * 6% tải trong khi model đã nằm trong VRAM — vì suy luận chạy ở CPU.
   *
   * ⚠⚠ **NỢ NGOÀI PHẠM VI TASK NÀY, GHI RA ĐỂ KHÔNG AI PHẢI TÌM LẠI:**
   *   `scripts/ai-kb/_gguf-embed.mjs:75` và `scripts/ai-kb/eval-rag.mjs:221` **đều viết
   *   `gpuLayers: -1`** ⇒ mọi lượt dựng embedding của kho (`npm run kb:embed`, `kb:embed:inc`) và
   *   mọi lượt `--rerank` của bộ eval cũ đã chạy **trên CPU**, im lặng. Không có phép đo nào ở đây
   *   ĐỎ vì chuyện đó — nó chỉ hiện ra dưới dạng "chậm", và "chậm" thì không ai gọi là lỗi.
   *   Bộ nhúng của harness này vẫn đi qua `_gguf-embed.mjs` nên **vẫn chịu CPU** (≈0,38 s/truy vấn,
   *   chấp nhận được); chỉ đường rerank ở đây được sửa.
   */
  const gpuLayers = process.env.RAG_EVAL_GPU_LAYERS ?? "max";
  _model = await _llama.loadModel({ modelPath, gpuLayers });
  const ctx = await _model.createContext({ contextSize: { min: 2048, max: 8192 } });
  _session = new LlamaChatSession({ contextSequence: ctx.getSequence() });
  return _session;
}
const RERANK_DOC_CHARS = Number(process.env.RAG_RERANKER_DOC_CHARS ?? 480);
const RERANK_BLEND = Number(process.env.RAG_RERANKER_BLEND ?? 0.85);
async function llmRerank(query, pool, topN) {
  const session = await loadFastModel();
  /**
   * ★★★ **XOÁ LỊCH SỬ HỘI THOẠI TRƯỚC MỖI LƯỢT CHẤM. ĐÂY LÀ MỘT LỖI ĐÃ ĐO ĐƯỢC, KHÔNG PHẢI LO XA.**
   *
   * `LlamaChatSession.prompt()` **CỘNG DỒN** lịch sử. Dùng chung một session cho N câu ⇒ tới câu
   * thứ k, ngữ cảnh mang theo **toàn bộ k−1 bảng tài liệu trước đó**. Hai hậu quả, cả hai đều xấu:
   *  1. **Sai**: model chấm câu hỏi hiện tại trong khi vẫn "nhìn thấy" tài liệu của câu trước ⇒
   *     điểm bị nhiễm chéo. Một lift đo được như vậy **không nói gì** về reranker sản phẩm, vốn
   *     luôn chấm MỘT truy vấn với MỘT pool.
   *  2. **Chậm**: vượt `contextSize` ⇒ dịch ngữ cảnh liên tục. Đo được: lượt chạy 54 ca **quá 20
   *     phút chưa xong**, trong khi mỗi lượt chấm lẽ ra chỉ vài giây.
   *
   * ⚠ `scripts/ai-kb/eval-rag.mjs` (llmRerank, ~:228) có **ĐÚNG lỗi này** — nó cũng dùng chung một
   *   `_session` cho mọi câu hỏi và không hề reset. Mọi con số `--rerank` từng lấy ở đó đều mang
   *   nhiễm chéo. Ghi ra đây vì file kia ngoài phạm vi task này; **đừng chép lại khuôn ấy**.
   */
  session.resetChatHistory();
  const docs = pool
    .map((c, i) => `[${i}] ${(c.title ? c.title + " — " : "") + (c.text || "").replace(/\s+/g, " ").slice(0, RERANK_DOC_CHARS)}`)
    .join("\n");
  const prompt =
    `You are a precise search reranker. Score how well each document answers the query.\n` +
    `Query: ${query.slice(0, 400)}\n\nDocuments:\n${docs}\n\n` +
    `Output ONLY a JSON array like [{"i":0,"s":0.9},{"i":1,"s":0.2}] covering every index 0..${pool.length - 1}, ` +
    `where s is relevance from 0.0 to 1.0.`;
  let out = "";
  try {
    out = await session.prompt(prompt, { temperature: 0, maxTokens: Math.min(900, 40 + pool.length * 14) });
  } catch (e) {
    // ⚠ Trả nguyên thứ tự cosine + BÁO. Một lượt rerank hỏng mà im lặng sẽ hiện ra thành
    //   "lift = 0" và bị đọc thành "reranker vô dụng" — hai kết luận hoàn toàn khác nhau.
    console.warn("  [rerank] sinh chữ HỎNG, giữ thứ tự cosine:", e?.message ?? e);
    return { list: pool.slice(0, topN), failed: true };
  }
  const scores = new Array(pool.length).fill(0);
  let any = false;
  const re = /\{\s*"?i"?\s*:\s*(\d+)\s*,\s*"?s"?\s*:\s*([0-9]*\.?[0-9]+)\s*\}/g;
  let m;
  while ((m = re.exec(out)) !== null) {
    const idx = Number(m[1]);
    let s = Number(m[2]);
    if (idx >= 0 && idx < pool.length && Number.isFinite(s)) {
      if (s > 1) s = s / 10;
      scores[idx] = s;
      any = true;
    }
  }
  if (!any) return { list: pool.slice(0, topN), failed: true };
  return {
    list: pool
      .map((c, i) => ({ c, s: RERANK_BLEND * scores[i] + (1 - RERANK_BLEND) * (c._cos ?? 0) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c),
    failed: false,
  };
}

// ─── GraphRAG (hàm SẢN PHẨM thật, nạp động chỉ khi --graph) ───────────────────
let loadSemanticGraph, expandWithGraph;
function graphRagOptsFromEnv() {
  return {
    seeds: Number(process.env.KB_GRAPHRAG_SEEDS ?? 5),
    hopsPerSeed: Number(process.env.KB_GRAPHRAG_HOPS_PER_SEED ?? 3),
    minSim: Number(process.env.KB_GRAPHRAG_MIN_SIM ?? 0.72),
    decay: Number(process.env.KB_GRAPHRAG_DECAY ?? 0.85),
    maxInject: Number(process.env.KB_GRAPHRAG_MAX_INJECT ?? 8),
  };
}

// ─── Kiểm tra bộ ca (LUÔN chạy) ──────────────────────────────────────────────
function validateCases(all, corpusPaths, absentOut) {
  const errs = [];
  const seen = new Set();
  for (const c of all) {
    if (!c.id) { errs.push(`Ca thiếu id`); continue; }
    if (seen.has(c.id)) errs.push(`Trùng id: ${c.id}`);
    seen.add(c.id);
    if (!c.question) errs.push(`${c.id}: thiếu question`);
    const nExpect = (c.expectPaths ?? []).length + (c.expectPrefixes ?? []).length;
    if (nExpect === 0) errs.push(`${c.id}: phải có expectPaths hoặc expectPrefixes`);
    if ((c.distractors ?? []).length < 3) errs.push(`${c.id}: cần ≥3 distractor (đang có ${(c.distractors ?? []).length})`);
    // ⚠ CẦU CHÌ: một đường dẫn không có thật trong kho sẽ cho recall 0 và bị đọc nhầm thành
    //   "retrieval hỏng". Bắt ở đây, không để nó lẫn vào kết quả đo.
    for (const p of c.expectPaths ?? []) {
      if (corpusPaths.has(norm(p))) continue;
      // ★ G4-C — xem chú thích ở `ALLOW_MISSING_EXPECT`. Vắng mặt vẫn được GHI LẠI và IN RA;
      //   chỉ khác ở chỗ nó không giết lượt chạy, để mốc so "kho chưa có tài liệu này" đo được.
      if (ALLOW_MISSING_EXPECT) absentOut?.push({ id: c.id, path: norm(p) });
      else errs.push(`${c.id}: expectPaths "${p}" KHÔNG có trong knowledge/chunks.jsonl`);
    }
    for (const p of c.distractors ?? []) if (!corpusPaths.has(norm(p))) errs.push(`${c.id}: distractor "${p}" KHÔNG có trong knowledge/chunks.jsonl`);
    for (const p of c.expectPaths ?? []) if ((c.distractors ?? []).map(norm).includes(norm(p))) errs.push(`${c.id}: "${p}" vừa là expect vừa là distractor`);
  }
  return errs;
}

function f(v) { return v === null || v === undefined ? "  n/a" : Number(v).toFixed(3); }

async function main() {
  // ── Kho + bộ ca ──
  const chunks = parseJsonl(CHUNKS_FILE);
  if (!chunks.length) throw new Error(`Kho rỗng: ${CHUNKS_FILE}. Chạy npm run kb:chunk trước.`);
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const corpusPaths = new Set(chunks.map((c) => norm(c.sourcePath)));

  const rawCases = JSON.parse(fs.readFileSync(CASES_FILE, "utf8"));
  const all = Array.isArray(rawCases) ? rawCases : rawCases.cases;
  if (!Array.isArray(all) || !all.length) throw new Error(`Bộ ca rỗng: ${CASES_FILE}`);

  const absentExpect = [];
  const errs = validateCases(all, corpusPaths, absentExpect);
  if (errs.length) {
    console.error("\n[rag-op] ✗ BỘ CA KHÔNG HỢP LỆ — không đo được gì:");
    for (const e of errs) console.error("   -", e);
    process.exit(1);
  }
  if (absentExpect.length) {
    // KHÔNG im lặng: in đầy đủ, và --ci vẫn đỏ.
    log(`\n[rag-op] ⚠⚠ --allow-missing-expect: ${absentExpect.length} expectPaths VẮNG MẶT trong kho.`);
    log(`   Các ca dưới đây có R=0 ⇒ MỌI chỉ số của chúng là 0 vì TÀI LIỆU CHƯA CÓ, không phải vì retrieval hỏng.`);
    log(`   Chúng VẪN nằm trong mẫu số (${all.length} ca) — đó là điều kiện để so được với cấu hình đã có tài liệu.`);
    for (const a of absentExpect) log(`     - ${a.id}: ${a.path}`);
    if (DO_CI) {
      console.error(`[rag-op] ✗ --ci: expectPaths vắng mặt là THẤT BẠI (cầu chì không bị cờ này tắt).`);
      process.exitCode = 1;
    }
  }

  let cases = all;
  if (DOMAIN) cases = cases.filter((c) => c.domain === DOMAIN);
  if (ONLY) cases = cases.filter((c) => String(c.id).startsWith(ONLY));
  if (LIMIT) cases = cases.slice(0, LIMIT);

  // ── Đối chiếu model nhúng: lệch model ⇒ mọi con số là rác ──
  const meta = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, "utf8")) : null;
  const envEmbed = (process.env.GGUF_EMBED_MODEL || "").replace(/\.gguf$/i, "");
  const embedMatches = !!meta?.model && !!envEmbed && meta.model === envEmbed;

  const embeddings = parseJsonl(EMB_FILE);
  const domains = [...new Set(all.map((c) => c.domain ?? "(none)"))];

  log(`[rag-op] kho: ${chunks.length} chunk · ${embeddings.length} vector · bộ ca ${all.length} ca / ${domains.length} miền → chạy ${cases.length}`);
  log(`[rag-op] model nhúng: kho="${meta?.model ?? "?"}" env="${envEmbed || "(chưa đặt)"}" ⇒ ${embedMatches ? "KHỚP" : "★ LỆCH"}`);
  log(`[rag-op] K=${TOP_K} · nDCG@${NDCG_K} · cửa sổ MRR=${MRR_WINDOW}` + (DO_RERANK ? ` · rerank pool=${POOL}` : "") + (DO_GRAPH ? ` · GraphRAG ON` : ""));

  // ── R (số chunk đúng có thật trong kho) cho từng ca — cũng là một cầu chì ──
  const relCount = new Map();
  for (const c of all) {
    const m = makeMatcher(c);
    relCount.set(c.id, chunks.filter(m.isRelevant).length);
  }

  if (SELFCHECK) {
    log(`\n[rag-op] ── SELFCHECK (KHÔNG nạp model nào) ──`);
    log(`  ✓ ${all.length} ca hợp lệ; mọi expectPaths/distractor đều CÓ THẬT trong kho.`);
    const rs = all.map((c) => relCount.get(c.id));
    log(`  R (số chunk đúng/ca): min=${Math.min(...rs)} · trung bình=${(rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(1)} · max=${Math.max(...rs)}`);
    log(`  ⚠ trần recall@${TOP_K} lý thuyết của bộ ca này = ${(mean(all.map((c) => Math.min(TOP_K, relCount.get(c.id)) / relCount.get(c.id))) ?? 0).toFixed(3)} (vì R > K ở nhiều ca)`);
    log(`  vector nhúng: ${embeddings.length ? `${embeddings.length} (dim=${embeddings[0].embedding.length})` : "✗ CHƯA CÓ — chạy npm run kb:embed"}`);
    log(`  model nhúng khớp: ${embedMatches ? "✓" : "✗ LỆCH — lượt đo thật sẽ THOÁT 1"}`);
    log(`  reranker: RAG_RERANKER_ENABLED=${RERANKER_ENABLED ? "true" : "false"} · GGUF_FAST_MODEL=${process.env.GGUF_FAST_MODEL ?? "(mặc định)"}`);
    const gfile = path.join(KDIR, "semantic-graph.json");
    log(`  semantic-graph.json: ${fs.existsSync(gfile) ? `✓ (${(fs.statSync(gfile).size / 1024 / 1024).toFixed(2)} MB)` : "✗ thiếu — npm run kb:graph"}`);
    log(`  miền: ${domains.join(", ")}`);
    process.exit(0);
  }

  if (!embeddings.length) {
    console.error("[rag-op] ✗ KHÔNG có vector nhúng (knowledge/embeddings.jsonl rỗng). Chạy `npm run kb:embed` trước. THOÁT 1.");
    process.exit(1);
  }
  if (!embedMatches) {
    // ⚠ KHÔNG hạ xuống mức cảnh báo. Vector truy vấn lệch không gian ⇒ bảng số vẫn IN RA ĐẸP
    //   nhưng vô nghĩa — đúng kiểu "thước xanh giả có hình dạng đúng bằng kết luận thật".
    console.error(
      `[rag-op] ✗ MODEL NHÚNG LỆCH: kho dựng bằng "${meta?.model}" nhưng GGUF_EMBED_MODEL="${envEmbed || "(chưa đặt)"}".\n` +
        `        Truy vấn sẽ rơi vào không gian vector KHÁC ⇒ mọi chỉ số là RÁC. THOÁT 1.\n` +
        `        Sửa: GGUF_EMBED_MODEL=${meta?.model}.gguf (và GGUF_MODELS_DIR trỏ đúng thư mục).`,
    );
    process.exit(1);
  }
  if (cases.length === 0) {
    console.error("[rag-op] ✗ 0 ca được chạy (bộ lọc loại hết). THOÁT 1.");
    process.exit(1);
  }

  // ── GraphRAG: nạp đồ thị MỘT LẦN ──
  let graphAdj = null, graphAvailable = false, graphReason = null;
  if (DO_GRAPH) {
    try {
      ({ loadSemanticGraph, expandWithGraph } = await import("../../server/services/aiSemanticGraph.ts"));
      graphAdj = loadSemanticGraph();
      graphAvailable = graphAdj.size > 0;
      if (!graphAvailable) graphReason = "knowledge/semantic-graph.json thiếu hoặc rỗng (0 cạnh) — chạy `npm run kb:graph`";
    } catch (e) {
      graphReason = `không nạp được aiSemanticGraph.ts: ${e?.message ?? e}`;
    }
  }
  const graphOpts = graphRagOptsFromEnv();

  const { embedTextGguf } = await import("../ai-kb/_gguf-embed.mjs");

  // ── ★ G4-B — nạp TRỌNG SỐ SẢN PHẨM THẬT (module lá, không kéo cây phụ thuộc server) ──
  let W = null, parityReason = null;
  if (DO_PARITY || PROBE) {
    try {
      W = await import("../../server/services/aiKbSourceWeights.ts");
      if (typeof W.sourceWeight !== "function") throw new Error("thiếu export sourceWeight");
    } catch (e) {
      parityReason = `không nạp được server/services/aiKbSourceWeights.ts: ${e?.message ?? e}`;
      W = null;
    }
    // ⚠ Xin đo mà không đo được thì KHÔNG im lặng (cùng kỷ luật với --rerank/--graph).
    if (!W) {
      log(`\n[rag-op] ── PARITY: ✗ KHÔNG ĐO ĐƯỢC ──\n  LÝ DO: ${parityReason}`);
      if (DO_CI) process.exitCode = 1;
    }
  }

  // ── ★ G4-B — SOI MỘT CÂU HỎI (`--probe "..."`) ──
  // Bộ chỉ số tổng hợp trả lời "kho tốt lên bao nhiêu"; nó KHÔNG trả lời được "câu hỏi CỤ THỂ này
  // nay trả về cái gì". Câu chẩn đoán của G4-B ("máy dừng đột ngột thì phải làm gì") cần đúng loại
  // câu trả lời thứ hai, và nó phải chạy lại được bất cứ lúc nào bằng một lệnh, không phải bằng
  // một script tạm rồi xoá.
  if (PROBE) {
    const qVec = await embedTextGguf(PROBE);
    const lang = detectLanguage(PROBE);
    const isDev = (p) => /^(docs|apidocs)\//i.test(p);
    // ★ G4-C — `operational-approved` PHẢI có trong biểu thức này. Thiếu nó thì 20 thẻ người
    //   duyệt bị đếm vào cột "khác (mã/schema/route)", và mọi lượt `--probe` sẽ báo cáo SAI theo
    //   hướng bi quan đúng về cái vừa được thêm vào — thước mù đúng thứ nó phải soi.
    const isOps = (p) => /^knowledge\/(operational|operational-approved|domain|features|workflows)\//i.test(p);
    const show = (title, list) => {
      const dev = list.filter((c) => isDev(c.sourcePath)).length;
      const ops = list.filter((c) => isOps(c.sourcePath)).length;
      log(`\n[rag-op] ── ${title} ──`);
      log(`  top-${list.length}: ${dev} tài liệu dev (docs/|apidocs/) · ${ops} vận hành · ${list.length - dev - ops} khác (mã/schema/route)`);
      list.forEach((c, i) => log(`  ${String(i + 1).padStart(2)}. [${String(c.sourceType).padEnd(11)}] ${c.sourcePath}`));
    };
    log(`\n[rag-op] ══ SOI CÂU HỎI: "${PROBE}" (ngôn ngữ nhận được: ${lang}) ══`);
    const cos = embeddings.map((e) => ({ id: e.id, cos: cosine(qVec, e.embedding) }));
    cos.sort((a, b) => b.cos - a.cos);
    show("COSINE THUẦN (thước baseline)", cos.slice(0, 20).map((s) => byId.get(s.id)).filter(Boolean));
    if (W) {
      const rows = parityBaseRows(qVec, PROBE, chunks, embeddings, byId);
      show("PARITY — đúng thứ retrieveKnowledge xếp (đã lọc trùng nguồn)", parityRank(rows, lang, W, undefined, 20));
    }
    try { const mod = await import("../ai-kb/_gguf-embed.mjs"); await mod.disposeGgufEmbed?.(); } catch {}
    return;
  }

  // ── ★ G4-B — LƯỚI QUÉT. Mỗi biến thể là MỘT giả thuyết về bảng trọng số. ──
  // "hiện tại (trước G4-B)" tái dựng ĐÚNG bảng cũ (operational/playbook vắng mặt ⇒ rơi về 1,00,
  // không có devJournal) — đó là mốc so, và nó phải nằm TRONG cùng một lượt chạy, không phải lấy
  // từ một report cũ chạy trên kho khác (kho vừa +15 chunk playbook).
  // ⚠⚠ MỘT BIẾN MỘT DÒNG. Lưới đầu tiên tôi viết đổi ĐỒNG THỜI `operational` và `playbook` ở mọi
  // dòng không phải mốc, nên khi MRR tụt 0,969 → 0,911 thì KHÔNG quy được cho cái nào — và suýt
  // nữa thì đọc thành "nâng operational làm hỏng thứ hạng", một kết luận sai. Lưới dưới đây tách
  // hai trục ra: nhóm A chỉ động `playbook`, nhóm B chỉ động `operational`, nhóm C chỉ động `dev`.
  const OLD = { feature: 1.18, domain: 1.08, doc: 0.9 };
  const SWEEP_GRID = [
    { name: "mốc: trước G4-B", types: OLD, devJournal: 1.0 },
    // ── A. chỉ đổi playbook (operational vẫn 1,00 như bảng cũ) ──
    { name: "A pb=1.00 (chỉ index)", types: { ...OLD, playbook: 1.0 }, devJournal: 1.0 },
    { name: "A pb=1.15", types: { ...OLD, playbook: 1.15 }, devJournal: 1.0 },
    { name: "A pb=1.30", types: { ...OLD, playbook: 1.3 }, devJournal: 1.0 },
    { name: "A pb=1.60", types: { ...OLD, playbook: 1.6 }, devJournal: 1.0 },
    // ── B. chỉ đổi operational (playbook giữ 1,00 = trung tính) ──
    { name: "B op=1.08 (ngang domain)", types: { ...OLD, operational: 1.08, playbook: 1.0 }, devJournal: 1.0 },
    { name: "B op=1.15", types: { ...OLD, operational: 1.15, playbook: 1.0 }, devJournal: 1.0 },
    { name: "B op=1.25", types: { ...OLD, operational: 1.25, playbook: 1.0 }, devJournal: 1.0 },
    { name: "B op=1.40", types: { ...OLD, operational: 1.4, playbook: 1.0 }, devJournal: 1.0 },
    // ── C. chỉ đổi trọng số nhật ký dev (op/pb giữ trung tính) ──
    { name: "C dev=0.90", types: { ...OLD, playbook: 1.0 }, devJournal: 0.9 },
    { name: "C dev=0.80", types: { ...OLD, playbook: 1.0 }, devJournal: 0.8 },
    { name: "C dev=0.55", types: { ...OLD, playbook: 1.0 }, devJournal: 0.55 },
    // ── D. tổ hợp ứng viên ──
    { name: "D op=1.15·pb=1.15·dev=0.80", types: { ...OLD, operational: 1.15, playbook: 1.15 }, devJournal: 0.8 },
    { name: "D op=1.15·pb=1.30·dev=0.80", types: { ...OLD, operational: 1.15, playbook: 1.3 }, devJournal: 0.8 },
    { name: "ĐÃ CHỌN (mặc định trong mã)", types: null, devJournal: null },
  ];

  const baseRows = [], rerankRows = [], graphRows = [], parityRows = [];
  const sweepRows = SWEEP_GRID.map(() => []);
  const perCase = [];
  let rerankFailures = 0, totalInjected = 0;
  const t0 = Date.now();

  for (const c of cases) {
    const m = makeMatcher(c);
    const R = relCount.get(c.id);
    const qVec = await embedTextGguf(c.question);
    const scored = embeddings.map((e) => ({ id: e.id, cos: cosine(qVec, e.embedding) }));
    scored.sort((a, b) => b.cos - a.cos);
    const ranked = scored.slice(0, Math.max(MRR_WINDOW, POOL, NDCG_K, TOP_K)).map((s) => byId.get(s.id)).filter(Boolean);

    const base = scoreRanking(ranked.slice(0, TOP_K), ranked.slice(0, NDCG_K), ranked, m, R);
    baseRows.push(base);

    // ── PARITY + quét ──
    if (W) {
      const lang = detectLanguage(c.question);
      const rows = parityBaseRows(qVec, c.question, chunks, embeddings, byId);
      const WIN = Math.max(MRR_WINDOW, NDCG_K, TOP_K);
      const pr = parityRank(rows, lang, W, undefined, WIN);
      parityRows.push(scoreRanking(pr.slice(0, TOP_K), pr.slice(0, NDCG_K), pr, m, R));
      if (DO_SWEEP) {
        for (let i = 0; i < SWEEP_GRID.length; i++) {
          const v = SWEEP_GRID[i];
          const ov = v.types === null ? undefined : { types: v.types, devJournal: v.devJournal };
          const L = parityRank(rows, lang, W, ov, WIN);
          sweepRows[i].push(scoreRanking(L.slice(0, TOP_K), L.slice(0, NDCG_K), L, m, R));
        }
      }
    }

    let rr = null;
    if (DO_RERANK) {
      const pool = scored.slice(0, POOL).map((s) => { const ch = byId.get(s.id); return ch ? { ...ch, _cos: s.cos } : null; }).filter(Boolean);
      const out = await llmRerank(c.question, pool, POOL);
      if (out.failed) rerankFailures++;
      rr = scoreRanking(out.list.slice(0, TOP_K), out.list.slice(0, NDCG_K), out.list, m, R);
      rerankRows.push(rr);
    }

    let gr = null;
    if (graphAvailable) {
      const seedPool = scored.slice(0, POOL).map((s) => ({ id: s.id, score: s.cos }));
      const exp = expandWithGraph(seedPool, graphAdj, graphOpts, (id, score) => (byId.has(id) ? { id, score } : null));
      totalInjected += exp.injected;
      const gList = exp.pool.slice().sort((a, b) => b.score - a.score).map((x) => byId.get(x.id)).filter(Boolean);
      gr = scoreRanking(gList.slice(0, TOP_K), gList.slice(0, NDCG_K), gList, m, R);
      graphRows.push(gr);
    }

    perCase.push({ id: c.id, domain: c.domain ?? "(none)", question: c.question, R, base, rerank: rr, graph: gr });
  }
  const elapsedMs = Date.now() - t0;

  // ── In từng ca ──
  log(`\n[rag-op] ── từng ca (baseline cosine) ──`);
  for (const p of perCase) {
    log(
      `  ${p.base.hitAt5 ? "✓" : "✗"} ${p.id.padEnd(5)} [${p.domain.padEnd(13)}] P@${TOP_K}=${p.base.precisionAt5.toFixed(2)} rank1=${String(p.base.firstRelRank || "-").padStart(3)} nDCG@10=${f(p.base.ndcgAt10)} R=${String(p.R).padStart(2)}` +
        (p.base.distractorsAbove ? ` ★ ${p.base.distractorsAbove} NHIỄU chen lên trên` : "") +
        `  top1=${p.base.top1}`,
    );
  }

  const baseAgg = aggregate(baseRows);
  const rrAgg = DO_RERANK ? aggregate(rerankRows) : null;
  const grAgg = graphAvailable ? aggregate(graphRows) : null;

  const printAgg = (title, a) => {
    log(`\n[rag-op] ── ${title} ──`);
    log(`  hitRate@${TOP_K} (≥1 đúng)   : ${f(a.hitRateAt5)}`);
    log(`  precision@${TOP_K}            : ${f(a.precisionAt5)}`);
    log(`  MRR                       : ${f(a.mrr)}`);
    log(`  nDCG@${NDCG_K}                  : ${f(a.ndcgAt10)}`);
    log(`  recall@${TOP_K} (thô, /R)      : ${f(a.recallAt5)}   ← trần = K/R, xem chú thích đầu file`);
    log(`  recall@${TOP_K} (bỏ trần)      : ${f(a.recallAt5Capped)}`);
    log(`  ca bị NHIỄU chen lên trên : ${f(a.distractorAboveRate)}   (nhiễu trong top-${TOP_K}: ${f(a.avgDistractorsInTopK)}/ca)`);
  };
  printAgg(`BASELINE — cosine thuần (${elapsedMs} ms)`, baseAgg);

  // ── Theo miền ──
  const dmap = new Map();
  for (const p of perCase) {
    if (!dmap.has(p.domain)) dmap.set(p.domain, []);
    dmap.get(p.domain).push(p.base);
  }
  log(`\n[rag-op] ── theo miền (baseline) ──`);
  for (const d of [...dmap.keys()].sort()) {
    const a = aggregate(dmap.get(d));
    log(`  ${d.padEnd(15)} n=${String(a.n).padStart(2)}  hit=${f(a.hitRateAt5)}  P@${TOP_K}=${f(a.precisionAt5)}  MRR=${f(a.mrr)}  nDCG=${f(a.ndcgAt10)}`);
  }

  // ── ★ G4-B — PARITY (công thức sản phẩm) ──
  let parityBlock;
  const paAgg = parityRows.length ? aggregate(parityRows) : null;
  if (paAgg) {
    printAgg("PARITY — công thức retrieveKnowledge (cos·0,72 + kw·0,28 × trọng số × lọc trùng nguồn)", paAgg);
    log(`\n[rag-op] ── PARITY so với baseline cosine ──`);
    for (const k of ["hitRateAt5", "precisionAt5", "mrr", "ndcgAt10", "recallAt5Capped"]) {
      const d = (paAgg[k] ?? 0) - (baseAgg[k] ?? 0);
      log(`  ${k.padEnd(16)} ${f(baseAgg[k])} → ${f(paAgg[k])}   Δ=${d >= 0 ? "+" : ""}${d.toFixed(3)}`);
    }
    log(`  ⚠ Đây KHÔNG phải "lift" của một cơ chế — đây là hai THƯỚC khác nhau đo cùng một kho.`);
    log(`    Baseline cosine bỏ qua keyword, trọng số và lọc trùng nguồn; parity thì không.`);
    parityBlock = { available: true, ...paAgg };
  } else {
    parityBlock = { available: false, requested: DO_PARITY, reason: parityReason ?? "không truyền --parity" };
  }

  // ── ★ G4-B — BẢNG QUÉT TRỌNG SỐ ──
  let sweepBlock = { available: false, requested: DO_SWEEP };
  if (DO_SWEEP && W) {
    log(`\n[rag-op] ── QUÉT TRỌNG SỐ (${cases.length} ca, cùng một lượt nhúng) ──`);
    log(`  ${"biến thể".padEnd(30)} ${"P@5".padStart(6)} ${"MRR".padStart(6)} ${"nDCG@10".padStart(8)} ${"recall@5".padStart(9)} ${"nhiễu↑".padStart(7)}`);
    const table = [];
    for (let i = 0; i < SWEEP_GRID.length; i++) {
      const a = aggregate(sweepRows[i]);
      table.push({ name: SWEEP_GRID[i].name, types: SWEEP_GRID[i].types, devJournal: SWEEP_GRID[i].devJournal, ...a });
      log(
        `  ${SWEEP_GRID[i].name.padEnd(30)} ${f(a.precisionAt5).padStart(6)} ${f(a.mrr).padStart(6)} ` +
          `${f(a.ndcgAt10).padStart(8)} ${f(a.recallAt5Capped).padStart(9)} ${f(a.distractorAboveRate).padStart(7)}`,
      );
    }
    log(`\n  ⚠⚠ ĐỌC BẢNG NÀY CÓ MỘT CÁI BẪY, VÀ NÓ NẰM Ở BỘ CA:`);
    log(`     ${cases.length} ca ở đây có 0 ca nào mong đợi một đường dẫn docs/** — expectPaths chỉ trỏ vào`);
    log(`     knowledge/{domain,operational,features}. Nghĩa là cột "dev=..." CHỈ CÓ THỂ tốt lên khi hạ:`);
    log(`     tối ưu của thước này là "hạ dev xuống 0", tức XOÁ tài liệu kiến trúc. Đó là lượng từ TỰ THOẢ.`);
    log(`     ⇒ Cái GIÁ của việc hạ phải đo bằng bộ ca RIÊNG:`);
    log(`        node scripts/ai-eval/eval-rag-operational.mjs --parity --cases scripts/ai-eval/rag-architecture-cases.json`);
    log(`     Đừng chọn mức hạ chỉ bằng bảng này.`);
    sweepBlock = { available: true, grid: table, caveat: "Bộ ca vận hành có 0 ca mong đợi docs/** ⇒ bảng này KHÔNG định giá được cái mất của việc hạ tài liệu dev. Đo bằng rag-architecture-cases.json." };
  } else if (DO_SWEEP) {
    sweepBlock = { available: false, requested: true, reason: parityReason };
  }

  // ── LIFT reranker ──
  let rerankBlock;
  if (rrAgg) {
    printAgg(`RERANKED (pool=${POOL}, ${rerankFailures} lượt rerank HỎNG)`, rrAgg);
    log(`\n[rag-op] ── LIFT của reranker ──`);
    for (const k of ["hitRateAt5", "precisionAt5", "mrr", "ndcgAt10", "recallAt5Capped"]) {
      const d = (rrAgg[k] ?? 0) - (baseAgg[k] ?? 0);
      log(`  ${k.padEnd(16)} ${f(baseAgg[k])} → ${f(rrAgg[k])}   lift=${d >= 0 ? "+" : ""}${d.toFixed(3)}`);
    }
    if (rerankFailures) log(`  ⚠ ${rerankFailures}/${cases.length} lượt rerank KHÔNG sinh được điểm ⇒ giữ nguyên thứ tự cosine. Lift bị PHA LOÃNG bởi số ấy, không phải "reranker vô dụng".`);
    rerankBlock = { available: true, pool: POOL, failures: rerankFailures, ...rrAgg, lift: Object.fromEntries(["hitRateAt5", "precisionAt5", "mrr", "ndcgAt10", "recallAt5Capped"].map((k) => [k, Number(((rrAgg[k] ?? 0) - (baseAgg[k] ?? 0)).toFixed(4))])) };
  } else if (RERANK_REQUESTED) {
    const reason = has("--no-rerank") ? "--no-rerank được truyền" : `RAG_RERANKER_ENABLED không bật (giá trị: "${process.env.RAG_RERANKER_ENABLED ?? "(chưa đặt)"}"). Dùng --force-rerank để bỏ qua cổng.`;
    log(`\n[rag-op] ── RERANKER: ✗ KHÔNG ĐO ĐƯỢC ──\n  LÝ DO: ${reason}\n  ⚠ Con số ở trên là retrieval THUẦN NHÚNG (trước rerank). Đừng đọc nó như đường ống sản phẩm.`);
    rerankBlock = { available: false, requested: true, reason };
  } else {
    rerankBlock = { available: false, requested: false, reason: "không truyền --rerank" };
  }

  // ── LIFT GraphRAG ──
  let graphBlock;
  if (grAgg) {
    printAgg(`GraphRAG (mở rộng 1-hop, trung bình ${(totalInjected / cases.length).toFixed(2)} hàng xóm/câu)`, grAgg);
    log(`\n[rag-op] ── LIFT của GraphRAG ──`);
    for (const k of ["hitRateAt5", "precisionAt5", "mrr", "ndcgAt10", "recallAt5Capped"]) {
      const d = (grAgg[k] ?? 0) - (baseAgg[k] ?? 0);
      log(`  ${k.padEnd(16)} ${f(baseAgg[k])} → ${f(grAgg[k])}   lift=${d >= 0 ? "+" : ""}${d.toFixed(3)}`);
    }
    graphBlock = { available: true, avgInjectedPerQuestion: Number((totalInjected / cases.length).toFixed(2)), opts: graphOpts, ...grAgg, lift: Object.fromEntries(["hitRateAt5", "precisionAt5", "mrr", "ndcgAt10", "recallAt5Capped"].map((k) => [k, Number(((grAgg[k] ?? 0) - (baseAgg[k] ?? 0)).toFixed(4))])) };
  } else if (DO_GRAPH) {
    log(`\n[rag-op] ── GraphRAG: ✗ KHÔNG ĐO ĐƯỢC ──\n  LÝ DO: ${graphReason}`);
    graphBlock = { available: false, requested: true, reason: graphReason };
  } else {
    graphBlock = { available: false, requested: false, reason: "không truyền --graph" };
  }

  // ── Report ──
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `rag-operational-${LABEL}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        label: LABEL,
        timestamp: new Date().toISOString(),
        casesFile: path.relative(ROOT, CASES_FILE),
        corpus: { chunks: chunks.length, vectors: embeddings.length, embedModel: meta?.model ?? null, embedModelMatches: embedMatches },
        params: { k: TOP_K, ndcgK: NDCG_K, pool: POOL, mrrWindow: MRR_WINDOW },
        hitRule: "STRICT — sourcePath BẰNG ĐÚNG expectPaths hoặc bắt đầu bằng expectPrefixes; CẤM khớp chuỗi con / từ khoá",
        // ★ G4-C — vắng mặt được GHI vào report, không chỉ in ra màn hình: một con số 0,000 đọc
        //   sau này phải tự nói được nó là "chưa có tài liệu" hay "retrieval hỏng".
        absentExpectPaths: absentExpect,
        baseline: baseAgg,
        parity: parityBlock,
        weightSweep: sweepBlock,
        reranked: rerankBlock,
        graphRag: graphBlock,
        perDomain: Object.fromEntries([...dmap.keys()].sort().map((d) => [d, aggregate(dmap.get(d))])),
        cases: perCase,
      },
      null,
      2,
    ) + "\n",
  );
  log(`\n[rag-op] báo cáo → ${path.relative(ROOT, outFile)}`);

  // ── Cổng CI ──
  let fail = false;
  if (DO_CI) {
    log(`\n[rag-op] ── CỔNG CI (hitRate@${TOP_K} min=${CI_MIN}) ──`);
    const eff = rrAgg ?? baseAgg;
    if (eff.hitRateAt5 === null || eff.hitRateAt5 < CI_MIN) {
      log(`  ✗ hitRate@${TOP_K} ${f(eff.hitRateAt5)} < ${CI_MIN}`);
      fail = true;
    } else log(`  ✓ hitRate@${TOP_K} ${f(eff.hitRateAt5)} ≥ ${CI_MIN}`);
    // ⚠ Xin đo mà không đo được = THẤT BẠI, không phải "bỏ qua".
    if (RERANK_REQUESTED && !rrAgg) { log("  ✗ yêu cầu --rerank nhưng KHÔNG đo được reranker."); fail = true; }
    if (DO_GRAPH && !grAgg) { log("  ✗ yêu cầu --graph nhưng KHÔNG đo được GraphRAG."); fail = true; }
    log(fail ? "  KẾT QUẢ: FAIL" : "  KẾT QUẢ: PASS");
  }

  try { const mod = await import("../ai-kb/_gguf-embed.mjs"); await mod.disposeGgufEmbed?.(); } catch {}
  if (_model) { try { await _model.dispose(); } catch {} }
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error("[rag-op] ✗ hỏng:", err?.stack ?? err?.message ?? err);
  process.exit(1);
});
