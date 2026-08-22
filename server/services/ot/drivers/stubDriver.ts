/**
 * Sprint F1.1 — Stub OT driver: mô phỏng dữ liệu thiết bị KHÔNG cần hạ tầng thật.
 *
 * Sinh giá trị xác định theo `tagKey` (sin + nhiễu nhẹ), áp scale/offset từ tag.
 * Dùng để E2E pipeline ingest → telemetry → (tuỳ chọn) UNS mà chưa cài driver thật.
 * writeTags là no-op trả ok:false ("write disabled in F1.1").
 */
import type {
  OtProtocol,
  OtDriver,
  OtConnectionConfig,
  OtTagAddress,
  OtSample,
  OtSubscriptionHandle,
  OtCommandResult,
  OtHealth,
  OnOtSample,
} from "../otDriver";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";

/** Hash ổn định từ chuỗi để mỗi tagKey có pha riêng. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export class StubDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";

  private connected = false;
  private connectedAt: Date | null = null;
  private lastError: string | undefined;

  async connect(_cfg: OtConnectionConfig): Promise<void> {
    this.connected = true;
    this.connectedAt = new Date();
    this.lastError = undefined;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Sinh một mẫu mô phỏng cho một tag, áp scale/offset. */
  private sampleFor(tag: OtTagAddress): OtSample {
    const now = Date.now();
    const phase = hashString(tag.tagKey) % 1000;
    const base = Math.sin((now / 1000 + phase) * 0.1);          // [-1, 1]
    const noise = (Math.random() - 0.5) * 0.05;
    const scale = tag.scale ?? 1;
    const offset = tag.offset ?? 0;

    let value: number | string | boolean | null;
    let raw: unknown;
    switch (tag.dataType) {
      case "bool":
        value = base > 0;
        raw = value;
        break;
      case "int": {
        const n = Math.round((base + noise) * 100) * scale + offset;
        value = Math.round(n);
        raw = value;
        break;
      }
      case "float": {
        const n = (base + noise) * scale + offset;
        value = Math.round(n * 1e6) / 1e6;
        raw = value;
        break;
      }
      case "string":
        value = `${tag.tagKey}:${base.toFixed(3)}`;
        raw = value;
        break;
      case "json": {
        const obj = { tagKey: tag.tagKey, base: Math.round(base * 1e6) / 1e6, ts: now };
        value = JSON.stringify(obj);
        raw = obj;
        break;
      }
      default:
        value = null;
        raw = null;
    }

    return {
      tagKey: tag.tagKey,
      raw,
      value,
      quality: "good",
      timestamp: new Date(now),
    };
  }

  async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    if (!this.connected) throw new DeviceUnreachableError("stub");
    return tags.map((t) => this.sampleFor(t));
  }

  async subscribe(tags: OtTagAddress[], onSample: OnOtSample, intervalMs = 5000): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new DeviceUnreachableError("stub");

    const tick = () => {
      for (const t of tags) {
        try {
          void onSample(this.sampleFor(t));
        } catch {
          // bỏ qua lỗi callback từng tag để không sập poll loop
        }
      }
    };

    const timer = setInterval(tick, intervalMs > 0 ? intervalMs : 5000);
    if (typeof (timer as NodeJS.Timeout).unref === "function") {
      (timer as NodeJS.Timeout).unref();
    }

    return {
      close: async () => {
        clearInterval(timer);
      },
    };
  }

  async writeTags(
    writes: Array<{ tagKey: string; address: string; value: unknown }>,
  ): Promise<OtCommandResult[]> {
    return writes.map((w) => ({
      tagKey: w.tagKey,
      ok: false,
      error: "write disabled in F1.1",
    }));
  }

  async health(): Promise<OtHealth> {
    return {
      protocol: this.protocol,
      connected: this.connected,
      lastOkAt: this.connectedAt ?? undefined,
      lastError: this.lastError,
    };
  }
}

/** Factory cho registry. */
export function createStubDriver(): OtDriver {
  return new StubDriver();
}
