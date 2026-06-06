/**
 * Sprint F3a — Sparkplug-B CORE: topic builder THUẦN.
 *
 * Dựng topic spBv1.0: `spBv1.0/{group}/{type}/{edge}[/{device}]`.
 * Sanitize loại bỏ ký tự cấm trong segment topic ('/' và '#', '+').
 */

export type SparkplugMessageType =
  | "NBIRTH"
  | "NDEATH"
  | "DBIRTH"
  | "DDATA"
  | "DDEATH"
  | "NCMD" // F4 HITL: NCMD/DCMD execute NOT implemented — chỉ để hoàn chỉnh union.
  | "DCMD"
  | "STATE";

/** Loại ký tự cấm MQTT/Sparkplug khỏi một segment ('/', '#', '+'). */
function sanitize(seg: string): string {
  return seg.replace(/[/#+]/g, "");
}

/**
 * Dựng topic Sparkplug: `spBv1.0/{group}/{type}/{edge}[/{device}]`.
 */
export function buildTopic(
  groupId: string,
  messageType: SparkplugMessageType,
  edgeNodeId: string,
  deviceId?: string,
  namespace = "spBv1.0",
): string {
  const parts = [namespace, sanitize(groupId), messageType, sanitize(edgeNodeId)];
  if (deviceId != null && deviceId !== "") {
    parts.push(sanitize(deviceId));
  }
  return parts.join("/");
}
