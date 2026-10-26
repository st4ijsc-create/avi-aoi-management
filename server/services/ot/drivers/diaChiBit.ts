/**
 * SCADA R1b-2b-1 Task 2 (điều kiện 1b, preflight C1) — địa chỉ mà driver GHI THÀNH MỘT BIT bất kể `dataType` của tag. THUẦN (chỉ dùng bộ phân
 * tích địa chỉ của chính các driver, không I/O).
 *
 *   • `modbus_coil`          — Modbus: thanh ghi kiểu coil (`parseModbusAddress`; "coil:N" | "0x:N" | 1..9999) — `writeCoil(boolChoGhi(..))`;
 *   • `modbus_holding_bool`  — Modbus: holding với dataType bool — `encodeModbus("bool")` ghi 1 / 0;
 *   • `slmp_bit`             — SLMP: bit-device (`parseSlmpDevice(..).isBit`) — slmpDriver ghi bit khi `dev.isBit` BẤT KỂ dataType;
 *   • `mc_bit`               — MELSEC MC: bit-device hoặc "<word>.<bit>" (`parseMcAddress(..).isBit`).
 * Địa chỉ không phân tích được ⇒ null (driver từ chối mọi write tới nó). S7 / EtherNet/IP / OPC UA: driver ghi theo `dataType` ⇒ null
 * (tag bool của chúng đã chỉ mang true/false — `validateStopValue`).
 *
 * Dùng LÚC ĐẶT ghim STOP (`stopPin.datStopPin`): trên các địa chỉ này giá trị ghim phải thuộc tập bool hợp lệ (8 giá trị, `boolTuGiaTri`), nếu
 * không bị từ chối với `StopPinLoi("dia_chi_bit")`. CỐ Ý không ở `validateStopValue` (chạy cả lúc dispatch: ghim cũ sẽ "biến mất" ⇒ STOP
 * "chưa ghim"); ghim CŨ ngoài tập vẫn được gửi và driver ghi bằng `boolDungGhim` (KD-T2).
 */
import { parseModbusAddress } from "./modbusDecode";
import { parseSlmpDevice } from "./slmpEncoder";
import { parseMcAddress } from "./mcAddress";

export type LopDiaChiBit = "modbus_coil" | "modbus_holding_bool" | "slmp_bit" | "mc_bit";

export function lopDiaChiBit(protocol: string | null | undefined, address: string, dataType: string | null | undefined): LopDiaChiBit | null {
  try {
    switch (protocol) {
      case "modbus": {
        const p = parseModbusAddress(address);
        if (p.registerType === "coil") return "modbus_coil";
        if (p.registerType === "holding" && dataType === "bool") return "modbus_holding_bool";
        return null;
      }
      case "slmp":
        return parseSlmpDevice(address).isBit ? "slmp_bit" : null;
      case "mitsubishi-mc":
        return parseMcAddress(address).isBit ? "mc_bit" : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}
