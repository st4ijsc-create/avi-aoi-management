/**
 * Sprint F1.1 — Base "not implemented" OT driver.
 *
 * Khung cho các driver giao thức thật (OPC-UA / Modbus / S7 / Mitsubishi MC /
 * EtherNet-IP). connect() ném Error có tên protocol; mọi thao tác I/O khác ném.
 * Mỗi driver con khai báo `packageName` của lib npm tương ứng và chuẩn bị sẵn
 * pattern DYNAMIC-IMPORT-QUA-BIẾN (tránh TS2307 vì 2 package CHƯA cài — để F1.2).
 */
import type {
  OtProtocol,
  OtDriver,
  OtConnectionConfig,
  OtTagAddress,
  OtSample,
  OtSubscriptionHandle,
  OtCommandResult,
  OtWrite,
  OtHealth,
  OnOtSample,
} from "../otDriver";
import { DeviceProtocolUnsupportedError } from "../../../_core/deviceErrors";

export abstract class NotImplementedDriver implements OtDriver {
  abstract readonly protocol: OtProtocol;
  /** Tên package npm sẽ dùng ở F1.2/F1.3 (dynamic import qua biến). */
  protected abstract readonly packageName: string;

  /** Phase tiếp theo dự kiến triển khai driver này. */
  protected readonly phase: string = "F1.2/F1.3";

  /** Nạp lib qua biến specifier để tránh lỗi biên dịch khi package chưa cài. */
  protected async loadPackage(): Promise<unknown> {
    const pkg = this.packageName;
    return import(pkg).catch(() => null);
  }

  async connect(_cfg: OtConnectionConfig): Promise<void> {
    throw new DeviceProtocolUnsupportedError(this.protocol, this.phase);
  }

  async disconnect(): Promise<void> {
    // no-op: chưa từng kết nối
  }

  isConnected(): boolean {
    return false;
  }

  async readTags(_tags: OtTagAddress[]): Promise<OtSample[]> {
    throw new DeviceProtocolUnsupportedError(this.protocol, this.phase);
  }

  async subscribe(_tags: OtTagAddress[], _onSample: OnOtSample, _intervalMs?: number): Promise<OtSubscriptionHandle> {
    throw new DeviceProtocolUnsupportedError(this.protocol, this.phase);
  }

  async writeTags(_writes: OtWrite[]): Promise<OtCommandResult[]> {
    throw new DeviceProtocolUnsupportedError(this.protocol, this.phase);
  }

  async health(): Promise<OtHealth> {
    return {
      protocol: this.protocol,
      connected: false,
      lastError: `not implemented (${this.phase})`,
    };
  }
}
