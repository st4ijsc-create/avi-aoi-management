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
 * - writeTags (F4b/G2.1): GHI THẬT — per-tag tuần tự. parseEipTag→newTag→inverse
 *   scale/offset+coerce→set tag.value→await PLC.writeTag(tag) (withTimeout). Lỗi 1
 *   tag → ok:false cô lập (không kéo sập batch). EIP không cần isReadOnly — gate
 *   ghi nằm ở deviceTags.writable (commandDispatcher). ⚠️ chỉ commandDispatcher gọi.
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
import { inverseScale } from "./otScale";

/** Ép raw (đã inverse scale) sang kiểu st-ethernet-ip chấp nhận theo dataType. */
function coerceEipWrite(raw: unknown, dataType: string): number | boolean | string {
  switch (dataType) {
    case "bool":
      return Boolean(raw);
    case "int":
      return Math.round(Number(raw));
    case "float":
      return Number(raw);
    case "string":
    case "json":
    default:
      return String(raw);
  }
}

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
      // doc 40 OT-F1 — st-ethernet-ip Controller là EventEmitter; lắng 'close'/'error'/
      // 'Disconnected' để phát hiện mất kết nối giữa phiên (rớt cáp / PLC reboot). Trước
      // đây `connected` chỉ lật ở disconnect() → supervisor không thấy rớt. Lật
      // connected=false → isConnected()/health() nói thật, supervisor reconnect/failover.
      this.attachLinkLossHandlers(plc);
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

  /**
   * doc 40 OT-F1 — gắn listener mất-kết-nối vào Controller (EventEmitter). Chỉ lật
   * connected=false (reconnect do connectionSupervisor lo). Guard `this.plc===plc` chống
   * listener của kết nối cũ lật nhầm kết nối mới. Bọc try/catch cho package tối giản/mock.
   */
  private attachLinkLossHandlers(plc: any): void {
    if (!plc || typeof plc.on !== "function") return;
    for (const ev of ["close", "error", "Disconnected"]) {
      try {
        plc.on(ev, (arg?: unknown) => {
          if (this.plc === plc) this.markLinkLost(ev, arg);
        });
      } catch {
        // ignore
      }
    }
  }

  /** Lật cờ mất kết nối (idempotent — chỉ tác động khi đang connected). */
  private markLinkLost(ev: string, arg?: unknown): void {
    if (!this.connected) return;
    this.connected = false;
    const detail = arg ? `: ${(arg as Error)?.message ?? String(arg)}` : "";
    this.lastError = `ethernet-ip link lost (${ev})${detail}`;
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

  /** Ghi một write; trả OtCommandResult (không throw). */
  private async writeOne(w: OtWrite): Promise<OtCommandResult> {
    try {
      const { name, program } = parseEipTag(w.address);
      const dataType = w.dataType ?? "float";
      const raw = inverseScale(w.value, dataType, w.scale ?? 1, w.offset ?? 0);
      const value = coerceEipWrite(raw, dataType);

      const eipTag = this.plc.newTag(name, program ?? null);
      // st-ethernet-ip: set tag.value rồi await PLC.writeTag(tag).
      eipTag.value = value;
      await withTimeout(this.plc.writeTag(eipTag, value), 5000, "eip writeTag");

      this.lastOkAt = new Date();
      return { tagKey: w.tagKey, ok: true };
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      this.lastError = msg;
      return { tagKey: w.tagKey, ok: false, error: msg };
    }
  }

  /**
   * ⚠️ ONLY commandDispatcher may call this — write reaches physical device.
   *
   * Ghi giá trị xuống PLC EtherNet/IP. Reachable CHỈ qua HITL execute() →
   * dispatch(). Ghi TUẦN TỰ per-tag: parseEipTag→newTag→inverse scale/offset+
   * coerce→await writeTag. Lỗi 1 tag được cô lập (ok:false), không kéo sập batch.
   */
  override async writeTags(writes: OtWrite[]): Promise<OtCommandResult[]> {
    if (!this.connected || !this.plc) {
      throw new Error("EthernetIpDriver: not connected");
    }
    if (writes.length === 0) return [];

    const out: OtCommandResult[] = [];
    for (const w of writes) {
      out.push(await this.writeOne(w));
    }
    return out;
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
