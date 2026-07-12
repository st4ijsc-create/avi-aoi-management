/**
 * Sprint F1.3 — Mitsubishi MELSEC MC driver THẬT (package `mcprotocol`, nạp qua loadPackage()).
 *
 * ⚠️ doc 37 §6.2 / M7 — GIỚI HẠN THƯ VIỆN (spec-verified vs manual):
 *   `mcprotocol` mã hoá **1E frame nhị phân (A-compatible)**. Xác nhận theo MELSEC
 *   Communication Protocol Reference Manual (SH-081227ENG), Ch.18 "Communicating
 *   Using 1E Frames" p391-396:
 *     • Subheader = mã lệnh nhị phân: 00H batch-read bit / 01H batch-read word /
 *       02H batch-write bit / 03H batch-write word; response = request|80H, tức
 *       80H/81H/82H/83H (p392 "Subheader").
 *     • PC No. (station): FFH = trạm host (kết nối trực tiếp); 01H–40H (1–64) =
 *       trạm khác qua network module (p393). 1E frame KHÔNG có trường Network No.
 *       (SH-081227: "1C/1E frame do not have the setting of network No.").
 *     • Bộ device 1E chỉ là TẬP CON A-compatible: X Y M L S F B, T(TN/TS/TC),
 *       C(CN/CS/CC), D W R; SM/SD truy cập qua M9000/D9000 — KHÔNG có
 *       ZR SB SW V DX DY Z RD STS/long-timer/long-counter (p351-352). Địa chỉ
 *       ngoài tập này KHÔNG map được qua 1E frame.
 *   → iQ-R/iQ-F MẶC ĐỊNH SLMP 3E frame: subheader request '5000' (50 00) / response
 *   'D000' (D0 00); 4E frame request '5400' / response 'D400' + serial-No 2 byte
 *   (SH-081227 "Message Format" p42/p48, Access route p45; SLMP Reference Manual
 *   SH-080956ENG §"3E/4E frame message format"). Muốn dùng lib này với iQ-R: hoặc
 *   (a) bật "A-compatible 1E frame" trong Open Setting của GX Works3, hoặc (b) thay
 *   bằng encoder SLMP 3E/4E (xem TODO dưới). Port KHÔNG có mặc định chuẩn — set ở
 *   Open Setting của module (SH-080956 §3.1/3.2 TCP/UDP), kỹ sư phải nhập đúng.
 *
 * TODO — SLMP 3E encoder (KHÔNG thêm npm dep; tự viết trên node:net đã có):
 *   Request batch-read-word (command 0401H, subcommand 0000H) nhị phân, LE:
 *     [50 00]            subheader 3E
 *     [00]               network No.  (mặc định 00 = host)
 *     [FF]               PC No.       (mặc định FF = host)
 *     [FF 03]            request dest module I/O No. (0x03FF = host CPU)
 *     [00]               request dest multidrop station No.
 *     [len 2B]           request-data length (byte sau trường này)
 *     [timer 2B]         monitoring timer (0 = wait)
 *     [01 04]            command 0401H
 *     [00 00]            subcommand 0000H (Q/L 1-byte device-code)
 *     [devNo 3B]         head device No. (LE, 3 byte)
 *     [devCode 1B]       device-code 1 byte: D=A8 W=B4 M=90 X=9C Y=9D R=AF
 *                        B=A0 SD=A9 SM=91 … (bảng đầy đủ ở mcAddress.ts)
 *     [points 2B]        số điểm (LE)
 *   Response OK: [D0 00][00 FF FF 03 00][resLen 2B][endCode 2B=00 00][data…].
 *   iQ-R subcommand 0002/0003 → device-code 2 byte (00A8H…) + devNo 4 byte.
 *   Ref: SLMP Reference Manual SH-080956 §5.1-5.2 p17-37.
 *   Khi có encoder, bổ sung config: networkNo (byte "Network No", mặc định 00H),
 *   stationNo (byte "PC No", mặc định FFH), octalInputOutput (X/Y hệ bát phân cho
 *   dòng FX; Q/iQ-R dùng hệ 16 — SH-081227 p68). `mcprotocol.initiateConnection`
 *   CHỈ nhận {port,host,ascii} nên 3 field này CHƯA nối được nếu chưa thay lib.
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
      // doc 40 OT-F1 — mcprotocol là fork của NodeS7 (callback-based, cùng API), KHÔNG
      // có event channel ổn định. Gắn 'error'/'close' phòng hờ; đường phát hiện CHÍNH là
      // isConnected()/health() đọc `isoConnectionState` thật + fallback đếm-lỗi ở supervisor.
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
   * doc 40 OT-F1 — isConnected() nói THẬT khi rớt kết nối giữa phiên. mcprotocol (fork
   * NodeS7) giữ `isoConnectionState` (4 = connected); lib tự hạ khi transport đứt. Ưu tiên
   * trạng thái lib (guarded) rồi mới tới cờ nội bộ để supervisor phát hiện & reconnect.
   * Mock không có field → lui về cờ `connected` (không đổi hành vi test).
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
    this.lastError = `mitsubishi-mc link lost (${ev})${detail}`;
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
      // doc 40 OT-F1 — báo trạng thái THẬT (đọc isoConnectionState), không phải cờ nội bộ.
      connected: this.isConnected(),
      lastOkAt: this.lastOkAt ?? this.connectedAt ?? undefined,
      lastError: this.lastError,
      latencyMs: this.lastLatencyMs,
    };
  }
}

export function createMitsubishiMcDriver(): OtDriver {
  return new MitsubishiMcDriver();
}
