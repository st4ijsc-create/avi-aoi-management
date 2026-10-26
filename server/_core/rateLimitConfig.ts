/**
 * Rate-limit configuration (extended by W4-D — doc 27 §8 gap B6).
 *
 * Store selection:
 *   - REDIS_URL set (and RATE_LIMIT_REDIS !== "false") → a small Redis-backed
 *     fixed-window store (dedicated ioredis connection — deliberately NOT the
 *     redisService cache client, so cache pipelines and rate-limit INCRs never
 *     queue behind each other). Counters are shared across instances, which
 *     the in-memory default cannot do.
 *   - otherwise → express-rate-limit's built-in MemoryStore (previous
 *     behaviour, unchanged). Single-instance only.
 *
 * Redis-outage posture (R1b-2b-1 T14, kiem-dinh G3 — replaces the old fail-open): every Redis store is wrapped in
 * `StoreDuPhongBoNho` ⇒ if Redis is down, answers `-ERR`, or is slower than `HAN_LENH_REDIS_GIOI_HAN_MS` (250 ms
 * `commandTimeout` on the shared client), each limiter keeps counting with its SAME ceiling in THIS PROCESS's memory
 * (N API instances ⇒ N × the ceiling) instead of letting requests through. `passOnStoreError: true` stays, but only
 * matters if the in-memory store itself throws (then the request is allowed rather than 500-ing all traffic). The
 * client uses `enableOfflineQueue: false` so a dead Redis fails fast instead of buffering commands.
 *
 * Key strategy (API limiter, gap B6 "key theo API-key/user"): machine/API-key
 * clients are keyed by a SHA-256 hash of their `x-api-key`; browser sessions
 * by a hash of the session cookie; bearer tokens by a hash of the token; only
 * anonymous clients fall back to the client IP (IPv6-safe via ipKeyGenerator).
 * This fixes the factory-NAT problem where all machines/operators behind one
 * IP shared a single bucket. Hashing keeps raw credentials out of Redis keys
 * and logs. The AUTH limiter deliberately stays IP-keyed (anti-brute-force on
 * login, where no credential exists yet).
 *
 * NOTE (W2-C interim limiter): machineAuthService's per-machine ingest limiter
 * is a non-pluggable in-memory Map — it stays instance-local for now (see
 * doc 27 Đợt 2 note; honest interim until it grows a pluggable store).
 */
import rateLimit, {
  ipKeyGenerator,
  MemoryStore,
  type ClientRateLimitInfo,
  type Options,
  type Store,
} from "express-rate-limit";
import { createHash } from "crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import Redis from "ioredis";
import { bamPhanDaKy, coHinhJws, docVePhienTuCookie } from "./vePhienCookie";
import { duongDinhTuyen, duongDinhTuyenGoc, duongKhopChinhXac } from "./duongDinhTuyen";

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const API_PER_MIN = envInt("RATE_LIMIT_PER_MINUTE", 300);
const AUTH_PER_15MIN = envInt("AUTH_RATE_LIMIT_PER_15MIN", 30);

export const API_RATE_LIMIT = {
  windowMs: 60 * 1000,
  max: API_PER_MIN,
};

export const AUTH_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  max: AUTH_PER_15MIN,
};

// ── OT machine-ingest tier (doc 48 R3) ───────────────────────────────────────
// Machine→server telemetry ingest (POST /api/ot/ingest) is machine-to-machine
// (authenticated by a per-machine key), NOT browser traffic — so it must NOT ride
// the 300/60 `/api` browser bucket that throttled a real benchmark to ~2541 pts/s.
// It gets its OWN limiter: keyed per machine-key (apiKeyGenerator), a much higher
// but still FINITE default so a legitimate high-rate gateway is un-throttled while a
// runaway client stays capped (never unlimited). ONE knob: OT_INGEST_RATE_MAX =
// requests per 60s window PER machine key. Default 300k/min (≈5000 req/s/key).
const OT_INGEST_PER_MIN = envInt("OT_INGEST_RATE_MAX", 300_000);

export const OT_INGEST_RATE_LIMIT = {
  windowMs: 60 * 1000,
  max: OT_INGEST_PER_MIN,
};

/**
 * The exact path(s) that carry machine telemetry ingest. Shared so the general
 * `/api` limiter can `skip` EXACTLY these paths while the dedicated ingest limiter
 * mounts on them — the exemption and the high tier can never drift apart.
 */
//
// doc 81 Đợt 1B Task 8 — `/api/v1/ingest` (telemetry · process-result · inspection: đường doc 61
// hướng dẫn thiết bị) ĐO được 429 sau 300 request/phút vì rơi vào limiter trình duyệt (BE3 §L4:
// 47.952/48.252 bị 429). Nay đi CÙNG tầng OT (khoá theo credential đã băm, OT_INGEST_RATE_MAX).
// Xác thực vẫn do `requireScope` của router v1 (khoá thiếu/sai ⇒ 401 trước mọi truy cập ghi).
export const OT_INGEST_PATHS = ["/api/ot/ingest", "/api/v1/ingest"] as const;

/**
 * doc 81 Đợt 5 G fix 1 (ruling R-5-b) — đường để PHÂN LOẠI tầng/bucket: bỏ query, hạ chữ thường. Express định tuyến
 * không phân biệt hoa/thường (`/API/ot/ingest` tới đúng route `/api/ot/ingest`), nên so trên đường gốc từng cho
 * biến thể chữ hoa thoát phân loại: bucket ingest khoá theo Bearer ngẫu nhiên (route đó không đọc Bearer ⇒ né trần),
 * bỏ qua credentialConflictGuard, và `/api/machine/Claim` (bootstrap, đích dò mật mã) ăn tầng 60k/phút.
 */
export function duongPhanLoai(req: Request): string {
  // G fix 2 (re-review N1) — CÙNG helper với originCheck: đường Express thật sự định tuyến (absolute-form, `#` đều quy về).
  return duongDinhTuyen(req);
}

/** True when a request targets the high-throughput OT ingest tier (query-string safe, case-insensitive). */
export function isOtIngestRequest(req: Request): boolean {
  const p = duongPhanLoai(req);
  return OT_INGEST_PATHS.some((base) => p === base || p.startsWith(base + "/"));
}

