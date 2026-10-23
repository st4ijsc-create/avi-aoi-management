/**
 * Sprint F1.1 — Build runtime adapters từ cấu hình DB.
 *
 * Đọc `deviceAdapters` (isEnabled) + `deviceTags` (isEnabled) qua lazy getDb(),
 * dựng đối tượng runtime kèm driver tạo từ registry. KHÔNG mở kết nối ở đây —
 * otManager chịu trách nhiệm connect/subscribe.
 */
import { createDriver } from "./driverRegistry";
import type { OtDriver, OtProtocol, OtConnectionConfig, OtTagAddress } from "./otDriver";

/** Một adapter đã giải nghĩa, sẵn sàng để connect/subscribe. */
export interface RuntimeAdapter {
  adapterId: number;
  code: string;
  machineId: number | null;
  protocol: OtProtocol;
  connection: OtConnectionConfig;
  pollIntervalMs: number;
  tags: OtTagAddress[];
  driver: OtDriver;
  /**
   * doc 24 Wave-3 / C3 — OPTIONAL secondary (hot-standby) endpoint for connection
   * HA/failover. Declared ADDITIVELY inside `connectionOptions.ha` (a schemaless
   * json column — no migration, no schema drift, so backward-compatible): set
   *   connectionOptions.ha.secondaryEndpoint (string) [+ optional .secondaryOptions].
   * Undefined ⇒ single-endpoint adapter (today's behaviour). Only consumed by the
   * connection supervisor when OT_CONN_HA_ENABLED === "true".
   */
  backupConnection?: OtConnectionConfig;
}

/**
 * SCADA R0 (C5) — `connectionOptions.timeoutMs` (số nguyên dương ≤ 60000, nhận cả chuỗi số) ⇒ timeout kết nối/đọc của driver.
 * Giá trị sai/thiếu ⇒ undefined (driver dùng mặc định của nó). Trước đây loadEnabledAdapters luôn truyền `undefined`.
 */
export function docTimeoutMs(opts: Record<string, unknown> | null | undefined): number | undefined {
  const raw = opts?.timeoutMs;
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*\d+\s*$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 60000 ? n : undefined;
}

/**
 * Parse the optional HA secondary endpoint from an adapter's `connectionOptions`
 * json. Returns undefined unless `connectionOptions.ha.secondaryEndpoint` is a
 * non-empty string. Falls back to the primary's options when `secondaryOptions`
 * is absent. Pure + defensive (never throws on malformed config).
 */
export function parseBackupConnection(
  connectionOptions: Record<string, unknown> | null | undefined,
  timeoutMs?: number,
): OtConnectionConfig | undefined {
  const ha = connectionOptions?.ha as Record<string, unknown> | undefined;
  const raw = ha && typeof ha.secondaryEndpoint === "string" ? ha.secondaryEndpoint.trim() : "";
  if (!raw) return undefined;
  const secondaryOptions = (ha?.secondaryOptions as Record<string, unknown> | undefined) ?? connectionOptions ?? undefined;
  return { endpoint: raw, options: secondaryOptions, timeoutMs };
}

/**
 * doc 81 Đợt 10 task E (design §2.12, D2) — the ADAPTER SOURCE seam. On the edge (no central DB) the gateway sets a source
 * that builds the runtime adapters from its VERIFIED config snapshot (edgeConfigSource — only the node's own adapters, with
 * their centrally decrypted connection options); loadEnabledAdapters() then never touches a database. Central never sets it.
 */
export type AdapterSource = () => Promise<RuntimeAdapter[]>;
let adapterSource: AdapterSource | null = null;
export function setAdapterSource(src: AdapterSource | null): void {
  adapterSource = src;
}

/**
 * Tải mọi adapter đang bật cùng tag đang bật của chúng. Trả [] nếu không có DB.
 * doc 81 Đợt 10 task E — an adapter source set (edge) ⇒ it alone answers; an edge process without one ⇒ [] (never the DB).
 * Central: adapters OWNED by an edge node (device_adapters."edgeNodeId", mig 0374) are skipped — one owner connects, polls and
 * controls a device (fixes the duplicate poll of final-review I1). Before 0374 is applied nothing is skipped (unchanged).
 */
export async function loadEnabledAdapters(
  /** doc 81 Đợt 10 D fix review 4 (R-10-ay) — central's transient STOP of an edge-owned adapter whose owner cannot list it */
  opts: { includeEdgeOwned?: boolean } = {},
): Promise<RuntimeAdapter[]> {
  if (adapterSource) return adapterSource();
  if (String(process.env.AVI_PROCESS_ROLE ?? "").trim().toLowerCase() === "edge") return [];
  const { getDb } = await import("../../db/connection");
  const db = await getDb();
  if (!db) return [];

  const { deviceAdapters, deviceTags } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  let adapters = await db.select().from(deviceAdapters).where(eq(deviceAdapters.isEnabled, true));
  if (adapters.length === 0) return [];
  const edgeOwned = opts.includeEdgeOwned ? new Set<number>() : await edgeOwnedAdapterIds(db);
  if (edgeOwned.size > 0) adapters = adapters.filter((a) => !edgeOwned.has(a.id));
  if (adapters.length === 0) return [];

  const runtime: RuntimeAdapter[] = [];
  for (const a of adapters) {
    const tagRows = await db
      .select()
      .from(deviceTags)
      .where(eq(deviceTags.adapterId, a.id));

    const tags: OtTagAddress[] = tagRows
      .filter((t) => t.isEnabled)
      .map((t) => ({
        tagKey: t.tagKey,
        address: t.address,
        dataType: t.dataType,
        scale: t.scale != null ? Number(t.scale) : undefined,
        offset: t.offset != null ? Number(t.offset) : undefined,
        unit: t.unit ?? undefined,
        writable: t.writable,
        // G1.4 (0253) — report-by-exception per tag; chỉ được otManager đánh giá
        // khi OT_TAG_DEADBAND_ENABLED === "true" (driver không đọc 2 field này).
        deadband: t.deadband != null && Number.isFinite(Number(t.deadband)) ? Number(t.deadband) : undefined,
        samplingMs: t.samplingMs != null && t.samplingMs > 0 ? t.samplingMs : undefined,
      }));

    const protocol = a.protocol as OtProtocol;
    const connectionOptions = (a.connectionOptions as Record<string, unknown> | null) ?? undefined;
    runtime.push({
      adapterId: a.id,
      code: a.code,
      machineId: a.machineId ?? null,
      protocol,
      connection: {
        endpoint: a.endpoint,
        options: connectionOptions,
        timeoutMs: docTimeoutMs(connectionOptions),
      },
      pollIntervalMs: a.pollIntervalMs ?? 5000,
      tags,
      driver: createDriver(protocol),
      backupConnection: parseBackupConnection(connectionOptions, docTimeoutMs(connectionOptions)),
    });
  }

  return runtime;
}

/** Ids of adapters owned by an edge node (0374). Schema missing ⇒ none (central unchanged); any other error is thrown. */
export async function edgeOwnedAdapterIds(db: NonNullable<Awaited<ReturnType<typeof import("../../db/connection").getDb>>>): Promise<Set<number>> {
  const { adapterOwnership, isEdgeControlSchemaMissing } = await import("../edge/edgeControlSchema");
  const { isNotNull } = await import("drizzle-orm");
  try {
    const rows = await db.select({ id: adapterOwnership.id }).from(adapterOwnership).where(isNotNull(adapterOwnership.edgeNodeId));
    return new Set(rows.map((r) => r.id));
  } catch (err) {
    if (isEdgeControlSchemaMissing(err)) return new Set();
    throw err;
  }
}
