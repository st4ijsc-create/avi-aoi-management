/**
 * G1.1 (doc 44 W2-A3) — DEFAULT ADAPTER FACADE cho hợp đồng DeviceAdapter đầy đủ
 * (LDS-L1 Chương 4: executeCommand / getSafetyStatus / describe).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Vấn đề: interface OtDriver (otDriver.ts) mở rộng 3 method spec ở dạng OPTIONAL
 * để không phá 6 driver hiện có. Facade này phủ mặc định cho driver CHƯA
 * implement, để mọi adapter đều phơi bày cùng một hợp đồng canonical.
 *
 * ⚠ AN TOÀN — KHÔNG CỬA HẬU (đọc kỹ trước khi sửa):
 *   • `executeCommand` của facade KHÔNG BAO GIỜ gọi driver.writeTags trực tiếp.
 *     Verb `tag.write` được ánh xạ thành DispatchInput và đi qua
 *     commandDispatcher.dispatch() — MỘT CỬA duy nhất của mọi lệnh ghi, nơi TOÀN
 *     BỘ cổng hiện có áp dụng (idempotency, adapter/tag enabled, tag.writable
 *     allowlist, driver active, OT_CONTROL_ENABLED mode-gate, commissioning/FAT,
 *     policy gate, interlock gate, ledger append-only + cmd_ack). Facade chỉ là
 *     BỘ CHUYỂN ĐỔI hình dạng CanonicalCommand ⇄ DispatchInput/DispatchResult.
 *   • Verb khác `tag.write` → ack `rejected` reason `UNSUPPORTED` (spec §13.3) —
 *     verb-level thật (start/stop/select_recipe…) do driver implement ở wave sau.
 *   • `getSafetyStatus` là READ-ONLY tuyệt đối: ủy quyền safetyPlcAdapter (đọc
 *     status từ safety-PLC độc lập, không ghi); không có nguồn → trả
 *     {state:'UNKNOWN', source:'none'} TRUNG THỰC — không bao giờ bịa 'OK'.
 *     doc 81 Đợt 1C Task 1: với `{ forRealActuation: true }` (preflight OT/robot trước lệnh THẬT)
 *     SIM / real_unmapped KHÔNG còn đủ cho 'OK' và tag an toàn chất lượng xấu ⇒ không sạch.
 *   • `describe` là metadata thuần (capabilityModel + device_tags), không I/O
 *     xuống thiết bị.
 * Khi driver ĐÃ implement method tương ứng → facade ủy quyền thẳng cho driver.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq } from "drizzle-orm";
import type {
  AssetDescriptor,
  CanonicalCommand,
  CanonicalCommandAck,
  OtDriver,
  SafetyState,
  TagDescriptor,
} from "./otDriver";
import { dispatch, type DispatchResult, type DispatchStatus } from "./commandDispatcher";
import { getActiveDriver } from "./otManager";
import {
  actuationPreflightVerdict,
  effectiveBackend,
  plcConfigAppliesToTarget,
  type PlcPreflightReading,
  type PlcReadOutcome,
} from "./safetyPreflightPolicy";
import type { MachineLike } from "../equipment/capabilityModel";
import { withDeadline } from "./drivers/boundedClose"; // final wave 5 (M4)
import type { SafetyPlcStatusSnapshot } from "../../../drizzle/schema";

/** Ngữ cảnh facade cho MỘT adapter đã cấu hình (device_adapters.id). */
export interface AdapterFacadeContext {
  adapterId: number;
  machineId?: number | null;
  /**
   * doc 81 Đợt 4 Task A1 — the robot a motion is for (robot path: adapterId = ROBOT_NO_OT_ADAPTER_ID,
   * machineId null). Only used to pick the safety-PLC configs that guard the target.
   */
  robotId?: number | null;
  /**
   * Driver đã resolve sẵn (tùy chọn — test/HA path). Vắng → facade tự resolve
   * driver ĐANG KẾT NỐI qua otManager.getActiveDriver tại thời điểm gọi (chỉ để
   * ủy quyền các method driver ĐÃ implement; đường lệnh vẫn là dispatcher).
   */
  driver?: OtDriver;
}

