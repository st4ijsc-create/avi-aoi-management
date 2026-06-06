/**
 * Sprint F1.1 — EtherNet/IP (CIP) driver (KHUNG). Triển khai thật ở F1.3.
 */
import type { OtProtocol, OtDriver } from "../otDriver";
import { NotImplementedDriver } from "./notImplementedDriver";

export class EthernetIpDriver extends NotImplementedDriver {
  readonly protocol: OtProtocol = "ethernet-ip";
  protected readonly packageName = "ethernet-ip";
}

export function createEthernetIpDriver(): OtDriver {
  return new EthernetIpDriver();
}
