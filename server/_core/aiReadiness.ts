/**
 * aiReadiness.ts — G1-E (2026-08-16): **HẠ TẦNG AI KHÔNG ĐƯỢC HỎNG TRONG IM LẶNG.**
 *
 * ─── VÌ SAO MODULE NÀY TỒN TẠI ────────────────────────────────────────────────────────────────
 * Hai sự thật đo được, hợp lại thành một lỗ:
 *
 *   1. `llama-server` (:8091) hôm nay chạy BẰNG TAY. Máy khởi động lại ⇒ nó biến mất. Khi nó mất,
 *      `aiGgufEngine` KHÔNG lỗi: `preflightHealthy()` trả false và đường sinh chữ **âm thầm lùi về
 *      in-process** (`LLAMA_SERVER_STRICT` cố ý để TẮT). Câu trả lời vẫn ra ⇒ không ai biết. Cái
 *      mất là prefix-cache: **TTFT đo thật 5.304 ms → 71 ms (74×)**; 63× ở ctx 4k, 44× ở 16k.
 *   2. `/api/health` **KHÔNG PHẢI một route** — nó rơi vào SPA catch-all (`_core/vite.ts` dùng
 *      `app.use("*")`) nên trả **200 + `text/html` 369 KB**. Mọi phép nghiệm thu từng viết
 *      "health 200 ⇒ hệ thống sống" thực chất chỉ chứng minh **trình duyệt tải được index.html**.
 *
 * ⇒ Hai lỗ CÙNG một bản chất: *mất năng lực AI mà mọi đèn vẫn xanh.* Module này là phép đo phát
 * biểu được sự mất mát đó — trả `ok|degraded|down|disabled` cho từng hệ con, kèm lý do tiếng Việt
 * nói rõ **MẤT GÌ**, và một mã HTTP không cho phép "xanh giả".
 *
 * ─── VÌ SAO LÀ ENDPOINT MỚI, KHÔNG SỬA `/health` ─────────────────────────────────────────────
 * `/health` (rich, đã có, `_core/index.ts`) và `/livez`/`/readyz` (doc 44 W6-4) đang được Docker
 * HEALTHCHECK / cổng canary dùng. Đổi ngữ nghĩa của chúng = có thể kéo tuột một instance ĐANG PHỤC
 * VỤ TỐT ra khỏi rotation chỉ vì llama-server chết (in-process vẫn trả lời được). Nên:
 *   • `/readyz`       — "instance này nhận traffic được không?" → cổng rollout. KHÔNG ĐỔI.
 *   • `/api/health/ai`— "hệ thống còn ĐỦ NĂNG LỰC AI như đã nghiệm thu không?" → cổng CẢNH BÁO.
 *
 * ─── QUY ƯỚC TRẠNG THÁI (viết ra để không ai đoán) ────────────────────────────────────────────
 *   ok       — hệ con đang làm đúng việc của nó.
 *   degraded — VẪN CHẠY nhưng ĐÃ MẤT một năng lực đo được (vd: sinh chữ đi in-process ⇒ mất
 *              prefix-cache). Đây là ô mà lớp lỗi "im lặng" trú ngụ.
 *   down     — hệ con CHẾT.
 *   disabled — TẮT CÓ CHỦ Ý bằng cấu hình. KHÔNG phải lỗi, KHÔNG kéo mã HTTP xuống.
 *
 * ─── MÃ HTTP (phản ánh sự thật, không hơn không kém) ──────────────────────────────────────────
 *   200 — mọi hệ con ok/disabled.
 *   207 Multi-Status — có hệ con `degraded`. CỐ Ý không phải 200: một phép kiểm `== 200` sẽ ĐỎ
 *        (đúng ý đồ — mất prefix-cache phải nhìn thấy được), trong khi phép kiểm "2xx" vẫn xanh
 *        (đúng ý đồ — instance vẫn trả lời được, đừng kéo nó ra khỏi rotation).
 *   503 — có hệ con `down`.
 *
 * ─── KHÔNG RÒ BÍ MẬT ─────────────────────────────────────────────────────────────────────────
 * Chỉ trả **basename** model (KHÔNG bao giờ path tuyệt đối — `/props` của llama-server trả
 * `model_path` = "D:/SOURCES/16.AI/…", đó là thông tin bố cục máy chủ), KHÔNG trả
 * `LLAMA_SERVER_API_KEY`, KHÔNG trả hostname (chỉ "loopback"/"remote" + cổng).
 *
 * ─── XÁC THỰC ────────────────────────────────────────────────────────────────────────────────
 * Mặc định KHÔNG đòi xác thực (để Uptime-Kuma/Zabbix/Docker gọi được không cần bí mật) — an toàn
 * vì phần trả về đã lọc như trên. Deployment nào coi danh sách model là nhạy cảm thì bật
 * `HEALTH_AI_REQUIRE_LOOPBACK=true` ⇒ chỉ caller loopback được đọc, còn lại 403.
 */