// ── Machine data-plane ingest tier (doc 51 R6 — CASE #2/#9 data loss) ────────
// AVI/AOI machines submit inspections over tRPC (/api/trpc/machineApi.*) and the
// REST proxies (/api/machine/*). Both rode the 300/60 BROWSER bucket: 100 machines
// behind ONE factory NAT offering ~6000 req/min shared a single 300/min bucket →
// ~95% 429. The 429 fires in middleware BEFORE tRPC, so the inspection store-forward
// WAL (which only buffers DbUnavailableError) cannot catch it → inspections are LOST.
// This tier keys per machine credential (see credentialKey) and raises the ceiling.
// ONE knob: MACHINE_INGEST_RATE_MAX = requests per 60s window PER machine key.
// Default 60k/min (1000 req/s per machine) — generous but FINITE (never unlimited).
const MACHINE_INGEST_PER_MIN = envInt("MACHINE_INGEST_RATE_MAX", 60_000);

export const MACHINE_INGEST_RATE_LIMIT = {
  windowMs: 60 * 1000,
  max: MACHINE_INGEST_PER_MIN,
};

/** REST prefix carrying the machine data plane. */
const MACHINE_REST_PREFIX = "/api/machine";

/**
 * Machine REST endpoints that are UNAUTHENTICATED bootstrap surface and therefore
 * must KEEP the general 300/min tier — never the high ingest tier:
 *   - /api/machine/claim    redeems a one-time claim token → brute-force target.
 *   - /api/machine/register self-registration (no key).
 *   - /api/machine/config   public config poll keyed only by serialNumber.
 * Raising these to 60k/min would hand an attacker a 200× brute-force amplifier.
 */
export const MACHINE_BOOTSTRAP_PATHS: readonly string[] = [
  "/api/machine/claim",
  "/api/machine/register",
  "/api/machine/config",
];

/**
 * ALLOWLIST of tRPC procedures on the machine data plane. Deliberately an allowlist,
 * NOT a `machineApi.*` prefix match: machineApi ALSO exposes admin key-management
 * (listKeys/issueKey/rotateKey/revokeKey, protectedProcedure) which is browser traffic
 * and must never inherit the high ingest ceiling.
 */
export const MACHINE_INGEST_TRPC_PROCEDURES: ReadonlySet<string> = new Set([
  "machineApi.submitInspection",
  "machineApi.submitInspectionBatch", // Doc 51 P3 — batch drain (CASE #2/#9); must sit in the machine-ingest tier, not the 300/min browser bucket, or a NAT fleet draining via batch 429s at the middleware.
  "machineApi.uploadImage",
  "machineApi.syncMeasurementPoints",
  "machineApi.heartbeat",
  "machineApi.checkPointsVersion",
  "machineApi.getPoints",
  "machineApi.getProductImage",
  "machineApi.syncProductImage",
  "machineApi.syncPointImage",
  "machineApi.getPointImage",
  "machineApi.deltaSyncPoints",
  "machineApi.getSyncHistory",
  "machineApi.checkModelVersion",
  "machineApi.getModelPackage",
  "machineApi.confirmDeployment",
  "machineApi.edgeHeartbeat",
  "machineApi.syncEdgeResults",
]);

/** Procedure names in a tRPC URL, or null when the path is not tRPC. */
function trpcProcedures(pathname: string): string[] | null {
  const base = "/api/trpc/";
  // R-5-b: tiền tố so không phân biệt hoa/thường (như Express); TÊN thủ tục giữ nguyên (tRPC tra chính xác).
  if (!pathname.toLowerCase().startsWith(base)) return null;
  const seg = pathname.slice(base.length);
  if (!seg) return null;
  // httpBatchLink packs a batch as comma-separated procedure names.
  return seg
    .split(",")
    .map((s) => {
      try {
        return decodeURIComponent(s.trim());
      } catch {
        return s.trim();
      }
    })
    .filter(Boolean);
}

/** The REST half of the machine ingest tier: `/api/machine/*` minus the bootstrap paths. */
export function isMachineRestIngestRequest(req: Request): boolean {
  const p = duongPhanLoai(req);
  if (p === MACHINE_REST_PREFIX || p.startsWith(MACHINE_REST_PREFIX + "/")) {
    // R-5-b: `/api/machine/claim/` tới CÙNG handler (strict:false) ⇒ bỏ MỘT dấu `/` cuối trước khi so danh sách bootstrap.
    return !MACHINE_BOOTSTRAP_PATHS.includes(duongKhopChinhXac(p));
  }
  return false;
}

/**
 * doc 81 Đợt 1B Task 8 fix round 2 — `POST /api/ot/ingest` (the LEGACY OT route, not the
 * /api/v1/ingest alias) authenticates with its OWN precedence (`_core/otIngestRoute.ts`):
 * `X-API-Key` → body `apiKey` → body `machineCode` / `X-Machine-Code`, and NEVER reads Bearer.
 */
export function isLegacyOtIngestRequest(req: Request): boolean {
  const p = duongPhanLoai(req);
  return p === "/api/ot/ingest" || p.startsWith("/api/ot/ingest/");
}

/**
 * True when a request belongs to the machine ingest tier (query-string safe).
 * A tRPC BATCH qualifies only when EVERY procedure in it is an allowlisted machine
 * procedure — otherwise a caller could smuggle expensive browser calls into the high
 * tier by bundling them with one machine procedure.
 */
export function isMachineIngestRequest(req: Request): boolean {
  if (isMachineRestIngestRequest(req)) return true;
  // N1: đường định tuyến (giữ hoa/thường — tRPC tra tên thủ tục chính xác; tiền tố so không phân biệt trong trpcProcedures).
  const procs = trpcProcedures(duongDinhTuyenGoc(req));
  if (procs && procs.length > 0) {
    return procs.every((name) => MACHINE_INGEST_TRPC_PROCEDURES.has(name));
  }
  return false;
}

// ── HMI STOP tier: SCADA R1b-1 Task 2 fix round 1 (important 1) + R1b-2a Task 3 (cap per session of a person) ─────
/**
 * tRPC procedures the general `/api` limiter (300/60 per IP / credential) never counts: the one-step HMI STOP. SCADA screens poll
 * every 2–5 s and HMI terminals behind one proxy share an IP, so the general bucket must never 429 a STOP. The exemption is EXACT and
 * NARROW (`isHmiStopRequest`): a NON-batched `POST /api/trpc/scadaCommands.dungMay` only. A batch — even a batch of one, or one that
 * bundles the STOP with any other call — is counted as before (nothing can ride the exemption). The client sends
 * `scadaCommands.dungMay` through a non-batching `httpLink` (client/src/lib/trpcLinks.ts `isStopOnlyOp`).
 * R1b-1 rà soát cuối I-2: and the request must carry a session token whose JWT signature verifies (`laStopHmiCoPhienKy`).
 * R1b-2a T3 (kiem-dinh limiter): such a request is NOT uncounted any more — it is counted by its OWN tier, `createHmiStopLimiter`
 * (`TRAN_STOP_HMI_MOI_PHUT` = 600 / min per session of a person). Rule: no software cap BELOW 600 / min per session of a person on a signed
 * HMI STOP; each request is counted by exactly one of the two tiers.
 */
