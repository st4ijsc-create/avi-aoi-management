/**
 * Sprint F1.2 — OPC-UA driver THẬT (package `node-opcua`, nạp qua loadPackage()).
 *
 * - connect: OPCUAClient.create + connect (race timeout) + createSession (user/pass tuỳ chọn).
 * - readTags: session.read([{nodeId, attributeId: Value}]) → normalizeOpcuaValue (áp scale/offset).
 * - subscribe: POLL bằng setInterval gọi readTags (KHÔNG dùng monitoredItem); timer.unref().
 *   close() chỉ clearInterval; disconnect() đóng session/client.
 * - writeTags (F4b): session.write([{nodeId, attributeId:Value, value:{value:Variant}}]).
 *   ⚠️ GHI XUỐNG THIẾT BỊ THẬT — chỉ commandDispatcher được gọi (xem comment writeTags).
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
  OtWrite,
  OtHealth,
  OnOtSample,
} from "../otDriver";
import { NotImplementedDriver } from "./notImplementedDriver";
import { parseOpcuaAddress, normalizeOpcuaValue } from "./opcuaAddress";
import { inverseScale } from "./otScale";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";

/**
 * doc 22 P3 — flag for the REAL OPC-UA monitored-item PUSH path. Default OFF: when off,
 * subscribe() keeps its original setInterval poll behaviour unchanged. Turn on with
 * OT_OPCUA_MONITORED_ITEMS=true|1 to prefer server-driven change notifications (with an
 * automatic fall back to poll when the endpoint/package can't support subscriptions).
 */
function monitoredItemsEnabled(): boolean {
  return (
    process.env.OT_OPCUA_MONITORED_ITEMS === "true" ||
    process.env.OT_OPCUA_MONITORED_ITEMS === "1"
  );
}

/**
 * Read an OPTIONAL named export from a (possibly strict-mocked) module namespace.
 * A vitest ESM mock throws on access to an undefined export; a plain object just
 * yields undefined. Either way we return null so the caller treats it as absent.
 */
