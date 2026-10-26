/**
 * SCADA R1b-2b-1 Task 2 (điều kiện 1b, preflight C1) — địa chỉ mà driver GHI THÀNH MỘT BIT bất kể `dataType` của tag. THUẦN (chỉ dùng bộ phân
 * tích địa chỉ của chính các driver, không I/O).
 *
 *   • `modbus_coil`          — Modbus: thanh ghi kiểu coil (`parseModbusAddress`; "coil:N" | "0x:N" | 1..9999) — `writeCoil(boolChoGhi(..))`;
 *   • `modbus_holding_bool`  — Modbus: holding với dataType bool — `encodeModbus("bool")` ghi 1 / 0;
 *   • `slmp_bit`             — SLMP: bit-device (`parseSlmpDevice(..).isBit`) — slmpDriver ghi bit khi `dev.isBit` BẤT KỂ dataType;
 *   • `mc_bit`               — MELSEC MC: bit-device hoặc "<word>.<bit>" (`parseMcAddress(..).isBit`);
 *   • `s7_bit`               — Siemens S7: "DB<n>,X<o>.<b>", "M0.0", "MX3.1"… (`parseS7Address(..).isBit`).
 * Fix round 1 (M1 + lo ngại 4): MC và S7 nay cũng ghi MỘT BIT bất kể dataType trên các địa chỉ này (`boolChoGhi`), như coil Modbus / bit SLMP.
 * Địa chỉ không phân tích được ⇒ null (driver từ chối mọi write tới nó). EtherNet/IP / OPC UA: địa chỉ là TÊN, driver ghi theo `dataType` ⇒ null
 * (tag bool của chúng đã chỉ mang true/false — `validateStopValue`).
 *
 * Dùng LÚC ĐẶT ghim STOP (`stopPin.datStopPin`): trên các địa chỉ này giá trị ghim phải thuộc tập bool hợp lệ (8 giá trị, `boolTuGiaTri`), nếu
 * không bị từ chối với `StopPinLoi("dia_chi_bit")`. CỐ Ý không ở `validateStopValue` (chạy cả lúc dispatch: ghim cũ sẽ "biến mất" ⇒ STOP
 * "chưa ghim"); ghim CŨ ngoài tập vẫn được gửi và driver ghi bằng `boolDungGhim` (KD-T2).
 */
import { parseModbusAddress } from "./modbusDecode";
import { parseSlmpDevice } from "./slmpEncoder";
import { parseMcAddress } from "./mcAddress";
import { parseS7Address } from "./s7Address";
import { boolTuGiaTri } from "./boolNghiem";

export type LopDiaChiBit = "modbus_coil" | "modbus_holding_bool" | "slmp_bit" | "mc_bit" | "s7_bit";

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
      case "s7":
        return parseS7Address(address).isBit ? "s7_bit" : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Fix round 1 (I1, review Task 2) — MỘT luật theo ĐỊA CHỈ cho mọi bên KHÔNG phải STOP đã xác minh: địa chỉ thuộc lớp bit (`lopDiaChiBit`) ⇒ giá trị
 * phải thuộc tập bool hợp lệ (`boolTuGiaTri`), BẤT KỂ dataType của tag — vì driver ghi MỘT BIT bằng `boolGhi` chặt (ngoài tập ⇒ write `failed` ở
 * driver, SAU mọi cổng). Dùng ở: cổng kênh sớm của `dispatch()` (`congKenhSom`, SAU miễn STOP khớp ghim — STOP luôn khoan dung, KD-T2), kiểm lúc LƯU
 * luật interlock (`kiemLenhInterlockTrenKenh` khi biết protocol + address) và posture / khởi động (`luatLenhLechLuoi`). Không phải lớp bit, hoặc
 * thiếu protocol / address ⇒ ok (không đoán).
 */
export function kiemGiaTriDiaChiBit(
  protocol: string | null | undefined,
  address: string | null | undefined,
  dataType: string | null | undefined,
  giaTri: unknown,
): { ok: true } | { ok: false; lopBit: LopDiaChiBit; chiTiet: string } {
  if (!protocol || !address) return { ok: true };
  const lopBit = lopDiaChiBit(protocol, address, dataType);
  if (lopBit === null || boolTuGiaTri(giaTri) !== undefined) return { ok: true };
  return {
    ok: false,
    lopBit,
    chiTiet: `Địa chỉ ${address} (${lopBit}) được ghi thành MỘT BIT — giá trị phải là true/false, 1/0, "1"/"0" hoặc "true"/"false".`,
  };
}