export const API_LIMITER_EXEMPT_TRPC: ReadonlySet<string> = new Set(["scadaCommands.dungMay"]);

/** True ⇔ a non-batched POST of exactly one exempt procedure (no `batch` query param, no comma-joined path). */
export function isHmiStopRequest(req: Request): boolean {
  if (String(req.method ?? "").toUpperCase() !== "POST") return false;
  const q = (req as { query?: Record<string, unknown> }).query;
  if (q && Object.prototype.hasOwnProperty.call(q, "batch")) return false;
  const raw = String((req as { originalUrl?: string }).originalUrl ?? (req as { url?: string }).url ?? "");
  const hoi = raw.indexOf("?");
  if (hoi >= 0 && new URLSearchParams(raw.slice(hoi + 1)).has("batch")) return false;
  const procs = trpcProcedures(duongDinhTuyenGoc(req));
  return !!procs && procs.length === 1 && API_LIMITER_EXEMPT_TRPC.has(procs[0]);
}

/**
 * SCADA R1b-1 rà soát cuối I-2 — "yêu cầu mang một phiên có CHỮ KÝ JWT hợp lệ" (stateless: chữ ký + hạn, KHÔNG chạm DB). Mặc định:
 * `trpcGioiHanThuTuc.phienKyHopLe` — CÙNG phép kiểm bước 1 của `robotStopAuth` (`sdk.verifySession`), một chủ (import động: tệp ấy nhập tệp
 * này ⇒ import tĩnh là vòng import).
 */
export type KiemPhienKy = (req: Request) => Promise<boolean>;

/**
 * R1b-2a T3 — ONE verification per request object: the STOP tier's `skip`, its `keyGenerator` and `apiLimiter`'s `skip` all read the
 * same result, so the two tiers can never disagree about one request (e.g. a ticket expiring between two checks ⇒ counted by NEITHER).
 * A failure / throw ⇒ null ⇒ "not a signed STOP" ⇒ counted by the general tier (fail-closed toward counting, never toward skipping).
 */
const _phienTheoYeuCau = new WeakMap<object, Promise<{ openId: string; phienBam: string } | null>>();
/**
 * `phienBam` (R1b-2a T3 fix rounds 1–2) = first 16 hex chars of sha256(the signed part `header.payload` of the VERIFIED ticket). The
 * string comes from `phienKyVaVe` (one cookie parse feeds both the verifier and this hash, and that parse is auth's own reader
 * `vePhienCookie.docVePhienTuCookie` — fix round 3, C-2). It is the "which session" half of the
 * STOP-tier key; the raw token is never logged or stored — only the prefix appears, inside the limiter key.
 */
function phienKyCuaYeuCau(req: Request): Promise<{ openId: string; phienBam: string } | null> {
  let p = _phienTheoYeuCau.get(req);
  if (!p) {
    p = (async () => {
      const { phienKyVaVe } = await import("./trpcGioiHanThuTuc");
      const phien = await phienKyVaVe(req);
      const phienBam = phien ? bamPhanDaKy(phien.ve, 16) : null;
      if (!phien || phienBam === null) return null;
      return { openId: phien.openId, phienBam };
    })().catch(() => null);
    _phienTheoYeuCau.set(req, p);
  }
  return p;
}
const kiemPhienKyMacDinh: KiemPhienKy = async (req) => (await phienKyCuaYeuCau(req)) !== null;

/**
 * True ⇔ `isHmiStopRequest(req)` VÀ phiên của nó qua phép kiểm chữ ký (`kiem`). Trước R1b-1 I-2, miễn trừ chỉ xét method / path / batch ⇒
 * người vô danh (không cookie, cookie rác) gửi được `POST /api/trpc/scadaCommands.dungMay` KHÔNG GIỚI HẠN, mỗi yêu cầu vẫn đi qua parse thân +
 * createContext (đọc auth) + middleware giấy phép rồi mới UNAUTHORIZED — tranh pool DB mà chính STOP cần. Nay: không cookie / cookie rác /
 * chữ ký sai / hết hạn ⇒ ĐẾM ở `apiLimiter` như mọi yêu cầu /api; vé ký hợp lệ ⇒ ĐẾM ở tầng STOP (`createHmiStopLimiter`, 600 / phút theo
 * phiên của một người — R1b-2a T3). Phiên đã thu hồi nhưng vé còn hạn vẫn qua phép kiểm stateless này (như robotStopAuth bước 1) ⇒ nó rơi vào
 * trần 600 / phút của CHÍNH phiên đó (không còn vô hạn; phiên khác của cùng người không bị ảnh hưởng), và vẫn bị createContext từ chối.
 * Phép kiểm lỗi ⇒ false (bị `apiLimiter` đếm, không bao giờ ném
 * ra limiter). Phép kiểm mặc định im lặng (`phienKyHopLe` → `verifySession(…, { imLang: true })`, N-2) và chạy MỘT lần mỗi yêu cầu.
 */
export async function laStopHmiCoPhienKy(req: Request, kiem: KiemPhienKy = kiemPhienKyMacDinh): Promise<boolean> {
  if (!isHmiStopRequest(req)) return false;
  try {
    return (await kiem(req)) === true;
  } catch {
    return false;
  }
}

// ── Store selection (B6) ─────────────────────────────────────────────────────

export type RateLimitStoreKind = "redis" | "memory";

/** Which store the limiters will use, given current env. Pure — exported for tests. */
export function resolveRateLimitStoreKind(): RateLimitStoreKind {
  if (process.env.RATE_LIMIT_REDIS === "false") return "memory"; // escape hatch
  return process.env.REDIS_URL ? "redis" : "memory";
}

