/**
 * Liveness / readiness probes — doc 44 W6-4 (gap G5.25). SYNAPSE_Tang5 Ch.15.
 *
 * Splits the single legacy `/health` into the two Kubernetes/ArgoCD-standard probes a
 * shadow→canary rollout gates on:
 *
 *   • /livez  — LIVENESS: is the process up? Always 200 unless the event loop is dead.
 *               Must NOT check dependencies (a DB blip must not trigger a pod restart).
 *   • /readyz — READINESS: can this instance serve traffic? Checks DB (hard gate) +
 *               broker (informational). 503 until ready — the canary gate holds the new
 *               revision out of the rollout until it flips green.
 *
 * The checkers are injectable so the logic is unit-testable without a live DB/broker.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════
 * doc 81 Đợt 1B Task 11 — `/health`, `/readyz` NÓI THẬT (BE3 §L7).
 * ĐO trước khi vá: cả hai chỉ kiểm `Boolean(getDb())`. `getDb()` trả đối tượng drizzle đã
 * cache (postgres.js nối LƯỜI) ⇒ truthy mọi lúc có DATABASE_URL ⇒ báo OK cả khi Postgres sập.
 * Nay:
 *   • DB được hỏi bằng `SELECT 1` THẬT, hạn DB_PING_TIMEOUT_MS (1500 ms) — `getDb()` treo hay
 *     truy vấn treo đều bị cắt; lỗi / quá hạn / null ⇒ "down".
 *   • MỘT lượt ping bay tại một thời điểm (single-flight): 20 probe đồng thời khi DB treo ⇒ đúng
 *     1 truy vấn, không vét cạn pool. Lượt bay bị bỏ rơi sau INFLIGHT_BO_ROI_MS để khi DB hồi
 *     phục lượt sau hỏi lại được (rò tối đa 1 truy vấn treo mỗi 10 s).
 *   • `/readyz` (createReadyzHandler): kết quả SELECT 1 cũ tối đa READYZ_DB_CACHE_MS (1 s — chặn
 *     lũ probe vô danh thành lũ truy vấn); DB down ⇒ 503 `{db:"down"}`.
 *   • `/health` (createHealthHandler) là LIVENESS: luôn 200 khi tiến trình trả lời được (DB chập
 *     chờn KHÔNG được làm Docker/k8s giết pod); trạng thái DB trong thân lấy từ lần ping gần nhất
 *     ≤ HEALTH_DB_CACHE_MS (5 s) — cũ hơn thì ping lại (có hạn giờ) trước khi trả lời, nên không
 *     bao giờ báo `db:"connected"` khi chưa ping. `status:"ok"` ⇔ DB connected.
 * Test: healthMetricsNoiThat.test.ts (DB giả ném/treo + DB `_test` thật).
 * ══════════════════════════════════════════════════════════════════════════════════════
 */
import type { Request, Response } from "express";
import { sql } from "drizzle-orm";

/** Hạn một lượt `SELECT 1` (brief T11: "vd 1500 ms"; nghiệm thu: 503 trong ≤ 2 s). */
export const DB_PING_TIMEOUT_MS = 1500;
/** `/health` (liveness) chỉ được hiện trạng thái DB từ ping cũ tối đa 5 s. */
export const HEALTH_DB_CACHE_MS = 5000;
/** `/readyz`: ping cũ tối đa 1 s — mỗi câu trả lời vẫn đứng trên một SELECT 1 thật. */
export const READYZ_DB_CACHE_MS = 1000;
/** Sau bấy lâu một lượt ping chưa về bị bỏ rơi, lượt sau được phép hỏi lại. */
const INFLIGHT_BO_ROI_MS = 10_000;

export type DbPingReason = "timeout" | "error" | "no_db";

export interface DbPingResult {
  ok: boolean;
  reason?: DbPingReason;
  /** Thời gian lượt ping (ms). */
  ms: number;
  /** Lúc lượt ping BẮT ĐẦU / KẾT THÚC (theo đồng hồ `now` của pinger). */
  startedAt: number;
  at: number;
}