function optionalExport(pkg: any, name: string): any {
  try {
    return pkg?.[name] ?? null;
  } catch {
    return null;
  }
}

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
  private DataType: any = null;
  private Variant: any = null;
  // doc 22 P3 — node-opcua subscription/monitored-item symbols (best-effort; may be
  // absent in a minimal/mocked package → the push path is skipped, poll is used).
  private ClientSubscription: any = null;
  private ClientMonitoredItem: any = null;
  private TimestampsToReturn: any = null;
  private MonitoringMode: any = null;
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
    const { OPCUAClient, AttributeIds, DataType, Variant } = pkg;
    this.AttributeIds = AttributeIds;
    this.DataType = DataType;
    this.Variant = Variant;
    // doc 22 P3 — capture subscription symbols if the package exposes them (real
    // node-opcua does; a minimal/mocked package may not → we fall back to poll).
    // optionalExport tolerates a strict ESM mock namespace that throws on access to
    // an undefined named export (vitest) → treated as "not available".
    this.ClientSubscription = optionalExport(pkg, "ClientSubscription");
    this.ClientMonitoredItem = optionalExport(pkg, "ClientMonitoredItem");
    this.TimestampsToReturn = optionalExport(pkg, "TimestampsToReturn");
    this.MonitoringMode = optionalExport(pkg, "MonitoringMode");

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
      // doc 40 OT-F1 — lắng event transport để phát hiện MẤT KẾT NỐI GIỮA PHIÊN
      // (rớt cáp / server reboot). Trước đây `connected` chỉ bị lật ở disconnect() →
      // supervisor không bao giờ thấy rớt cáp. node-opcua OPCUAClient phát
      // 'connection_lost'/'close'/'backoff'/'abort' → lật connected=false để
      // isConnected()/health() nói thật; connectionSupervisor sẽ reconnect/failover.
      this.attachLinkLossHandlers(client);
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

  /**
   * doc 40 OT-F1 — gắn listener mất-kết-nối vào OPCUAClient. Chỉ lật connected=false
   * (KHÔNG tự reconnect — đó là việc của connectionSupervisor). Guard `this.client===client`
   * để listener của một client CŨ (đã bị thay khi reconnect) không lật nhầm kết nối MỚI.
   * Bọc try/catch: package tối giản/mock có thể không phải EventEmitter.
   */
  private attachLinkLossHandlers(client: any): void {
    if (!client || typeof client.on !== "function") return;
    const events = ["connection_lost", "close", "backoff", "abort"];
    for (const ev of events) {
      try {
        client.on(ev, (arg?: unknown) => {
          if (this.client === client) this.markLinkLost(ev, arg);
        });
      } catch {
        // ignore — không phải mọi build đều expose event này
      }
    }
  }

  /** Lật cờ mất kết nối (idempotent — chỉ tác động khi đang connected). */
  private markLinkLost(ev: string, arg?: unknown): void {
    if (!this.connected) return;
    this.connected = false;
    const detail = arg ? `: ${(arg as Error)?.message ?? String(arg)}` : "";
    this.lastError = `opcua link lost (${ev})${detail}`;
  }

  override async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    if (!this.connected || !this.session) {
      throw new DeviceUnreachableError("opcua");
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
    if (!this.connected) throw new DeviceUnreachableError("opcua");

    // doc 22 P3 — real OPC-UA PUSH via ClientMonitoredItem, gated by
    // OT_OPCUA_MONITORED_ITEMS (default OFF → unchanged poll behaviour). When the flag
    // is on we try to create a subscription + monitored items; if that fails or the
    // package/session lacks subscription support we fall back to the poll loop below.
    if (monitoredItemsEnabled()) {
      try {
        const handle = await this.trySubscribeMonitored(tags, onSample, intervalMs);
        if (handle) return handle;
      } catch (e) {
        // Subscription unsupported/failed → transparently fall back to polling.
        console.error(
          "[OPCUA] monitored-item subscribe failed, falling back to poll:",
          (e as Error)?.message ?? e,
        );
      }
    }

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

  /**
   * doc 22 P3 — REAL push path via node-opcua ClientSubscription + ClientMonitoredItem.
   * Returns a handle on success, or `null` when the package/session cannot support
   * subscriptions (so the caller falls back to polling). READ-ONLY (monitors Value
   * attribute changes) — opens NO control path. Each change notification is normalized
   * through the SAME normalizeOpcuaValue used by readTags so the emitted OtSample shape
   * is identical to the poll path.
   */
  private async trySubscribeMonitored(
    tags: OtTagAddress[],
    onSample: OnOtSample,
    intervalMs: number,
  ): Promise<OtSubscriptionHandle | null> {
    if (!this.session) return null;
    // Need either the ClientSubscription helper or a session.createSubscription2.
    const canCreate =
      typeof this.session.createSubscription2 === "function" || this.ClientSubscription;
    if (!canCreate || !this.ClientMonitoredItem) return null;
    if (tags.length === 0) {
      // Nothing to monitor — return a trivial handle so we don't spin a poll timer.
      return { close: async () => {} };
    }

    const publishingInterval = intervalMs > 0 ? intervalMs : 1000;
    const subParams = {
      requestedPublishingInterval: publishingInterval,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 10,
    };

    const subscription =
      typeof this.session.createSubscription2 === "function"
        ? await this.session.createSubscription2(subParams)
        : await this.ClientSubscription.create(this.session, subParams);

    const tsToReturn = this.TimestampsToReturn?.Both ?? 2; // Both = 2 by spec
    const monitoredItems: any[] = [];

    for (const tag of tags) {
      let nodeId: string;
      try {
        nodeId = parseOpcuaAddress(tag.address).nodeId;
      } catch (e) {
        // Bad address → skip this tag (do NOT tear down the whole subscription).
        console.error(`[OPCUA] monitored-item skip bad address "${tag.address}":`, (e as Error)?.message ?? e);
        continue;
      }
      const itemToMonitor = { nodeId, attributeId: this.AttributeIds.Value };
      const params = { samplingInterval: publishingInterval, discardOldest: true, queueSize: 10 };
      const mi = await this.ClientMonitoredItem.create(subscription, itemToMonitor, params, tsToReturn);
      mi.on("changed", (dataValue: any) => {
        try {
          const raw = dataValue?.value?.value;
          const sc = dataValue?.statusCode;
          const scVal = typeof sc?.value === "number" ? sc.value : 0;
          const scGood = scVal === 0;
          const norm = normalizeOpcuaValue(raw, tag.dataType, tag.scale ?? 1, tag.offset ?? 0);
          const quality = scGood ? norm.quality : "bad";
          const timestamp: Date =
            dataValue?.sourceTimestamp instanceof Date ? dataValue.sourceTimestamp : new Date();
          this.lastOkAt = new Date();
          void Promise.resolve(
            onSample({
              tagKey: tag.tagKey,
              raw,
              value: quality === "good" ? norm.value : null,
              quality,
              timestamp,
            } satisfies OtSample),
          ).catch(() => {
            // swallow per-sample callback errors so one bad handler can't kill the push
          });
        } catch (e) {
          this.lastError = (e as Error)?.message || String(e);
        }
      });
      monitoredItems.push(mi);
    }

    // If every tag had an unparseable address there is nothing monitored → let the
    // caller poll instead (terminate the empty subscription first).
    if (monitoredItems.length === 0) {
      try { await subscription.terminate(); } catch { /* ignore */ }
      return null;
    }

    return {
      close: async () => {
        try {
          await subscription.terminate();
        } catch {
          // ignore
        }
      },
    };
  }

  /**
   * ⚠️ ONLY commandDispatcher may call this — write reaches physical device.
   *
   * Ghi giá trị xuống node OPC-UA. Reachable CHỈ qua HITL execute() → dispatch().
   * Với mỗi write: inverse scale/offset (int/float) → coerce theo dataType →
   * session.write([{nodeId, attributeId:Value, value:{value: Variant}}]).
   * StatusCode good → ok:true; lỗi/exception → ok:false.
   */
  override async writeTags(writes: OtWrite[]): Promise<OtCommandResult[]> {
    if (!this.connected || !this.session) {
      throw new DeviceUnreachableError("opcua");
    }
    if (writes.length === 0) return [];

    // Chuẩn bị nodesToWrite + nhớ map lỗi parse từng write (không kéo sập batch).
    const prepared: Array<{ tagKey: string; node?: any; error?: string }> = writes.map((w) => {
      try {
        const dataType = w.dataType ?? "float";
        // INVERSE scale/offset — chỉ int/float (bool/string giữ nguyên).
        const raw = inverseScale(w.value, dataType, w.scale ?? 1, w.offset ?? 0);
        const { nodeId } = parseOpcuaAddress(w.address);
        const variantValue = this.coerce(raw, dataType);
        const node = {
          nodeId,
          attributeId: this.AttributeIds.Value,
          value: { value: variantValue },
        };
        return { tagKey: w.tagKey, node };
      } catch (err) {
        return { tagKey: w.tagKey, error: (err as Error)?.message || String(err) };
      }
    });

    const toWrite = prepared.filter((p) => p.node).map((p) => p.node);
    let statusCodes: any[] = [];
    if (toWrite.length > 0) {
      try {
        const res = await this.session.write(toWrite);
        statusCodes = Array.isArray(res) ? res : [res];
      } catch (err) {
        const msg = (err as Error)?.message || String(err);
        this.lastError = msg;
        // Toàn batch lỗi I/O → tất cả node-đã-prepare fail; giữ lỗi parse riêng.
        return prepared.map((p) => ({
          tagKey: p.tagKey,
          ok: false,
          error: p.error ?? msg,
        }));
      }
    }

    // Ghép statusCode về từng write theo thứ tự các node đã gửi.
    let scIdx = 0;
    const out: OtCommandResult[] = prepared.map((p) => {
      if (p.error) return { tagKey: p.tagKey, ok: false, error: p.error };
      const sc = statusCodes[scIdx++];
      const scVal = typeof sc?.value === "number" ? sc.value : 0;
      const good = scVal === 0; // StatusCodes.Good
      if (good) return { tagKey: p.tagKey, ok: true };
      const name = sc?.name ?? sc?.description ?? `status ${scVal}`;
      return { tagKey: p.tagKey, ok: false, error: `bad status: ${name}` };
    });
    if (out.every((r) => r.ok)) this.lastOkAt = new Date();
    return out;
  }

  /** Bọc raw vào Variant theo OtDataType (int→Int32, float→Double, bool→Boolean, string→String). */
  private coerce(raw: unknown, dataType: string): any {
    const DataType = this.DataType ?? {};
    const Variant = this.Variant;
    let dt: any;
    let value: any;
    switch (dataType) {
      case "bool":
        dt = DataType.Boolean;
        value = Boolean(raw);
        break;
      case "int":
        dt = DataType.Int32; // Int32 phổ biến nhất với PLC.
        value = Math.round(Number(raw));
        break;
      case "float":
        dt = DataType.Double;
        value = Number(raw);
        break;
      case "string":
      default:
        dt = DataType.String;
        value = String(raw);
        break;
    }
    // Dùng Variant nếu lib cung cấp; fallback object phẳng cho test/lib tối giản.
    return Variant ? new Variant({ dataType: dt, value }) : { dataType: dt, value };
  }

  /**
   * X1-d (doc 16 §5) — REAL OPC-UA browse for hot-plug discovery. Browses the children
   * of a node (default the Objects folder "ns=0;i=85") and returns the discovered
   * references as candidate nodes. READ-ONLY (session.browse) — opens NO control path.
   * Returns [] when not connected or the browse yields nothing. NEVER fabricates nodes.
   */
  async browseNodes(rootNodeId = "ns=0;i=85"): Promise<Array<{ nodeId: string; browseName: string; nodeClass?: string }>> {
    if (!this.connected || !this.session) {
      throw new DeviceUnreachableError("opcua");
    }
    const res = await this.session.browse(rootNodeId);
    const refs: any[] = Array.isArray(res?.references) ? res.references : [];
    return refs.map((r) => ({
      nodeId: typeof r?.nodeId?.toString === "function" ? r.nodeId.toString() : String(r?.nodeId ?? ""),
      browseName: r?.browseName?.name ?? String(r?.browseName ?? ""),
      nodeClass: typeof r?.nodeClass === "number" ? String(r.nodeClass) : (r?.nodeClass ?? undefined),
    })).filter((n) => n.nodeId);
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
