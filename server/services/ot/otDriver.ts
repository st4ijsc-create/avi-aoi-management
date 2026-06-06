/**
 * Sprint F1.1 — OT Connectivity Framework: driver contract + value types.
 *
 * Một `OtDriver` trừu tượng hoá MỘT giao thức công nghiệp (OPC-UA, Modbus, S7,
 * Mitsubishi MC, EtherNet/IP, hoặc `stub` mô phỏng). F1.1 chỉ stub là chạy thật;
 * các driver khác là khung (connect ném "not implemented"). Điều khiển ghi (writeTags)
 * mới chỉ khai báo — thực thi ở F4.
 */

export type OtProtocol = "opcua" | "modbus" | "s7" | "mitsubishi-mc" | "ethernet-ip" | "stub";

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

/** Callback nhận mỗi mẫu từ subscription. */
export type OnOtSample = (sample: OtSample) => void | Promise<void>;

/**
 * Hợp đồng driver giao thức OT. Một instance ↔ một kết nối thiết bị.
 */
export interface OtDriver {
  readonly protocol: OtProtocol;
  connect(cfg: OtConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  readTags(tags: OtTagAddress[]): Promise<OtSample[]>;
  subscribe(tags: OtTagAddress[], onSample: OnOtSample, intervalMs?: number): Promise<OtSubscriptionHandle>;
  writeTags(writes: Array<{ tagKey: string; address: string; value: unknown }>): Promise<OtCommandResult[]>;
  health(): Promise<OtHealth>;
}

/** Factory tạo một instance driver mới. */
export type OtDriverFactory = () => OtDriver;