/** Minimal Redis surface the store needs — lets tests inject a fake client. */
export interface MinimalRedisClient {
  incr(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
  decr(key: string): Promise<number>;
  del(key: string): Promise<unknown>;
}

/**
 * Fixed-window Redis store for express-rate-limit v7+/v8 (INCR + PEXPIRE).
 * Small on purpose (no extra dependency): INCR the counter, stamp the window
 * TTL on first hit (or when the key somehow lost its TTL), report resetTime
 * from PTTL. Any thrown error (incl. the 250 ms command deadline) is caught by the `StoreDuPhongBoNho` wrapping it.
 */
export class RedisRateLimitStore implements Store {
  /** Counters live in Redis — shared across instances. */
  readonly localKeys = false;
  prefix: string;
  windowMs = 60 * 1000;
  private client: MinimalRedisClient;

  constructor(opts: { prefix: string; client: MinimalRedisClient }) {
    this.prefix = opts.prefix;
    this.client = opts.client;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const k = this.prefix + key;
    const totalHits = await this.client.incr(k);
    let ttl = await this.client.pttl(k);
    if (ttl < 0) {
      // First hit of a window (or TTL lost) — start the window now.
      await this.client.pexpire(k, this.windowMs);
      ttl = this.windowMs;
    }
    return { totalHits, resetTime: new Date(Date.now() + ttl) };
  }

  async decrement(key: string): Promise<void> {
    await this.client.decr(this.prefix + key);
  }

  async resetKey(key: string): Promise<void> {
    await this.client.del(this.prefix + key);
  }
}

/**
 * R1b-2b-1 T14 (kiem-dinh G3, mục 45) — deadline of EVERY command on the limiters' shared ioredis client (`commandTimeout`). A slow-but-alive
 * Redis (each command 2 s) would otherwise hold every request — a signed HMI STOP included — in the Express limiter tier BEFORE tRPC, outside
 * the STOP request's own deadline (`hanStopHmi.ts`). Past the deadline the command throws and `StoreDuPhongBoNho` counts in memory instead.
 * Extra latency in front of tRPC ≤ ~3 × 250 ms (INCR + PTTL + PEXPIRE). Shared by every limiter: that is safe ONLY because every limiter on
 * this client is wrapped in `StoreDuPhongBoNho` (dieu-phoi condition 4, option (b)) — a timeout never turns into fail-open.
 */
export const HAN_LENH_REDIS_GIOI_HAN_MS = 250;

/**
 * R1b-2b-1 T14 — Redis store with an IN-MEMORY fallback. `increment` / `decrement` / `resetKey` go to `chinh` (the Redis store); when it
 * throws (Redis down, `-ERR`, or `HAN_LENH_REDIS_GIOI_HAN_MS` exceeded) the SAME key goes to `duPhong` (express-rate-limit's MemoryStore) ⇒
 * the limiter keeps counting with the SAME ceiling, but PER PROCESS (N API instances ⇒ N × the ceiling) — never fail-open. `chinh` absent
 * (memory mode) ⇒ only `duPhong`. `init` reaches BOTH stores (C4: a MemoryStore that is never initialised has no window and never resets —
 * a permanent lock-out). Logs at most one line per 60 s per store. `prefix` / `localKeys` are the primary's, so express-rate-limit's
 * double-count check keys on the same `rl:<tier>:` namespace as before.
 * `resetKey` also clears `duPhong` (a count made during an outage must not outlive an explicit reset).
 */
export class StoreDuPhongBoNho implements Store {
  readonly localKeys: boolean;
  readonly prefix?: string;
  private lanLogCuoi = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly chinh: Store | undefined,
    private readonly duPhong: Store,
  ) {
    this.localKeys = chinh ? chinh.localKeys === true : true;
    this.prefix = chinh?.prefix ?? duPhong.prefix;
  }

  init(options: Options): void {
    try {
      this.duPhong.init?.(options);
    } finally {
      this.chinh?.init?.(options);
    }
  }

  private ghiLog(e: unknown): void {
    const bay = Date.now();
    if (bay - this.lanLogCuoi < 60_000) return;
    this.lanLogCuoi = bay;
    console.warn(
      `[RateLimit] ${this.prefix ?? ""} Redis store failed — counting in THIS PROCESS's memory (same ceiling, per process) until Redis answers again:`,
      e instanceof Error ? e.message : e,
    );
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    if (!this.chinh) return this.duPhong.increment(key);
    try {
      return await this.chinh.increment(key);
    } catch (e) {
      this.ghiLog(e);
      return this.duPhong.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    if (!this.chinh) return void (await this.duPhong.decrement(key));
    try {
      await this.chinh.decrement(key);
    } catch (e) {
      this.ghiLog(e);
      await this.duPhong.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.duPhong.resetKey(key);
    if (!this.chinh) return;
    try {
      await this.chinh.resetKey(key);
    } catch (e) {
      this.ghiLog(e);
    }
  }
}

// One shared (lazy) ioredis connection for all limiters in this process.
let _redisClient: MinimalRedisClient | null = null;
let _redisInitFailed = false;

/** The limiters' shared client (lazy). Exported for tests (`client.options.commandTimeout`). */
export function getRateLimitRedis(): MinimalRedisClient | null {
  if (_redisClient || _redisInitFailed) return _redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    // Dedicated connection: rate-limit INCRs must not queue behind cache
    // pipelines (redisService), and redisService gives up reconnecting after
    // 3 tries while a limiter store should keep trying (capped backoff).
    const client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false, // fail fast → StoreDuPhongBoNho counts in memory
      maxRetriesPerRequest: 1,
      commandTimeout: HAN_LENH_REDIS_GIOI_HAN_MS, // T14: slow-but-alive Redis ⇒ throw ⇒ memory fallback, never a held request
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    });
    client.on("error", (err: Error) => {
      console.error("[RateLimit] Redis store error (limiters count in process memory):", err.message);
    });
    client.connect().catch((err: Error) => {
      console.error("[RateLimit] Redis store initial connect failed (limiters count in process memory):", err.message);
    });
    _redisClient = client;
    console.log("[RateLimit] Using Redis-backed rate-limit store");
  } catch (err: any) {
    _redisInitFailed = true;
    console.error("[RateLimit] Redis store init failed — falling back to memory:", err?.message ?? err);
  }
  return _redisClient;
}

/**
 * `{ store }` option when Redis mode is active, `{}` for the memory default. THE one place every limiter here (and `taoStoreDem`) gets its
 * store — R1b-2b-1 T14: the Redis store is ALWAYS wrapped in `StoreDuPhongBoNho` ⇒ Redis down / erroring / slower than
 * `HAN_LENH_REDIS_GIOI_HAN_MS` ⇒ each limiter counts in process memory with its own ceiling (never fail-open).
 */
