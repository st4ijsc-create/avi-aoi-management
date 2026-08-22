/**
 * doc 40 Wave 5 — OT-F8 / CTL-04 / MTX: SLMP 3E/4E driver THẬT cho Mitsubishi
 * FX5U / iQ-R / iQ-F trên `node:net` (KHÔNG npm dep — dùng encoder slmpEncoder.ts).
 *
 * Bổ khuyết mitsubishiMcDriver.ts (chỉ nói 1E frame qua `mcprotocol`): iQ-R/FX5U mặc
 * định SLMP 3E frame — driver này nối được các CPU đó qua SLMP binary trực tiếp.
 *
 * connectionOptions:
 *   host, port           — hoặc lấy từ endpoint "tcp://host:port"
 *   frame                — "3E" (mặc định) | "4E"
 *   networkNo (00)       stationNo/pcNo (FF)   moduleIo (03FF)   multidropStation (00)
 *   octalInputOutput     — X/Y hệ bát phân (FX5U). Mặc định false (Q/iQ-R hệ 16).
 *
 * Hành vi (khớp 5 driver Wave 3A):
 *   - connect: mở socket TCP; timeout; lắng 'close'/'error' → link-loss (isConnected
 *     nói THẬT để supervisor reconnect).
 *   - readTags: mỗi tag = 1 giao dịch SLMP (bit-read cho bool, word-read cho int/float/
 *     string). endCode != 0 → quality:"bad" (KHÔNG sập batch, KHÔNG throw). Áp scale/
 *     offset Ở DRIVER (nhất quán modbus/mc).
 *   - subscribe: POLL setInterval; unref; close()=clearInterval.
 *   - writeTags: bit-device→write-bit; word int→1 word; float→2 word. X/DX read-only →
 *     ok:false. ⚠️ CHỈ commandDispatcher gọi (write chạm thiết bị thật).
 *   - Giao dịch tuần tự (1 outstanding/socket) — tránh trộn response 3E/4E.
 */
import net from "node:net";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";
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
import { inverseScale } from "./otScale";
import {
  parseSlmpDevice,
  buildBatchReadWord,
  buildBatchReadBit,
  buildBatchWriteWord,
  buildBatchWriteBit,
  parseResponse,
  expectedFrameLength,
  decodeInt16,
  decodeFloat32,
  decodeBits,
  encodeFloat32,
  type SlmpConfig,
  type SlmpFrame,
} from "./slmpEncoder";

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

/** Số WORD cần đọc cho một dataType word-device. */
function wordCountFor(dataType: string): number {
  return dataType === "float" ? 2 : 1;
}

export class SlmpDriver implements OtDriver {
  // doc 40 OT-F8 — 'slmp' chưa nằm trong union OtProtocol (otDriver.ts KHÔNG thuộc quyền
  // sửa của pass này). Cast an toàn: giá trị runtime khớp otProtocolEnum (migration 0241)
  // + registry (index.ts). Xem notes: nên bổ sung 'slmp' vào OtProtocol khi mở file đó.
  readonly protocol: OtProtocol = "slmp" as OtProtocol;

  private socket: net.Socket | null = null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;
  private lastLatencyMs: number | undefined;

  private frame: SlmpFrame = "3E";
  private baseCfg: SlmpConfig = {};
  private timeoutMs = 5000;
  private serialCounter = 0;

