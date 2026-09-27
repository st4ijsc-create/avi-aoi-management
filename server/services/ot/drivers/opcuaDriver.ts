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
 * - doc 81 Đợt 1B Task 12: securityMode/securityPolicy + PKI/trust-list (opcuaSecurity.ts,
 *   mặc định None + cảnh báo một lần); ghi ép về DataType CỦA NODE + kiểm miền; đọc lô cô lập
 *   lỗi theo tag (statusCode trên mẫu bad); địa chỉ `nsu=<uri>;…`; connect/disconnect có hạn.
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
import { parseOpcuaAddress, normalizeOpcuaValue, coerceOpcuaWriteValue } from "./opcuaAddress";
import { inverseScale } from "./otScale";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";
import { withDeadline } from "./boundedClose";
import {
  parseOpcuaSecurityOptions,
  resolveOpcuaPkiDir,
  resolveOpcuaPassword,
  warnInsecureDefaultOnce,
  getOpcuaClientCertificateManager,
  explainOpcuaConnectError,
} from "./opcuaSecurity";

/**
 * doc 81 Đợt 1B Task 12 — tên ứng dụng client cho đường BẢO MẬT (xuất hiện trong chứng chỉ
 * `<OPCUA_PKI_DIR>/own/certs/client_certificate.pem` mà PLC phải tin). Đường None giữ mặc
 * định của node-opcua như cũ.
 */
const OPCUA_CLIENT_APPLICATION_NAME = "AVI-AOI-OT-Client";

/**
 * Hạn cho TỪNG bước đóng (session.close, client.disconnect) — tổng ≤ 2 s, dưới hạn
 * disconnect 2,5 s của connectionSupervisor (Task 1), để driver tự xong trước lưới ngoài.
 */
const OPCUA_CLOSE_STEP_MS = 1000;

/** Mã trạng thái theo OPC UA Part 4 §7.34 (gõ tay — dùng khi lỗi phát hiện TRƯỚC khi gửi). */
const STATUS_BAD_NODEID_INVALID = "BadNodeIdInvalid (0x80330000)";
const STATUS_BAD_NODEID_UNKNOWN = "BadNodeIdUnknown (0x80340000)";

type ResolvedAddress = { nodeId: string } | { error: string; statusCode: string };

/** Đợi p nhưng không quá ms; mọi lỗi/quá hạn bị nuốt (dùng cho đường dọn dẹp). */
async function settleWithin(p: () => Promise<unknown>, ms: number, label: string): Promise<void> {
  try {
    await withDeadline(Promise.resolve().then(p), ms, label);
  } catch {
    // dọn dẹp best-effort — không bao giờ ném, không bao giờ treo
  }
}

