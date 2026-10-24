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

/**
 * SCADA R0 (C2) — VÌ SAO một mẫu không "good": phân loại thô để UI/cảnh báo/interlock không phải đoán từ chuỗi.
 *   comm_lost    mất liên lạc với thiết bị (timeout, rớt kết nối, từ chối kết nối, không tới được)
 *   device_error thiết bị trả lỗi/trạng thái không dùng được (Modbus exception 4/5/6/11, OPC UA Bad chung, Uncertain)
 *   config_error cấu hình sai (địa chỉ/tag không tồn tại, mã exception 1/2/3, SLMP end code địa chỉ/thiết bị sai)
 *   out_of_range giá trị ngoài dải kỹ thuật khai báo
 *   stale        giá trị cũ quá hạn (không còn được làm mới)
 */
export type LyDoChatLuong = "comm_lost" | "device_error" | "config_error" | "out_of_range" | "stale";

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
  /**
   * doc 81 Đợt 1B Task 12 — TUỲ CHỌN: mã trạng thái của giao thức khi mẫu `bad` hoặc `uncertain`
   * (vd OPC UA "BadNodeIdUnknown (0x80340000)"), để một tag hỏng nói được vì sao mà không
   * kéo cả lô. Mẫu good không mang trường này (hình dạng cũ giữ nguyên).
   */
  statusCode?: string;
  /** SCADA R0 (C2) — lý do thô khi mẫu không good. Mẫu good không mang trường này. */
  reason?: LyDoChatLuong;
  /**
   * Đợt 1C Task 6 (R-1C-a) — nguồn mẫu khai giờ bằng chuỗi KHÔNG múi giờ (plugin sidecar). `timestamp`
   * khi đó chỉ là giờ nhận; `sampleToCanonical` chuyển cờ này sang bus ⇒ loại `ts_no_timezone`.
   */
  tsReject?: "ts_no_timezone";
  /**
   * doc 81 Đợt 4 Task B6 — WHO stamped `timestamp`: "device" = the device/source declared it (e.g. OPC UA
   * sourceTimestamp); "server" = the driver stamped it itself on receipt. A server stamp measures nothing about the
   * device's clock, so the bus keeps it OUT of the clock-drift table. Absent ⇒ behaviour unchanged (treated as device).
   */
  tsSource?: "device" | "server";
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

/**
 * SCADA R0 (C1/C5) — một lần đọc của vòng poll, báo cho người nghe (tiêu thụ ở supervisor/trạng thái adapter).
 * `timeout` = lần đọc bị cắt ở hạn `deadlineMs` (không phải lỗi giao thức); `ms` = thời gian thực tế.
 */
export interface SuKienDoc {
  ok: boolean;
  timeout: boolean;
  ms: number;
  /** Tick tốt: chất lượng từng tag (`reason` khi mẫu mang lý do). Tick lỗi: rỗng. */
  tags: { tagKey: string; quality: OtQuality; reason?: LyDoChatLuong }[];
  /** SCADA R0 T12 (D1) — chỉ tick lỗi (`ok:false`): phân loại lỗi của lần đọc (phanLoiLoi của driver). */
  statusCode?: string;
  reason?: LyDoChatLuong;
  /**
   * SCADA R1b-1 T4 — lượt phát mẫu của tick (onSample: ghi DB) quá hạn `max(2 × chu kỳ, 5000)` ⇒ bỏ mẫu còn lại, nhả chốt vòng poll.
   * Hai hình:
   *   - lần đọc chính: `{ok:true, timeout:true, lyDo:"ingest_treo", tags:<của lần đọc>}` — thiết bị ĐÃ trả lời; D1/đọc tốt phán theo
   *     tag của lần đọc như mọi tick ok, KHÔNG theo cờ timeout;
   *   - lượt phát không kèm lần đọc (mẫu muộn V2 tắt / loạt mẫu xấu V2): `{ok:false, timeout:true, lyDo:"ingest_treo", tags:[]}` —
   *     lần đọc đã được báo ở tick riêng; D1 bỏ qua (trung tính), bộ đếm chỉ tăng `ingestTreo`.
   * DB chậm không phải thiết bị mất: không bao giờ là tick hỏng tự thân (ruling R1a residual).
   */
  lyDo?: "ingest_treo";
  /** SCADA R1b-1 T4 — số tick bị bỏ vì chồng (`soLanChong`) kể từ lần báo trước; vắng = 0. Bộ đếm truyền thông cộng vào `chong`. */
  chong?: number;
}