function storeOption(prefix: string): { store?: Store } {
  if (resolveRateLimitStoreKind() !== "redis") return {};
  const client = getRateLimitRedis();
  if (!client) return {}; // init failed → memory fallback
  return { store: new StoreDuPhongBoNho(new RedisRateLimitStore({ prefix, client }), new MemoryStore()) };
}

/**
 * Store ĐẾM cho bộ giới hạn theo SỐ THỦ TỤC (`trpcGioiHanThuTuc.ts`): Redis khi bật chế độ redis (dùng chung nhiều instance), ngược lại bộ nhớ. `init` đặt cửa sổ đếm.
 * R1b-2b-1 T14: ở chế độ redis store là `StoreDuPhongBoNho` ⇒ Redis sập / lỗi / chậm quá 250 ms ⇒ đếm trong bộ nhớ tiến trình (cùng ngưỡng, theo tiến trình),
 * KHÔNG ném ⇒ nhánh "store lỗi — FAIL-OPEN" của middleware chỉ còn khi chính bộ nhớ ném.
 */
export function taoStoreDem(prefix: string, windowMs: number): Store {
  const s: Store = storeOption(prefix).store ?? new MemoryStore();
  s.init?.({ windowMs } as Options);
  return s;
}

// ── Key strategy (B6) ────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 32);
}

/** Longest credential we will hash — a real key is ~40-200 chars. */
const MAX_CREDENTIAL_LEN = 512;
/** Upper bound on tRPC batch entries scanned for a credential. */
const MAX_BATCH_SCAN = 20;

function cleanCredential(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, MAX_CREDENTIAL_LEN) : null;
}

/** Read `field` off one payload node, unwrapping the tRPC `{ json: ... }` envelope. */
function pickFromNode(node: unknown, field: string): string | null {
  if (!node || typeof node !== "object") return null;
  const o = node as Record<string, unknown>;
  const direct = cleanCredential(o[field]);
  if (direct) return direct;
  const j = o.json; // tRPC / superjson envelope: { json: { apiKey, ... } }
  if (j && typeof j === "object") {
    const nested = cleanCredential((j as Record<string, unknown>)[field]);
    if (nested) return nested;
  }
  return null;
}

/**
 * Read `field` from a parsed request body, covering every shape a machine uses:
 *   REST proxy       → { apiKey, ... }
 *   tRPC httpLink    → { json: { apiKey, ... } }
 *   tRPC batchLink   → { "0": { json: { apiKey, ... } }, "1": ... }
 */
function pickFromBody(body: unknown, field: string): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const direct = pickFromNode(body, field);
  if (direct) return direct;

  const o = body as Record<string, unknown>;
  let scanned = 0;
  for (const k of Object.keys(o)) {
    if (!/^\d+$/.test(k)) continue;
    if (++scanned > MAX_BATCH_SCAN) break;
    const v = pickFromNode(o[k], field);
    if (v) return v;
  }
  return null;
}

/**
 * doc 51 R6 rollback switch. Body/query credential keying only ever SPLITS a shared
 * bucket into per-machine buckets (strictly more permissive — it can never throttle a
 * client that today passes), so the default is ON. Set RATE_LIMIT_BODY_KEY=false to
 * restore the exact pre-R6 header-only behaviour.
 */
function bodyKeyEnabled(): boolean {
  return process.env.RATE_LIMIT_BODY_KEY !== "false";
}

/**
 * The bearer / x-api-key credential EXACTLY as the auth layers read it — `api/v1/auth.ts`
 * `extractKey` and `machineApiRouters.ts` `machineHeaderKey`: `Authorization: Bearer <tok>`
 * (scheme case-insensitive, token trimmed) FIRST, then `X-API-Key` (trimmed). Exported for tests.
 */
export function headerCredentials(req: Request): { bearer: string | null; xApiKey: string | null } {
  let bearer: string | null = null;
  const auth = req.headers?.authorization;
  if (typeof auth === "string" && /^bearer\s+/i.test(auth)) {
    const tok = auth.replace(/^bearer\s+/i, "").trim();
    if (tok) bearer = tok.slice(0, MAX_CREDENTIAL_LEN);
  }
  const x = req.headers?.["x-api-key"];
  const xApiKey = typeof x === "string" && x.trim() ? x.trim().slice(0, MAX_CREDENTIAL_LEN) : null;
  return { bearer, xApiKey };
}

/**
 * The credential-derived bucket key, or null when the request carries no credential
 * at all. Order: Bearer > x-api-key header > session cookie > body apiKey >
 * query apiKey > machineCode. Credentials are hashed — never stored/logged raw.
 *
 * doc 81 Đợt 1B Task 8 fix round 1 — the bucket MUST follow the credential that AUTH uses,
 * otherwise a client authenticates with `Bearer K` while rotating a random `X-API-Key` per
 * request and gets a fresh bucket every time. Header precedence therefore mirrors
 * `headerCredentials` (bearer first, case-insensitive), and on the MACHINE data plane (OT ingest
 * + allowlisted machine procedures — which never authenticate by session) the body/query key
 * outranks a session cookie for the same reason. `credentialConflictGuard` additionally 400s a
 * request that carries two DIFFERENT credentials.
 *
 * doc 51 R6: the header-only version silently fell through to the client IP for
 * machines that send their key in the tRPC BODY (`{json:{apiKey}}`) or the query
 * string (the GET machine endpoints) — which the machine contract explicitly allows.
 * Every machine behind one factory NAT then collapsed into ONE IP bucket. Body/query
 * keys reuse the `key:` prefix so a machine that switches transport (header ⇄ body)
 * keeps the SAME bucket identity instead of being double-counted.
 */
