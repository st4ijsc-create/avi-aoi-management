// Doc 56 Đợt 2 việc 5 (Đ2b nhóm 1) — Wizard hợp nhất "Thêm thiết bị" V2.
//
// CLIENT-ONLY, cờ default OFF (`DEVICE_ONBOARD_WIZARD_V2_ENABLED`). Shared types +
// constants + flag helper cho hai nhánh KHÔNG-aoi (automation / iot). Nhánh
// `aoi_avi` tái dùng NGUYÊN VẸN `AoiOnboardingWizardContent` nên không giữ state ở
// đây. Giao thức mô tả theo doc 57 (ST4I Standard Process Feed v1).
//
// LƯU Ý: các nhánh automation/iot ở bản này là WIZARD THIẾT KẾ (thu thập cấu hình
// vào state cục bộ) — provisioning thật (tạo máy, seed recipe/guardrail, cấp mk_)
// nằm ở Đợt 4. Không gọi procedure tạo máy ở đây (tránh bịa API). Bước credential
// chỉ HƯỚNG DẪN + (admin) mint enrollment token `met_` bằng procedure có thật.
import type { DeviceClass } from "@/hooks/useMachineTypes";

export type { DeviceClass };

const FLAG_KEY = "DEVICE_ONBOARD_WIZARD_V2_ENABLED";

/**
 * Cờ wizard hợp nhất V2 — mặc định OFF (route ẩn khi OFF; orchestrator gate route
 * + TAB_REDIRECTS sau). Theo đúng convention client-flag của repo
 * (appLauncherFlag.ts / useMachineTypes.ts): localStorage override ("true"/"false")
 * → VITE env `VITE_DEVICE_ONBOARD_WIZARD_V2_ENABLED` → OFF.
 */
export function isDeviceOnboardWizardV2Enabled(): boolean {
  if (typeof window !== "undefined") {
    try {
      const v = window.localStorage.getItem(FLAG_KEY);
      if (v === "true") return true;
      if (v === "false") return false;
    } catch {
      /* storage unavailable — dùng env default */
    }
  }
  return import.meta.env.VITE_DEVICE_ONBOARD_WIZARD_V2_ENABLED === "true";
}

// ── Tham chiếu tài liệu / endpoint (doc 57) ──────────────────────────────────
export const DOC57_PATH = "docs/ECOSYSTEM/57_ST4I_STANDARD_PROCESS_FEED_SPEC.md";
export const ADAPTER_SDK_PATH = "examples/device-client/";
/** Route in-app tài liệu API (ApiDocs) + tab Mã gia nhập thiết bị (Factory Config). */
export const API_DOCS_ROUTE = "/api-docs";
export const ENROLLMENT_TOKENS_ROUTE = "/datasettings?tab=enrollment-tokens";

export const INGEST_PROCESS_RESULT_ENDPOINT = "/api/v1/ingest/process-result";
export const INGEST_TELEMETRY_ENDPOINT = "/api/v1/ingest/telemetry";
export const MQTT_TOPIC_PREFIX = "syn/"; // SYNAPSE namespace (doc 57 §1/§10)

// ── Giao thức automation (doc 57 §1) ─────────────────────────────────────────
export type AutomationProtocol = "http-push" | "plc-adapter" | "mqtt";

export interface ProtocolOption {
  value: AutomationProtocol;
  /** i18n suffix: deviceOnboarding.automation.protocol.<key>{Title,Desc} */
  key: string;
  /** endpoint/topic hiển thị dạng <code> (không qua i18n). */
  target: string;
}

export const AUTOMATION_PROTOCOLS: readonly ProtocolOption[] = [
  { value: "http-push", key: "http", target: `POST ${INGEST_PROCESS_RESULT_ENDPOINT}` },
  { value: "plc-adapter", key: "plc", target: "OT adapter (PLC / Zmotion / Modbus)" },
  { value: "mqtt", key: "mqtt", target: `${MQTT_TOPIC_PREFIX}<line>/<machine>/result` },
];

// ── Kênh IoT (doc 57 §9) ─────────────────────────────────────────────────────
export type IotChannel = "http-telemetry" | "mqtt";

export interface IotChannelOption {
  value: IotChannel;
  key: string; // deviceOnboarding.iot.channel.<key>{Title,Desc}
  target: string;
}

