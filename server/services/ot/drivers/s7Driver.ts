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
 * - writeTags (F4b/G2.1): GHI THẬT qua NodeS7.writeItems(keys[],values[],cb(anyBad)).
 *   setTranslationCB như readTags; inverse scale/offset + coerce theo dataType;
 *   địa chỉ read-only (I/E/PI) → ok:false; writeItems trả 1 (busy) → ok:false
 *   "S7 write busy"; anyBadQualities → ok:false "bad write quality". ⚠️ chỉ
 *   commandDispatcher được gọi (xem comment writeTags).
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
  OtWrite,
  OtHealth,
  OnOtSample,
} from "../otDriver";
import { NotImplementedDriver } from "./notImplementedDriver";
import { parseS7Address, coerceS7Value } from "./s7Address";
import { inverseScale } from "./otScale";

/** Ép raw (đã inverse scale) sang kiểu NodeS7 chấp nhận theo dataType. */
function coerceS7Write(raw: unknown, dataType: string): number | boolean | string {
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
      // doc 40 OT-F1 — NodeS7 là callback-based, KHÔNG có event channel ổn định. Gắn
      // 'error'/'close' phòng hờ (bọc try/catch — no-op nếu không expose). Đường phát
      // hiện CHÍNH cho nodes7 là isConnected()/health() đọc `isoConnectionState` thật
      // của lib (xem isConnected) + fallback đếm-lỗi ở connectionSupervisor.
      this.attachLinkLossHandlers(conn);
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

  /**
   * doc 40 OT-F1 — isConnected() phải nói THẬT khi rớt cáp/PLC reboot giữa phiên.
   * NodeS7 giữ trạng thái ISO ở `isoConnectionState` (4 = connected); khi transport
   * đứt, lib tự hạ về != 4. Ta ưu tiên trạng thái lib (guarded) rồi mới tới cờ nội bộ —
   * nhờ vậy health()/isConnected() không còn báo "connected" giả sau khi mất kết nối,
   * để connectionSupervisor phát hiện và reconnect. Package mock (không có field) →
   * lui về cờ `connected` như cũ (không đổi hành vi test).
   */
  override isConnected(): boolean {
    if (!this.connected) return false;
    const st = (this.conn as { isoConnectionState?: unknown } | null)?.isoConnectionState;
    if (typeof st === "number") return st === 4;
    return this.connected;
  }

  /** doc 40 OT-F1 — gắn listener 'error'/'close' phòng hờ (no-op nếu lib không emit). */
  private attachLinkLossHandlers(conn: any): void {
    if (!conn || typeof conn.on !== "function") return;
    for (const ev of ["error", "close"]) {
      try {
        conn.on(ev, (arg?: unknown) => {
          if (this.conn === conn) this.markLinkLost(ev, arg);
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
    this.lastError = `s7 link lost (${ev})${detail}`;
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

  /**
   * ⚠️ ONLY commandDispatcher may call this — write reaches physical device.
   *
   * Ghi giá trị xuống PLC S7 qua NodeS7.writeItems. Reachable CHỈ qua HITL
   * execute() → dispatch(). Với mỗi write: parseS7Address (read-only I/E/PI →
   * ok:false isolate); inverse scale/offset (int/float) → coerce theo dataType;
   * setTranslationCB ánh xạ tagKey→địa chỉ; writeItems(keys[],values[],cb(anyBad)).
   * writeItems trả 1 (busy, đồng bộ) → ok:false "S7 write busy" (không chờ cb);
   * cb(anyBadQualities=true) → ok:false "bad write quality" cả batch;
   * anyBadQualities=false → ok:true cả batch. Lỗi parse từng write được cô lập.
   */
  override async writeTags(writes: OtWrite[]): Promise<OtCommandResult[]> {
    if (!this.connected || !this.conn) {
      throw new Error("S7Driver: not connected");
    }
    if (writes.length === 0) return [];

    // Chuẩn bị từng write; cô lập lỗi parse / read-only (không kéo sập batch).
    const prepared: Array<{ tagKey: string; addr?: string; value?: unknown; error?: string }> =
      writes.map((w) => {
        try {
          const parsed = parseS7Address(w.address);
          if (parsed.isReadOnly) {
            return { tagKey: w.tagKey, error: "register type not writable" };
          }
          const dataType = w.dataType ?? "float";
          const raw = inverseScale(w.value, dataType, w.scale ?? 1, w.offset ?? 0);
          return { tagKey: w.tagKey, addr: parsed.s7, value: coerceS7Write(raw, dataType) };
        } catch (err) {
          return { tagKey: w.tagKey, error: (err as Error)?.message || String(err) };
        }
      });

    const writable = prepared.filter((p) => p.error === undefined);
    if (writable.length === 0) {
      // Toàn bộ lỗi parse/read-only — không gọi writeItems.
      return prepared.map((p) => ({ tagKey: p.tagKey, ok: false, error: p.error }));
    }

    // Ánh xạ tagKey → địa chỉ S7 (translation callback của NodeS7).
    const addrByKey = new Map<string, string>();
    for (const p of writable) addrByKey.set(p.tagKey, p.addr!);
    this.conn.setTranslationCB((tag: string) => addrByKey.get(tag));

    const keys = writable.map((p) => p.tagKey);
    const values = writable.map((p) => p.value);

    let batchError: string | null = null;
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          // writeItems trả 1 (đồng bộ) nếu busy → coi là lỗi, KHÔNG chờ callback.
          const rc = this.conn.writeItems(keys, values, (anyBadQualities: boolean) => {
            if (anyBadQualities) reject(new Error("bad write quality"));
            else resolve();
          });
          if (rc === 1) reject(new Error("S7 write busy"));
        }),
        5000,
        "s7 writeItems",
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
      // doc 40 OT-F1 — báo trạng thái THẬT (đọc isoConnectionState của lib), không phải
      // cờ nội bộ có thể đã lỗi thời sau khi rớt kết nối giữa phiên.
      connected: this.isConnected(),
      lastOkAt: this.lastOkAt ?? this.connectedAt ?? undefined,
      lastError: this.lastError,
      latencyMs: this.lastLatencyMs,
    };
  }
}

export function createS7Driver(): OtDriver {
  return new S7Driver();
}
