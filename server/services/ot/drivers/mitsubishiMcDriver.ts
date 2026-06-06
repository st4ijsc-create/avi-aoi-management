/**
 * Sprint F1.1 — Mitsubishi MC protocol driver (KHUNG). Triển khai thật ở F1.3.
 */
import type { OtProtocol, OtDriver } from "../otDriver";
import { NotImplementedDriver } from "./notImplementedDriver";

export class MitsubishiMcDriver extends NotImplementedDriver {
  readonly protocol: OtProtocol = "mitsubishi-mc";
  protected readonly packageName = "mcprotocol";
}

export function createMitsubishiMcDriver(): OtDriver {
  return new MitsubishiMcDriver();
}
