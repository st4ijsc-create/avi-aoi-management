/**
 * Sprint F1.1 — Ingest một OtSample vào `ot_telemetry` (và tuỳ chọn phát sang UNS).
 *
 * `mapSampleToRow` là hàm thuần (test được không cần DB): số → valueNumeric;
 * bool/string/json → valueText. `ingestSample` ghi DB qua lazy getDb(); nếu
 * OT_INGEST_TO_UNS==="true" && isUnsBridgeEnabled() thì publishNormalized (TÁI DÙNG
 * publisher hiện có, KHÔNG viết publisher mới) — bọc try/catch RIÊNG để lỗi UNS
 * không làm hỏng đường ghi telemetry.
 */
import type { OtSample } from "./otDriver";
import type { RuntimeAdapter } from "./deviceAdapter";
import type { InsertOtTelemetry } from "../../../drizzle/schema";

/**
 * Map một sample sang hàng telemetry. Thuần, không I/O.
 */
export function mapSampleToRow(
  adapterId: number,
  machineId: number | null,
  sample: OtSample,
): InsertOtTelemetry {
  const row: InsertOtTelemetry = {
    adapterId,
    machineId: machineId ?? undefined,
    tagKey: sample.tagKey,
    valueNumeric: null,
    valueText: null,
    quality: sample.quality,
    timestamp: sample.timestamp,
  };

  const v = sample.value;
  if (typeof v === "number" && Number.isFinite(v)) {
    row.valueNumeric = String(v);
  } else if (typeof v === "boolean") {
    row.valueText = v ? "true" : "false";
  } else if (typeof v === "string") {
    row.valueText = v.length > 500 ? v.slice(0, 500) : v;
  } else if (v != null) {
    // fallback cho json/object
    const s = JSON.stringify(v);
    row.valueText = s.length > 500 ? s.slice(0, 500) : s;
  }

  return row;
}

/** UNS topic giả lập theo adapter/tag để tái dùng normalize → publishNormalized. */
function unsTopicFor(adapter: RuntimeAdapter, sample: OtSample): string {
  return `avi/0/workshop/ot/station/${adapter.code}/${sample.tagKey}`;
}

/**
 * Ghi một sample vào telemetry; tuỳ chọn phát bản chuẩn hoá sang UNS.
 */
export async function ingestSample(adapter: RuntimeAdapter, sample: OtSample): Promise<void> {
  const { getDb } = await import("../../db/connection");
  const db = await getDb();
  if (db) {
    const { otTelemetry } = await import("../../../drizzle/schema");
    const row = mapSampleToRow(adapter.adapterId, adapter.machineId, sample);
    await db.insert(otTelemetry).values(row);
  }

  if (process.env.OT_INGEST_TO_UNS === "true") {
    try {
      const { isUnsBridgeEnabled } = await import("../unsBridge");
      if (isUnsBridgeEnabled()) {
        const { publishNormalized } = await import("../unsPublisher");
        publishNormalized(unsTopicFor(adapter, sample), {
          adapterId: adapter.adapterId,
          machineId: adapter.machineId,
          tagKey: sample.tagKey,
          value: sample.value,
          quality: sample.quality,
          timestamp: sample.timestamp.toISOString(),
        });
      }
    } catch (err) {
      console.error("[OT] UNS publish failed:", (err as Error)?.message || err);
    }
  }
}
