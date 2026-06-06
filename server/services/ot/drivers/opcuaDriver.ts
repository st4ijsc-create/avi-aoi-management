/**
 * Sprint F1.2 — OPC-UA driver THẬT (package `node-opcua`, nạp qua loadPackage()).
 *
 * - connect: OPCUAClient.create + connect (race timeout) + createSession (user/pass tuỳ chọn).
 * - readTags: session.read([{nodeId, attributeId: Value}]) → normalizeOpcuaValue (áp scale/offset).
 * - subscribe: POLL bằng setInterval gọi readTags (KHÔNG dùng monitoredItem); timer.unref().
 *   close() chỉ clearInterval; disconnect() đóng session/client.
 * - writeTags: VẪN CHẶN (ok:false "write via HITL only (F4)") — điều khiển 2 chiều để F4.
 * - Thiếu lib → connect() throw "node-opcua not installed" để otManager skip (không sập).
 *
 * Giữ extends NotImplementedDriver, override các method, tái dùng loadPackage()/packageName.
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
import { parseOpcuaAddress, normalizeOpcuaValue } from "./opcuaAddress";

/** Chạy promise với timeout; quá hạn → reject. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

export class OpcuaDriver extends NotImplementedDriver {
  readonly protocol: OtProtocol = "opcua";
  protected readonly packageName = "node-opcua";

  private client: any = null;
  private session: any = null;
  private AttributeIds: any = null;
  private connected = false;
  private connectedAt: Date | null = null;
  private lastOkAt: Date | undefined;
  private lastError: string | undefined;
  private lastLatencyMs: number | undefined;

  override async connect(cfg: OtConnectionConfig): Promise<void> {
    const pkg: any = await this.loadPackage();
    if (!pkg) {
      throw new Error("node-opcua not installed");
    }
    const { OPCUAClient, AttributeIds } = pkg;
    this.AttributeIds = AttributeIds;

    const timeoutMs = cfg.timeoutMs ?? 5000;
    const client = OPCUAClient.create({
      endpointMustExist: false,
      connectionStrategy: { maxRetry: 1 },
    });

    try {
      await withTimeout(client.connect(cfg.endpoint), timeoutMs, "opcua connect");

      const opts = cfg.options ?? {};
      const userName = typeof opts.userName === "string" ? opts.userName : undefined;
      const password = typeof opts.password === "string" ? opts.password : undefined;
      const session =
        userName && password
          ? await withTimeout(
              client.createSession({ userName, password }),
              timeoutMs,
              "opcua createSession",
            )
          : await withTimeout(client.createSession(), timeoutMs, "opcua createSession");

      this.client = client;
      this.session = session;
      this.connected = true;
      this.connectedAt = new Date();
      this.lastError = undefined;
    } catch (err) {
      this.lastError = (err as Error)?.message || String(err);
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
      throw err;
    }
  }

  override async disconnect(): Promise<void> {
    if (this.session) {
      try {
        await this.session.close();
      } catch {
        // ignore
      }
    }
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch {
        // ignore
      }
    }
    this.session = null;
    this.client = null;
    this.connected = false;
  }

  override isConnected(): boolean {
    return this.connected;
  }

  override async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    if (!this.connected || !this.session) {
      throw new Error("OpcuaDriver: not connected");
    }
    if (tags.length === 0) return [];

    const nodesToRead = tags.map((t) => ({
      nodeId: parseOpcuaAddress(t.address).nodeId,
      attributeId: this.AttributeIds.Value,
    }));

    const t0 = Date.now();
    const results = await this.session.read(nodesToRead);
    this.lastLatencyMs = Date.now() - t0;
    this.lastOkAt = new Date();

    const arr: any[] = Array.isArray(results) ? results : [results];

    return tags.map((tag, i) => {
      const dv = arr[i];
      const raw = dv?.value?.value;
      // statusCode: good nếu thiếu hoặc .value === 0 (StatusCodes.Good)
      const sc = dv?.statusCode;
      const scVal = typeof sc?.value === "number" ? sc.value : 0;
      const scGood = scVal === 0;

      const norm = normalizeOpcuaValue(raw, tag.dataType, tag.scale ?? 1, tag.offset ?? 0);
      const quality = scGood ? norm.quality : "bad";
      const timestamp: Date =
        dv?.sourceTimestamp instanceof Date ? dv.sourceTimestamp : new Date();

      return {
        tagKey: tag.tagKey,
        raw,
        value: quality === "good" ? norm.value : null,
        quality,
        timestamp,
      } satisfies OtSample;
    });
  }

  override async subscribe(
    tags: OtTagAddress[],
    onSample: OnOtSample,
    intervalMs = 5000,
  ): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new Error("OpcuaDriver: not connected");

    const tick = async () => {
      try {
        const samples = await this.readTags(tags);
        for (const s of samples) {
          try {
            await onSample(s);
          } catch {
            // bỏ qua lỗi callback từng mẫu để không sập poll loop
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

export function createOpcuaDriver(): OtDriver {
  return new OpcuaDriver();
}
