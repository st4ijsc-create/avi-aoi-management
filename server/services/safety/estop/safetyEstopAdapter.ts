/**
 * W1-5 (audit doc 25 §T1) — SAFETY-RATED E-STOP TRIGGER ADAPTER — SCAFFOLD ONLY.
 *   Flag: SAFETY_ESTOP_ADAPTER_ENABLED (default OFF → everything is a no-op).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PROBLEM (doc 25 §T1)
 *   Hôm nay mọi e-stop/abort đều đi qua dispatcher phần mềm Node async (KHÔNG
 *   safety-rated): interlockEngine.evaluateRule → commandDispatcher.dispatch, và
 *   foeEngine.abortRun chỉ đổi status DB. Một Node event-loop bị nghẽn / GC pause
 *   có thể trì hoãn "dừng khẩn". Chuẩn an toàn máy (ISO 13849 / IEC 62061, SIL 2/3,
 *   Cat 3/4) đòi hỏi đường dừng khẩn ĐỘC LẬP với lớp phần mềm — thường là một
 *   Safety PLC được chứng nhận (Pilz PNOZmulti/PSS, Sick Flexi Soft) đấu cứng
 *   dual-channel, tự thực thi dừng < 100 ms trong PHẦN CỨNG.
 *
 * VAI TRÒ CỦA FILE NÀY (kiến trúc)
 *   Đây là SEAM (điểm nối) để, KHI CÓ PHẦN CỨNG (doc 24 P6), gắn đường dừng khẩn
 *   safety-rated ĐỘC LẬP với dispatcher Node. File hiện tại CHỈ là scaffold:
 *     • interface `SafetyPlcAdapter` — hợp đồng cho một đường TRIGGER (actuation)
 *       dừng khẩn: triggerEmergencyStop(target) · health() · isRated().
 *     • `NullSafetyPlcAdapter` — cài đặt mặc định KHÔNG có phần cứng: isRated()=false,
 *       triggerEmergencyStop() KHÔNG actuate gì (actuated:false). Không bao giờ giả
 *       vờ đã dừng — trung thực về việc CHƯA có phần cứng.
 *     • registry (`registerSafetyPlcAdapter`) để tích hợp HW cắm adapter thật vào.
 *     • `requestEmergencyStop()` — ENTRY mà lớp phần mềm (vd interlockEngine) gọi
 *       SONG SONG với đường dispatcher. No-op (enabled:false) khi flag off.
 *
 * ⚠ PHÂN BIỆT VỚI plc/safetyPlcAdapter.ts
 *   plc/safetyPlcAdapter.ts là adapter ĐỌC-CHỈ (observe status: estop/zone/muting →
 *   advisory event, KHÔNG bao giờ ghi). File NÀY là đường GHI/ACTUATE (trigger dừng
 *   khẩn). Hai concern tách biệt → tách flag riêng:
 *     • SAFETY_PLC_ADAPTER_ENABLED   → bật ĐỌC status (đã có).
 *     • SAFETY_ESTOP_ADAPTER_ENABLED → bật đường TRIGGER e-stop (file này).
 *   Dùng flag riêng để bật giám sát trạng thái KHÔNG vô tình "arm" đường actuate.
 *
 * ⚠ HONESTY / SAFETY (bất biến)
 *   • Với flag OFF: requestEmergencyStop() là no-op tuyệt đối (enabled:false).
 *   • Với flag ON nhưng chưa cắm HW: NullSafetyPlcAdapter trả actuated:false, rated:false
 *     — software interlock vẫn là đường DUY NHẤT đang hoạt động.
 *   • Chỉ khi một adapter được chứng nhận (isRated()===true) được register + phần cứng
 *     có thật thì mới có dừng khẩn safety-rated. Cho tới lúc đó, đây KHÔNG thay thế
 *     safety-rated hardware.
 *   • Đường này ĐỘC LẬP với commandDispatcher/foeEngine: nó KHÔNG đi qua tRPC/AI và
 *     KHÔNG phụ thuộc các cờ OT_CONTROL/INTERLOCK_AUTO_BLOCK.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** Cờ — mặc định OFF. Mirrors phong cách safetyPlcAdapterEnabled(). */
export function safetyEstopAdapterEnabled(): boolean {
  return (
    process.env.SAFETY_ESTOP_ADAPTER_ENABLED === "true" ||
    process.env.SAFETY_ESTOP_ADAPTER_ENABLED === "1"
  );
}

/** Đích của một lệnh dừng khẩn (zone/machine/robot/line/station). */
export interface EstopTarget {
  /** Vùng an toàn (safety zone) nếu dừng theo zone. */
  zoneId?: number | null;
  machineId?: number | null;
  robotId?: number | null;
  lineId?: number | null;
  stationId?: number | null;
  /** Lý do (đi vào audit trail của HW/adapter thật). */
  reason?: string;
}

/** Kết quả một lần trigger e-stop. */
export interface EstopResult {
  /** Adapter chấp nhận & xử lý yêu cầu không lỗi. */
  ok: boolean;
  /** true CHỈ khi một kênh SAFETY-RATED (được chứng nhận) đã thực thi dừng. */
  rated: boolean;
  /** true khi có một lệnh dừng vật lý thực sự được phát (Null adapter → false). */
  actuated: boolean;
  /** Nhãn/nguồn gốc adapter (trung thực sim vs rated HW). */
  adapter: string;
  message?: string;
}

