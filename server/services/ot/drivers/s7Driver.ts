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
 * - readProgramChecksum (doc 81 Đợt 9 task T1): checksum of the user program (OB/DB/FC/FB block infos) read through the
 *   documented S7comm block functions on a SEPARATE, bounded connection — see s7BlockChecksum.ts (sources, formula,
 *   status "not verified on a real device").
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
  ProgramChecksumResult,
  TuyChonVongPoll,
} from "../otDriver";
import { NotImplementedDriver } from "./notImplementedDriver";
import { parseS7Address, coerceS7Value } from "./s7Address";
import { inverseScale } from "./otScale";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";
import { withDeadline } from "./boundedClose";
import { taoVongPoll } from "../vongPoll";
import { chatLuongLoiChung, chatLuongV2Bat } from "../chatLuong";
import { readS7ProgramChecksum, clampS7Deadline, S7_CHECKSUM_SOURCE, type S7ChecksumTarget } from "./s7BlockChecksum";

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
  /** SCADA R0 (C5) — hạn giao dịch đã cấu hình ở connect(); readAllItems của nodes7 có thể không bao giờ gọi lại. */
  private timeoutMs = 5000;
  /** doc 81 Đợt 9 T1 — where the program checksum is read (same host / port / rack / slot as the nodes7 session). */
  private checksumTarget: S7ChecksumTarget | null = null;

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
    this.timeoutMs = timeoutMs;
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
      this.checksumTarget = { host, port, rack, slot };
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
    // doc 81 Đợt 5 task F2 (item 28) — capture-and-null-first: the fields are cleared BEFORE the first await and only
    // the CAPTURED handle is dropped. A drop that completes late (after a supervisor reset already reconnected this same
    // driver object) therefore never clears the NEW session (was: `await drop(); this.conn = null; connected = false`).
    const conn = this.conn;
    this.conn = null;
    this.connected = false;
    if (conn && typeof conn.dropConnection === "function") {
      try {
        await new Promise<void>((resolve) => conn.dropConnection(() => resolve()));
      } catch {
        // ignore
      }
    }
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
      throw new DeviceUnreachableError("s7");
    }
    if (tags.length === 0) return [];

    // Ánh xạ tagKey → địa chỉ S7 đã validate (translation callback của NodeS7).
    // SCADA R0 (C2) — sau cờ: địa chỉ sai của MỘT tag ⇒ chỉ tag đó bad/config_error, tag khác vẫn đọc.
    // Cờ tắt: địa chỉ sai ném cả lô như cũ.
    const v2 = chatLuongV2Bat();
    const addrByKey = new Map<string, string>();
    const loiDiaChi = new Map<string, OtSample>();
    for (const t of tags) {
      try {
        addrByKey.set(t.tagKey, parseS7Address(t.address).s7);
      } catch (e) {
        if (!v2) throw e;
        loiDiaChi.set(t.tagKey, {
          tagKey: t.tagKey,
          raw: null,
          value: null,
          quality: "bad",
          timestamp: new Date(),
          tsSource: "server",
          statusCode: "invalid_address",
          reason: "config_error",
        });
      }
    }
    this.conn.setTranslationCB((tag: string) => addrByKey.get(tag));

    let values: Record<string, unknown> = {};
    if (addrByKey.size > 0) {
      const keys = tags.filter((t) => addrByKey.has(t.tagKey)).map((t) => t.tagKey);
      this.conn.removeItems(); // xoá item phiên trước
      this.conn.addItems(keys);

      const t0 = Date.now();
      // SCADA R0 (C5) — readAllItems có thể không bao giờ gọi lại ⇒ đọc CÓ HẠN (không cờ, sửa lỗi treo).
      values = await withDeadline(
        new Promise<Record<string, unknown>>((resolve, reject) => {
          this.conn.readAllItems((anythingBad: boolean, vals: Record<string, unknown>) => {
            // anythingBad=true vẫn trả vals (item lỗi mang giá trị BAD) — không reject.
            if (vals && typeof vals === "object") resolve(vals);
            else reject(new Error("S7Driver: readAllItems returned no values"));
          });
        }),
        this.timeoutMs + 1000,
        "s7 readAllItems",
      );
      this.lastLatencyMs = Date.now() - t0;
      this.lastOkAt = new Date();
    }

    return tags.map((tag) => {
      const loi = loiDiaChi.get(tag.tagKey);
      if (loi) return loi;
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
        tsSource: "server", // doc 81 Đợt 4 Task B6 — stamped by the driver on receipt
      } satisfies OtSample;
    });
  }

  override async subscribe(
    tags: OtTagAddress[],
    onSample: OnOtSample,
    intervalMs = 5000,
    tuyChon?: TuyChonVongPoll,
  ): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new DeviceUnreachableError("s7");

    // SCADA R0 — vòng poll DÙNG CHUNG (chống chồng tick, hạn đọc, mẫu xấu một lần khi mất liên lạc sau cờ).
    return taoVongPoll({
      tags,
      intervalMs,
      deadlineMs: tuyChon?.deadlineMs,
      doc: async (t) => {
        try {
          return await this.readTags(t);
        } catch (e) {
          this.lastError = (e as Error)?.message || String(e);
          throw e;
        }
      },
      onSample,
      onTick: tuyChon?.onTick,
      phanLoiLoi: chatLuongLoiChung,
      chatLuongV2: chatLuongV2Bat(),
      nhan: "s7",
    });
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
      throw new DeviceUnreachableError("s7");
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

  /**
   * doc 81 Đợt 9 task T1 — the checksum of the program loaded in the controller (READ-ONLY), per the S7comm protocol
   * documentation (s7BlockChecksum.ts). Not verified on a real device yet — the source label says so on screen.
   *   • a SEPARATE ISO-on-TCP connection per read: it shares no queue with writeTags (L-7 — a STOP write never waits);
   *   • bounded by `opts.deadlineMs` (the adapter's deadline, R-9-b; default 1000 ms, hard cap 10 s — clampS7Deadline) and
   *     cancelled by `opts.signal` (socket destroyed, nothing pending);
   *   • not connected / any failure ⇒ THROWS (the caller fails closed); never answers `supported:false`.
   */
  async readProgramChecksum(opts?: { signal?: AbortSignal; deadlineMs?: number }): Promise<ProgramChecksumResult> {
    const target = this.checksumTarget;
    if (!this.isConnected() || !this.conn || !target) {
      throw new DeviceUnreachableError("s7");
    }
    const checksum = await readS7ProgramChecksum(target, { signal: opts?.signal, deadlineMs: clampS7Deadline(opts?.deadlineMs) });
    return { supported: true, checksum, source: S7_CHECKSUM_SOURCE };
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