import type { Request, RequestHandler } from "express";

export type SubsystemState = "ok" | "degraded" | "down" | "disabled";

export interface SubsystemReport {
  status: SubsystemState;
  /** Câu tiếng Việt nói rõ ĐANG XẢY RA GÌ và MẤT GÌ. Đi thẳng vào cảnh báo, nên phải cụ thể. */
  reason: string;
  /** Chi tiết ĐÃ LỌC (basename/cổng/cờ). Không path tuyệt đối, không khoá, không hostname. */
  detail?: Record<string, unknown>;
}

export type CheckName =
  | "db"
  | "llamaServer"
  | "textGeneration"
  | "embedding"
  | "reranker"
  | "tierFlags";

export interface AiReadinessResult {
  status: "ok" | "degraded" | "down";
  ready: boolean;
  /** Mã HTTP tương ứng — tính ở đây để route chỉ việc chuyển tiếp (một nguồn sự thật). */
  httpStatus: 200 | 207 | 503;
  checks: Record<CheckName, SubsystemReport>;
  /** Một dòng cho mỗi hệ con không ok — đủ để cảnh báo đọc mà không cần parse cả cây. */
  problems: string[];
  checkMs: number;
  ts: string;
}

/** Kết quả thăm dò llama-server — `servedModel` là model NÓ ĐANG NẠP THẬT, không phải cấu hình. */
export interface LlamaServerProbeResult {
  reachable: boolean;
  /** basename model đang nạp thật (từ `/props.model_path`); null nếu không đọc được. */
  servedModel: string | null;
  slots: number | null;
  ctxPerSlot: number | null;
  /** Lý do không với tới được (đã cắt ngắn, không kèm URL đầy đủ). */
  error?: string;
}

export interface RerankerStatusShape {
  enabled: boolean;
  mode: string;
  modelConfigured: boolean;
  modelResolved: boolean;
  activeBackend: "gguf" | "llm" | "identity";
}

export interface TierFlagFindingShape {
  label: string;
  env: string;
  reason: string;
}

export interface AiReadinessDeps {
  /** Ping DB THẬT (một truy vấn), không chỉ "đối tượng kết nối có tồn tại". */
  checkDb?: (timeoutMs: number) => Promise<boolean>;
  probeLlamaServer?: (baseUrl: string, timeoutMs: number) => Promise<LlamaServerProbeResult>;
  rerankerStatus?: () => RerankerStatusShape;
  /** Model GGUF có thật trên đĩa không (basename). */
  ggufExists?: (basename: string) => Promise<boolean> | boolean;
  auditTierFlags?: () => Promise<TierFlagFindingShape[]>;
  env?: NodeJS.ProcessEnv;
  /** Trần thời gian cho MỖI phép kiểm (chúng chạy song song). */
  timeoutMs?: number;
}

// ─── Tiện ích thuần ────────────────────────────────────────────────────────────────────────────

function toBase(raw: string | undefined | null): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  return v.replace(/^.*[\\/]/, "").replace(/\.gguf$/i, "");
}

