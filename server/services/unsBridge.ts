/**
 * G1 (Giai đoạn 1) — UNS Topic Normalization Bridge (ISA-95 / Sparkplug B).
 *
 * Mục tiêu: chuẩn hoá topic MQTT hiện tại (`avi/{factoryId}/workshop/{workshopId}/
 * station/{stationId}/{type}`) sang một Unified Namespace theo ISA-95 và (tuỳ chọn)
 * Sparkplug B — GIỮ TƯƠNG THÍCH NGƯỢC (không đổi topic gốc, chỉ phát thêm bản chuẩn hoá).
 *
 * Đây là lớp CODE-ONLY, feature-flag `UNS_BRIDGE_ENABLED`. Khi tắt hoặc không có
 * publisher, mọi hàm là no-op / chỉ trả về mapping thuần (không I/O).
 *
 * Bật thực sự (publish sang broker chuẩn hoá) sẽ làm ở Giai đoạn 1 khi có broker HA.
 */

const UNS_BRIDGE_ENABLED = process.env.UNS_BRIDGE_ENABLED === "true";

/** Định danh ISA-95 phân cấp (Enterprise → Site → Area → Line/WorkCenter → Cell/Unit). */
export interface Isa95Path {
  enterprise: string;
  site: string;        // factory
  area: string;        // workshop
  line: string;        // (suy ra từ station nếu không có line riêng)
  cell: string;        // station
  metric: string;      // messageType (inspection/errors/status/heartbeat/...)
}

export interface ParsedTopic {
  factoryId: string;
  workshopId: string;
  stationId: string;
  messageType: string;
  raw: string;
}

const ENTERPRISE = process.env.UNS_ENTERPRISE_NAME || "AVI-AOI";

/**
 * Parse topic dạng `avi/{factoryId}/workshop/{workshopId}/station/{stationId}/{type...}`.
 * Trả về null nếu không khớp cấu trúc đã biết.
 */
export function parseAviTopic(topic: string): ParsedTopic | null {
  // Bỏ prefix tuỳ chọn (avi/ hoặc avi-aoi/) — chuẩn hoá về dạng không prefix.
  const cleaned = topic.replace(/^avi(-aoi)?\//i, "");
  const m = cleaned.match(/^(\d+)\/workshop\/([^/]+)\/station\/([^/]+)\/(.+)$/i);
  if (!m) return null;
  return {
    factoryId: m[1],
    workshopId: m[2],
    stationId: m[3],
    messageType: m[4],
    raw: topic,
  };
}

/** Map topic gốc → ISA-95 path. */
export function toIsa95(parsed: ParsedTopic): Isa95Path {
  return {
    enterprise: ENTERPRISE,
    site: `Factory${parsed.factoryId}`,
    area: `Workshop${parsed.workshopId}`,
    line: `Line${parsed.workshopId}`,
    cell: `Station${parsed.stationId}`,
    metric: parsed.messageType,
  };
}

/** Topic UNS chuẩn ISA-95: `{enterprise}/{site}/{area}/{line}/{cell}/{metric}`. */
export function toUnsTopic(parsed: ParsedTopic): string {
  const p = toIsa95(parsed);
  return [p.enterprise, p.site, p.area, p.line, p.cell, p.metric].join("/");
}

/**
 * Topic Sparkplug B: `spBv1.0/{group_id}/{message_type}/{edge_node_id}/{device_id}`.
 * group_id = site, edge_node_id = area, device_id = cell. messageType map sang DDATA.
 */
export function toSparkplugTopic(parsed: ParsedTopic, msgType: "NBIRTH" | "DBIRTH" | "DDATA" | "DDEATH" = "DDATA"): string {
  const p = toIsa95(parsed);
  const groupId = `${p.enterprise}_${p.site}`;
  const edgeNodeId = p.area;
  const deviceId = p.cell;
  return `spBv1.0/${groupId}/${msgType}/${edgeNodeId}/${deviceId}`;
}

/**
 * Chuẩn hoá một message: trả về danh sách (topic, payload) cần phát thêm vào UNS.
 * KHÔNG tự publish — caller quyết định (giữ I/O ở rìa). No-op khi flag tắt.
 */
export function normalize(topic: string, payload: unknown): Array<{ topic: string; payload: unknown }> {
  if (!UNS_BRIDGE_ENABLED) return [];
  const parsed = parseAviTopic(topic);
  if (!parsed) return [];

  const out: Array<{ topic: string; payload: unknown }> = [];
  out.push({ topic: toUnsTopic(parsed), payload });

  if (process.env.UNS_SPARKPLUG_ENABLED === "true") {
    out.push({ topic: toSparkplugTopic(parsed, "DDATA"), payload });
  }
  return out;
}

export function isUnsBridgeEnabled(): boolean {
  return UNS_BRIDGE_ENABLED;
}