export const IOT_CHANNELS: readonly IotChannelOption[] = [
  { value: "http-telemetry", key: "http", target: `POST ${INGEST_TELEMETRY_ENDPOINT}` },
  { value: "mqtt", key: "mqtt", target: `${MQTT_TOPIC_PREFIX}iot/<device>/telemetry` },
];

/** deviceClass iot chỉ có hai loại (đồng bộ useMachineTypes fallback). */
export const IOT_MACHINE_TYPES = ["IOT_SENSOR", "IOT_GATEWAY"] as const;
export type IotMachineType = (typeof IOT_MACHINE_TYPES)[number];

/** Gợi ý metric IoT phổ biến (doc 57 §6/§8.3) — user thêm/sửa tự do. */
export const IOT_METRIC_PRESETS: readonly { name: string; unit: string }[] = [
  { name: "temperature", unit: "°C" },
  { name: "humidity", unit: "%RH" },
  { name: "pressure", unit: "kPa" },
  { name: "current", unit: "A" },
];

// ── State cục bộ nhánh automation ────────────────────────────────────────────
export interface GuardrailRow {
  id: string;
  /** Tên tham số máy sẽ GHI (vd torqueTarget, glueVolume). */
  param: string;
  min: string; // giữ dạng string trong form; parse khi seed parameter_guardrails ở Đ4
  max: string;
  maxStep: string; // biên độ thay đổi tối đa mỗi lần ghi
  unit: string;
}

export interface AutomationDraft {
  // Bước 1 — thông tin máy
  machineType: string; // lọc deviceClass automation
  code: string;
  name: string;
  stationId: string;
  // Bước 2 — giao thức
  protocol: AutomationProtocol;
  // Bước 3 — recipe/chương trình khởi tạo (placeholder — deploy thật Đ4)
  recipeCode: string;
  recipeVersion: string;
  // Bước 4 — guardrail (BẮT BUỘC ≥1 dòng hợp lệ; seed parameter_guardrails ở Đ4)
  guardrails: GuardrailRow[];
  // Bước 5 — credential
  credentialAcknowledged: boolean;
  // Bước 6 — sign-off
  signedOff: boolean;
}

export const initialAutomationDraft: AutomationDraft = {
  machineType: "",
  code: "",
  name: "",
  stationId: "",
  protocol: "http-push",
  recipeCode: "",
  recipeVersion: "",
  guardrails: [],
  credentialAcknowledged: false,
  signedOff: false,
};

// ── State cục bộ nhánh iot ───────────────────────────────────────────────────
export interface MetricRow {
  id: string;
  name: string; // canonical (temperature, humidity...)
  unit: string; // °C, %RH...
}

export interface IotDraft {
  // Bước 1 — thông tin
  machineType: IotMachineType;
  code: string;
  workshopId: string; // chọn workshop → station ảo IOT-<workshopCode>
  // Bước 2 — kênh
  channel: IotChannel;
  // Bước 3 — lược đồ metric (≥1)
  metrics: MetricRow[];
  // Bước 4 — credential mk_ (guide + option cert QĐ4)
  credentialAcknowledged: boolean;
  useCert: boolean;
  // Bước 5 — sign-off
  signedOff: boolean;
}

export const initialIotDraft: IotDraft = {
  machineType: "IOT_SENSOR",
  code: "",
  workshopId: "",
  channel: "http-telemetry",
  metrics: [],
  credentialAcknowledged: false,
  useCert: false,
  signedOff: false,
};

let _rowSeq = 0;
/** Khóa dòng client-only cho guardrail/metric (không phải id server). */
export function newRowId(prefix = "row"): string {
  _rowSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_rowSeq}`;
}

/** ≥1 guardrail có param + min + max (maxStep khuyến nghị) → mới cho qua bước 4. */
export function hasValidGuardrail(rows: GuardrailRow[]): boolean {
  return rows.some(
    (r) => r.param.trim().length > 0 && r.min.trim().length > 0 && r.max.trim().length > 0,
  );
}

/** ≥1 metric có tên → mới cho qua bước lược đồ metric. */
export function hasValidMetric(rows: MetricRow[]): boolean {
  return rows.some((r) => r.name.trim().length > 0);
}