/** "BadNodeIdUnknown (0x80340000)" từ một StatusCode node-opcua (hoặc object giả trong test). */
function describeStatus(sc: any, scVal: number): string {
  const hex = `0x${(scVal >>> 0).toString(16).padStart(8, "0")}`;
  const name = typeof sc?.name === "string" && sc.name ? sc.name : undefined;
  return name ? `${name} (${hex})` : hex;
}

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
  // doc 81 Đợt 1B Task 12 — theo PHIÊN (xoá khi connect/disconnect: PLC tải lại project có
  // thể đổi chỉ số namespace và kiểu biến).
  private resolveNodeIdFn: ((s: string) => unknown) | null = null;
  private namespaceArray: string[] | null = null;
  private readonly dataTypeCache = new Map<string, number>();

  private resetSessionCaches(): void {
    this.namespaceArray = null;
    this.dataTypeCache.clear();
  }

  override async connect(cfg: OtConnectionConfig): Promise<void> {
    const pkg: any = await this.loadPackage();
    if (!pkg) {
      throw new Error("node-opcua not installed");
    }
    // Task 12 — cấu hình bảo mật + mật khẩu kiểm TRƯỚC khi mở socket: sai cấu hình ⇒ lỗi rõ.
    const security = parseOpcuaSecurityOptions(cfg.options);
    const opts = cfg.options ?? {};
    const userName = typeof opts.userName === "string" ? opts.userName : undefined;
    const password = userName ? resolveOpcuaPassword(opts.password) : undefined;

    const { OPCUAClient, AttributeIds, DataType, Variant } = pkg;
    this.AttributeIds = AttributeIds;
    this.DataType = DataType;
    this.Variant = Variant;
    this.resolveNodeIdFn = optionalExport(pkg, "resolveNodeId");
    this.resetSessionCaches();
    // doc 22 P3 — capture subscription symbols if the package exposes them (real
    // node-opcua does; a minimal/mocked package may not → we fall back to poll).
    // optionalExport tolerates a strict ESM mock namespace that throws on access to
    // an undefined named export (vitest) → treated as "not available".
    this.ClientSubscription = optionalExport(pkg, "ClientSubscription");
    this.ClientMonitoredItem = optionalExport(pkg, "ClientMonitoredItem");
    this.TimestampsToReturn = optionalExport(pkg, "TimestampsToReturn");
    this.MonitoringMode = optionalExport(pkg, "MonitoringMode");

    const timeoutMs = cfg.timeoutMs ?? 5000;
    const createOpts: Record<string, unknown> = {
      endpointMustExist: false,
      connectionStrategy: { maxRetry: 1 },
    };
    let pkiDir: string | null = null;
    if (security.securityMode !== "None") {
      const MessageSecurityMode = optionalExport(pkg, "MessageSecurityMode");
      const SecurityPolicy = optionalExport(pkg, "SecurityPolicy");
      if (!MessageSecurityMode || !SecurityPolicy) {
        throw new Error("opcua: this node-opcua build has no MessageSecurityMode/SecurityPolicy (security unsupported)");
      }
      pkiDir = resolveOpcuaPkiDir();
      createOpts.securityMode = MessageSecurityMode[security.securityMode];
      createOpts.securityPolicy = SecurityPolicy[security.securityPolicy];
      createOpts.applicationName = OPCUA_CLIENT_APPLICATION_NAME;
      // Trust-list của app; trustOnFirstUse mặc định TẮT ⇒ chứng chỉ server lạ bị từ chối.
      createOpts.clientCertificateManager = await withDeadline(
        getOpcuaClientCertificateManager(pkg, pkiDir, security.trustOnFirstUse),
        timeoutMs,
        "opcua pki init",
      );
    } else if (!security.explicit) {
      // Không ai cấu hình ⇒ giữ None như cũ, nhưng nói ra MỘT lần mỗi tiến trình.
      warnInsecureDefaultOnce(cfg.endpoint);
    }
    const client = OPCUAClient.create(createOpts);

    try {
      await withDeadline(client.connect(cfg.endpoint), timeoutMs, "opcua connect");

      const session =
        userName && password
          ? await withDeadline(
              client.createSession({ userName, password }),
              timeoutMs,
              "opcua createSession",
            )
          : await withDeadline(client.createSession(), timeoutMs, "opcua createSession");

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
      const explained = explainOpcuaConnectError(err, pkiDir);
      this.lastError = explained.message;
      // Task 12 — dọn client CÓ HẠN (trước đây `await client.disconnect()` trần có thể treo).
      await settleWithin(() => client.disconnect(), OPCUA_CLOSE_STEP_MS, "opcua disconnect");
      throw explained;
    }
  }

  override async disconnect(): Promise<void> {
    const session = this.session;
    const client = this.client;
    this.session = null;
    this.client = null;
    this.connected = false;
    this.resetSessionCaches();
    // Task 12 — mỗi bước có hạn (tổng ≤ 2 s): session/secure channel treo không giữ stop().
    if (session) {
      await settleWithin(() => session.close(), OPCUA_CLOSE_STEP_MS, "opcua session.close");
    }
    if (client) {
      await settleWithin(() => client.disconnect(), OPCUA_CLOSE_STEP_MS, "opcua disconnect");
    }
  }

  /**
   * Task 12 — phân giải địa chỉ của MỘT tag (không bao giờ ném): cú pháp sai ⇒
   * BadNodeIdInvalid; `nsu=` không có trên server ⇒ BadNodeIdUnknown. Kiểm thêm bằng
   * `resolveNodeId` của thư viện — một chuỗi nó không nhận (vd `ns=2;i=abc`) trước đây
   * làm `session.read` ném và hỏng CẢ LÔ.
   */
  private async resolveAddress(address: string): Promise<ResolvedAddress> {
    let parsed;
    try {
      parsed = parseOpcuaAddress(address);
    } catch (e) {
      return { error: (e as Error)?.message || String(e), statusCode: STATUS_BAD_NODEID_INVALID };
    }
    let nodeId = parsed.nodeId;
    if (parsed.namespaceUri !== undefined) {
      let arr: string[] | null;
      try {
        arr = await this.getNamespaceArray();
      } catch (e) {
        return {
          error: `cannot read server NamespaceArray: ${(e as Error)?.message || String(e)}`,
          statusCode: STATUS_BAD_NODEID_UNKNOWN,
        };
      }
      const idx = arr ? arr.indexOf(parsed.namespaceUri) : -1;
      if (idx < 0) {
        return {
          error: `namespace uri "${parsed.namespaceUri}" not found on server`,
          statusCode: STATUS_BAD_NODEID_UNKNOWN,
        };
      }
      nodeId = `ns=${idx};${parsed.identifier}`;
    }
    if (this.resolveNodeIdFn) {
      try {
        this.resolveNodeIdFn(nodeId);
      } catch (e) {
        return { error: (e as Error)?.message || String(e), statusCode: STATUS_BAD_NODEID_INVALID };
      }
    }
    return { nodeId };
  }

  /** NamespaceArray của phiên (cache tới lần connect/disconnect sau). null ⇒ session không hỗ trợ. */
  private async getNamespaceArray(): Promise<string[] | null> {
    if (this.namespaceArray) return this.namespaceArray;
    const session = this.session;
    if (!session || typeof session.readNamespaceArray !== "function") return null;
    const arr = await session.readNamespaceArray();
    if (Array.isArray(arr) && this.session === session) this.namespaceArray = arr.map(String);
    return Array.isArray(arr) ? arr.map(String) : null;
  }

  /**
   * Task 12 — kiểu dựng sẵn của node (thuộc tính DataType, đi theo cây kiểu tới kiểu gốc),
   * cache theo nodeId trong phiên. null ⇒ session không có `getBuiltInDataType` (gói tối
   * giản/giả) ⇒ caller dùng đường ép cũ theo dataType khai báo. Node không đọc được ⇒ ném.
   */
  private async nodeBuiltinType(nodeId: string): Promise<number | null> {
    const cached = this.dataTypeCache.get(nodeId);
    if (cached !== undefined) return cached;
    const session = this.session;
    if (!session || typeof session.getBuiltInDataType !== "function") return null;
    const dt = await session.getBuiltInDataType(nodeId);
    const n = typeof dt === "number" ? dt : Number(dt);
    if (!Number.isFinite(n)) throw new Error(`cannot determine DataType of ${nodeId}`);
    if (this.session === session) this.dataTypeCache.set(nodeId, n);
    return n;
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

    // Task 12 — cô lập lỗi theo tag: địa chỉ không phân giải được ⇒ CHỈ tag đó `bad` (kèm mã
    // trạng thái), không gửi vào session.read (trước đây một địa chỉ sai làm ném cả lô).
    const session = this.session;
    const resolved = await Promise.all(tags.map((t) => this.resolveAddress(t.address)));
    const nodesToRead: Array<{ nodeId: string; attributeId: unknown }> = [];
    const slot: number[] = resolved.map((r) => {
      if ("error" in r) return -1;
      nodesToRead.push({ nodeId: r.nodeId, attributeId: this.AttributeIds.Value });
      return nodesToRead.length - 1;
    });

    let arr: any[] = [];
    if (nodesToRead.length > 0) {
      const t0 = Date.now();
      const results = await session.read(nodesToRead);
      this.lastLatencyMs = Date.now() - t0;
      this.lastOkAt = new Date();
      arr = Array.isArray(results) ? results : [results];
    }

    return tags.map((tag, i) => {
      const r = resolved[i];
      if ("error" in r) {
        return {
          tagKey: tag.tagKey,
          raw: undefined,
          value: null,
          quality: "bad",
          timestamp: new Date(),
          statusCode: r.statusCode,
        } satisfies OtSample;
      }
      const dv = arr[slot[i]];
      const raw = dv?.value?.value;
      // statusCode: good nếu thiếu hoặc .value === 0 (StatusCodes.Good)
      const sc = dv?.statusCode;
      const scVal = typeof sc?.value === "number" ? sc.value : 0;
      const scGood = scVal === 0;

      const norm = normalizeOpcuaValue(raw, tag.dataType, tag.scale ?? 1, tag.offset ?? 0);
      const quality = scGood ? norm.quality : "bad";
      const timestamp: Date =
        dv?.sourceTimestamp instanceof Date ? dv.sourceTimestamp : new Date();

      const sample: OtSample = {
        tagKey: tag.tagKey,
        raw,
        value: quality === "good" ? norm.value : null,
        quality,
        timestamp,
      };
      if (!scGood) sample.statusCode = describeStatus(sc, scVal);
      return sample;
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
      // Task 12 — cùng bộ phân giải với readTags (nsu=, kiểm cú pháp bằng thư viện).
      const r = await this.resolveAddress(tag.address);
      if ("error" in r) {
        // Bad address → skip this tag (do NOT tear down the whole subscription).
        console.error(`[OPCUA] monitored-item skip bad address "${tag.address}": ${r.error} (${r.statusCode})`);
        continue;
      }
      const nodeId = r.nodeId;
      const itemToMonitor = { nodeId, attributeId: this.AttributeIds.Value };
      const params = { samplingInterval: publishingInterval, discardOldest: true, queueSize: 10 };
      let mi: any;
      try {
        mi = await this.ClientMonitoredItem.create(subscription, itemToMonitor, params, tsToReturn);
      } catch (e) {
        // Task 12 — một item hỏng không kéo sập các tag khác của subscription.
        console.error(`[OPCUA] monitored-item create failed for "${tag.address}":`, (e as Error)?.message ?? e);
        continue;
      }
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
          const sample: OtSample = {
            tagKey: tag.tagKey,
            raw,
            value: quality === "good" ? norm.value : null,
            quality,
            timestamp,
          };
          if (!scGood) sample.statusCode = describeStatus(sc, scVal);
          void Promise.resolve(onSample(sample)).catch(() => {
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
    const prepared: Array<{ tagKey: string; node?: any; error?: string }> = await Promise.all(
      writes.map(async (w) => {
        try {
          const dataType = w.dataType ?? "float";
          // INVERSE scale/offset — chỉ int/float (bool/string giữ nguyên).
          const raw = inverseScale(w.value, dataType, w.scale ?? 1, w.offset ?? 0);
          const r = await this.resolveAddress(w.address);
          if ("error" in r) return { tagKey: w.tagKey, error: `${r.error} (${r.statusCode})` };
          const nodeId = r.nodeId;
          // Task 12 — ép về kiểu dựng sẵn CỦA NODE (Float/Int16/UInt16/UInt32/Byte…) + kiểm
          // miền; trước đây luôn Int32/Double ⇒ BadTypeMismatch. Không xác định được kiểu
          // (gói tối giản) ⇒ đường cũ theo dataType khai báo.
          let variantValue: any;
          let builtin: number | null;
          try {
            builtin = await this.nodeBuiltinType(nodeId);
          } catch (e) {
            return { tagKey: w.tagKey, error: `cannot read DataType of ${nodeId}: ${(e as Error)?.message || String(e)}` };
          }
          if (builtin === null) {
            variantValue = this.coerce(raw, dataType);
          } else {
            const c = coerceOpcuaWriteValue(raw, builtin);
            if (!c.ok) return { tagKey: w.tagKey, error: c.error };
            variantValue = this.Variant
              ? new this.Variant({ dataType: c.dataType, value: c.value })
              : { dataType: c.dataType, value: c.value };
          }
          const node = {
            nodeId,
            attributeId: this.AttributeIds.Value,
            value: { value: variantValue },
          };
          return { tagKey: w.tagKey, node };
        } catch (err) {
          return { tagKey: w.tagKey, error: (err as Error)?.message || String(err) };
        }
      }),
    );

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
      // Task 12 — kiểu biến đổi phía PLC (tải lại project) ⇒ bỏ cache để lần sau đọc lại.
      if (sc?.name === "BadTypeMismatch" && p.node?.nodeId) this.dataTypeCache.delete(p.node.nodeId);
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