export interface DbPingerDeps {
  /** Mặc định: `getDb` thật của `../db/connection` (nạp lười). */
  getDb?: () => Promise<unknown> | unknown;
  timeoutMs?: number;
  now?: () => number;
}

export interface DbPinger {
  /** Kết quả ping cũ tối đa `maxAgeMs`; cũ hơn ⇒ chạy (hoặc nhập) một lượt SELECT 1 có hạn giờ. Không bao giờ ném. */
  ping(opts: { maxAgeMs: number }): Promise<DbPingResult>;
  /** Kết quả gần nhất (null = chưa từng ping). */
  last(): DbPingResult | null;
}

async function defaultGetDb(): Promise<unknown> {
  const { getDb } = await import("../db/connection");
  return getDb();
}

export function createDbPinger(deps: DbPingerDeps = {}): DbPinger {
  const getDb = deps.getDb ?? defaultGetDb;
  const timeoutMs = deps.timeoutMs ?? DB_PING_TIMEOUT_MS;
  const now = deps.now ?? Date.now;

  let last: DbPingResult | null = null;
  let inflight: Promise<DbPingResult> | null = null;
  let inflightAt = 0;

  const ghi = (r: DbPingResult): DbPingResult => {
    // Kết quả của một lượt CŨ hơn (vd lượt bị bỏ rơi về muộn) không đè kết quả mới hơn.
    if (!last || r.startedAt >= last.startedAt) last = r;
    return r;
  };

  const chayMotLuot = async (startedAt: number): Promise<DbPingResult> => {
    try {
      const db = (await getDb()) as { execute?: (q: unknown) => Promise<unknown> } | null | undefined;
      if (!db || typeof db.execute !== "function") {
        return { ok: false, reason: "no_db", ms: now() - startedAt, startedAt, at: now() };
      }
      await db.execute(sql`select 1`);
      return { ok: true, ms: now() - startedAt, startedAt, at: now() };
    } catch {
      return { ok: false, reason: "error", ms: now() - startedAt, startedAt, at: now() };
    }
  };

  async function ping({ maxAgeMs }: { maxAgeMs: number }): Promise<DbPingResult> {
    const t = now();
    if (last && t - last.at <= maxAgeMs) return last;

    if (!inflight || t - inflightAt > INFLIGHT_BO_ROI_MS) {
      inflightAt = t;
      const p: Promise<DbPingResult> = chayMotLuot(t).then((r) => {
        if (inflight === p) inflight = null;
        return ghi(r);
      });
      inflight = p;
    }
    const current = inflight;
    const batDau = inflightAt;
    const hetGio = (): DbPingResult =>
      ghi({ ok: false, reason: "timeout", ms: now() - batDau, startedAt: batDau, at: now() });
    const conLai = timeoutMs - (t - batDau);
    if (conLai <= 0) return hetGio();

    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        current,
        new Promise<DbPingResult>((resolve) => {
          timer = setTimeout(() => resolve(hetGio()), conLai);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { ping, last: () => last };
}

/** Pinger dùng chung của tiến trình (`/health`, `/readyz`, `/api/network/health`, `/api/external/health`). */
const pingerMacDinh = createDbPinger();

/** Ping DB dùng chung, kết quả cũ tối đa `maxAgeMs` (mặc định 5 s). Không bao giờ ném. */
export function pingDbCached(maxAgeMs: number = HEALTH_DB_CACHE_MS): Promise<DbPingResult> {
  return pingerMacDinh.ping({ maxAgeMs });
}

export interface LivenessResult {
  status: "alive";
  uptimeSec: number;
  pid: number;
  ts: string;
}

export function livenessProbe(): LivenessResult {
  return {
    status: "alive",
    uptimeSec: Math.floor(process.uptime()),
    pid: process.pid,
    ts: new Date().toISOString(),
  };
}

export interface ReadinessResult {
  status: "ready" | "not_ready";
  ready: boolean;
  /** T11: trạng thái DB ở mức trên cùng (503 ⇒ `{db:"down"}`), trùng `checks.db`. */
  db: "ok" | "down";
  checks: {
    db: "ok" | "down";
    broker: "ok" | "down" | "disabled";
  };
  ts: string;
}

export interface ReadinessDeps {
  /** Resolve true when the primary DB is reachable. */
  checkDb?: () => Promise<boolean>;
  /** Resolve broker state: true=up, false=down, null=intentionally disabled (not a gate). */
  checkBroker?: () => Promise<boolean | null>;
}

/** T11: SELECT 1 thật có hạn giờ (KHÔNG còn `Boolean(getDb())`). */
async function defaultCheckDb(): Promise<boolean> {
  return (await pingerMacDinh.ping({ maxAgeMs: READYZ_DB_CACHE_MS })).ok;
}

async function defaultCheckBroker(): Promise<boolean | null> {
  try {
    const { isMqttRunning } = await import("../services/mqttService");
    return isMqttRunning();
  } catch {
    return null; // broker module unavailable → treat as disabled (not a readiness gate)
  }
}

/**
 * Readiness = DB reachable. Broker state is reported but does NOT gate readiness (the
 * MQTT broker may be intentionally off in some deployments). Never throws.
 */
export async function readinessProbe(deps: ReadinessDeps = {}): Promise<ReadinessResult> {
  const checkDb = deps.checkDb ?? defaultCheckDb;
  const checkBroker = deps.checkBroker ?? defaultCheckBroker;

  const [dbOk, brokerState] = await Promise.all([
    checkDb().catch(() => false),
    checkBroker().catch(() => null),
  ]);

  const broker = brokerState === null ? "disabled" : brokerState ? "ok" : "down";
  const ready = dbOk === true; // DB is the hard readiness gate
  return {
    status: ready ? "ready" : "not_ready",
    ready,
    db: dbOk ? "ok" : "down",
    checks: { db: dbOk ? "ok" : "down", broker },
    ts: new Date().toISOString(),
  };
}

// ─── Handler HTTP (index.ts gắn ĐÚNG các hàm này — test mount cùng hàm) ─────────────────────────

export interface ProbeHandlerDeps {
  pinger?: DbPinger;
  checkBroker?: ReadinessDeps["checkBroker"];
}

/** `GET /readyz` — 200 khi SELECT 1 trả lời trong hạn; ngược lại 503 `{db:"down"}`. */
export function createReadyzHandler(deps: ProbeHandlerDeps = {}) {
  const pinger = deps.pinger ?? pingerMacDinh;
  const checkDb = async () => (await pinger.ping({ maxAgeMs: READYZ_DB_CACHE_MS })).ok;
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await readinessProbe({ checkDb, checkBroker: deps.checkBroker });
      res.setHeader("Cache-Control", "no-store");
      res.status(result.ready ? 200 : 503).json(result);
    } catch {
      res.status(503).json({ status: "not_ready", ready: false, db: "down", ts: new Date().toISOString() });
    }
  };
}

/**
 * `GET /health` — LIVENESS có chẩn đoán (Docker HEALTHCHECK, compose, Helm liveness/startup,
 * k3s, edition-smoke CI, e2e). Luôn 200 khi tiến trình trả lời được; thân mang trạng thái DB từ
 * ping ≤ 5 s: `status:"ok"` + `db:"connected"` chỉ khi SELECT 1 vừa thành công; DB sập/treo ⇒
 * `status:"degraded"`, `db:"disconnected"|"error"` + `dbReason` (vẫn 200 — cổng traffic là `/readyz`).
 */
export function createHealthHandler(deps: ProbeHandlerDeps = {}) {
  const pinger = deps.pinger ?? pingerMacDinh;
  return async (_req: Request, res: Response): Promise<void> => {
    const startedAt = Date.now();
    const r = await pinger.ping({ maxAgeMs: HEALTH_DB_CACHE_MS });
    const db: "connected" | "disconnected" | "error" = r.ok
      ? "connected"
      : r.reason === "error"
        ? "error"
        : "disconnected";
    const mem = process.memoryUsage();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      status: db === "connected" ? "ok" : "degraded",
      db,
      ...(r.ok ? {} : { dbReason: r.reason }),
      dbPingMs: r.ms,
      memoryMB: Math.round(mem.heapUsed / 1024 / 1024),
      uptimeSec: Math.floor(process.uptime()),
      version: process.env.npm_package_version || "unknown",
      checkMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  };
}
