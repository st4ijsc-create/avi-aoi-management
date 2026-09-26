/**
 * doc 81 Đợt 1B Task 7 — handler của POST /api/ot/ingest (tách khỏi `_core/index.ts` để test
 * mount được ĐÚNG handler đang chạy; `_core/index.ts` vẫn là nơi DUY NHẤT gắn tuyến).
 *
 * ĐO (BE3 §L4): lô ≥7.000 mẫu ⇒ `200 {ok:true, accepted:0}` (không lưu gì); một `ts` hỏng ⇒ 500.
 * Hợp đồng MỚI — phản hồi phản ánh ĐÚNG số đã lưu, không bao giờ `200 ok:true` khi thiếu:
 *   200 — accepted === received (thân y như cũ: {ok, accepted, received, machine});
 *   207 — lưu được một phần: kèm `rejected[{index, reason}]`;
 *   400 — không mẫu nào được nhận và KHÔNG do DB (vd cả lô `ts` hỏng) ⇒ gửi lại vô ích;
 *   503 — không mẫu nào được lưu và có mẫu hỏng vì DB (`db_error`) ⇒ gửi lại được
 *         (ghi lặp bị ON CONFLICT DO NOTHING chặn trên (deviceId, metric, ts));
 *   413 — lô vượt OT_INGEST_MAX_BATCH (mặc định 20000), kiểm TRƯỚC xác thực (rẻ, không đụng DB).
 * Lý do loại (`reason`): invalid_ts · ts_too_far_future · contract_invalid · invalid_value · db_error.
 *
 * Xác thực: khoá theo máy, scope "ingest:write" — GIỮ NGUYÊN, không nới.
 * Module này chỉ import KIỂU từ telemetryBus/machineAuthService — không kéo tác dụng phụ nào lúc nạp.
 */
import type { Request, Response } from "express";
import type {
  CanonicalSample,
  TelemetryIngestResult,
  TelemetryProtocol,
  TelemetryQuality,
} from "../services/telemetryBus";