  // Hàng đợi giao dịch (1 outstanding/socket).
  private rxBuf: Buffer = Buffer.alloc(0);
  private pending: {
    resolve: (buf: Buffer) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private txChain: Promise<unknown> = Promise.resolve();

  async connect(cfg: OtConnectionConfig): Promise<void> {
    const opts = (cfg.options ?? {}) as Record<string, unknown>;
    const defaultPort = typeof opts.port === "number" ? opts.port : 5007;
    const { host, port } = parseEndpoint(cfg.endpoint, defaultPort);
    this.timeoutMs = cfg.timeoutMs ?? 5000;
    this.frame = opts.frame === "4E" ? "4E" : "3E";
    this.baseCfg = {
      frame: this.frame,
      networkNo: typeof opts.networkNo === "number" ? opts.networkNo : undefined,
      stationNo: typeof opts.stationNo === "number" ? opts.stationNo : undefined,
      moduleIo: typeof opts.moduleIo === "number" ? opts.moduleIo : undefined,
      multidropStation: typeof opts.multidropStation === "number" ? opts.multidropStation : undefined,
      monitoringTimer: typeof opts.monitoringTimer === "number" ? opts.monitoringTimer : undefined,
      octalInputOutput: opts.octalInputOutput === true,
    };

    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onTimeout = () => {
        cleanup();
        socket.destroy();
        reject(new Error(`slmp connect timeout after ${this.timeoutMs}ms`));
      };
      const cleanup = () => {
        socket.removeListener("error", onError);
        socket.removeListener("timeout", onTimeout);
      };
      socket.setTimeout(this.timeoutMs);
      socket.once("error", onError);
      socket.once("timeout", onTimeout);
      socket.connect(port, host, () => {
        cleanup();
        socket.setTimeout(0);
        socket.setNoDelay(true);
        this.socket = socket;
        this.connected = true;
        this.connectedAt = new Date();
        this.lastError = undefined;
        this.rxBuf = Buffer.alloc(0);
        socket.on("data", (chunk) => this.onData(chunk));
        this.attachLinkLossHandlers(socket);
        resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    const s = this.socket;
    this.socket = null;
    this.connected = false;
    this.failPending(new Error("slmp disconnected"));
    if (s) {
      try {
        s.removeAllListeners("data");
        s.destroy();
      } catch {
        // ignore
      }
    }
  }

  isConnected(): boolean {
    return this.connected && this.socket !== null && !this.socket.destroyed;
  }

  /** doc 40 OT-F1 — 'close'/'error' của socket → mất kết nối giữa phiên. */
  private attachLinkLossHandlers(socket: net.Socket): void {
    for (const ev of ["close", "error"] as const) {
      socket.on(ev, (arg?: unknown) => {
        if (this.socket === socket) this.markLinkLost(ev, arg);
      });
    }
  }

  private markLinkLost(ev: string, arg?: unknown): void {
    const detail = arg ? `: ${(arg as Error)?.message ?? String(arg)}` : "";
    if (this.connected) {
      this.connected = false;
      this.lastError = `slmp link lost (${ev})${detail}`;
    }
    this.failPending(new Error(this.lastError ?? `slmp link lost (${ev})`));
  }

  /** Nhận chunk TCP; gộp tới đủ 1 frame rồi giải quyết giao dịch đang chờ. */
  private onData(chunk: Buffer): void {
    this.rxBuf = this.rxBuf.length === 0 ? chunk : Buffer.concat([this.rxBuf, chunk]);
    // Chỉ 1 giao dịch outstanding → xử lý đúng 1 frame khi đủ.
    const need = expectedFrameLength(this.rxBuf, this.frame);
    if (need < 0 || this.rxBuf.length < need) return;
    const frameBuf = this.rxBuf.subarray(0, need);
    this.rxBuf = this.rxBuf.subarray(need);
    const p = this.pending;
    this.pending = null;
    if (p) {
      clearTimeout(p.timer);
      p.resolve(Buffer.from(frameBuf));
    }
  }

  private failPending(err: Error): void {
    const p = this.pending;
    this.pending = null;
    if (p) {
      clearTimeout(p.timer);
      p.reject(err);
    }
  }

  /** Gửi 1 request, chờ đúng 1 response frame (tuần tự hoá qua txChain). */
  private transact(request: Buffer): Promise<Buffer> {
    const run = async (): Promise<Buffer> => {
      const socket = this.socket;
      if (!this.connected || !socket) throw new DeviceUnreachableError("slmp");
      this.rxBuf = Buffer.alloc(0);
      return await new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.pending) {
            this.pending = null;
            // QA W5: timeout ⇒ tear down socket để 1 response TRỄ không bị onData()
            // gán nhầm cho giao dịch KẾ (đọc sai / xác nhận-ghi nhầm). Đóng socket +
            // flip connected=false → supervisor reconnect sạch (link-loss path).
            this.connected = false;
            this.socket?.destroy();
            reject(new Error(`slmp transaction timeout after ${this.timeoutMs}ms`));
          }
        }, this.timeoutMs);
        this.pending = { resolve, reject, timer };
        socket.write(request, (err) => {
          if (err) this.failPending(err);
        });
      });
    };
    // Nối vào chuỗi để đảm bảo 1 outstanding; lỗi 1 giao dịch không phá chuỗi.
    const next = this.txChain.then(run, run);
    this.txChain = next.catch(() => undefined);
    return next;
  }

  private nextSerial(): number {
    this.serialCounter = (this.serialCounter + 1) & 0xffff;
    return this.serialCounter;
  }

  private cfgFor(): SlmpConfig {
    return this.frame === "4E" ? { ...this.baseCfg, serial: this.nextSerial() } : this.baseCfg;
  }

  /** Đọc 1 tag → OtSample (lỗi/endCode != 0 → quality:"bad", KHÔNG throw). */
  private async readOne(tag: OtTagAddress): Promise<OtSample> {
    const now = () => new Date();
    try {
      const dev = parseSlmpDevice(tag.address, this.baseCfg.octalInputOutput);
      const cfg = this.cfgFor();

      let raw: number | boolean;
      if (tag.dataType === "bool" || (dev.isBit && tag.dataType !== "int" && tag.dataType !== "float")) {
        const { request } = buildBatchReadBit(tag.address, 1, cfg);
        const resp = parseResponse(await this.transact(request), this.frame);
        if (resp.endCode !== 0) return this.badSample(tag, resp.endCode);
        raw = decodeBits(resp.data, 1)[0];
      } else {
        const count = wordCountFor(tag.dataType);
        const { request } = buildBatchReadWord(tag.address, count, cfg);
        const resp = parseResponse(await this.transact(request), this.frame);
        if (resp.endCode !== 0) return this.badSample(tag, resp.endCode);
        raw = tag.dataType === "float" ? decodeFloat32(resp.data) : decodeInt16(resp.data);
      }

      // Áp scale/offset Ở DRIVER (nhất quán modbus/mc).
      let value: number | string | boolean | null;
      if (typeof raw === "boolean") {
        value = raw;
      } else {
        const scale = tag.scale ?? 1;
        const offset = tag.offset ?? 0;
        const n = raw * scale + offset;
        value = tag.dataType === "int" ? Math.round(n) : n;
      }

      this.lastOkAt = now();
      return { tagKey: tag.tagKey, raw, value, quality: "good", timestamp: now() } satisfies OtSample;
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      return { tagKey: tag.tagKey, raw: null, value: null, quality: "bad", timestamp: now() } satisfies OtSample;
    }
  }

  private badSample(tag: OtTagAddress, endCode: number): OtSample {
    this.lastError = `slmp end-code 0x${endCode.toString(16).padStart(4, "0").toUpperCase()} on ${tag.address}`;
    return { tagKey: tag.tagKey, raw: null, value: null, quality: "bad", timestamp: new Date() };
  }

  async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    if (!this.connected || !this.socket) throw new DeviceUnreachableError("slmp");
    if (tags.length === 0) return [];
    const t0 = Date.now();
    const out: OtSample[] = [];
    for (const tag of tags) out.push(await this.readOne(tag));
    this.lastLatencyMs = Date.now() - t0;
    return out;
  }

  async subscribe(tags: OtTagAddress[], onSample: OnOtSample, intervalMs = 5000): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new DeviceUnreachableError("slmp");

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
    if (typeof (timer as NodeJS.Timeout).unref === "function") (timer as NodeJS.Timeout).unref();
    return { close: async () => clearInterval(timer) };
  }

  /** Ghi 1 write; trả OtCommandResult (KHÔNG throw). */
  private async writeOne(w: OtWrite): Promise<OtCommandResult> {
    try {
      const dev = parseSlmpDevice(w.address, this.baseCfg.octalInputOutput);
      if (dev.isReadOnly) {
        return { tagKey: w.tagKey, ok: false, error: "register type not writable" };
      }
      const cfg = this.cfgFor();
      const dataType = w.dataType ?? (dev.isBit ? "bool" : "int");

      let request: Buffer;
      if (dataType === "bool" || dev.isBit) {
        request = buildBatchWriteBit(w.address, [Boolean(w.value)], cfg).request;
      } else {
        const raw = inverseScale(w.value, dataType, w.scale ?? 1, w.offset ?? 0) as number;
        const words =
          dataType === "float"
            ? encodeFloat32(Number(raw))
            : [Math.round(Number(raw)) & 0xffff];
        request = buildBatchWriteWord(w.address, words, cfg).request;
      }

      const resp = parseResponse(await this.transact(request), this.frame);
      if (resp.endCode !== 0) {
        const msg = `slmp write end-code 0x${resp.endCode.toString(16).padStart(4, "0").toUpperCase()}`;
        this.lastError = msg;
        return { tagKey: w.tagKey, ok: false, error: msg };
      }
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
   * Ghi tuần tự (1 giao dịch SLMP/lần). bit-device→write-bit; word int→1 word; float→
   * 2 word; X/DX read-only → ok:false. endCode != 0 → ok:false (KHÔNG throw).
   */
  async writeTags(writes: OtWrite[]): Promise<OtCommandResult[]> {
    if (!this.connected || !this.socket) throw new DeviceUnreachableError("slmp");
    if (writes.length === 0) return [];
    const out: OtCommandResult[] = [];
    for (const w of writes) out.push(await this.writeOne(w));
    if (out.every((r) => r.ok)) this.lastOkAt = new Date();
    return out;
  }

  async health(): Promise<OtHealth> {
    return {
      protocol: this.protocol,
      connected: this.isConnected(),
      lastOkAt: this.lastOkAt ?? this.connectedAt ?? undefined,
      lastError: this.lastError,
      latencyMs: this.lastLatencyMs,
    };
  }
}

export function createSlmpDriver(): OtDriver {
  return new SlmpDriver();
}
