/**
 * SCADA R0 (C2 nền, C5) — hợp đồng chất lượng 3 mức (good / uncertain / bad) và ánh xạ lỗi giao thức sang
 * (statusCode, reason). Thuần hàm, KHÔNG I/O: mọi driver dùng chung để một tag/lô hỏng nói được "vì sao".
 *
 * Quy ước:
 *   - `statusCode` là chuỗi ngắn, ổn định, đọc được (không chứa địa chỉ/endpoint) để người vận hành tra cứu.
 *   - `reason` là phân loại thô (LyDoChatLuong) cho UI/cảnh báo/interlock.
 */
import { DeviceUnreachableError } from "../../_core/deviceErrors";
import type { LyDoChatLuong, OtQuality, OtSample, OtTagAddress } from "./otDriver";

/** OPC UA StatusCode (mã lõi = 16 bit cao; 16 bit thấp là bit thông tin, đã che) báo MẤT LIÊN LẠC. */
const OPCUA_MAT_LIEN_LAC = new Set<number>([
  0x80310000, // BadNoCommunication
  0x808a0000, // BadNotConnected
  0x800a0000, // BadTimeout
  0x800d0000, // BadServerNotConnected
  0x80050000, // BadCommunicationError
]);

/** OPC UA StatusCode báo CẤU HÌNH SAI (node không tồn tại/không hợp lệ). */
const OPCUA_SAI_CAU_HINH = new Set<number>([
  0x80340000, // BadNodeIdUnknown
  0x80330000, // BadNodeIdInvalid
]);

/** Modbus exception code: địa chỉ/hàm/giá trị không hợp lệ ⇒ lỗi cấu hình. */
const MODBUS_SAI_CAU_HINH = new Set<number>([
  1, // Illegal Function
  2, // Illegal Data Address
  3, // Illegal Data Value
]);

/** SLMP end code: địa chỉ/thiết bị/phạm vi sai ⇒ lỗi cấu hình. */
const SLMP_SAI_CAU_HINH = new Set<number>([
  0xc056, // địa chỉ vượt phạm vi
  0xc059, // lệnh/subcommand không hỗ trợ
  0xc05b, // CPU không đọc/ghi được thiết bị này
]);

/** Mã lỗi hệ điều hành/socket nghĩa là mất liên lạc. */
const MA_LOI_MANG = new Set<string>(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "EHOSTUNREACH"]);

const DO_DAI_TOI_DA_STATUS = 80;

/**
 * Chất lượng một mẫu OPC UA từ StatusCode. Mức lấy từ 2 bit cao: 0 good, 1 uncertain, 2–3 bad.
 * Good ⇒ chỉ `{ quality: "good" }` (hình dạng cũ).
 */
export function chatLuongOpcua(
  scVal: number,
  moTa: string,
): { quality: OtQuality; statusCode?: string; reason?: LyDoChatLuong } {
  const sc = scVal >>> 0;
  const muc = sc >>> 30;
  if (muc === 0) return { quality: "good" };
  if (muc === 1) return { quality: "uncertain", statusCode: moTa, reason: "device_error" };
  // Tra tập theo mã lõi (16 bit cao): 16 bit thấp là bit thông tin/giới hạn/overflow, không đổi nghĩa mã.
  const loi = (sc & 0xffff0000) >>> 0;
  const reason: LyDoChatLuong = OPCUA_MAT_LIEN_LAC.has(loi)
    ? "comm_lost"
    : OPCUA_SAI_CAU_HINH.has(loi)
      ? "config_error"
      : "device_error";
  return { quality: "bad", statusCode: moTa, reason };
}

function maLoi(err: unknown): string | undefined {
  const c = (err as { code?: unknown } | null | undefined)?.code;
  return typeof c === "string" ? c : undefined;
}

/** Lỗi do quá hạn đọc/ghi (TransactionTimedOutError, TimeoutError, "timed out"). Mã ETIMEDOUT của hệ điều hành KHÔNG tính ở đây. */
export function laLoiTimeout(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as { name?: unknown; message?: unknown };
  if (typeof e.name === "string" && /time(d)?-?out/i.test(e.name)) return true;
  if (typeof e.message === "string" && /\btime(d)?[ -]?out\b/i.test(e.message)) return true;
  return false;
}

function thongDiepNgan(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const s = raw.trim().slice(0, DO_DAI_TOI_DA_STATUS);
  return s || "unknown";
}

/** Ánh xạ lỗi chung (mọi giao thức) ⇒ (statusCode, reason). */
export function chatLuongLoiChung(err: unknown): { statusCode: string; reason: LyDoChatLuong } {
  if (laLoiTimeout(err)) return { statusCode: "timeout", reason: "comm_lost" };
  if (err instanceof DeviceUnreachableError) return { statusCode: "unreachable", reason: "comm_lost" };
  const code = maLoi(err);
  if (code && MA_LOI_MANG.has(code)) return { statusCode: code, reason: "comm_lost" };
  return { statusCode: thongDiepNgan(err), reason: "device_error" };
}

/** Ánh xạ lỗi Modbus: mã exception của thiết bị trước, rồi rơi về `chatLuongLoiChung`. */
export function chatLuongLoiModbus(err: unknown): { statusCode: string; reason: LyDoChatLuong } {
  const mc = (err as { modbusCode?: unknown } | null | undefined)?.modbusCode;
  if (typeof mc === "number" && Number.isInteger(mc) && mc > 0) {
    return {
      statusCode: `modbus_exc_${String(mc).padStart(2, "0")}`,
      reason: MODBUS_SAI_CAU_HINH.has(mc) ? "config_error" : "device_error",
    };
  }
  return chatLuongLoiChung(err);
}

/** Ánh xạ SLMP end code (Mitsubishi) ⇒ (statusCode, reason). */
export function chatLuongEndCodeSlmp(endCode: number): { statusCode: string; reason: LyDoChatLuong } {
  const hex = (endCode >>> 0).toString(16).toUpperCase().padStart(4, "0");
  return {
    statusCode: `slmp_end_0x${hex}`,
    reason: SLMP_SAI_CAU_HINH.has(endCode) ? "config_error" : "device_error",
  };
}

/** Một mẫu `bad` (value/raw null, giờ do server đóng dấu) cho MỖI tag — dùng khi cả lần đọc hỏng. */
export function mauXauChoMoiTag(tags: OtTagAddress[], statusCode: string, reason: LyDoChatLuong, at: Date): OtSample[] {
  return tags.map((t) => ({
    tagKey: t.tagKey,
    raw: null,
    value: null,
    quality: "bad" as const,
    timestamp: at,
    tsSource: "server" as const,
    statusCode,
    reason,
  }));
}

/** Cờ OT_CHAT_LUONG_V2_ENABLED (mặc định TẮT): driver phát chất lượng 3 mức + mẫu xấu khi mất liên lạc. Đọc tại điểm dùng. */
export function chatLuongV2Bat(): boolean {
  return process.env.OT_CHAT_LUONG_V2_ENABLED === "true";
}