/** Hợp đồng DeviceAdapter đầy đủ mà facade bảo đảm cho MỌI adapter. */
export interface OtAdapterFacade {
  executeCommand(cmd: CanonicalCommand): Promise<CanonicalCommandAck>;
  getSafetyStatus(opts?: SafetyStatusOptions): Promise<SafetyState>;
  describe(): Promise<AssetDescriptor>;
}

/**
 * doc 81 Đợt 1C Task 1 (owner decision 2026-09-27) — what the safety reading is FOR.
 *   forRealActuation: true — the caller is about to perform a REAL device write / robot motion
 *     (the OT (5a-safety) and robot (4a-safety) preflights; both are reachable only on the real,
 *     commissioned path). The safety-PLC branch then applies safetyPreflightPolicy
 *     .actuationPreflightVerdict: only a `real` config (real endpoint + ≥1 mapped safety tag) that
 *     reads clean with every mapped tag at good quality yields OK; SIM / real_unmapped alone ⇒
 *     UNKNOWN with basis "sim_only" (SAFETY_SIM_ONLY); a bad-quality real tag ⇒ not clean.
 *   absent/false — the legacy reading, unchanged (AI gate L-7 pre-check, which may precede a
 *     SIMULATED dispatch; the dispatcher re-checks strictly if the write turns out real).
 * Fix round 1 (review #3): with forRealActuation a driver's OWN getSafetyStatus is NOT delegated to —
 * a self-report carries no basis (sim / real / mapped tags), so it would bypass the SIM rule. A
 * future driver that wants to vouch for real actuation must report a basis the policy can classify
 * (and be wired through actuationPreflightVerdict); until then only safety-PLC configs count. The
 * legacy reading (no option) still delegates, unchanged.
 */
export interface SafetyStatusOptions {
  forRealActuation?: boolean;
}

type SafetyPlcModule = typeof import("../safety/plc/safetyPlcAdapter");
type SafetyPlcConfigRow = Awaited<ReturnType<SafetyPlcModule["listPlcConfigs"]>>[number];

/**
 * Fix round 1 (review #2) — a config that fails to read during the real-actuation preflight is
 * logged, rate-limited to one line per config code per window. Only the config CODE is printed:
 * the error message is not (a driver error can carry the endpoint).
 */
const PREFLIGHT_READ_WARN_WINDOW_MS = 60_000;
const lastPreflightReadWarn = new Map<string, number>();
function warnPreflightReadFailed(code: string): void {
  const now = Date.now();
  const last = lastPreflightReadWarn.get(code);
  if (last !== undefined && now - last < PREFLIGHT_READ_WARN_WINDOW_MS) return;
  lastPreflightReadWarn.set(code, now);
  console.warn(
    `[AdapterFacade] safety-PLC config "${code}" could not be read during the real-actuation preflight — counted as unreadable (SAFETY_UNKNOWN); further failures of this config are silenced for ${PREFLIGHT_READ_WARN_WINDOW_MS / 1000}s`,
  );
}

/**
 * doc 81 Đợt 1C final wave 5 (final review M4) — deadline of ONE safety-PLC read in the real-actuation
 * preflight. Below the robot's outer SAFETY_PREFLIGHT_DEADLINE_MS (5000) and the OT dispatcher's
 * OT_SAFETY_PREFLIGHT_DEADLINE_MS, so a slow/hung PLC turns into its own "error" (⇒ UNKNOWN, fail-closed for
 * motion/writes) instead of eating the whole budget.
 */
export const SAFETY_PLC_READ_DEADLINE_MS = 4000;

/** One config's reading (classification + outcome). Throws on a read error; the caller maps that to "error". */
async function readOneForRealActuation(plc: SafetyPlcModule, cfg: SafetyPlcConfigRow): Promise<PlcPreflightReading> {
  const kind = effectiveBackend(cfg);
  const backend = plc.backendForConfig(cfg);
  let status: SafetyPlcStatusSnapshot;
  let complete = true;
  if (kind === "real") {
    if (typeof backend.readChecked !== "function") return { kind, outcome: "incomplete" };
    const checked = await backend.readChecked();
    status = checked.status;
    complete = checked.unreadable.length === 0;
  } else {
    status = await backend.read();
  }
  if (plc.statusToFindings(status).length > 0) return { kind, outcome: "blocked" };
  return { kind, outcome: complete ? "clean" : "incomplete" };
}

