/**
 * Sprint F1.3 — Mitsubishi MELSEC MC driver THẬT (package `mcprotocol`, nạp qua loadPackage()).
 *
 * mcprotocol có API callback + translation giống NodeS7:
 *   - new MC(); initiateConnection({port,host,ascii}, cb(err))
 *   - setTranslationCB(tag => address); addItems([...]); readAllItems(cb(anythingBad, values))
 *   - dropConnection(cb)
 * Ta promisify. readTags: setTranslationCB ánh xạ tagKey→địa chỉ MELSEC (đã validate
 * bằng parseMcAddress), addItems(tagKeys), readAllItems → values{tagKey}.
 *
 * - connect: initiateConnection race timeout; thiếu lib → throw "mcprotocol not installed".
 * - readTags: coerceMcValue + áp scale/offset Ở DRIVER; item lỗi → quality:"bad".
 * - subscribe: POLL setInterval; unref; close()=clearInterval.
 * - writeTags: VẪN CHẶN (ok:false "write via HITL only (F4)").
 * - disconnect: dropConnection.
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
import { parseMcAddress, coerceMcValue } from "./mcAddress";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

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

export class MitsubishiMcDriver extends NotImplementedDriver {
  readonly protocol: OtProtocol = "mitsubishi-mc";
  protected readonly packageName = "mcprotocol";

  private conn: any = null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;
  private lastLatencyMs: number | undefined;

  override async connect(cfg: OtConnectionConfig): Promise<void> {
    const mod: any = await this.loadPackage();
    if (!mod) {
      throw new Error("mcprotocol not installed");
    }
    const MC = mod.default ?? mod;
    const conn = new MC();

    const opts = cfg.options ?? {};
    const defaultPort = typeof opts.port === "number" ? opts.port : 1281;
    const { host, port } = parseEndpoint(cfg.endpoint, defaultPort);
    const timeoutMs = cfg.timeoutMs ?? 5000;
    const ascii = opts.ascii === true; // mặc định binary (false)

    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          conn.initiateConnection({ port, host, ascii }, (err: unknown) => {
            if (err) reject(err instanceof Error ? err : new Error(String(err)));
            else resolve();
          });
        }),
        timeoutMs,
        "mc initiateConnection",
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
      throw new Error("MitsubishiMcDriver: not connected");
    }
    if (tags.length === 0) return [];

    const addrByKey = new Map<string, string>();
    for (const t of tags) {
      addrByKey.set(t.tagKey, parseMcAddress(t.address).mc);
    }
    this.conn.setTranslationCB((tag: string) => addrByKey.get(tag));

    const keys = tags.map((t) => t.tagKey);
    this.conn.removeItems();
    this.conn.addItems(keys);

    const t0 = Date.now();
    const values: Record<string, unknown> = await new Promise((resolve, reject) => {
      this.conn.readAllItems((_anythingBad: boolean, vals: Record<string, unknown>) => {
        if (vals && typeof vals === "object") resolve(vals);
        else reject(new Error("MitsubishiMcDriver: readAllItems returned no values"));
      });
    });
    this.lastLatencyMs = Date.now() - t0;
    this.lastOkAt = new Date();

    return tags.map((tag) => {
      const raw = values[tag.tagKey];
      const co = coerceMcValue(raw, tag.dataType);

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
    if (!this.connected) throw new Error("MitsubishiMcDriver: not connected");

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

export function createMitsubishiMcDriver(): OtDriver {
  return new MitsubishiMcDriver();
}
