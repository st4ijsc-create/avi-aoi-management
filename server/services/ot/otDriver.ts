/**
 * Sprint F1.1 — OT Connectivity Framework: driver contract + value types.
 *
 * Một `OtDriver` trừu tượng hoá MỘT giao thức công nghiệp (OPC-UA, Modbus, S7,
 * Mitsubishi MC, EtherNet/IP, hoặc `stub` mô phỏng). F1.1 chỉ stub là chạy thật;
 * các driver khác là khung (connect ném "not implemented"). Điều khiển ghi (writeTags)
 * mới chỉ khai báo — thực thi ở F4.
 */

export type OtProtocol = "opcua" | "modbus" | "s7" | "mitsubishi-mc" | "ethernet-ip" | "slmp" | "stub";

export type OtDataType = "bool" | "int" | "float" | "string" | "json";

export type OtQuality = "good" | "bad" | "uncertain";

/** Một địa chỉ tag cần đọc/ghi trên thiết bị. */
export interface OtTagAddress {
  tagKey: string;
  address: string;
  dataType: OtDataType;
  scale?: number;
  offset?: number;
  unit?: string;
  writable?: boolean;
  /**
   * G1.4 (doc 44 W2-A3, mig 0253) — report-by-exception per tag. `deadband`:
   * numeric sample chỉ forward khi |value − lastForwarded| ≥ deadband. `samplingMs`:
   * throttle — chỉ forward khi đã qua samplingMs kể từ lần forward trước. Cả hai
   * OPTIONAL (undefined = hành vi cũ, forward mọi sample); chỉ được otManager
   * đánh giá khi OT_TAG_DEADBAND_ENABLED === "true". Driver KHÔNG cần đọc 2 field
   * này — lọc nằm ở sink phía trên subscribe().
   */
  deadband?: number;
  samplingMs?: number;
}

/** Một mẫu giá trị đọc được từ thiết bị tại một thời điểm. */
export interface OtSample {
  tagKey: string;
  raw: unknown;
  value: number | string | boolean | null;
  quality: OtQuality;
  timestamp: Date;
}

/** Sức khoẻ kết nối của driver. */
export interface OtHealth {
  protocol: OtProtocol;
  connected: boolean;
  lastOkAt?: Date;
  lastError?: string;
  latencyMs?: number;
}

/** Cấu hình kết nối truyền vào connect(). */
export interface OtConnectionConfig {
  endpoint: string;
  options?: Record<string, unknown>;
  timeoutMs?: number;
}

/** Tay cầm của một subscription để đóng lại khi dừng. */
export interface OtSubscriptionHandle {
  close(): Promise<void>;
}

/** Kết quả của một lệnh ghi (F1.1: luôn ok:false). */
export interface OtCommandResult {
  tagKey: string;
  ok: boolean;
  error?: string;
}

/**
 * Một lệnh ghi xuống thiết bị. Ngoài {tagKey,address,value}, driver cần
 * dataType + scale/offset để áp INVERSE scale (giá trị người dùng → raw ghi).
 * dataType/scale/offset là TUỲ CHỌN (commandDispatcher F4b resolve từ deviceTags);
 * thiếu → coi raw = value (không inverse), dataType mặc định suy từ typeof value.
 */
export interface OtWrite {
  tagKey: string;
  address: string;
  value: unknown;
  dataType?: OtDataType;
  scale?: number;
  offset?: number;
}

/** Callback nhận mỗi mẫu từ subscription. */
export type OnOtSample = (sample: OtSample) => void | Promise<void>;

// ─── G1.1 (doc 44 W2-A3) — DeviceAdapter contract types (LDS-L1 §8.5 / §A.2-§A.4) ──
//
// Ba method OPTIONAL mở rộng OtDriver theo spec SYNAPSE Tầng 1 (Chương 4 Adapter
// SDK): executeCommand (verb-level, canonical), getSafetyStatus (READ-ONLY) và
// describe (AssetDescriptor). Optional để KHÔNG phá 6 driver hiện có — driver
// implement dần ở wave sau; driver chưa implement được phủ bởi facade mặc định
// (server/services/ot/adapterFacade.ts) vốn ủy quyền qua commandDispatcher
// (một-cửa lệnh) / safetyPlcAdapter / capabilityModel + device_tags.