function credentialKey(req: Request): string | null {
  const { bearer, xApiKey } = headerCredentials(req);
  // fix round 2 — /api/ot/ingest: bucket = the credential THAT route authenticates with (it never
  // reads Bearer). Otherwise a random Bearer per request + machineCode-only auth = fresh bucket.
  if (isLegacyOtIngestRequest(req)) {
    if (xApiKey) return `key:${hashToken(xApiKey)}`;
    try {
      const bodyKey = pickFromBody(req.body, "apiKey");
      if (bodyKey) return `key:${hashToken(bodyKey)}`;
      const hdrCode = req.headers?.["x-machine-code"];
      const code = pickFromBody(req.body, "machineCode") ?? cleanCredential(hdrCode);
      if (code) return `mcode:${hashToken(code)}`;
    } catch {
      // extraction must never break the limiter — fall through to the IP bucket.
    }
    return null;
  }
  if (bearer) return `bearer:${hashToken(bearer)}`;
  if (xApiKey) return `key:${hashToken(xApiKey)}`;

  const sessionKey = (): string | null => {
    const ve = docVePhienTuCookie(req.headers?.cookie);
    return ve ? `sess:${hashToken(ve)}` : null;
  };
  const machinePlane = isOtIngestRequest(req) || isMachineIngestRequest(req);
  if (!machinePlane) {
    const sess = sessionKey();
    if (sess) return sess;
  }

  if (bodyKeyEnabled()) {
    try {
      const q = req.query as Record<string, unknown> | undefined;
      const bodyKey = pickFromBody(req.body, "apiKey") ?? cleanCredential(q?.apiKey);
      if (bodyKey) return `key:${hashToken(bodyKey)}`;
      // machineCode-only is a WEAK auth path (machineAuthService) but still identifies a
      // single machine — far better than collapsing the whole factory onto one IP bucket.
      const code = pickFromBody(req.body, "machineCode") ?? cleanCredential(q?.machineCode);
      if (code) return `mcode:${hashToken(code)}`;
    } catch {
      // Key extraction must NEVER break the limiter — fall through to the IP bucket.
    }
  }
  return machinePlane ? sessionKey() : null;
}

/**
 * doc 81 Đợt 1B Task 8 fix round 1 — a request carrying two DIFFERENT credentials among
 * `Authorization: Bearer`, `X-API-Key` and the body `apiKey` is rejected with 400 BEFORE any
 * limiter counts it: the limiter and the auth layer must never be able to disagree about who
 * is calling. Same value in several places (the SDKs send `Bearer K` + `X-API-Key: K`, the
 * heartbeat sends header + body) passes. Mounted with the limiters in `_core/index.ts`, but it
 * acts ONLY on the machine data plane (fix round 2 — see the first lines of the function).
 */
export function credentialConflictGuard(req: Request, res: Response, next: NextFunction): void {
  // fix round 2 — ONLY the machine data plane: /api/ot/ingest, /api/v1/ingest/*, /api/machine/*.
  // NOT tRPC and NOT the rest of /api: FactoryAlertSystem (in-repo) legitimately sends
  // `Authorization: Bearer <session JWT>` + `x-api-key: <configured key>` (+ body apiKey) on
  // /api/trpc/publicProductApi.* and /api/trpc/machineApi.* — a 400 there broke the app after login.
  if (!(isOtIngestRequest(req) || isMachineRestIngestRequest(req))) {
    next();
    return;
  }
  let distinct = 0;
  try {
    const { bearer, xApiKey } = headerCredentials(req);
    const bodyKey = pickFromBody(req.body, "apiKey");
    // /api/ot/ingest never reads Bearer (its bucket ignores it too) ⇒ only X-API-Key vs body apiKey.
    const creds = isLegacyOtIngestRequest(req) ? [xApiKey, bodyKey] : [bearer, xApiKey, bodyKey];
    distinct = new Set(creds.filter((v): v is string => !!v)).size;
  } catch {
    distinct = 0; // extraction must never break the request path
  }
  if (distinct > 1) {
    const message =
      "Request carries more than one different credential (Authorization Bearer / X-API-Key / body apiKey) — send exactly one.";
    if (duongPhanLoai(req).startsWith("/api/v1/")) {
      // /api/v1 envelope {ok:false, error:{code,message}} — the SDKs read error.code.
      res.status(400).json({ ok: false, error: { code: "conflicting_credentials", message } });
    } else {
      res.status(400).json({ ok: false, code: "conflicting_credentials", error: message });
    }
    return;
  }
  next();
}

/** True when the request carries an identifying credential (i.e. is not IP-keyed). */
export function hasCredentialKey(req: Request): boolean {
  return credentialKey(req) !== null;
}

/**
 * Per-client key for the general API limiter: bearer token > API-key >
 * session cookie > body/query machine credential > IP (machine data plane: body/query
 * credential before the session cookie — see credentialKey). Credentials are hashed —
 * never stored/logged raw. The IP fallback is deliberately UN-prefixed (bare
 * ipKeyGenerator output) so it stays compatible with pre-B6 behaviour
 * (`limiter.resetKey("<ip>")`). Exported for tests.
 */
export function apiKeyGenerator(req: Request): string {
  return credentialKey(req) ?? ipKeyGenerator(req.ip ?? "", 56);
}

/**
 * W21 (kiểm định 2026-10-25) — khoá của limiter /api CHUNG theo PHIÊN CHỈ KHI phiên qua phép kiểm chữ ký.
 * Lỗ cũ: `apiKeyGenerator` băm GIÁ TRỊ cookie / Bearer chưa kiểm chữ ký ⇒ kẻ vô danh xoay giá trị rác mỗi yêu cầu được MỘT XÔ MỚI (300/phút) mỗi lần ⇒ vượt limiter chung.
 * Nay: cookie phiên / Bearer có HÌNH JWT (3 đoạn) → `phienKyHopLeTuVe` (HS256 jose qua sdk.verifySession ở `trpcGioiHanThuTuc`, stateless, cùng phép kiểm tầng STOP `laStopHmiCoPhienKy`); qua ⇒ khoá theo PHẦN ĐÃ KÝ
 * (`sha256(header.payload)`, KHÔNG băm cả token: jose chấp nhận biến thể đoạn chữ ký của cùng một vé ⇒ băm cả token vẫn xoay được); không qua ⇒ khoá theo IP.
 * Không đổi: mặt phẳng máy (OT ingest / machine ingest — limiter riêng), `X-API-Key`, Bearer KHÔNG có hình JWT (khoá API) — vẫn theo `apiKeyGenerator`.
 */
export type KiemChuKyPhien = (token: string) => Promise<boolean>;
const kiemChuKyMacDinh: KiemChuKyPhien = async (token) => {
  const { phienKyHopLeTuVe } = await import("./trpcGioiHanThuTuc"); // CÙNG chủ phép kiểm chữ ký với laStopHmiCoPhienKy (import động: tệp ấy nhập tệp này)
  return (await phienKyHopLeTuVe(token)) !== null;
};

