/**
 * Sprint F1.3 — Siemens S7 driver THẬT (package `nodes7`, nạp qua loadPackage()).
 *
 * NodeS7 API là callback-based + "translation" tag→address:
 *   - new NodeS7(); initiateConnection({port,host,rack,slot,timeout}, cb(err))
 *   - setTranslationCB(tag => address); addItems([...]); readAllItems(cb(anythingBad, values))
 *   - dropConnection(cb)
 * Ta promisify các callback đó. Mỗi readTags: setTranslationCB ánh xạ tagKey→địa chỉ
 * S7 (đã validate bằng parseS7Address), addItems(tagKeys), readAllItems → values{tagKey}.
 *
 * - connect: initiateConnection race timeout; thiếu lib → throw "nodes7 not installed".
 * - readTags: đọc theo địa chỉ, coerceS7Value, áp scale/offset Ở DRIVER, OtSample.
 *   NodeS7 trả giá trị BAD (null) cho item lỗi → quality:"bad" (không sập batch).
 * - subscribe: POLL setInterval gọi readTags; timer.unref(); close()=clearInterval.
 * - writeTags: VẪN CHẶN (ok:false "write via HITL only (F4)").
 * - disconnect: dropConnection.
 *
 * Giữ extends NotImplementedDriver, override method, tái dùng loadPackage()/packageName.
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
import { NotImplementedDriver } from "./notImplementedDriver";
import { parseS7Address, coerceS7Value } from "./s7Address";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

/** Parse host/port từ endpoint. "tcp://host:port" | "host:port" | "host". */
function parseEndpoint(endpoint: string, defaultPort: number): { host: string; port: number } {
  let s = String(endpoint ?? "").trim();
  s = s.replace(/^tcp:\/\//i, "");
  const idx = s.lastIndexOf(":");
  if (idx > 0) {
    const host = s.slice(0, idx);
    const port = Number(s.slice(idx + 1));
    if (host && Number.isFinite(port)) return { host, port };
  }
  return { host: s || "127.0.0.1", port: defaultPort };
}

export class S7Driver extends NotImplementedDriver {
  readonly protocol: OtProtocol = "s7";
  protected readonly packageName = "nodes7";

  private conn: any = null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;
  private lastLatencyMs: number | undefined;

  override async connect(cfg: OtConnectionConfig): Promise<void> {
    const mod: any = await this.loadPackage();
    if (!mod) {
      throw new Error("nodes7 not installed");
    }
    const NodeS7 = mod.default ?? mod;
    const conn = new NodeS7();

    const opts = cfg.options ?? {};
    const defaultPort = typeof opts.port === "number" ? opts.port : 102;
    const { host, port } = parseEndpoint(cfg.endpoint, defaultPort);
    const timeoutMs = cfg.timeoutMs ?? 5000;
    const rack = typeof opts.rack === "number" ? opts.rack : 0;
    // slot 2 cho S7-300/400, slot 1 cho S7-1200/1500 (mặc định 1).
    const slot = typeof opts.slot === "number" ? opts.slot : 1;

    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          conn.initiateConnection(
            { port, host, rack, slot, timeout: timeoutMs, silent: true },
            (err: unknown) => {
              if (err) reject(err instanceof Error ? err : new Error(String(err)));
              else resolve();
            },
          );
        }),
        timeoutMs,
        "s7 initiateConnection",
      );

      this.conn = conn;
      this.connected = true;
      this.connectedAt = new Date();
      this.lastError = undefined;
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      try {
        if (typeof conn.dropConnection === "function") {
          await new Promise<void>((resolve) => conn.dropConnection(() => resolve()));
        }
      } catch {
        // ignore
      }
      throw err;
    }
  }

  override async disconnect(): Promise<void> {
    if (this.conn && typeof this.conn.dropConnection === "function") {
      try {
        await new Promise<void>((resolve) => this.conn.dropConnection(() => resolve()));
      } catch {
        // ignore
      }
    }
    this.conn = null;
    this.connected = false;
  }

  override isConnected(): boolean {
    return this.connected;
  }

  override async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    if (!this.connected || !this.conn) {
      throw new Error("S7Driver: not connected");
    }
    if (tags.length === 0) return [];

    // Ánh xạ tagKey → địa chỉ S7 đã validate (translation callback của NodeS7).
    const addrByKey = new Map<string, string>();
    for (const t of tags) {
      addrByKey.set(t.tagKey, parseS7Address(t.address).s7);
    }
    this.conn.setTranslationCB((tag: string) => addrByKey.get(tag));

    const keys = tags.map((t) => t.tagKey);
    this.conn.removeItems(); // xoá item phiên trước
    this.conn.addItems(keys);

    const t0 = Date.now();
    const values: Record<string, unknown> = await new Promise((resolve, reject) => {
      this.conn.readAllItems((anythingBad: boolean, vals: Record<string, unknown>) => {
        // anythingBad=true vẫn trả vals (item lỗi mang giá trị BAD) — không reject.
        if (vals && typeof vals === "object") resolve(vals);
        else reject(new Error("S7Driver: readAllItems returned no values"));
      });
    });
    this.lastLatencyMs = Date.now() - t0;
    this.lastOkAt = new Date();

    return tags.map((tag) => {
      const raw = values[tag.tagKey];
      const co = coerceS7Value(raw, tag.dataType);

      let value = co.value;
      if (co.quality === "good" && typeof value === "number" && tag.dataType !== "bool") {
        const scale = tag.scale ?? 1;
        const offset = tag.offset ?? 0;
        const n = value * scale + offset;
        value = tag.dataType === "int" ? Math.round(n) : n;
      }

      return {
        tagKey: tag.tagKey,
        raw,
        value: co.quality === "good" ? value : null,
        quality: co.quality,
        timestamp: new Date(),
      } satisfies OtSample;
    });
  }

  override async subscribe(
    tags: OtTagAddress[],
    onSample: OnOtSample,
    intervalMs = 5000,
  ): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new Error("S7Driver: not connected");

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

  override async writeTags(
    writes: Array<{ tagKey: string; address: string; value: unknown }>,
  ): Promise<OtCommandResult[]> {
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

export function createS7Driver(): OtDriver {
  return new S7Driver();
}