/** SCADA R0 — tuỳ chọn thêm cho vòng poll của driver (tham số 4 của subscribe). */
export interface TuyChonVongPoll {
  /** Hạn cứng cho MỘT lần đọc; quá hạn ⇒ coi là timeout. Không đặt ⇒ dùng timeout của kết nối. */
  deadlineMs?: number;
  onTick?: (e: SuKienDoc) => void;
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
  /**
   * doc 81 Đợt 1C Task 1 — set ONLY by the facade's real-actuation read, on an UNKNOWN that is
   * unknown because no enabled safety-PLC config is a real PLC with a mapped tag (only SIM /
   * real_unmapped) ⇒ dispatchers refuse with SAFETY_SIM_ONLY. Absent everywhere else.
   */
  basis?: "sim_only";
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
  subscribe(
    tags: OtTagAddress[],
    onSample: OnOtSample,
    intervalMs?: number,
    tuyChon?: TuyChonVongPoll,
  ): Promise<OtSubscriptionHandle>;
  writeTags(writes: OtWrite[]): Promise<OtCommandResult[]>;
  health(): Promise<OtHealth>;
  // ── G1.1 — optional per-spec methods (mọi driver hiện có được giữ nguyên) ──
  executeCommand?(cmd: CanonicalCommand): Promise<CanonicalCommandAck>;
  getSafetyStatus?(): Promise<SafetyState>;
  describe?(): Promise<AssetDescriptor>;
  /**
   * doc 81 Đợt 8 task O1 — OPTIONAL: the checksum of the program currently loaded in the controller (READ-ONLY).
   * Contract for a driver that implements it:
   *   • it only reads — never writes, never changes the controller's mode;
   *   • it must NOT queue behind or ahead of writeTags (no shared write serialisation): a slow checksum read must never
   *     delay a STOP write on the same connection (L-7);
   *   • `supported:false` ONLY when this controller type cannot report a program checksum at all — a failed / slow /
   *     undecidable read THROWS (callers then fail closed), it never answers `supported:false`.
   * Whether an adapter is EXPECTED to support it is decided from its configuration row (programChecksum.ts
   * programChecksumCapable), so a failure can never be read as "unsupported".
   *   • doc 81 Đợt 8 final wave (review O M4) — CANCELLABLE: `opts.signal` is aborted at the caller's deadline; the read must
   *     then settle promptly (reject) and release what it holds, so a hung controller leaves no pending read behind. A
   *     driver must never ignore the signal (callers always pass one — programChecksum.readAdapterProgramCheck).
   */
  //   • doc 81 Đợt 9 (ruling R-9-b) — `opts.deadlineMs`: the adapter's own bound for this read (the caller's deadline,
  //     programChecksum.programChecksumDeadlineMs); a driver with its own internal deadline must not exceed it.
  readProgramChecksum?(opts?: { signal?: AbortSignal; deadlineMs?: number }): Promise<ProgramChecksumResult>;
}

/** doc 81 Đợt 8 task O1 — answer of OtDriver.readProgramChecksum(). */
export interface ProgramChecksumResult {
  supported: boolean;
  /** Present iff supported: an opaque, stable identifier of the loaded program (e.g. "sha256:<hex>"). */
  checksum?: string;
  /** Short, non-sensitive label of where the value comes from (e.g. "sim"). Never an endpoint / host. */
  source: string;
}

/** Factory tạo một instance driver mới. */
export type OtDriverFactory = () => OtDriver;
