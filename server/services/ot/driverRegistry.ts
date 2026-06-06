/**
 * Sprint F1.1 — OT driver registry.
 *
 * Map protocol → factory. `createDriver` ném nếu protocol chưa đăng ký. Đăng ký
 * thực hiện ở `index.ts` (6 driver). `_clearRegistry` chỉ dùng trong test.
 */
import type { OtProtocol, OtDriver, OtDriverFactory } from "./otDriver";

const registry = new Map<OtProtocol, OtDriverFactory>();

/** Đăng ký factory cho một protocol (ghi đè nếu đã có). */
export function registerDriver(protocol: OtProtocol, factory: OtDriverFactory): void {
  registry.set(protocol, factory);
}

/** Tạo một driver mới cho protocol. Ném Error nếu chưa đăng ký. */
export function createDriver(protocol: OtProtocol): OtDriver {
  const factory = registry.get(protocol);
  if (!factory) {
    throw new Error(`No OT driver registered for protocol "${protocol}"`);
  }
  return factory();
}

/** Danh sách protocol đã đăng ký. */
export function listProtocols(): OtProtocol[] {
  return [...registry.keys()];
}

/** Xoá toàn bộ đăng ký — chỉ phục vụ test. */
export function _clearRegistry(): void {
  registry.clear();
}
