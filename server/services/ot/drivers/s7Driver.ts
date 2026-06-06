/**
 * Sprint F1.1 — Siemens S7 driver (KHUNG). Triển khai thật ở F1.3 (package `nodes7`).
 */
import type { OtProtocol, OtDriver } from "../otDriver";
import { NotImplementedDriver } from "./notImplementedDriver";

export class S7Driver extends NotImplementedDriver {
  readonly protocol: OtProtocol = "s7";
  protected readonly packageName = "nodes7";
}

export function createS7Driver(): OtDriver {
  return new S7Driver();
}
