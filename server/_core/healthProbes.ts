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
 *     1 truy vấn. Ping chạy trên client RIÊNG `max: 1` (không chạm pool request); quá hạn ⇒ lượt
 *     treo bị HUỶ (đóng socket). Câu trả lời về sau hạn được ghi là QUÁ HẠN (không nhấp nháy).
 *   • `/readyz` (createReadyzHandler): kết quả SELECT 1 cũ tối đa READYZ_DB_CACHE_MS (1 s — chặn
 *     lũ probe vô danh thành lũ truy vấn); DB down ⇒ 503 `{db:"down"}`.
 *   • `/health` (createHealthHandler) là LIVENESS: luôn 200 khi tiến trình trả lời được (DB chập
 *     chờn KHÔNG được làm Docker/k8s giết pod); trạng thái DB trong thân lấy từ lần ping gần nhất
 *     ≤ HEALTH_DB_CACHE_MS (5 s) — cũ hơn thì ping lại (có hạn giờ) trước khi trả lời, nên không
 *     bao giờ báo `db:"connected"` khi chưa ping. `status:"ok"` ⇔ DB connected.
 * Test: healthMetricsNoiThat.test.ts (DB giả ném/treo + DB `_test` thật), healthPingRieng.test.ts (pool riêng).
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
/**
 * Sau bấy lâu một lượt ping chưa về bị BỎ RƠI (và được HUỶ nếu nguồn có `huy()`), lượt sau được phép
 * hỏi lại. Với client ping riêng (bên dưới) lượt treo đã bị huỷ ngay khi quá hạn — mốc này chỉ còn
 * là lưới an toàn cho nguồn tiêm vào không huỷ được.
 */
export const INFLIGHT_BO_ROI_MS = 10_000;

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

/** Nguồn ping: `execute(q)` chạy SELECT 1; `huy()` (tuỳ chọn) HUỶ lượt đang treo (đóng kết nối của nó). */
export interface NguonPing {
  execute: (q: unknown) => Promise<unknown>;
  huy?: () => void;
}

export interface DbPingerDeps {
  /** Mặc định: client ping RIÊNG (`layNguonPingRieng`) — không bao giờ lấy slot của pool request. */
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

// ─── Client ping RIÊNG (Fix round 1, mục 2) ───────────────────────────────────────────────────────
// VÌ SAO không dùng `getDb()`: một lượt SELECT 1 treo (mạng hố đen) giữ MỘT slot của pool request
// (25) cho tới khi TCP chết, và mỗi 10 s một lượt mới bị bỏ rơi lại giữ thêm một slot ⇒ probe tự vét
// cạn pool phục vụ người dùng. Chọn client riêng thay vì nâng INFLIGHT_BO_ROI_MS ≥ statement_timeout
// (30 s) vì: statement_timeout do SERVER thi hành — với hố đen mạng server không bao giờ nhận/hồi
// đáp nên nó KHÔNG cứu được; còn client riêng `max: 1` thì (a) probe KHÔNG BAO GIỜ chạm pool request,
// (b) quá hạn ⇒ `end({timeout:0})` huỷ socket ⇒ lượt treo bị HUỶ THẬT, không chỉ bị bỏ rơi.
// Tạo lười; connect_timeout 2 s; idle 10 s; application_name để đếm được trong pg_stat_activity.
export const PING_APPLICATION_NAME = "aoi-health-ping";
type ClientPing = ((s: TemplateStringsArray) => Promise<unknown>) & {
  end: (o?: { timeout?: number }) => Promise<void>;
};
let _clientPing: ClientPing | null = null;

async function layClientPing(): Promise<ClientPing | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!_clientPing) {
    const { default: postgres } = await import("postgres");
    _clientPing = postgres(url, {
      max: 1,
      connect_timeout: 2,
      idle_timeout: 10,
      max_lifetime: 60 * 10,
      onnotice: () => {},
      connection: { application_name: PING_APPLICATION_NAME, statement_timeout: DB_PING_TIMEOUT_MS * 2 },
    }) as unknown as ClientPing;
  }
  return _clientPing;
}

/** Đóng client ping riêng (tắt máy / afterAll của test). An toàn gọi nhiều lần. */
export async function dongClientPing(): Promise<void> {
  const c = _clientPing;
  _clientPing = null;
  if (c) await c.end({ timeout: 0 }).catch(() => {});
}

/** Nguồn ping mặc định: client riêng; `huy()` đóng ĐÚNG client của lượt ấy (không giết client mới hơn). */
export async function layNguonPingRieng(): Promise<NguonPing | null> {
  const c = await layClientPing();
  if (!c) return null;
  return {
    execute: () => c`select 1`,
    huy: () => {
      if (_clientPing === c) _clientPing = null;
      void c.end({ timeout: 0 }).catch(() => {});
    },
  };
}

interface Luot {
  p: Promise<DbPingResult>;
  at: number;
  huy?: () => void;
  daHuy: boolean;
}

