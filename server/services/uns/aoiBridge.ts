/**
 * Sprint F3b — Bridge topic AOI cũ (Aedes) → Sparkplug-B telemetry (THUẦN, không I/O).
 *
 * Map message AOI hiện hữu (NG alert / summary) sang tập metric Sparkplug-B để phát
 * DBIRTH (định nghĩa metric) + DDATA (giá trị). KHÔNG mở socket, KHÔNG publish — chỉ
 * tính toán; caller (unsPublisher) lo I/O. Test offline được.
 *
 * NGUYÊN TẮC AN TOÀN:
 * - Chỉ read-direction: AOI → Sparkplug là PUBLISH telemetry. KHÔNG sinh NCMD/DCMD.
 * - Backward-compat: KHÔNG đổi topic AOI gốc; module này chỉ ĐỌC topic+payload.
 * - Tái dùng parseAviTopic (từ unsBridge) — KHÔNG viết lại logic parse.
 *
 * LƯU Ý topic thật: AOI publish dạng `avi/factory/{factoryId}/workshop/{workshopId}/
 * station/{stationId}/...` nhưng parseAviTopic mong dạng `avi/{factoryId}/workshop/...`.
 * Ta CHỈ chuẩn hoá chuỗi topic về dạng parseAviTopic hiểu (bỏ segment "factory/")
 * TRƯỚC khi gọi — KHÔNG sửa parseAviTopic.
 */

import { parseAviTopic, type ParsedTopic } from "../unsBridge";
import type { MetricDef, MetricSample } from "./sparkplugNode";

/** Kết quả map: deviceId + metric defs (cho DBIRTH) + metric samples (cho DDATA). */
export interface AoiBridgeMapping {
  deviceId: string;
  metricDefs: MetricDef[];
  metrics: MetricSample[];
}

/**
 * Chuẩn hoá topic AOI thật về dạng parseAviTopic hiểu được, rồi parse.
 * - `avi/factory/12/workshop/3/station/45/errors` → bỏ "factory/" → parseAviTopic OK.
 * - Topic vốn đã dạng `avi/12/workshop/...` cũng vẫn parse được (no-op chuẩn hoá).
 */
function parseAoiTopic(topic: string): ParsedTopic | null {
  // Bỏ segment "factory/" chèn giữa prefix avi và factoryId (chỉ chuỗi, không đổi topic gốc).
  const normalized = topic.replace(/^(avi(?:-aoi)?\/)factory\//i, "$1");
  return parseAviTopic(normalized);
}

/** Helpers chọn giá trị an toàn (graceful khi field thiếu). */
function asInt(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function asDouble(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function asString(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return typeof v === "string" ? v : String(v);
}

/**
 * Build cặp {metricDefs, metrics} từ một danh sách (name, type, value).
 * metricDefs (DBIRTH) và metrics (DDATA) chia sẻ cùng name/type/value khởi tạo.
 */
function buildMetrics(
  entries: Array<{ name: string; type: string; value: unknown }>,
): { metricDefs: MetricDef[]; metrics: MetricSample[] } {
  const ts = Date.now();
  const metricDefs: MetricDef[] = entries.map((e) => ({ ...e, timestamp: ts }));
  const metrics: MetricSample[] = entries.map((e) => ({ ...e, timestamp: ts }));
  return { metricDefs, metrics };
}

/**
 * Map topic + payload AOI → mapping Sparkplug (deviceId + metricDefs + metrics).
 * Trả null nếu topic không khớp cấu trúc AOI hoặc không phải loại có bridge.
 *
 * Mỗi loại message có TẬP METRIC CỐ ĐỊNH → DBIRTH 1 lần đủ defs là đủ; nếu device
 * đổi loại message (xuất hiện metric name mới) thì caller (publishAoiBridge) tự
 * trigger re-DBIRTH dựa trên alias/birth-state. Ở đây chỉ tính metric set.
 *
 * Graceful: payload thiếu field → dùng giá trị fallback, KHÔNG throw.
 */
export function mapAoiTopicToSparkplug(
  topic: string,
  payload: unknown,
): AoiBridgeMapping | null {
  if (typeof topic !== "string" || topic.length === 0) return null;

  const parsed = parseAoiTopic(topic);
  if (!parsed) return null;

  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const deviceId = `Station${parsed.stationId}`;
  const mt = parsed.messageType.toLowerCase();

  // --- NG alert: topic chứa "/errors" (hoặc messageType bắt đầu errors) ---
  if (mt.includes("errors")) {
    const product = (p.product && typeof p.product === "object" ? p.product : {}) as Record<string, unknown>;
    // result tổng thể: ưu tiên overallResult, fallback "NG".
    const result = asString(p.overallResult ?? "NG", "NG");
    const entries = [
      { name: "ng_count", type: "Int64", value: asInt(p.totalNG) },
      { name: "severity", type: "String", value: asString(p.severity) },
      { name: "serial", type: "String", value: asString(product.serialNumber) },
      { name: "inspection_id", type: "Int64", value: asInt(p.inspectionId) },
      { name: "result", type: "String", value: result },
    ];
    const { metricDefs, metrics } = buildMetrics(entries);
    return { deviceId, metricDefs, metrics };
  }

  // --- Summary: topic chứa "/summary/" (daily|weekly) ---
  if (mt.includes("summary/") || mt.startsWith("summary")) {
    // statistics nằm trong SummaryPayload.statistics {totalInspections,totalNG,ngRate}.
    const stats = (p.statistics && typeof p.statistics === "object" ? p.statistics : p) as Record<string, unknown>;
    const entries = [
      { name: "total_inspections", type: "Double", value: asDouble(stats.totalInspections) },
      { name: "total_ng", type: "Double", value: asDouble(stats.totalNG) },
      { name: "ng_rate", type: "Double", value: asDouble(stats.ngRate) },
    ];
    const { metricDefs, metrics } = buildMetrics(entries);
    return { deviceId, metricDefs, metrics };
  }

  return null;
}