/**
 * doc 81 Đợt 1C Task 1 — the real-actuation reading over the enabled configs. Every config is
 * classified with the ONE shared `effectiveBackend`; a `real` one must be read through
 * `readChecked()` so a bad-quality safety tag is seen (absent ⇒ "incomplete", fail-closed). The
 * verdict is the ONE shared `actuationPreflightVerdict` (the Safety panel predicts with the same
 * function); BLOCKED wins over everything.
 * doc 81 Đợt 1C final wave 5 (final review M4): the configs are read IN PARALLEL, each under its own
 * SAFETY_PLC_READ_DEADLINE_MS. Before, they were read one after another with no per-read bound: since
 * R-1C-b requires EVERY real PLC, two slow-but-healthy PLCs could exceed the robot's 5 s preflight
 * (⇒ SAFETY_UNKNOWN) while OT waited, and a hung `disconnect()` inside one read could hang an OT dispatch.
 * A timed-out read counts as "error" for that config (UNKNOWN unless another reads BLOCKED).
 */
async function readForRealActuation(plc: SafetyPlcModule, configs: SafetyPlcConfigRow[]): Promise<SafetyState> {
  const readings: PlcPreflightReading[] = await Promise.all(
    configs.map((cfg) =>
      withDeadline(
        Promise.resolve().then(() => readOneForRealActuation(plc, cfg)),
        SAFETY_PLC_READ_DEADLINE_MS,
        `safety-PLC "${cfg.code}" preflight read`,
      ).catch((): PlcPreflightReading => {
        warnPreflightReadFailed(cfg.code); // one config unreadable / too slow ⇒ it vouches for nothing; never invented
        return { kind: effectiveBackend(cfg), outcome: "error" };
      }),
    ),
  );
  const blockedIdx = readings.findIndex((r) => r.outcome === "blocked");
  const blockedCode = blockedIdx >= 0 ? configs[blockedIdx].code : null;
  const verdict = actuationPreflightVerdict(readings);
  const now = new Date().toISOString();
  if (verdict.state === "BLOCKED") return { state: "BLOCKED", source: `safety_plc:${blockedCode}`, ts: now };
  if (verdict.state === "OK") return { state: "OK", source: "safety_plc", ts: now };
  if (verdict.reason === "SAFETY_SIM_ONLY") return { state: "UNKNOWN", source: "safety_plc", ts: now, basis: "sim_only" };
  return { state: "UNKNOWN", source: "none", ts: now };
}

/** Ack `rejected` chuẩn hóa (reason theo §13.3). PURE. */
function rejectedAck(cmd: CanonicalCommand, reason: string): CanonicalCommandAck {
  return { command_id: cmd.command_id, status: "rejected", reason, ts: new Date().toISOString() };
}

/**
 * PURE — map trạng thái terminal của DispatchResult → CanonicalCommandStatus.
 *   rejected → rejected; failed → failed; timeout → failed (reason TIMEOUT);
 *   sent → executing; simulated/acked/acked_verified/acked_unverified → done.
 * `simulated` vẫn là `done` NHƯNG reason nêu rõ SIMULATED (trung thực: lệnh không
 * chạm thiết bị vì mode-gate/commissioning — sổ cái ghi lý do đầy đủ).
 */
export function dispatchResultToAck(cmd: CanonicalCommand, r: DispatchResult): CanonicalCommandAck {
  const ts = new Date().toISOString();
  const base = { command_id: cmd.command_id, ts, result: r.results } as const;
  const status: DispatchStatus = r.status;
  if (status === "rejected") return { ...base, status: "rejected", reason: r.reason ?? "REJECTED" };
  if (status === "timeout") return { ...base, status: "failed", reason: r.reason ?? "TIMEOUT" };
  if (status === "failed") return { ...base, status: "failed", reason: r.reason ?? "FAILED" };
  if (status === "sent") return { ...base, status: "executing", reason: r.reason };
  if (status === "simulated") return { ...base, status: "done", reason: r.reason ?? "SIMULATED" };
  // acked / acked_verified / acked_unverified — write thành công (verify là WARN-only).
  return { ...base, status: "done", reason: r.reason };
}

