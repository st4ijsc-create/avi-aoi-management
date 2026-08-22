/**
 * Sprint F1.2 — Modbus driver THẬT (package `modbus-serial`, nạp qua loadPackage()).
 *
 * - connect: new ModbusRTU(); parse host/port từ endpoint ("tcp://host:port" | "host");
 *   connectTCP(host,{port}) race timeout; setID(unitId); setTimeout.
 * - readTags: parse address → word count theo dataType → read{Holding|Input}Registers /
 *   read{Coils|DiscreteInputs} → decodeModbus → áp scale/offset → OtSample.
 *   Lỗi 1 tag → quality:"bad", KHÔNG sập cả batch.
 * - subscribe: POLL bằng setInterval gọi readTags; timer.unref(); close()=clearInterval.
 * - writeTags (F4b): coil→writeCoil; holding int→writeRegister; holding float→
 *   writeRegisters (2 word). input/discrete = read-only → ok:false.
 *   ⚠️ GHI XUỐNG THIẾT BỊ THẬT — chỉ commandDispatcher được gọi (xem comment writeTags).
 * - Thiếu lib → connect() throw "modbus-serial not installed" để otManager skip.
 *
 * Áp scale/offset Ở DRIVER (decodeModbus chỉ trả raw) — nhất quán với OPC-UA.
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
import { DeviceUnreachableError } from "../../../_core/deviceErrors";
import {
  parseModbusAddress,
  decodeModbus,
  encodeModbus,
  wordCountFor,
  type DecodeModbusOpts,
} from "./modbusDecode";
import { inverseScale } from "./otScale";

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

export class ModbusDriver extends NotImplementedDriver {
  readonly protocol: OtProtocol = "modbus";
  protected readonly packageName = "modbus-serial";

  private client: any = null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;
  private lastLatencyMs: number | undefined;
  private decodeOpts: DecodeModbusOpts = {};

  override async connect(cfg: OtConnectionConfig): Promise<void> {
    const mod: any = await this.loadPackage();
    if (!mod) {
      throw new Error("modbus-serial not installed");
    }
    const ModbusRTU = mod.default ?? mod;
    const client = new ModbusRTU();

    const opts = cfg.options ?? {};
    const defaultPort = typeof opts.port === "number" ? opts.port : 502;
    const { host, port } = parseEndpoint(cfg.endpoint, defaultPort);
    const timeoutMs = cfg.timeoutMs ?? 5000;

    // Lưu cấu hình giải mã từ options để dùng khi readTags.
    this.decodeOpts = {
      endianness: opts.endianness === "little" ? "little" : "big",
      wordOrder: opts.wordOrder === "little" ? "little" : "big",
      signed: opts.signed === false ? false : true,
    };

    try {
      await withTimeout(client.connectTCP(host, { port }), timeoutMs, "modbus connectTCP");
      const unitId = typeof opts.unitId === "number" ? opts.unitId : 1;
      client.setID(unitId);
      if (typeof client.setTimeout === "function") client.setTimeout(timeoutMs);

      this.client = client;
      this.connected = true;
      this.connectedAt = new Date();
      this.lastError = undefined;
      // doc 40 OT-F1 — lắng 'close'/'error' của socket TCP để phát hiện mất kết nối
      // giữa phiên (rớt cáp / PLC reboot). Trước đây `connected` chỉ lật ở disconnect()
      // → supervisor không thấy rớt. modbus-serial giữ socket ở client._port (TcpPort,
      // là EventEmitter). Lật connected=false → isConnected()/health() nói thật.
      this.attachLinkLossHandlers(client);
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      try {
        if (typeof client.close === "function") {
          await new Promise<void>((resolve) => client.close(() => resolve()));
        }
      } catch {
        // ignore
      }
      throw err;
    }
  }

  override async disconnect(): Promise<void> {
    if (this.client && typeof this.client.close === "function") {
      try {
        await new Promise<void>((resolve) => this.client.close(() => resolve()));
      } catch {
        // ignore
      }
    }
    this.client = null;
    this.connected = false;
  }

  override isConnected(): boolean {
    return this.connected;
  }

  /**
   * doc 40 OT-F1 — gắn listener mất-kết-nối vào socket modbus-serial. Chỉ lật
   * connected=false (reconnect do connectionSupervisor lo). Thử cả `client` và các
   * emitter socket nội bộ (client._port / ._port._client / ._client) vì bản modbus-serial
   * khác nhau đặt EventEmitter ở nơi khác nhau. Guard `this.client===client` chống listener
   * của kết nối cũ lật nhầm kết nối mới. Bọc try/catch cho package tối giản/mock.
   */
  private attachLinkLossHandlers(client: any): void {
    const candidates = [client, client?._port, client?._port?._client, client?._client];
    for (const emitter of candidates) {
      if (!emitter || typeof emitter.on !== "function") continue;
      for (const ev of ["close", "error"]) {
        try {
          emitter.on(ev, (arg?: unknown) => {
            if (this.client === client) this.markLinkLost(ev, arg);
          });
        } catch {
          // ignore
        }
      }
    }
  }

  /** Lật cờ mất kết nối (idempotent — chỉ tác động khi đang connected). */
  private markLinkLost(ev: string, arg?: unknown): void {
    if (!this.connected) return;
    this.connected = false;
    const detail = arg ? `: ${(arg as Error)?.message ?? String(arg)}` : "";
    this.lastError = `modbus link lost (${ev})${detail}`;
  }

  /** Đọc một tag, trả OtSample. Lỗi → quality:"bad" (không throw). */
  private async readOne(tag: OtTagAddress): Promise<OtSample> {
    const now = () => new Date();
    try {
      const { registerType, register } = parseModbusAddress(tag.address);
      const count = wordCountFor(tag.dataType);

      let raw: number | boolean;
      if (registerType === "coil" || registerType === "discrete") {
        const res =
          registerType === "coil"
            ? await this.client.readCoils(register, 1)
            : await this.client.readDiscreteInputs(register, 1);
        raw = decodeModbus([res.data?.[0] ? 1 : 0], "bool", this.decodeOpts);
      } else {
        const res =
          registerType === "holding"
            ? await this.client.readHoldingRegisters(register, count)
            : await this.client.readInputRegisters(register, count);
        const words: number[] = Array.isArray(res.data) ? res.data : [];
        raw = decodeModbus(words, tag.dataType, this.decodeOpts);
      }

      // Áp scale/offset Ở DRIVER (nhất quán với OPC-UA).
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
      return {
        tagKey: tag.tagKey,
        raw,
        value,
        quality: "good",
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
    if (!this.connected || !this.client) {
      throw new DeviceUnreachableError("modbus");
    }
    if (tags.length === 0) return [];

    const t0 = Date.now();
    const out: OtSample[] = [];
    for (const tag of tags) {
      // Modbus TCP nối tiếp theo unit — đọc tuần tự để tránh trùng giao dịch.
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
    if (!this.connected) throw new DeviceUnreachableError("modbus");

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
      const { registerType, register } = parseModbusAddress(w.address);

      if (registerType === "input" || registerType === "discrete") {
        return { tagKey: w.tagKey, ok: false, error: "register type not writable" };
      }

      if (registerType === "coil") {
        await this.client.writeCoil(register, Boolean(w.value));
        return { tagKey: w.tagKey, ok: true };
      }

      // holding register — int (1 word) hoặc float (2 word).
      const dataType = w.dataType ?? "int";
      // INVERSE scale/offset (int/float); bool không tới đây với holding.
      const raw = inverseScale(w.value, dataType, w.scale ?? 1, w.offset ?? 0) as number;
      const words = encodeModbus(raw, dataType, this.decodeOpts);

      if (wordCountFor(dataType) > 1 || words.length > 1) {
        await this.client.writeRegisters(register, words);
      } else {
        await this.client.writeRegister(register, words[0]);
      }
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
   * Ghi giá trị xuống Modbus. Reachable CHỈ qua HITL execute() → dispatch().
   * coil→writeCoil; holding int→writeRegister; holding float→writeRegisters;
   * input/discrete = read-only → ok:false. Ghi tuần tự (Modbus TCP nối tiếp).
   */
  override async writeTags(writes: OtWrite[]): Promise<OtCommandResult[]> {
    if (!this.connected || !this.client) {
      throw new DeviceUnreachableError("modbus");
    }
    if (writes.length === 0) return [];

    const out: OtCommandResult[] = [];
    for (const w of writes) {
      out.push(await this.writeOne(w));
    }
    if (out.every((r) => r.ok)) this.lastOkAt = new Date();
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

export function createModbusDriver(): OtDriver {
  return new ModbusDriver();
}