export async function apiKeyGeneratorXacThuc(req: Request, kiem: KiemChuKyPhien = kiemChuKyMacDinh): Promise<string> {
  const ip = () => ipKeyGenerator(req.ip ?? "", 56);
  if (isLegacyOtIngestRequest(req) || isOtIngestRequest(req) || isMachineIngestRequest(req)) return apiKeyGenerator(req);
  const { bearer, xApiKey } = headerCredentials(req);
  let token: string | null = null;
  let tienTo = "sess";
  if (bearer) {
    if (!coHinhJws(bearer)) return apiKeyGenerator(req); // khoá API (không phải JWT): giữ nguyên
    token = bearer;
    tienTo = "bearer";
  } else if (!xApiKey) {
    // ĐÚNG bộ phân tích của `vePhienCookie.docVePhienTuCookie` (thư viện `cookie`: cắt khoảng trắng, bỏ nháy, giải %-mã, tên lặp ⇒ lần ĐẦU) — không cắt chuỗi thô ⇒ mọi biến thể
    // văn bản mà auth coi là CÙNG một vé cũng rơi vào CÙNG một lớp khoá (phiên đã ký / IP).
    const cookies = req.headers?.cookie;
    if (typeof cookies === "string" && cookies.length > 0) {
      try {
        const v = docVePhienTuCookie(cookies);
        if (v) token = v;
      } catch {
        return ip();
      }
    }
  }
  if (token === null) return apiKeyGenerator(req);
  const bam = bamPhanDaKy(token, 32);
  try {
    if (bam !== null && (await kiem(token))) return `${tienTo}:${bam}`;
  } catch {
    /* phép kiểm lỗi ⇒ coi như không verify được */
  }
  return ip();
}

// ── Limiter factories ────────────────────────────────────────────────────────

export function createApiLimiter() {
  return rateLimit({
    ...API_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
    keyGenerator: (req: Request) => apiKeyGeneratorXacThuc(req),
    // doc 48 R3: EXEMPT the machine telemetry ingest path from the 300/60 browser
    // tier — it is governed by the dedicated createOtIngestLimiter high tier instead.
    // doc 51 R6: likewise EXEMPT the machine data plane (/api/machine/*, allowlisted
    // machineApi tRPC procedures) — governed by createMachineIngestLimiter. Each path
    // is counted by EXACTLY ONE limiter, so the tiers can never double-count.
    // Browser/tRPC traffic is unaffected (skip returns false for every other path).
    // SCADA R1b-1 T2 fix round 1: likewise EXEMPT a non-batched HMI STOP (`isHmiStopRequest`) — the general bucket never 429s a STOP.
    // R1b-1 rà soát cuối I-2: ONLY when it carries a session token with a valid JWT signature (`laStopHmiCoPhienKy`) — anonymous / junk-cookie
    // floods of dungMay are counted like any other /api request.
    // R1b-2a T3: the exempted request is counted by `createHmiStopLimiter` instead (600 / min per session of a person) — exactly one tier counts it.
    skip: async (req: Request) => isOtIngestRequest(req) || isMachineIngestRequest(req) || (await laStopHmiCoPhienKy(req)),
    passOnStoreError: true, // Redis down / slow ⇒ counted in process memory (StoreDuPhongBoNho, T14); allow only if memory itself throws — never 500 all traffic
    ...storeOption("rl:api:"),
  });
}

/**
 * R1b-2a T3 (kiem-dinh limiter, Q3 duyệt — hằng trong mã, KHÔNG biến môi trường) — trần STOP HMI theo PHIÊN CỦA MỘT NGƯỜI mỗi phút. Một người bấm tay
 * không bao giờ chạm 600 lần / phút ⇒ STOP của người đăng nhập không bị 429 khi dùng bình thường; lạm dụng (kể cả vé đã thu hồi mà còn hạn)
 * vẫn bị chặn trên.
 */
export const TRAN_STOP_HMI_MOI_PHUT = 600;

/**
 * R1b-2a T3 — the DEDICATED HMI STOP tier. Counts ONLY a non-batched `POST /api/trpc/scadaCommands.dungMay` whose session ticket verifies
 * (`laStopHmiCoPhienKy`) — exactly the requests `createApiLimiter` skips — keyed per SESSION OF A PERSON
 * (`hmistop:u:<openId>:<first 16 hex of sha256 of the signed part header.payload>`, R1b-2a T3 fix rounds 1–2 — `phanDaKyCuaVe`; a
 * re-encoded signature segment of the same ticket lands in the SAME bucket): N operators behind one NAT / proxy each get their
 * own 600 / min, and a stolen / revoked-but-unexpired ticket only exhausts ITS OWN bucket — the real user's current session keeps its own
 * 600 / min. Tickets cannot be minted without the session secret, so the total stays bounded (logins are themselves rate-limited). The raw
 * token is never logged or stored: only the 16-hex hash prefix appears, inside the limiter key.
 * Everything else is `skip`ped here and counted by the general tier. Mounted BEFORE `apiLimiter` on `/api/` only (_core/index.ts) — the STOP
 * classifier matches `/api/trpc` only and no tRPC router is mounted on `/trpc`.
 * No DB on this path: the ticket check is stateless (signature + expiry) and shared with the general tier (one verification per request).
 * Redis outage (R1b-2b-1 T14, kiem-dinh G3 — replaces the c4 fail-open): while Redis is down, erroring or slower than
 * `HAN_LENH_REDIS_GIOI_HAN_MS` (250 ms), this tier counts in THIS PROCESS's memory (`StoreDuPhongBoNho`) ⇒ a signed STOP is still capped at
 * `TRAN_STOP_HMI_MOI_PHUT` (600) / min per session PER PROCESS (N API instances ⇒ N × 600), and the limiter tier adds at most ~3 × 250 ms
 * in front of tRPC. `passOnStoreError: true` stays only for the case where the in-memory store itself throws (a store failure must never 500 a STOP).
 */
export function createHmiStopLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    max: TRAN_STOP_HMI_MOI_PHUT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many STOP requests — use the hard E-STOP" },
    keyGenerator: async (req: Request) => {
      // `skip` already proved a signed ticket (same memoised result) ⇒ the session branch is the live one. The fallback only exists so a
      // key-generator failure can never 500 a STOP: it keys by the general (hashed) credential under this tier's own namespace.
      try {
        const phien = await phienKyCuaYeuCau(req);
        if (phien) return `hmistop:u:${phien.openId}:${phien.phienBam}`;
      } catch {
        /* fall through */
      }
      return `hmistop:k:${apiKeyGenerator(req)}`;
    },
    skip: async (req: Request) => !(await laStopHmiCoPhienKy(req)),
    passOnStoreError: true, // only if the in-memory fallback itself throws — Redis down / slow ⇒ counted in memory (T14, see JSDoc); never 500 a STOP
    ...storeOption("rl:hmistop:"),
  });
}