/** Parse issued_by → users.id (số nguyên dương); null nếu không hợp lệ. PURE. */
export function parseIssuedBy(issuedBy: string | number): number | null {
  const n = typeof issuedBy === "number" ? issuedBy : Number(String(issuedBy).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Tạo facade cho một adapter. Mỗi method resolve driver tại THỜI ĐIỂM GỌI
 * (không giữ tham chiếu chết khi HA failover đổi endpoint).
 */
export function createAdapterFacade(ctx: AdapterFacadeContext): OtAdapterFacade {
  const resolveDriver = (): OtDriver | undefined => ctx.driver ?? getActiveDriver(ctx.adapterId);

  return {
    /**
     * Verb-level command. Driver có executeCommand → ủy quyền. Không → fallback:
     * CHỈ verb `tag.write` (args {tag, value}) và đi QUA commandDispatcher —
     * không tồn tại đường ghi nào khác từ facade.
     */
    async executeCommand(cmd: CanonicalCommand): Promise<CanonicalCommandAck> {
      const driver = resolveDriver();
      if (driver?.executeCommand) return driver.executeCommand(cmd);

      if (cmd.verb !== "tag.write") {
        return rejectedAck(cmd, "UNSUPPORTED");
      }
      const tag = cmd.args?.tag;
      if (typeof tag !== "string" || tag.length === 0 || !("value" in (cmd.args ?? {}))) {
        return rejectedAck(cmd, "INVALID_ARGS");
      }
      const issuedBy = parseIssuedBy(cmd.issued_by);
      if (issuedBy == null) {
        return rejectedAck(cmd, "INVALID_ARGS");
      }

      // MỘT CỬA: dispatch() áp mọi cổng + ghi sổ cái + phát cmd_ack. idempotency_key
      // của lệnh canonical là idempotencyKey của dispatcher (trùng → trả ack cũ,
      // không thực thi hai lần — spec §13.2).
      const result = await dispatch({
        adapterId: ctx.adapterId,
        machineId: ctx.machineId ?? null,
        commandType: "tag.write",
        writes: [{ tagKey: tag, value: cmd.args.value }],
        triggeredBy: { kind: "hitl", confirmedBy: issuedBy, requestedBy: issuedBy },
        idempotencyKey: cmd.idempotency_key || cmd.command_id,
        correlationId: cmd.correlation_id ?? undefined,
        deadlineMs: cmd.deadline_ms,
      });
      return dispatchResultToAck(cmd, result);
    },

    /**
     * READ-ONLY safety status. Driver có getSafetyStatus → ủy quyền. Không →
     * ủy quyền safetyPlcAdapter (đọc status các safety-PLC config đang bật);
     * flag OFF / không config / lỗi đọc toàn bộ → UNKNOWN trung thực.
     * `opts.forRealActuation` (Đợt 1C Task 1) → luật lệnh thật: readForRealActuation.
     */
    async getSafetyStatus(opts?: SafetyStatusOptions): Promise<SafetyState> {
      const driver = resolveDriver();
      // Fix round 1 (#3): never delegate the REAL-actuation reading to a driver self-report (no basis
      // ⇒ it would bypass the SIM rule). A future driver must report a basis first (see SafetyStatusOptions).
      if (driver?.getSafetyStatus && opts?.forRealActuation !== true) return driver.getSafetyStatus();

      const ts = new Date().toISOString();
      const unknown: SafetyState = { state: "UNKNOWN", source: "none", ts };
      try {
        const plc = await import("../safety/plc/safetyPlcAdapter");
        if (!plc.safetyPlcAdapterEnabled()) return unknown;
        const enabled = await plc.listPlcConfigs({ onlyEnabled: true });
        if (enabled.length === 0) return unknown;
        // doc 81 Đợt 4 Task A1 (R-4-c) — only the configs guarding THIS target, plus untargeted ones.
        // Target not resolvable ⇒ null ⇒ every config applies (never fewer than before). Same matcher
        // as the Safety panel (safetySourceHealth).
        const { resolveSafetyTarget } = await import("./safetyTarget");
        const target = await resolveSafetyTarget({ adapterId: ctx.adapterId, machineId: ctx.machineId ?? null, robotId: ctx.robotId ?? null });
        const configs = enabled.filter((cfg) => plcConfigAppliesToTarget(cfg, target));
        if (configs.length === 0) return unknown;

        if (opts?.forRealActuation === true) return await readForRealActuation(plc, configs);

        // Legacy reading (AI gate L-7, comparisons) — byte-identical to before Đợt 1C Task 1.
        let anyOk = false;
        for (const cfg of configs) {
          try {
            const status = await plc.backendForConfig(cfg).read();
            // Bất kỳ cờ an toàn nào ACTIVE (estop/zone/reset-required/muting) →
            // BLOCKED (fail-safe conservative). Đọc được và sạch → OK.
            const active = plc.statusToFindings(status);
            if (active.length > 0) {
              return {
                state: "BLOCKED",
                source: `safety_plc:${cfg.code}`,
                ts: new Date().toISOString(),
              };
            }
            anyOk = true;
          } catch {
            // Một config đọc lỗi → bỏ qua (unknown cục bộ); không bịa trạng thái.
          }
        }
        return anyOk
          ? { state: "OK", source: "safety_plc", ts: new Date().toISOString() }
          : unknown;
      } catch {
        return unknown; // safety module không tải được → UNKNOWN, không ném
      }
    },

    /**
     * AssetDescriptor. Driver có describe → ủy quyền. Không → dựng từ
     * capabilityModel (theo machineType của máy gắn adapter) + device_tags DB.
     * Fail-safe: không DB → profile fallback read-only + tags rỗng.
     */
    async describe(): Promise<AssetDescriptor> {
      const driver = resolveDriver();
      if (driver?.describe) return driver.describe();

      const { getCapabilitiesForMachine } = await import("../equipment/capabilityModel");

      let machine: MachineLike | null = null;
      let tagRows: Array<{
        tagKey: string;
        address: string;
        dataType: string;
        unit: string | null;
        writable: boolean;
        deadband: number | null;
        samplingMs: number | null;
      }> = [];

      try {
        const { getDb } = await import("../../db/connection");
        const db = await getDb();
        if (db) {
          const { deviceAdapters, deviceTags, machines } = await import("../../../drizzle/schema");
          const [adapter] = await db
            .select()
            .from(deviceAdapters)
            .where(eq(deviceAdapters.id, ctx.adapterId))
            .limit(1);
          const machineId = ctx.machineId ?? adapter?.machineId ?? null;
          if (machineId != null) {
            const [m] = await db.select().from(machines).where(eq(machines.id, machineId)).limit(1);
            if (m) machine = { machineType: m.machineType, capabilities: m.capabilities ?? null };
          }
          const rows = await db
            .select()
            .from(deviceTags)
            .where(eq(deviceTags.adapterId, ctx.adapterId));
          tagRows = rows
            .filter((t) => t.isEnabled)
            .map((t) => ({
              tagKey: t.tagKey,
              address: t.address,
              dataType: String(t.dataType),
              unit: t.unit ?? null,
              writable: t.writable === true,
              deadband: t.deadband != null ? Number(t.deadband) : null,
              samplingMs: t.samplingMs ?? null,
            }));
        }
      } catch {
        // DB không sẵn sàng → descriptor tối thiểu (không ném).
      }

      const capability = getCapabilitiesForMachine(machine);
      const tags: TagDescriptor[] = tagRows.map((t) => ({
        tag_id: t.tagKey,
        datatype: t.dataType,
        unit: t.unit ?? undefined,
        direction: t.writable ? "read_write" : "read",
        source_address: t.address,
        deadband: t.deadband ?? undefined,
        sampling_ms: t.samplingMs ?? undefined,
      }));
      return {
        class: capability.equipmentClass,
        capabilities: capability.supportedCommands.map((c) => c.name),
        tags,
      };
    },
  };
}