export function createDbPinger(deps: DbPingerDeps = {}): DbPinger {
  const getDb = deps.getDb ?? layNguonPingRieng;
  const timeoutMs = deps.timeoutMs ?? DB_PING_TIMEOUT_MS;
  const now = deps.now ?? Date.now;

  let last: DbPingResult | null = null;
  let inflight: Luot | null = null;

  const ghi = (r: DbPingResult): DbPingResult => {
    // Kết quả của một lượt CŨ hơn (vd lượt bị bỏ rơi về muộn) không đè kết quả mới hơn.
    if (!last || r.startedAt >= last.startedAt) last = r;
    return r;
  };

  const huyLuot = (l: Luot) => {
    if (l.daHuy) return;
    l.daHuy = true;
    try {
      l.huy?.();
    } catch {
      /* huỷ là nỗ lực tốt nhất */
    }
  };

  const chayMotLuot = async (l: Luot): Promise<DbPingResult> => {
    const startedAt = l.at;
    const ketThuc = (ok: boolean, reason?: DbPingReason): DbPingResult => {
      const ms = now() - startedAt;
      // Fix round 1 mục 1: câu trả lời VỀ SAU hạn là QUÁ HẠN, kể cả khi nó "ok" — nếu không, một DB
      // chậm 2,5 s làm readiness nhấp nháy 503 → 200 (kết quả muộn đè kết quả quá hạn cùng startedAt).
      if (ms > timeoutMs) return { ok: false, reason: "timeout", ms, startedAt, at: now() };
      return ok ? { ok: true, ms, startedAt, at: now() } : { ok: false, reason, ms, startedAt, at: now() };
    };
    try {
      const db = (await getDb()) as Partial<NguonPing> | null | undefined;
      if (!db || typeof db.execute !== "function") return ketThuc(false, "no_db");
      if (typeof db.huy === "function") {
        const h = db.huy.bind(db);
        l.huy = h;
        if (l.daHuy) h(); // quá hạn TRƯỚC khi getDb kịp trả nguồn ⇒ huỷ ngay khi có
      }
      await db.execute(sql`select 1`);
      return ketThuc(true);
    } catch {
      return ketThuc(false, "error");
    }
  };

  async function ping({ maxAgeMs }: { maxAgeMs: number }): Promise<DbPingResult> {
    const t = now();
    if (last && t - last.at <= maxAgeMs) return last;

    if (!inflight || t - inflight.at > INFLIGHT_BO_ROI_MS) {
      if (inflight) huyLuot(inflight); // bỏ rơi ⇒ huỷ nếu huỷ được
      const l: Luot = { p: Promise.resolve(null as never), at: t, daHuy: false };
      l.p = chayMotLuot(l).then((r) => {
        if (inflight === l) inflight = null;
        return ghi(r);
      });
      inflight = l;
    }
    const current = inflight;
    const batDau = current.at;
    const hetGio = (): DbPingResult => {
      huyLuot(current);
      return ghi({ ok: false, reason: "timeout", ms: now() - batDau, startedAt: batDau, at: now() });
    };
    const conLai = timeoutMs - (t - batDau);
    if (conLai <= 0) return hetGio();

    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        current.p,
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
    const db = trangThaiDb(r);
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

/** Kết quả ping ⇒ trạng thái DB kiểu cũ: `connected` · `error` (SELECT 1 ném) · `disconnected` (quá hạn / không có DB). */
export function trangThaiDb(r: DbPingResult): "connected" | "disconnected" | "error" {
  if (r.ok) return "connected";
  return r.reason === "error" ? "error" : "disconnected";
}

export interface NetworkHealthDeps {
  pinger?: DbPinger;
  /** Mặc định: `../services/mqttService` (nạp lười). */
  mqtt?: () => Promise<{ isMqttRunning: () => boolean; getConnectedClientsCount: () => number }>;
}

/**
 * `GET /api/network/health` — chẩn đoán cho network monitor của FactoryAlertSystem (đọc
 * `dbStatus === 'connected'`). Fix round 1 mục 4: tách khỏi index.ts để test HÀNH VI trên đúng
 * handler đang chạy. `dbStatus` từ ping SELECT 1 thật (≤ 5 s, hạn 1500 ms): `connected` · `error`
 * (truy vấn ném — nay đến được trung thực, trước là một `catch` chết) · `disconnected` (quá hạn /
 * không DB). Hình dạng thân và mã 200/500 giữ như handler nội tuyến cũ.
 */
export function createNetworkHealthHandler(deps: NetworkHealthDeps = {}) {
  const pinger = deps.pinger ?? pingerMacDinh;
  const napMqtt = deps.mqtt ?? (() => import("../services/mqttService"));
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const { isMqttRunning, getConnectedClientsCount } = await napMqtt();
      const dbStatus = trangThaiDb(await pinger.ping({ maxAgeMs: HEALTH_DB_CACHE_MS }));

      const mem = process.memoryUsage();
      const memoryUsageMB = Math.round(mem.heapUsed / 1024 / 1024);
      const uptimeSec = Math.floor(process.uptime());
      const hours = Math.floor(uptimeSec / 3600);
      const minutes = Math.floor((uptimeSec % 3600) / 60);
      const uptime = `${hours}h ${minutes}m`;

      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        mqttStatus: isMqttRunning() ? "running" : "stopped",
        mqttClients: getConnectedClientsCount(),
        dbStatus,
        memoryUsageMB,
        uptime,
      });
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error?.message });
    }
  };
}
