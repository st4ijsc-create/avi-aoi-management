/**
 * Sprint F1.1 — OPC-UA driver (KHUNG). Triển khai thật ở F1.2 (package `node-opcua`).
 */
import type { OtProtocol, OtDriver } from "../otDriver";
import { NotImplementedDriver } from "./notImplementedDriver";

export class OpcuaDriver extends NotImplementedDriver {
  readonly protocol: OtProtocol = "opcua";
  protected readonly packageName = "node-opcua";
}

export function createOpcuaDriver(): OtDriver {
  return new OpcuaDriver();
}
