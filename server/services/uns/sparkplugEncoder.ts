/**
 * Sprint F3a — Sparkplug-B CORE: encoder wrapper quanh `sparkplug-payload`.
 *
 * Bọc thư viện `sparkplug-payload` (pure JS, protobuf) để encode/decode payload
 * spBv1.0. THUẦN — không broker/DB, test offline được (round-trip encode/decode).
 *
 * ESM interop: thư viện export default là object có `.get(namespace)`. Đã xác nhận
 * `import sparkplugbpayload from "sparkplug-payload"` chạy với Node ESM + Vitest.
 *
 * F4 HITL: chỉ phục vụ ENCODE telemetry (DDATA/birth/death) + DECODE cho test/log.
 * KHÔNG dùng để execute NCMD/DCMD (lệnh điều khiển máy) — để F4 HITL.
 */
import sparkplugbpayload from "sparkplug-payload";
import type { OtDataType } from "../ot/otDriver";

export interface SparkplugMetric {
  name?: string;
  alias?: number;
  type: string;
  value: unknown;
  timestamp?: number;
}

export interface SparkplugPayload {
  timestamp?: number;
  seq?: number;
  metrics: SparkplugMetric[];
  uuid?: string;
  body?: Uint8Array;
}

/** Lấy codec spBv1.0 (lazy, cache). Tách ra để guard interop một chỗ. */
function getCodec(): {
  encodePayload: (p: unknown) => Buffer | Uint8Array;
  decodePayload: (b: Uint8Array) => unknown;
} {
  const codec = sparkplugbpayload.get("spBv1.0");
  if (!codec) throw new Error("[Sparkplug] codec spBv1.0 không khả dụng");
  return codec as ReturnType<typeof getCodec>;
}

/** Chuẩn hoá Long ({low,high,unsigned}) hoặc number → number JS. */
function longToNumber(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "low" in v) {
    // protobufjs Long
    const lng = v as { low: number; high: number; unsigned?: boolean };
    return lng.high * 0x100000000 + (lng.low >>> 0);
  }
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

/** Encode một SparkplugPayload → Buffer protobuf. */
export function encodePayload(p: SparkplugPayload): Buffer {
  const out = getCodec().encodePayload(p);
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

/**
 * Decode Buffer protobuf → SparkplugPayload (timestamp/seq/metric.timestamp
 * được chuẩn hoá về number JS thay vì Long).
 */
export function decodePayload(buf: Buffer | Uint8Array): SparkplugPayload {
  const raw = getCodec().decodePayload(buf) as {
    timestamp?: unknown;
    seq?: unknown;
    uuid?: string;
    body?: Uint8Array;
    metrics?: Array<{ name?: string; alias?: unknown; type: string; value: unknown; timestamp?: unknown }>;
  };
  const metrics: SparkplugMetric[] = (raw.metrics ?? []).map((m) => ({
    name: m.name,
    alias: longToNumber(m.alias),
    type: m.type,
    value: m.value,
    timestamp: longToNumber(m.timestamp),
  }));
  return {
    timestamp: longToNumber(raw.timestamp),
    seq: longToNumber(raw.seq),
    uuid: raw.uuid,
    body: raw.body,
    metrics,
  };
}

/** Map kiểu dữ liệu OT → tên type Sparkplug-B. */
export function otTypeToSparkplug(dt: OtDataType): string {
  switch (dt) {
    case "bool":
      return "Boolean";
    case "int":
      return "Int64";
    case "float":
      return "Double";
    case "string":
      return "String";
    case "json":
      return "String";
    default:
      return "String";
  }
}
