/**
 * Sprint F1.1 — Modbus driver (KHUNG). Triển khai thật ở F1.2 (package `modbus-serial`).
 */
import type { OtProtocol, OtDriver } from "../otDriver";
import { NotImplementedDriver } from "./notImplementedDriver";

export class ModbusDriver extends NotImplementedDriver {
  readonly protocol: OtProtocol = "modbus";
  protected readonly packageName = "modbus-serial";
}

export function createModbusDriver(): OtDriver {
  return new ModbusDriver();
}
