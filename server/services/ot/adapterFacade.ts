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
import type { MachineLike } from "../equipment/capabilityModel";

/** Ngữ cảnh facade cho MỘT adapter đã cấu hình (device_adapters.id). */
export interface AdapterFacadeContext {
  adapterId: number;
  machineId?: number | null;
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
  getSafetyStatus(): Promise<SafetyState>;
  describe(): Promise<AssetDescriptor>;
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
     */
    async getSafetyStatus(): Promise<SafetyState> {
      const driver = resolveDriver();
      if (driver?.getSafetyStatus) return driver.getSafetyStatus();

      const ts = new Date().toISOString();
      const unknown: SafetyState = { state: "UNKNOWN", source: "none", ts };
      try {
        const plc = await import("../safety/plc/safetyPlcAdapter");
        if (!plc.safetyPlcAdapterEnabled()) return unknown;
        const configs = await plc.listPlcConfigs({ onlyEnabled: true });
        if (configs.length === 0) return unknown;

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