/**
 * Canonical Command (LDS-L1 §A.3): lệnh verb-level xuống một asset.
 * `issued_by` là định danh người/agent phát lệnh (users.id dạng chuỗi hoặc URN);
 * `idempotency_key` bắt buộc — nhận lại lệnh trùng KHÔNG thực thi hai lần.
 */
export interface CanonicalCommand {
  command_id: string;
  asset_id: string;
  correlation_id?: string | null;
  verb: string;
  args: Record<string, unknown>;
  issued_by: string | number;
  /** Tham chiếu policy tầng trên (tùy chọn, LDS-L1 §A.3). */
  policy_ref?: string;
  deadline_ms?: number;
  idempotency_key: string;
}

/** Trạng thái ack của lệnh canonical (máy trạng thái §13.1). */
export type CanonicalCommandStatus = "accepted" | "rejected" | "executing" | "done" | "failed";

/** Canonical CommandAck (LDS-L1 §8.5 / §A.3). `reason` theo reason-code §13.3. */
export interface CanonicalCommandAck {
  command_id: string;
  status: CanonicalCommandStatus;
  reason?: string;
  ts: string;
  result?: unknown;
}

/**
 * SafetyState (LDS-L1 §A.4) — READ-ONLY. Adapter KHÔNG BAO GIỜ ghi/điều khiển
 * chức năng an toàn; chỉ quan sát trạng thái từ safety-PLC độc lập. 'UNKNOWN'
 * là giá trị trung thực khi không có nguồn nào đọc được.
 */
export interface SafetyState {
  state: "OK" | "BLOCKED" | "UNKNOWN";
  /** Nguồn quan sát (vd 'safety_plc:<code>', 'none'). */
  source: string;
  ts: string;
  asset_id?: string;
}

/** TagDescriptor (LDS-L1 §A.2) — một điểm dữ liệu trong AssetDescriptor. */
export interface TagDescriptor {
  tag_id: string;
  datatype: string;
  unit?: string;
  direction: "read" | "write" | "read_write";
  source_address: string;
  deadband?: number;
  sampling_ms?: number;
}

/** AssetDescriptor (LDS-L1 §A.1, rút gọn) — trả về từ describe(). */
export interface AssetDescriptor {
  /** Lớp thiết bị (equipment class, vd 'AOI', 'ROBOT', 'AUTOMATION'). */
  class: string;
  vendor?: string;
  model?: string;
  /** Danh sách verb/năng lực (canonical command names). */
  capabilities: string[];
  tags: TagDescriptor[];
}

/**
 * Hợp đồng driver giao thức OT. Một instance ↔ một kết nối thiết bị.
 *
 * G1.1: 3 method cuối là OPTIONAL (spec LDS-L1 Chương 4). Driver chưa implement →
 * dùng facade mặc định (adapterFacade.ts). LƯU Ý AN TOÀN: một driver implement
 * `executeCommand` chỉ được gọi từ đường đã qua cổng (commandDispatcher / facade);
 * KHÔNG được export ra tRPC trực tiếp. `getSafetyStatus` là READ-ONLY tuyệt đối.
 */
export interface OtDriver {
  readonly protocol: OtProtocol;
  connect(cfg: OtConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  readTags(tags: OtTagAddress[]): Promise<OtSample[]>;
  subscribe(tags: OtTagAddress[], onSample: OnOtSample, intervalMs?: number): Promise<OtSubscriptionHandle>;
  writeTags(writes: OtWrite[]): Promise<OtCommandResult[]>;
  health(): Promise<OtHealth>;
  // ── G1.1 — optional per-spec methods (mọi driver hiện có được giữ nguyên) ──
  executeCommand?(cmd: CanonicalCommand): Promise<CanonicalCommandAck>;
  getSafetyStatus?(): Promise<SafetyState>;
  describe?(): Promise<AssetDescriptor>;
}

/** Factory tạo một instance driver mới. */
export type OtDriverFactory = () => OtDriver;