/** Trạng thái sức khoẻ/đấu nối của đường e-stop. */
export interface SafetyPlcHealth {
  /** Adapter/HW có với tới được không. */
  reachable: boolean;
  /** Được backed bởi phần cứng safety-rated chứng nhận không. */
  rated: boolean;
  label: string;
  detail?: string;
}

/**
 * Hợp đồng cho một đường TRIGGER dừng khẩn ĐỘC LẬP với dispatcher Node.
 * Một cài đặt thật (khi có HW, doc 24 P6) sẽ nói chuyện trực tiếp với Safety PLC
 * qua kênh riêng của nó (digital output đấu cứng / OPC-UA Safety / FSoE …), KHÔNG
 * đi qua commandDispatcher.
 */
export interface SafetyPlcAdapter {
  readonly kind: string;
  /** true CHỈ khi adapter này được backed bởi phần cứng safety-rated chứng nhận. */
  isRated(): boolean;
  /** Thăm dò sức khoẻ/đấu nối (không actuate). */
  health(): Promise<SafetyPlcHealth>;
  /** Phát lệnh dừng khẩn tới target. ĐỘC LẬP với dispatcher phần mềm. */
  triggerEmergencyStop(target: EstopTarget): Promise<EstopResult>;
  /** Nhãn người-đọc — luôn nêu rõ sim vs rated HW. */
  label(): string;
}

/**
 * Cài đặt mặc định KHÔNG có phần cứng. isRated()=false; triggerEmergencyStop KHÔNG
 * actuate — trả actuated:false. TRUNG THỰC: không bao giờ báo đã dừng khi chưa có HW.
 * Đây là scaffold để bật khi có phần cứng; software interlock vẫn là đường duy nhất.
 */
export class NullSafetyPlcAdapter implements SafetyPlcAdapter {
  readonly kind = "null" as const;
  isRated(): boolean {
    return false;
  }
  async health(): Promise<SafetyPlcHealth> {
    return {
      reachable: false,
      rated: false,
      label: this.label(),
      detail: "chưa cắm phần cứng safety-rated — software interlock là đường duy nhất",
    };
  }
  async triggerEmergencyStop(_target: EstopTarget): Promise<EstopResult> {
    // SCAFFOLD: không actuate. Software interlock — KHÔNG thay thế safety-rated hardware.
    return {
      ok: false,
      rated: false,
      actuated: false,
      adapter: this.label(),
      message:
        "SCAFFOLD: chưa cắm phần cứng safety-rated e-stop — KHÔNG actuate. Software interlock vẫn là đường duy nhất đang hoạt động.",
    };
  }
  label(): string {
    return "null (scaffold — KHÔNG safety-rated)";
  }
}

// ── Registry — chỗ tích hợp HW cắm adapter thật vào (mặc định Null) ──────────────
let registered: SafetyPlcAdapter = new NullSafetyPlcAdapter();

/** Cắm một adapter (khi có HW, doc 24 P6). Trả về adapter trước đó (để test khôi phục). */
export function registerSafetyPlcAdapter(adapter: SafetyPlcAdapter): SafetyPlcAdapter {
  const prev = registered;
  registered = adapter;
  return prev;
}

/** Adapter đang đăng ký (mặc định Null). */
export function getSafetyPlcAdapter(): SafetyPlcAdapter {
  return registered;
}

/** Khôi phục về Null (dùng cho test / gỡ HW). */
export function resetSafetyPlcAdapter(): void {
  registered = new NullSafetyPlcAdapter();
}

/** Kết quả của ENTRY requestEmergencyStop — thêm `enabled` (trạng thái cờ). */
export interface EstopRequestResult extends EstopResult {
  enabled: boolean;
}

/**
 * ENTRY mà lớp phần mềm gọi SONG SONG với đường dispatcher. No-op tuyệt đối
 * (enabled:false) khi SAFETY_ESTOP_ADAPTER_ENABLED off. KHÔNG BAO GIỜ throw —
 * đường an toàn không được phép làm sập caller. Khi on: uỷ nhiệm cho adapter đã
 * register (mặc định Null → không actuate).
 *
 * ⚠ Đây là software interlock — KHÔNG thay thế safety-rated hardware.
 */
export async function requestEmergencyStop(target: EstopTarget): Promise<EstopRequestResult> {
  if (!safetyEstopAdapterEnabled()) {
    return {
      enabled: false,
      ok: false,
      rated: false,
      actuated: false,
      adapter: "off",
      message: "SAFETY_ESTOP_ADAPTER_ENABLED off (no-op scaffold)",
    };
  }
  const adapter = getSafetyPlcAdapter();
  try {
    const res = await adapter.triggerEmergencyStop(target);
    return { enabled: true, ...res };
  } catch (err) {
    // Trung thực: adapter lỗi → báo lỗi, KHÔNG giả vờ đã dừng, KHÔNG throw.
    return {
      enabled: true,
      ok: false,
      rated: false,
      actuated: false,
      adapter: adapter.label(),
      message: `estop adapter throw: ${(err as Error)?.message ?? String(err)}`,
    };
  }
}