/**
 * W21b — TRẦN IP THỨ HAI, hẹp: CHỈ cho yêu cầu mang thông tin xác thực CHƯA verify được ở tầng limiter (Bearer KHÔNG có hình JWT, hoặc X-API-Key — khoá API/khoá máy chỉ tra được ở DB).
 * Lỗ còn lại sau W21: `apiKeyGenerator` khoá các thứ này theo GIÁ TRỊ ⇒ kẻ xoay giá trị rác mỗi yêu cầu được xô 300/phút MỚI mỗi lần. Trần này đếm theo IP (cùng `req.ip` /
 * cấu hình trust proxy hiện có), rộng (mặc định 3000/phút, `RATE_LIMIT_UNVERIFIED_IP_PER_MINUTE`) để khách API thật sau NAT không bị ảnh hưởng, độc lập với khoá của limiter chung.
 * KHÔNG áp cho: phiên đã verify (cookie / Bearer JWT — W21), mặt phẳng máy (limiter riêng). Chạm trần ⇒ 429 + log cảnh báo (tối đa 1 dòng/IP/cửa sổ) để biết khách thật có bị ảnh hưởng.
 */
const UNVERIFIED_IP_PER_MIN = envInt("RATE_LIMIT_UNVERIFIED_IP_PER_MINUTE", 3000);

/** True ⇔ yêu cầu mang credential chưa verify được ở tầng limiter (và không thuộc mặt phẳng máy). Pure — exported cho test. */
export function mangCredentialChuaVerify(req: Request): boolean {
  if (isLegacyOtIngestRequest(req) || isOtIngestRequest(req) || isMachineIngestRequest(req)) return false;
  const { bearer, xApiKey } = headerCredentials(req);
  if (bearer) return !coHinhJws(bearer); // Bearer JWT: do khoá phiên (W21) xử lý
  return !!xApiKey;
}

export function createUnverifiedCredentialIpLimiter() {
  const daCanhBao = new Map<string, number>();
  return rateLimit({
    windowMs: 60 * 1000,
    max: UNVERIFIED_IP_PER_MIN,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
    keyGenerator: (req: Request) => `uip:${ipKeyGenerator(req.ip ?? "", 56)}`,
    skip: (req: Request) => !mangCredentialChuaVerify(req),
    handler: (req: Request, res: Response) => {
      const ip = ipKeyGenerator(req.ip ?? "", 56);
      const now = Date.now();
      if (now - (daCanhBao.get(ip) ?? 0) > 60_000) {
        daCanhBao.set(ip, now);
        if (daCanhBao.size > 10_000) daCanhBao.clear();
        console.warn(`[RateLimit] IP ${ip} chạm trần ${UNVERIFIED_IP_PER_MIN}/phút cho yêu cầu mang credential chưa verify (Bearer không-JWT / X-API-Key) — nếu là khách API thật sau NAT, nâng RATE_LIMIT_UNVERIFIED_IP_PER_MINUTE`);
      }
      res.status(429).json({ error: "Too many requests, please try again later" });
    },
    passOnStoreError: true,
    ...storeOption("rl:api-uip:"),
  });
}

export function createAuthLimiter() {
  return rateLimit({
    ...AUTH_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many login attempts, please try again later" },
    // Deliberately IP-keyed (default): brute-force protection happens before
    // any credential exists to key on.
    passOnStoreError: true,
    ...storeOption("rl:auth:"),
  });
}

/**
 * doc 48 R3 — the DEDICATED machine telemetry ingest limiter. Keyed per machine-key
 * (apiKeyGenerator → hashed x-api-key; IP fallback for the keyless case), high default
 * (OT_INGEST_RATE_MAX, 300k/min) so a gateway pushing hundreds of thousands of
 * points/sec is NOT throttled, yet a runaway client is still capped (finite, never
 * unlimited). Mounted on OT_INGEST_PATHS BEFORE the general `/api` limiter (which
 * `skip`s those same paths). Auth (machine key) is enforced by the route handler.
 */
export function createOtIngestLimiter() {
  return rateLimit({
    ...OT_INGEST_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "OT ingest rate limit exceeded" },
    keyGenerator: apiKeyGenerator,
    passOnStoreError: true, // Redis down / slow ⇒ counted in process memory (StoreDuPhongBoNho, T14); allow only if memory itself throws — never 500 the ingest path
    ...storeOption("rl:otingest:"),
  });
}

/**
 * doc 51 R6 — the DEDICATED machine data-plane limiter (inspection submit, image
 * upload, point sync, heartbeat …). Mounted on `/api/` BEFORE the general limiter and
 * `skip`ping everything that is not machine ingest, so ONE mount covers both the REST
 * proxies and the tRPC procedures while the general limiter skips those exact requests.
 *
 * The ceiling is CREDENTIAL-DEPENDENT on purpose (QĐ#1 — siết phải có kiểm soát):
 *   - credentialed (real machine, per-key bucket) → MACHINE_INGEST_RATE_MAX (60k/min)
 *   - keyless (IP-keyed) → API_PER_MIN, i.e. EXACTLY today's 300/min
 * Without that split, exempting /api/machine/* from the general tier would have handed
 * an anonymous attacker a 200× amplifier on the un-authenticated machine surface.
 * `standardHeaders: true` makes express-rate-limit emit `Retry-After` on every 429, so
 * a client draining a backlog after an outage knows how long to back off (CASE #2).
 */
export function createMachineIngestLimiter() {
  return rateLimit({
    ...MACHINE_INGEST_RATE_LIMIT,
    max: (req: Request) => (hasCredentialKey(req) ? MACHINE_INGEST_PER_MIN : API_PER_MIN),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Machine ingest rate limit exceeded" },
    keyGenerator: apiKeyGenerator,
    skip: (req: Request) => !isMachineIngestRequest(req),
    passOnStoreError: true, // Redis down / slow ⇒ counted in process memory (StoreDuPhongBoNho, T14); allow only if memory itself throws — never 500 the ingest path
    ...storeOption("rl:machingest:"),
  });
}
