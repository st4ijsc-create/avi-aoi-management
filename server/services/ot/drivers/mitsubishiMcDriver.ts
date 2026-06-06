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
 * - writeTags (F4b/G2.1): GHI THẬT qua mcprotocol.writeItems(keys[],values[],cb(anyBad))
 *   — pattern y hệt NodeS7. setTranslationCB; inverse scale/offset + coerce; device
 *   read-only (X/DX) → ok:false; writeItems trả 1 (busy) → ok:false "MC write busy";
 *   anyBadQualities → ok:false "bad write quality". ⚠️ chỉ commandDispatcher gọi.
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
  OtWrite,
  OtHealth,
  OnOtSample,
} from "../otDriver";
import { NotImplementedDriver } from "./notImplementedDriver";
import { parseMcAddress, coerceMcValue } from "./mcAddress";
import { inverseScale } from "./otScale";

/** Ép raw (đã inverse scale) sang kiểu mcprotocol chấp nhận theo dataType. */
function coerceMcWrite(raw: unknown, dataType: string): number | boolean | string {
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

  /**
   * ⚠️ ONLY commandDispatcher may call this — write reaches physical device.
   *
   * Ghi giá trị xuống PLC MELSEC qua mcprotocol.writeItems. Reachable CHỈ qua HITL
   * execute() → dispatch(). Pattern y hệt S7: parseMcAddress (read-only X/DX →
   * ok:false isolate); inverse scale/offset + coerce; setTranslationCB;
   * writeItems(keys[],values[],cb(anyBad)). writeItems trả 1 (busy) → ok:false
   * "MC write busy"; cb(anyBadQualities=true) → ok:false "bad write quality";
   * else ok:true cả batch. Lỗi parse từng write được cô lập.
   */
  override async writeTags(writes: OtWrite[]): Promise<OtCommandResult[]> {
    if (!this.connected || !this.conn) {
      throw new Error("MitsubishiMcDriver: not connected");
    }
    if (writes.length === 0) return [];

    const prepared: Array<{ tagKey: string; addr?: string; value?: unknown; error?: string }> =
      writes.map((w) => {
        try {
          const parsed = parseMcAddress(w.address);
          if (parsed.isReadOnly) {
            return { tagKey: w.tagKey, error: "register type not writable" };
          }
          const dataType = w.dataType ?? "float";
          const raw = inverseScale(w.value, dataType, w.scale ?? 1, w.offset ?? 0);
          return { tagKey: w.tagKey, addr: parsed.mc, value: coerceMcWrite(raw, dataType) };
        } catch (err) {
          return { tagKey: w.tagKey, error: (err as Error)?.message || String(err) };
        }
      });

    const writable = prepared.filter((p) => p.error === undefined);
    if (writable.length === 0) {
      return prepared.map((p) => ({ tagKey: p.tagKey, ok: false, error: p.error }));
    }

    const addrByKey = new Map<string, string>();
    for (const p of writable) addrByKey.set(p.tagKey, p.addr!);
    this.conn.setTranslationCB((tag: string) => addrByKey.get(tag));

    const keys = writable.map((p) => p.tagKey);
    const values = writable.map((p) => p.value);

    let batchError: string | null = null;
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          const rc = this.conn.writeItems(keys, values, (anyBadQualities: boolean) => {
            if (anyBadQualities) reject(new Error("bad write quality"));
            else resolve();
          });
          if (rc === 1) reject(new Error("MC write busy"));
        }),
        5000,
        "mc writeItems",
      );
    } catch (err) {
      batchError = (err as Error)?.message || String(err);
      this.lastError = batchError;
    }

    if (!batchError) this.lastOkAt = new Date();

    return prepared.map((p) => {
      if (p.error !== undefined) return { tagKey: p.tagKey, ok: false, error: p.error };
      if (batchError) return { tagKey: p.tagKey, ok: false, error: batchError };
      return { tagKey: p.tagKey, ok: true };
    });
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
