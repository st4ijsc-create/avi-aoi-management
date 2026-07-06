/**
 * Reference DEVICE-CONNECTOR plugin sidecar — doc 37 C3 (dev-portal / "thêm hãng = 1 plugin").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A COMPLETE, copy-me template for the out-of-process device-connector RPC the Hub speaks over
 * stdio JSON-lines. Unlike `sidecar/sampleSidecar.ts` (which only proves the wire with
 * ping/echo/health), THIS implements the five methods `pluginDriverBridge.ts` (Đợt-B4) actually
 * calls, in the exact wire shapes it expects:
 *
 *   request  { id, method, params }            → response { id, result | error }
 *
 *   connect(cfg: OtConnectionConfig)  → any               establish the device connection
 *   readTags(tags: OtTagAddress[])    → WireSample[]       { tagKey, value, quality?, timestamp? }
 *   writeTags(writes: OtWrite[])      → OtCommandResult[]  { tagKey, ok, error? }  (via dispatcher only)
 *   health()                          → { connected?, latencyMs? }
 *   disconnect()                      → any
 *
 * A REAL connector replaces the in-memory simulation below with vendor I/O (OPC UA / Modbus /
 * a native-DLL FFI wrapper). The pure {@link handleDeviceConnectorRequest} is unit-testable; the
 * stdio loop at the bottom runs only when the file is the process entrypoint.
 *
 * WRITE-GATE (do not weaken): `writeTags` is reached ONLY through the Hub's commandDispatcher →
 * HITL / commissioning / interlock gates. A sidecar must NEVER expose a side-channel write. On a
 * fault, THROW (return an { error }) — never fabricate success; the bridge records a failure and
 * the supervisor drives recovery.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** Wire request frame (correlated by id). */
export interface SidecarRequest {
  id: number;
  method: string;
  params?: unknown;
}
/** Wire response frame. `error` (a string) rejects the caller's promise; `result` resolves it. */
export interface SidecarResponse {
  id: number;
  result?: unknown;
  error?: string;
}

/** A tag address the Hub asks the connector to read (subset the sidecar needs). */
export interface TagAddress {
  tagKey: string;
  address: string;
  dataType?: string;
  writable?: boolean;
}
/** A write request (reached ONLY via the Hub's gated commandDispatcher). */
export interface TagWrite {
  tagKey: string;
  address: string;
  value: unknown;
}
/** The sample shape the bridge revives (timestamp → Date, quality → "good" default). */
export interface WireSample {
  tagKey: string;
  raw?: unknown;
  value: number | string | boolean | null;
  quality?: "good" | "bad" | "uncertain" | "stale";
  timestamp?: string | number;
}
/** Per-write result the bridge returns to the dispatcher unchanged. */
export interface CommandResult {
  tagKey: string;
  ok: boolean;
  error?: string;
}

/**
 * Connector state kept between RPCs. A real connector holds the vendor session here; the template
 * keeps a tiny in-memory "device" so the sidecar is runnable end-to-end for smoke tests / conformance.
 */
export interface ConnectorState {
  connected: boolean;
  endpoint: string | null;
  /** Last written value per tag (so a read-after-write echoes it — proves the round-trip). */
  values: Map<string, number | string | boolean | null>;
}

export function createConnectorState(): ConnectorState {
  return { connected: false, endpoint: null, values: new Map() };
}

/** A deterministic synthetic value for a tag (replace with real vendor reads). */
function synthValue(state: ConnectorState, tag: TagAddress): number | string | boolean | null {
  if (state.values.has(tag.tagKey)) return state.values.get(tag.tagKey)!;
  // Stable pseudo-value from the address so tests are deterministic.
  let h = 0;
  for (const c of tag.address) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  if (tag.dataType === "bool") return (h & 1) === 1;
  if (tag.dataType === "string") return `sim:${tag.address}`;
  return h / 100;
}

/**
 * PURE request handler — the whole connector protocol in one testable function. `state` is mutated
 * across calls (connect flips `connected`, writeTags stores values). Unknown method → { error }.
 */
export function handleDeviceConnectorRequest(req: SidecarRequest, state: ConnectorState): SidecarResponse {
  const { id, method, params } = req;
  try {
    switch (method) {
      case "connect": {
        const cfg = (params ?? {}) as { endpoint?: string };
        state.connected = true;
        state.endpoint = cfg.endpoint ?? null;
        // TODO(real connector): open the vendor session here; throw to reject on failure.
        return { id, result: { connected: true, endpoint: state.endpoint } };
      }
      case "readTags": {
        if (!state.connected) return { id, error: "not connected" };
        const tags = Array.isArray(params) ? (params as TagAddress[]) : [];
        const now = new Date().toISOString();
        const samples: WireSample[] = tags.map((t) => ({
          tagKey: t.tagKey,
          value: synthValue(state, t),
          quality: "good",
          timestamp: now,
        }));
        return { id, result: samples };
      }
      case "writeTags": {
        // WRITE-GATE: the Hub only reaches this via its gated dispatcher. Apply + report per write.
        if (!state.connected) return { id, error: "not connected" };
        const writes = Array.isArray(params) ? (params as TagWrite[]) : [];
        const results: CommandResult[] = writes.map((w) => {
          // TODO(real connector): perform the vendor write; on failure return { ok:false, error }.
          state.values.set(w.tagKey, (w.value as number | string | boolean | null) ?? null);
          return { tagKey: w.tagKey, ok: true };
        });
        return { id, result: results };
      }
      case "health": {
        return { id, result: { connected: state.connected, latencyMs: 1 } };
      }
      case "disconnect": {
        state.connected = false;
        state.endpoint = null;
        // TODO(real connector): close the vendor session / release handles here.
        return { id, result: { connected: false } };
      }
      default:
        return { id, error: `unknown method: ${method}` };
    }
  } catch (err) {
    // NEVER fabricate success — surface the fault; the bridge records a failure + recovers.
    return { id, error: (err as Error)?.message ?? String(err) };
  }
}

/** Wire stdin → handler → stdout as newline-delimited JSON (runs only as a process entrypoint). */
export function runDeviceConnectorSidecar(): void {
  const state = createConnectorState();
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const req = JSON.parse(line) as SidecarRequest;
        process.stdout.write(JSON.stringify(handleDeviceConnectorRequest(req, state)) + "\n");
      } catch {
        /* ignore a malformed request line (never tear down the channel) */
      }
    }
  });
}

// Only run the stdio loop when this file is the process entrypoint (not when imported by tests).
if (process.argv[1] && /deviceConnectorSidecar/i.test(process.argv[1])) runDeviceConnectorSidecar();
