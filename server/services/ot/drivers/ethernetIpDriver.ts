/**
 * Sprint F1.3 — EtherNet/IP (Allen-Bradley CIP) driver THẬT
 * (package `st-ethernet-ip`, nạp qua loadPackage()).
 *
 * st-ethernet-ip có API promise-based:
 *   - new Controller(); await PLC.connect(ipAddress, slot)
 *   - const tag = PLC.newTag(name, program); await PLC.readTag(tag) → tag.value
 *   - await PLC.disconnect()
 *
 * - connect: Controller.connect race timeout; thiếu lib → throw "st-ethernet-ip not installed".
 * - readTags: newTag theo parseEipTag (name+program), readTag từng tag, coerceEipValue,
 *   áp scale/offset Ở DRIVER. Lỗi 1 tag → quality:"bad" (không sập batch).
 * - subscribe: POLL setInterval; unref; close()=clearInterval.
 * - writeTags: VẪN CHẶN (ok:false "write via HITL only (F4)").
 * - disconnect: PLC.disconnect().
 *
 * packageName = "st-ethernet-ip" (lib pure-JS, feature-complete cho ControlLogix/CompactLogix;
 * thay placeholder "ethernet-ip" của F1.1).
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
import { NotImplementedDriver } from "./notImplementedDriver";
import { parseEipTag, coerceEipValue } from "./eipTag";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

/** Tách host (bỏ tcp:// và :port nếu có) — EtherNet/IP nối IP cố định cổng 44818. */
function parseHost(endpoint: string): string {
  let s = String(endpoint ?? "").trim();
  s = s.replace(/^tcp:\/\//i, "");
  const idx = s.lastIndexOf(":");
  if (idx > 0) {
    const host = s.slice(0, idx);
    if (host) return host;
  }
  return s || "127.0.0.1";
}

export class EthernetIpDriver extends NotImplementedDriver {
  readonly protocol: OtProtocol = "ethernet-ip";
  protected readonly packageName = "st-ethernet-ip";

  private plc: any = null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;
  private lastLatencyMs: number | undefined;

  override async connect(cfg: OtConnectionConfig): Promise<void> {
    const mod: any = await this.loadPackage();
    if (!mod) {
      throw new Error("st-ethernet-ip not installed");
    }
    const Controller = mod.Controller ?? mod.default?.Controller ?? mod.default;
    if (typeof Controller !== "function") {
      throw new Error("st-ethernet-ip not installed");
    }
    const plc = new Controller();

    const opts = cfg.options ?? {};
    const host = parseHost(cfg.endpoint);
    const slot = typeof opts.slot === "number" ? opts.slot : 0;
    const timeoutMs = cfg.timeoutMs ?? 5000;

    try {
      await withTimeout(plc.connect(host, slot), timeoutMs, "eip connect");

      this.plc = plc;
      this.connected = true;
      this.connectedAt = new Date();
      this.lastError = undefined;
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      try {
        if (typeof plc.disconnect === "function") await plc.disconnect();
      } catch {
        // ignore
      }
      throw err;
    }
  }

  override async disconnect(): Promise<void> {
    if (this.plc && typeof this.plc.disconnect === "function") {
      try {
        await this.plc.disconnect();
      } catch {
        // ignore
      }
    }
    this.plc = null;
    this.connected = false;
  }

  override isConnected(): boolean {
    return this.connected;
  }

  /** Đọc một tag, trả OtSample. Lỗi → quality:"bad" (không throw). */
  private async readOne(tag: OtTagAddress): Promise<OtSample> {
    const now = () => new Date();
    try {
      const { name, program } = parseEipTag(tag.address);
      const eipTag = this.plc.newTag(name, program ?? null);
      await this.plc.readTag(eipTag);
      const raw = eipTag?.value;

      const co = coerceEipValue(raw, tag.dataType);
      let value = co.value;
      if (co.quality === "good" && typeof value === "number" && tag.dataType !== "bool") {
        const scale = tag.scale ?? 1;
        const offset = tag.offset ?? 0;
        const n = value * scale + offset;
        value = tag.dataType === "int" ? Math.round(n) : n;
      }

      if (co.quality === "good") this.lastOkAt = now();
      return {
        tagKey: tag.tagKey,
        raw,
        value: co.quality === "good" ? value : null,
        quality: co.quality,
        timestamp: now(),
      } satisfies OtSample;
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      return {
        tagKey: tag.tagKey,
        raw: null,
        value: null,
        quality: "bad",
        timestamp: now(),
      } satisfies OtSample;
    }
  }

  override async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    if (!this.connected || !this.plc) {
      throw new Error("EthernetIpDriver: not connected");
    }
    if (tags.length === 0) return [];

    const t0 = Date.now();
    const out: OtSample[] = [];
    for (const tag of tags) {
      out.push(await this.readOne(tag));
    }
    this.lastLatencyMs = Date.now() - t0;
    return out;
  }

  override async subscribe(
    tags: OtTagAddress[],
    onSample: OnOtSample,
    intervalMs = 5000,
  ): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new Error("EthernetIpDriver: not connected");

    const tick = async () => {
      try {
        const samples = await this.readTags(tags);
        for (const s of samples) {
          try {
            await onSample(s);
          } catch {
            // bỏ qua lỗi callback từng mẫu
          }
        }
      } catch (e) {
        this.lastError = (e as Error)?.message || String(e);
      }
    };

    const timer = setInterval(() => void tick(), intervalMs > 0 ? intervalMs : 5000);
    if (typeof (timer as NodeJS.Timeout).unref === "function") {
      (timer as NodeJS.Timeout).unref();
    }

    return {
      close: async () => {
        clearInterval(timer);
      },
    };
  }

  // F4b: ethernet-ip GIỮ ok:false — capability ghi bật dần ở sprint sau.
  override async writeTags(writes: OtWrite[]): Promise<OtCommandResult[]> {
    return writes.map((w) => ({
      tagKey: w.tagKey,
      ok: false,
      error: "write via HITL only (F4)",
    }));
  }

  override async health(): Promise<OtHealth> {
    return {
      protocol: this.protocol,
      connected: this.connected,
      lastOkAt: this.lastOkAt ?? this.connectedAt ?? undefined,
      lastError: this.lastError,
      latencyMs: this.lastLatencyMs,
    };
  }
}

export function createEthernetIpDriver(): OtDriver {
  return new EthernetIpDriver();
}