function flagOn(env: NodeJS.ProcessEnv, name: string): boolean {
  const v = (env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Mô tả endpoint llama-server ĐÃ LỌC: chỉ "loopback"/"remote" + cổng. KHÔNG trả hostname/URL đầy
 * đủ — endpoint này công khai, mà hostname nội bộ là thông tin bố cục hạ tầng.
 */
export function redactEndpoint(rawUrl: string): { host: "loopback" | "remote" | "unknown"; port: number | null } {
  try {
    const u = new URL(rawUrl);
    const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1" || u.hostname === "[::1]";
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return { host: loopback ? "loopback" : "remote", port: Number.isFinite(port) ? port : null };
  } catch {
    return { host: "unknown", port: null };
  }
}

/** Caller có phải loopback không (dùng cho `HEALTH_AI_REQUIRE_LOOPBACK`). */
export function isLoopbackRequest(req: Pick<Request, "ip" | "socket">): boolean {
  const raw = (req.ip || req.socket?.remoteAddress || "").trim();
  if (!raw) return false;
  const ip = raw.replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("127.");
}

// ─── Thăm dò mặc định (chạm mạng/đĩa/DB thật) ──────────────────────────────────────────────────

async function defaultCheckDb(timeoutMs: number): Promise<boolean> {
  // `getDb()` chỉ trả về đối tượng đã cache — KHÔNG chứng minh DB còn sống (đó là điểm yếu của
  // `/readyz` hiện có). Ở đây chạy một truy vấn THẬT, có trần thời gian.
  const timer = new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  const probe = (async () => {
    try {
      const [{ getDb }, { sql }] = await Promise.all([import("../db/connection"), import("drizzle-orm")]);
      const db = await getDb();
      if (!db) return false;
      await db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  })();
  return Promise.race([probe, timer]);
}

function authHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const key = (env.LLAMA_SERVER_API_KEY || "").trim();
  return key ? { authorization: `Bearer ${key}` } : {};
}

/**
 * `/health` (sống chưa) + `/props` (ĐANG NẠP MODEL NÀO). Cả hai dùng CHUNG một AbortController nên
 * toàn bộ phép thăm dò bị chặn bởi `timeoutMs` — kể cả khi server nhận TCP rồi treo không trả lời
 * (chính là lớp lỗi mà `probeHealthy` của `aiLlamaServerClient` đã phải vá ở doc69 G2-6).
 */
async function defaultProbeLlamaServer(
  baseUrl: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LlamaServerProbeResult> {
  const url = baseUrl.replace(/\/+$/, "");
  if (!url) return { reachable: false, servedModel: null, slots: null, ctxPerSlot: null, error: "chưa cấu hình URL" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = authHeaders(env);
    const health = await fetch(`${url}/health`, { headers, signal: ctrl.signal });
    if (!health.ok) {
      return { reachable: false, servedModel: null, slots: null, ctxPerSlot: null, error: `/health HTTP ${health.status}` };
    }
    let servedModel: string | null = null;
    let slots: number | null = null;
    let ctxPerSlot: number | null = null;
    try {
      const res = await fetch(`${url}/props`, { headers, signal: ctrl.signal });
      if (res.ok) {
        const j: any = await res.json();
        // ⚠ `model_path` là ĐƯỜNG DẪN TUYỆT ĐỐI — chỉ giữ basename, không bao giờ trả nguyên văn.
        servedModel = toBase(j?.model_path ?? j?.model_alias ?? "") || null;
        slots = Number.isFinite(Number(j?.total_slots)) ? Number(j.total_slots) : null;
        const n = Number(j?.default_generation_settings?.n_ctx);
        ctxPerSlot = Number.isFinite(n) ? n : null;
      }
    } catch {
      /* /props là bổ sung — server sống mà /props hỏng vẫn tính là reachable. */
    }
    return { reachable: true, servedModel, slots, ctxPerSlot };
  } catch (err: any) {
    const msg = err?.name === "AbortError" ? `không trả lời trong ${timeoutMs} ms` : String(err?.message ?? err).slice(0, 120);
    return { reachable: false, servedModel: null, slots: null, ctxPerSlot: null, error: msg };
  } finally {
    clearTimeout(t);
  }
}

async function defaultRerankerStatus(): Promise<RerankerStatusShape> {
  const { getRerankerStatus } = await import("../services/aiReranker");
  const s = getRerankerStatus();
  return {
    enabled: s.enabled,
    mode: s.mode,
    modelConfigured: s.modelConfigured,
    modelResolved: s.modelResolved,
    activeBackend: s.activeBackend,
  };
}

async function defaultGgufExists(basename: string): Promise<boolean> {
  try {
    const { ggufModelFileExists } = await import("../services/aiGgufEngine");
    return ggufModelFileExists(basename);
  } catch {
    return false;
  }
}

async function defaultAuditTierFlags(): Promise<TierFlagFindingShape[]> {
  try {
    const { auditModelTierFlags } = await import("../services/ai/modelTierFlagAudit");
    return await auditModelTierFlags();
  } catch {
    return [];
  }
}

/** Bọc một promise bằng trần thời gian — mọi phép kiểm đều phải trả lời trong `timeoutMs`. */
async function withTimeout<T>(p: Promise<T>, timeoutMs: number, onTimeout: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout), timeoutMs);
  });
  try {
    return await Promise.race([p.catch(() => onTimeout), guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Phép đo ───────────────────────────────────────────────────────────────────────────────────

const RANK: Record<SubsystemState, number> = { ok: 0, disabled: 0, degraded: 1, down: 2 };

/**
 * Chụp trạng thái SẴN SÀNG THẬT của hạ tầng AI. Mọi phép kiểm chạy SONG SONG, mỗi phép có trần
 * thời gian riêng ⇒ tổng thời gian ≈ phép chậm nhất, không cộng dồn. KHÔNG BAO GIỜ ném.
 */
export async function probeAiReadiness(deps: AiReadinessDeps = {}): Promise<AiReadinessResult> {
  const startedAt = Date.now();
  const env = deps.env ?? process.env;
  const timeoutMs = deps.timeoutMs ?? Number(env.HEALTH_AI_TIMEOUT_MS ?? 2000) ?? 2000;
  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 2000;

  const checkDb = deps.checkDb ?? defaultCheckDb;
  const probeServer = deps.probeLlamaServer ?? ((u, t) => defaultProbeLlamaServer(u, t, env));
  const rerankerStatus = deps.rerankerStatus;
  const ggufExists = deps.ggufExists ?? defaultGgufExists;
  const auditTierFlags = deps.auditTierFlags ?? defaultAuditTierFlags;

  const serverEnabled = (env.LLAMA_SERVER_ENABLED || "").trim() === "true";
  const serverUrl = (env.LLAMA_SERVER_URL || "").trim().replace(/\/+$/, "");
  const serverConfigured = serverEnabled && !!serverUrl;
  const strict = (env.LLAMA_SERVER_STRICT || "").trim() === "true";
  const deepModel = toBase(env.GGUF_DEFAULT_MODEL);
  const configuredServerModel = toBase(env.LLAMA_SERVER_MODEL) || deepModel;
  const embedModel = toBase(env.GGUF_EMBED_MODEL);

  const DEAD_SERVER: LlamaServerProbeResult = {
    reachable: false,
    servedModel: null,
    slots: null,
    ctxPerSlot: null,
    error: `không trả lời trong ${budget} ms`,
  };

  // ⚠ Mỗi phép kiểm được gói trong một async-IIFE — KHÔNG phải `Promise.resolve(f())`. Khác biệt
  // quan trọng: `f()` ném ĐỒNG BỘ (một probe hỏng, một env đọc lỗi) sẽ thoát ra NGOÀI `Promise
  // .resolve` và làm hỏng CẢ phép đo; async-IIFE biến nó thành rejection để `withTimeout` nuốt và
  // hạ ĐÚNG hệ con đó xuống. Một thiết bị đo không được chết vì thứ nó đang đo bị hỏng.
  const [dbOk, server, rerank, embedOnDisk, tierFindings] = await Promise.all([
    withTimeout((async () => checkDb(budget))(), budget, false),
    serverConfigured
      ? withTimeout((async () => probeServer(serverUrl, budget))(), budget, DEAD_SERVER)
      : Promise.resolve(DEAD_SERVER),
    withTimeout(
      (async () => (rerankerStatus ? rerankerStatus() : defaultRerankerStatus()))(),
      budget,
      null as RerankerStatusShape | null,
    ),
    embedModel
      ? withTimeout((async () => ggufExists(embedModel))(), budget, false)
      : Promise.resolve(false),
    withTimeout((async () => auditTierFlags())(), budget, [] as TierFlagFindingShape[]),
  ]);

  const checks = {} as Record<CheckName, SubsystemReport>;

  // ── DB ──────────────────────────────────────────────────────────────────────────────────────
  checks.db = dbOk
    ? { status: "ok", reason: "PostgreSQL trả lời truy vấn thăm dò (`select 1`)." }
    : {
        status: "down",
        reason:
          `PostgreSQL KHÔNG trả lời truy vấn thăm dò trong ${budget} ms — mọi tính năng đọc/ghi dữ liệu ` +
          "và toàn bộ RAG (kho tri thức nằm trong DB) đang hỏng.",
      };

  // ── llama-server ────────────────────────────────────────────────────────────────────────────
  const ep = redactEndpoint(serverUrl);
  if (!serverConfigured) {
    checks.llamaServer = {
      status: "disabled",
      reason: serverEnabled
        ? "LLAMA_SERVER_ENABLED=true nhưng LLAMA_SERVER_URL rỗng — cấu hình tự mâu thuẫn, coi như TẮT."
        : "llama-server TẮT có chủ ý (LLAMA_SERVER_ENABLED khác 'true').",
      detail: { enabled: serverEnabled },
    };
  } else if (!server.reachable) {
    checks.llamaServer = {
      status: "down",
      reason:
        `llama-server (cổng ${ep.port ?? "?"}, ${ep.host}) KHÔNG với tới được: ${server.error ?? "không rõ"}. ` +
        "Tiến trình nhiều khả năng đã chết hoặc chưa khởi động lại sau khi máy reboot — " +
        "chạy `scripts/ai/start-llama-server.ps1` (hoặc tác vụ Task Scheduler tương ứng).",
      detail: { port: ep.port, host: ep.host, expectedModel: configuredServerModel || null },
    };
  } else if (configuredServerModel && server.servedModel && server.servedModel !== configuredServerModel) {
    checks.llamaServer = {
      status: "degraded",
      reason:
        `llama-server SỐNG nhưng đang nạp "${server.servedModel}" trong khi cấu hình khai ` +
        `"${configuredServerModel}" — mã định tuyến so khớp CẤU HÌNH với CẤU HÌNH nên vẫn gửi sang, ` +
        "tức câu trả lời sâu đang do MODEL KHÁC sinh ra mà không có gì báo.",
      detail: { port: ep.port, host: ep.host, servedModel: server.servedModel, expectedModel: configuredServerModel },
    };
  } else {
    checks.llamaServer = {
      status: "ok",
      reason: `llama-server sống trên cổng ${ep.port ?? "?"} (${ep.host}), đang nạp "${server.servedModel ?? configuredServerModel}".`,
      detail: {
        port: ep.port,
        host: ep.host,
        servedModel: server.servedModel,
        slots: server.slots,
        ctxPerSlot: server.ctxPerSlot,
      },
    };
  }

  // ── Đường sinh chữ: SERVER hay IN-PROCESS (hệ con quan trọng nhất) ──────────────────────────
  // Điều kiện định tuyến sao chép NGUYÊN của `aiLlamaServerClient.shouldUseServerForText()`:
  // bật + có URL + basename model sâu KHỚP basename model server khai phục vụ.
  const routedByConfig = serverConfigured && !!configuredServerModel && deepModel === configuredServerModel;
  const IN_PROCESS_COST =
    "đường in-process tạo session MỚI mỗi lượt ⇒ KHÔNG BAO GIỜ tái dùng KV-cache; " +
    "TTFT đo thật 5.304 ms thay vì 71 ms (chậm 44–74× tuỳ độ dài ngữ cảnh)";

  if (routedByConfig && server.reachable) {
    checks.textGeneration = {
      status: "ok",
      reason: `Sinh chữ model sâu đi QUA llama-server (prefix-cache CÒN, KV tái dùng theo slot).`,
      detail: { path: "llama-server", model: deepModel, strict },
    };
  } else if (routedByConfig && !server.reachable) {
    checks.textGeneration = strict
      ? {
          status: "down",
          reason:
            `Sinh chữ được định tuyến sang llama-server nhưng server CHẾT, và LLAMA_SERVER_STRICT=true ` +
            "nên KHÔNG có đường lùi in-process — mọi yêu cầu sinh chữ sâu sẽ ném / rơi về mẫu offline.",
          detail: { path: "none", model: deepModel, strict },
        }
      : {
          status: "degraded",
          reason:
            `llama-server chết ⇒ hệ **đang chạy in-process, MẤT PREFIX-CACHE**. Câu trả lời vẫn ra nên ` +
            `không có gì đỏ ở nơi khác — ${IN_PROCESS_COST}. Đây chính là lỗ "hỏng trong im lặng".`,
          detail: { path: "in-process", model: deepModel, strict, fallback: "silent" },
        };
  } else if (!serverConfigured) {
    checks.textGeneration = {
      status: "degraded",
      reason:
        `Sinh chữ model sâu chạy IN-PROCESS theo cấu hình (llama-server chưa bật) — ${IN_PROCESS_COST}. ` +
        "Không phải hỏng, nhưng KHÔNG phải cấu hình đã nghiệm thu.",
      detail: { path: "in-process", model: deepModel || null, strict },
    };
  } else {
    checks.textGeneration = {
      status: "degraded",
      reason:
        `llama-server bật nhưng GGUF_DEFAULT_MODEL ("${deepModel || "(rỗng)"}") KHÔNG khớp ` +
        `LLAMA_SERVER_MODEL ("${configuredServerModel || "(rỗng)"}") ⇒ mã KHÔNG định tuyến sang server, ` +
        `sinh chữ vẫn IN-PROCESS — ${IN_PROCESS_COST}.`,
      detail: { path: "in-process", model: deepModel || null, servedModelConfigured: configuredServerModel || null, strict },
    };
  }

  // ── Model nhúng (RAG) ───────────────────────────────────────────────────────────────────────
  if (!embedModel) {
    checks.embedding = {
      status: "down",
      reason: "GGUF_EMBED_MODEL chưa được gán — không có model nhúng ⇒ RAG không sinh được vector, trích dẫn tắt.",
    };
  } else if (!embedOnDisk) {
    checks.embedding = {
      status: "down",
      reason: `GGUF_EMBED_MODEL="${embedModel}" nhưng file KHÔNG có trên đĩa ⇒ RAG không sinh được vector, trích dẫn tắt.`,
      detail: { model: embedModel },
    };
  } else {
    checks.embedding = {
      status: "ok",
      reason: `Model nhúng "${embedModel}" có mặt trên đĩa (chạy in-process theo thiết kế).`,
      detail: { model: embedModel },
    };
  }

  // ── Reranker ────────────────────────────────────────────────────────────────────────────────
  if (!rerank) {
    checks.reranker = {
      status: "degraded",
      reason: `Không đọc được trạng thái reranker trong ${budget} ms — KHÔNG kết luận được nó đang xếp hạng hay bỏ qua.`,
    };
  } else if (!rerank.enabled) {
    checks.reranker = { status: "disabled", reason: "Reranker TẮT có chủ ý (RAG_RERANKER_ENABLED khác 'true')." };
  } else if (rerank.mode === "gguf" && rerank.activeBackend !== "gguf") {
    checks.reranker = {
      status: "degraded",
      reason:
        "RAG_RERANKER_MODE=gguf nhưng backend đang phục vụ là " +
        `"${rerank.activeBackend}" — cross-encoder không nạp được, thứ hạng trích dẫn RAG ĐÃ ĐỔI trong im lặng.`,
      detail: { mode: rerank.mode, activeBackend: rerank.activeBackend, modelResolved: rerank.modelResolved },
    };
  } else {
    checks.reranker = {
      status: "ok",
      reason: `Reranker bật, backend đang phục vụ: "${rerank.activeBackend}".`,
      detail: { mode: rerank.mode, activeBackend: rerank.activeBackend },
    };
  }

  // ── Cờ tầng model (dùng lại TIER_FLAG_SPECS — không viết trùng) ──────────────────────────────
  checks.tierFlags =
    tierFindings.length === 0
      ? { status: "ok", reason: "Mọi cờ tầng model đang BẬT đều có đủ model trên đĩa." }
      : {
          status: "degraded",
          reason:
            `${tierFindings.length} cờ tầng model khai BẬT nhưng VÔ HIỆU — cấu hình đang nói SAI sự thật ` +
            "(chi tiết ở `detail.findings`).",
          detail: { findings: tierFindings.map((f) => ({ label: f.label, env: f.env, reason: f.reason })) },
        };

  // ── Tổng hợp ────────────────────────────────────────────────────────────────────────────────
  const names = Object.keys(checks) as CheckName[];
  const worst = names.reduce<SubsystemState>(
    (acc, n) => (RANK[checks[n].status] > RANK[acc] ? checks[n].status : acc),
    "ok",
  );
  const status: "ok" | "degraded" | "down" = worst === "down" ? "down" : worst === "degraded" ? "degraded" : "ok";
  const httpStatus: 200 | 207 | 503 = status === "down" ? 503 : status === "degraded" ? 207 : 200;
  const problems = names
    .filter((n) => checks[n].status === "down" || checks[n].status === "degraded")
    .map((n) => `[${checks[n].status}] ${n}: ${checks[n].reason}`);

  return {
    status,
    ready: status === "ok",
    httpStatus,
    checks,
    problems,
    checkMs: Date.now() - startedAt,
    ts: new Date().toISOString(),
  };
}

// ─── Handler Express ───────────────────────────────────────────────────────────────────────────

/**
 * Handler cho `GET /api/health/ai`. Tách ra khỏi `_core/index.ts` để test được ĐÚNG CÁI ĐANG CHẠY
 * (mount thật vào một app Express, đặt SAU nó một SPA catch-all `app.use("*")` y như `vite.ts`, rồi
 * chứng minh route này KHÔNG bị nuốt) — thay vì test một bản sao chép của logic.
 *
 * `deps` chỉ dùng cho test; sản xuất gọi không tham số ⇒ dùng phép thăm dò thật.
 */
export function createAiReadinessHandler(deps?: AiReadinessDeps): RequestHandler {
  return async (req, res) => {
    try {
      const env = deps?.env ?? process.env;
      // Mặc định CÔNG KHAI (tiện giám sát; phần trả về đã lọc basename/cổng — không khoá, không
      // path tuyệt đối, không hostname). Deployment coi roster model là nhạy cảm thì bật cờ này.
      if ((env.HEALTH_AI_REQUIRE_LOOPBACK || "").trim() === "true" && !isLoopbackRequest(req)) {
        res.status(403).json({
          status: "forbidden",
          reason: "HEALTH_AI_REQUIRE_LOOPBACK=true — chỉ caller loopback được đọc trạng thái AI.",
        });
        return;
      }
      const result = await probeAiReadiness(deps);
      res.setHeader("Cache-Control", "no-store");
      res.status(result.httpStatus).json(result);
    } catch (err: any) {
      // Endpoint SẴN SÀNG không được phép tự nó trở thành "xanh giả": lỗi ⇒ 503 nói thẳng.
      res.status(503).json({
        status: "down",
        ready: false,
        reason: `Không chạy được phép đo sẵn sàng AI: ${String(err?.message ?? err).slice(0, 200)}`,
        ts: new Date().toISOString(),
      });
    }
  };
}
