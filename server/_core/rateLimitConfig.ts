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
 * Fail-open posture: `passOnStoreError: true` — if Redis is down, requests are
 * ALLOWED (and the error logged) instead of 500-ing all traffic. The store
 * client uses `enableOfflineQueue: false` so a dead Redis fails fast instead
 * of buffering commands.
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
  type ClientRateLimitInfo,
  type Options,
  type Store,
} from "express-rate-limit";
import { createHash } from "crypto";
import type { NextFunction, Request, Response } from "express";
import Redis from "ioredis";
import { COOKIE_NAME } from "@shared/const";
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
 * from PTTL. Any thrown error is handled by the limiter's passOnStoreError.
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

// One shared (lazy) ioredis connection for all limiters in this process.
let _redisClient: MinimalRedisClient | null = null;
let _redisInitFailed = false;

function getRateLimitRedis(): MinimalRedisClient | null {
  if (_redisClient || _redisInitFailed) return _redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    // Dedicated connection: rate-limit INCRs must not queue behind cache
    // pipelines (redisService), and redisService gives up reconnecting after
    // 3 tries while a limiter store should keep trying (capped backoff).
    const client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false, // fail fast → passOnStoreError lets requests through
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    });
    client.on("error", (err: Error) => {
      console.error("[RateLimit] Redis store error (fail-open):", err.message);
    });
    client.connect().catch((err: Error) => {
      console.error("[RateLimit] Redis store initial connect failed (fail-open):", err.message);
    });
    _redisClient = client;
    console.log("[RateLimit] Using Redis-backed rate-limit store");
  } catch (err: any) {
    _redisInitFailed = true;
    console.error("[RateLimit] Redis store init failed — falling back to memory:", err?.message ?? err);
  }
  return _redisClient;
}

/** `{ store }` option when Redis mode is active, `{}` for the memory default. */
function storeOption(prefix: string): { store?: Store } {
  if (resolveRateLimitStoreKind() !== "redis") return {};
  const client = getRateLimitRedis();
  if (!client) return {}; // init failed → memory fallback
  return { store: new RedisRateLimitStore({ prefix, client }) };
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
    const cookies = req.headers?.cookie;
    if (typeof cookies === "string" && cookies.length > 0) {
      const m = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
      if (m?.[1]) return `sess:${hashToken(m[1])}`;
    }
    return null;
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

// ── Limiter factories ────────────────────────────────────────────────────────

export function createApiLimiter() {
  return rateLimit({
    ...API_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
    keyGenerator: apiKeyGenerator,
    // doc 48 R3: EXEMPT the machine telemetry ingest path from the 300/60 browser
    // tier — it is governed by the dedicated createOtIngestLimiter high tier instead.
    // doc 51 R6: likewise EXEMPT the machine data plane (/api/machine/*, allowlisted
    // machineApi tRPC procedures) — governed by createMachineIngestLimiter. Each path
    // is counted by EXACTLY ONE limiter, so the tiers can never double-count.
    // Browser/tRPC traffic is unaffected (skip returns false for every other path).
    skip: (req: Request) => isOtIngestRequest(req) || isMachineIngestRequest(req),
    passOnStoreError: true, // Redis down → allow (fail-open), never 500 all traffic
    ...storeOption("rl:api:"),
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
    passOnStoreError: true, // Redis down → allow (fail-open), never 500 the ingest path
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
    passOnStoreError: true, // Redis down → allow (fail-open), never 500 the ingest path
    ...storeOption("rl:machingest:"),
  });
}