/** Trần số mẫu mỗi request (mặc định 20000). Đọc lúc gọi. */
export function otIngestMaxBatch(): number {
  const n = parseInt(String(process.env.OT_INGEST_MAX_BATCH ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? n : 20000;
}

const OT_PROTOCOLS = new Set<string>([
  "mqtt", "opcua", "modbus", "s7", "ethernet_ip", "mtconnect", "sparkplug", "inspection", "other",
]);
const OT_QUALITY = new Set<string>(["good", "bad", "uncertain"]);
const normProtocol = (p: unknown): TelemetryProtocol =>
  typeof p === "string" && OT_PROTOCOLS.has(p) ? (p as TelemetryProtocol) : "other";
const normQuality = (q: unknown): TelemetryQuality =>
  typeof q === "string" && OT_QUALITY.has(q) ? (q as TelemetryQuality) : "good";

/**
 * Map one raw JSON sample → CanonicalSample (y như route cũ). deviceId is preserved so the bus
 * resolves the soft machineId itself (one gateway credential forwards many devices). Một `ts`
 * không đọc được thành `Invalid Date` — bus loại RIÊNG mẫu đó (invalid_ts), không ném cả lô.
 */
export function toOtCanonicalSample(s: any): CanonicalSample {
  return {
    ts: s?.ts ? new Date(s.ts) : undefined,
    machineId: typeof s?.machineId === "number" ? s.machineId : null,
    deviceId: typeof s?.deviceId === "string" ? s.deviceId : null,
    protocol: normProtocol(s?.protocol),
    metric: String(s?.metric ?? ""),
    value:
      typeof s?.value === "number" || typeof s?.value === "string" || typeof s?.value === "boolean"
        ? s.value
        : null,
    unit: typeof s?.unit === "string" ? s.unit : null,
    quality: normQuality(s?.quality),
    meta: s?.meta && typeof s.meta === "object" ? s.meta : null,
  };
}

/**
 * ★ DÙNG LẠI (Task 8): mã HTTP trung thực cho một kết quả ingest.
 * 200 chỉ khi lưu ĐỦ; 207 khi lưu một phần; 0 mẫu ⇒ 503 nếu có lỗi DB, ngược lại 400.
 */
export function otIngestHttpStatus(r: TelemetryIngestResult): 200 | 207 | 400 | 503 {
  if (r.received > 0 && r.accepted === r.received) return 200;
  if (r.accepted > 0) return 207;
  return r.rejected.some((x) => x.reason === "db_error") ? 503 : 400;
}

export interface OtIngestDeps {
  authenticateMachine: (opts: {
    headerKey: string | null;
    apiKey: string | null;
    machineCode: string | null;
    scope: "ingest:write";
  }) => Promise<{ machine: { code: string } }>;
  ingestTelemetryDetailed: (samples: CanonicalSample[]) => Promise<TelemetryIngestResult>;
}

/** Express handler cho POST /api/ot/ingest. */
export function createOtIngestHandler(deps: OtIngestDeps) {
  return async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as any;
      const rawSamples = Array.isArray(body) ? body : body.samples;
      if (!Array.isArray(rawSamples) || rawSamples.length === 0) {
        return res
          .status(400)
          .json({ ok: false, error: "Body must be { samples: [ ... ] } with at least one sample" });
      }
      const maxBatch = otIngestMaxBatch();
      if (rawSamples.length > maxBatch) {
        return res.status(413).json({
          ok: false,
          code: "batch_too_large",
          error: `Batch of ${rawSamples.length} samples exceeds OT_INGEST_MAX_BATCH=${maxBatch} — split it`,
          received: rawSamples.length,
          maxBatch,
        });
      }

      // Auth (per-machine key) — preserved, NOT weakened. Throws TRPCError on failure.
      const auth = await deps.authenticateMachine({
        headerKey: req.header("x-api-key") || null,
        apiKey: typeof body.apiKey === "string" ? body.apiKey : null,
        machineCode:
          typeof body.machineCode === "string" ? body.machineCode : req.header("x-machine-code") || null,
        scope: "ingest:write",
      });

      const samples = rawSamples.map(toOtCanonicalSample);
      const result = await deps.ingestTelemetryDetailed(samples);
      const status = otIngestHttpStatus(result);
      const machine = auth.machine.code;
      if (status === 200) {
        return res.json({ ok: true, accepted: result.accepted, received: result.received, machine });
      }
      const common = {
        ok: false,
        accepted: result.accepted,
        received: result.received,
        rejectedCount: result.rejected.length,
        rejected: result.rejected,
        machine,
      };
      if (status === 207) {
        return res.status(207).json({
          ...common,
          code: "partial",
          error: `Stored ${result.accepted}/${result.received} samples — see rejected[] (db_error ⇒ retry those; others will never be stored)`,
        });
      }
      if (status === 503) {
        return res.status(503).json({ ...common, code: "db_unavailable", error: "Database unavailable — retry" });
      }
      return res.status(400).json({ ...common, code: "all_rejected", error: "Every sample was rejected — nothing stored" });
    } catch (error: any) {
      // Auth failures (TRPCError) → 401/403; DB down → 503; everything else → 500.
      const code = error?.code;
      if (code === "UNAUTHORIZED")
        return res.status(401).json({ ok: false, error: error?.message || "Unauthorized" });
      if (code === "FORBIDDEN")
        return res.status(403).json({ ok: false, error: error?.message || "Forbidden" });
      if (error?.name === "DbUnavailableError")
        return res.status(503).json({ ok: false, error: "Database unavailable — retry" });
      console.error("[OT ingest] error:", error?.message || error);
      res.status(500).json({ ok: false, error: error?.message || "Ingest failed" });
    }
  };
}
