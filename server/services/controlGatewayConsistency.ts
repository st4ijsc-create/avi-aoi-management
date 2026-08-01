/**
 * W1-3 (audit doc 25 T2) — Fail-fast kiểm tra nhất quán cặp cờ CONTROL/GATEWAY.
 *
 * Vấn đề: *_CONTROL_ENABLED=true "trang bị" đường ghi thật ở dispatcher, NHƯNG nếu
 * *_GATEWAY_ENABLED không bật thì manager không nạp adapter/robot nào → getActiveDriver()
 * = undefined → mọi lệnh ghi thật rơi ADAPTER_OFFLINE ÂM THẦM. Đây là bất đối xứng
 * cấu hình nguy hiểm (vd OT_CONTROL_ENABLED=true nhưng OT_GATEWAY_ENABLED bị comment).
 *
 * Helper thuần (không side-effect): nhận `env` → trả danh sách cảnh báo cần LOG đỏ.
 * KHÔNG tự bật gateway (fail-closed, chỉ cảnh báo). Việc log do `logControlGateway
 * Consistency` đảm nhận lúc khởi động.
 */

/** Một cặp cờ cần kiểm tra nhất quán (control armed ⇒ gateway phải bật). */
interface ControlGatewayPair {
  domain: string;
  controlFlag: string;
  gatewayFlag: string;
}

/** Các cặp áp dụng: OT và Robot (mirror lẫn nhau). */
const PAIRS: readonly ControlGatewayPair[] = [
  { domain: "OT", controlFlag: "OT_CONTROL_ENABLED", gatewayFlag: "OT_GATEWAY_ENABLED" },
  { domain: "Robot", controlFlag: "ROBOT_CONTROL_ENABLED", gatewayFlag: "ROBOT_GATEWAY_ENABLED" },
];

/**
 * Trả danh sách cảnh báo cho các cặp cờ LỆCH: control=true nhưng gateway != "true".
 * Rỗng khi mọi cặp nhất quán (cả hai bật, hoặc control tắt bất kể gateway).
 */
export function checkControlGatewayConsistency(
  env: Record<string, string | undefined>,
): string[] {
  const warnings: string[] = [];
  for (const p of PAIRS) {
    const controlOn = env[p.controlFlag] === "true";
    const gatewayOn = env[p.gatewayFlag] === "true";
    // Chỉ cảnh báo khi control ĐÃ trang bị mà gateway KHÔNG bật → không adapter nào start.
    if (controlOn && !gatewayOn) {
      const gwValue = env[p.gatewayFlag] === undefined ? "unset" : `"${env[p.gatewayFlag]}"`;
      warnings.push(
        `[${p.domain}] CẤU HÌNH LỆCH: ${p.controlFlag}=true (đường ghi thật đã trang bị) ` +
          `nhưng ${p.gatewayFlag}=${gwValue} (gateway TẮT) → không adapter nào được nạp, ` +
          `mọi lệnh ghi thật sẽ rơi ADAPTER_OFFLINE âm thầm. ` +
          `Bật ${p.gatewayFlag}=true, hoặc tắt ${p.controlFlag}.`,
      );
    }
  }
  return warnings;
}

/**
 * Đọc process.env, LOG cảnh báo đỏ (console.warn) cho mỗi cặp lệch lúc khởi động.
 * KHÔNG tự bật gateway. Trả số cảnh báo (tiện cho test/quan sát).
 */
export function logControlGatewayConsistency(
  env: Record<string, string | undefined> = process.env,
): number {
  const warnings = checkControlGatewayConsistency(env);
  for (const w of warnings) {
    console.warn(w);
  }
  return warnings.length;
}
