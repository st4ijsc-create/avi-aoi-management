#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// St4iDeviceClient (Node.js) — SDK tham chiếu cho gateway/PC-based máy nội bộ
// đẩy dữ liệu vào ST4I AVI/AOI Management theo doc 57 (Process Feed v1) + doc 56.
//
// Chỉ dùng `fetch` có sẵn trong Node >= 18 (không cần dependency).
//
// KHÓA & ENDPOINT:
//   Ingest:  Authorization: Bearer <mk_...>  (hoặc X-API-Key)
//     POST {SERVER}/api/v1/ingest/process-result   RESULT (Feed v1)
//     POST {SERVER}/api/v1/ingest/telemetry        TELEMETRY (CanonicalSample[])
//   Heartbeat: X-API-Key: <mk_...>
//     POST {SERVER}/api/machine/heartbeat
//   Bootstrap (1 lần, token là credential — server dùng superjson):
//     POST {SERVER}/api/trpc/machine.enroll        (met_ -> mk_)
//     POST {SERVER}/api/trpc/machine.claimKey      (mct_ -> mk_)
//
// Dev TLS self-signed: chạy với  NODE_TLS_REJECT_UNAUTHORIZED=0
// ══════════════════════════════════════════════════════════════════════════
import { appendFileSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";

/** RFC 3339 kèm offset tường minh. `toISOString()` trả hậu tố 'Z' (= offset UTC hợp lệ). */
export function isoNow() {
  return new Date().toISOString(); // vd 2026-07-17T07:03:00.480Z  (Z là offset hợp lệ — §4)
}

export class St4iApiError extends Error {
  constructor(message, { status = 0, code = "", payload = null } = {}) {
    super(message);
    this.name = "St4iApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}
export class St4iNetworkError extends Error {
  constructor(message) { super(message); this.name = "St4iNetworkError"; }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class St4iDeviceClient {
  static SCHEMA_VERSION = "1.0";

  constructor({
    serverUrl,
    mkKey = process.env.ST4I_MK_KEY || null,
    machineCode = null,
    serialNumber = null,
    queuePath = null,          // đường dẫn file JSONL -> hàng đợi BỀN qua restart; null -> RAM
    timeoutMs = 10000,
    maxRetries = 4,
    backoffBase = 500,
    backoffMax = 30000,
  } = {}) {
    if (!serverUrl) throw new Error("serverUrl là bắt buộc");
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.mkKey = mkKey;
    this.machineCode = machineCode;
    this.serialNumber = serialNumber;
    this.queuePath = queuePath;
    this.timeoutMs = timeoutMs;
    this.maxRetries = Math.max(0, maxRetries);
    this.backoffBase = backoffBase;
    this.backoffMax = backoffMax;
    this._memQueue = [];
  }

  // ── HTTP tầng thấp ──────────────────────────────────────────────────────
  async _http(method, url, headers, body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const resp = await fetch(url, { method, headers, body, signal: ctrl.signal });
      const text = await resp.text();
      let data = {};
      if (text) { try { data = JSON.parse(text); } catch { data = {}; } }
      return { status: resp.status, data };
    } catch (e) {
      throw new St4iNetworkError(`Không gọi được ${url}: ${e.message}`);
    } finally {
      clearTimeout(t);
    }
  }

  _authHeaders() {
    if (!this.mkKey) throw new Error("Chưa có mk_. Gọi enroll()/claim() hoặc truyền mkKey.");
    return { Authorization: `Bearer ${this.mkKey}`, "X-API-Key": this.mkKey };
  }

  // ── Bootstrap tRPC (superjson) ──────────────────────────────────────────
  async _trpcMutation(procedure, input) {
    const url = `${this.serverUrl}/api/trpc/${procedure}`;
    const body = JSON.stringify({ json: input }); // superjson: bọc { json: ... }
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    let lastErr = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res;
      try {
        res = await this._http("POST", url, headers, body);
      } catch (e) { lastErr = e; await sleep(this._backoff(attempt)); continue; }

      const { status, data } = res;
      const err = data && data.error;
      if (status >= 400 || err) {
        const j = (err && err.json) || err || {};
        throw new St4iApiError(j.message || `tRPC ${procedure} lỗi (HTTP ${status})`, { status, payload: data });
      }
      let result = data && data.result && data.result.data; // mở result.data
      if (result && typeof result === "object" && "json" in result) result = result.json; // mở superjson
      return result || {};
    }
    throw new St4iNetworkError(`tRPC ${procedure} thất bại: ${lastErr}`);
  }

  async enroll(enrollmentToken, { serialNumber = null, machineInfo = null } = {}) {
    const serial = serialNumber || this.serialNumber;
    if (!serial) throw new Error("enroll cần serialNumber");
    const input = { serialNumber: serial, enrollmentToken };
    if (machineInfo) input.machineInfo = machineInfo;
    const data = await this._trpcMutation("machine.enroll", input);
    this._absorb(data);
    return data;
  }

  async claim(claimToken, { serialNumber = null } = {}) {
    const serial = serialNumber || this.serialNumber;
    if (!serial) throw new Error("claim cần serialNumber");
    const data = await this._trpcMutation("machine.claimKey", { serialNumber: serial, claimToken });
    this._absorb(data);
    return data;
  }

  _absorb(data) {
    if (data && data.apiKey) this.mkKey = data.apiKey;
    if (data && data.code && !this.machineCode) this.machineCode = data.code;
  }

  saveKey(path) {
    if (!this.mkKey) throw new Error("Chưa có mk_ để lưu.");
    writeFileSync(path, JSON.stringify({ mkKey: this.mkKey, machineCode: this.machineCode }), { mode: 0o600 });
  }
  loadKey(path) {
    if (!existsSync(path)) return false;
    const o = JSON.parse(readFileSync(path, "utf8"));
    this.mkKey = o.mkKey || this.mkKey;
    this.machineCode = o.machineCode || this.machineCode;
    return Boolean(this.mkKey);
  }

  // ── RESULT ──────────────────────────────────────────────────────────────
  async submitProcessResult({
    serialNumber, stepType, result,
    metrics = null, waveforms = null, recipe = null,
    idempotencyKey = null, ts = null, machineCode = null, extra = null,
  }) {
    result = String(result).toLowerCase().trim();
    if (!["pass", "fail", "warn", "skip"].includes(result))
      throw new Error(`result phải là pass|fail|warn|skip, nhận '${result}'`);
    const mc = machineCode || this.machineCode;
    if (!idempotencyKey) idempotencyKey = `${mc || "dev"}:${stepType}:${cryptoRandom()}`;

    const payload = {
      schemaVersion: St4iDeviceClient.SCHEMA_VERSION,
      serialNumber, stepType, result,
      ts: ts || isoNow(),
      idempotencyKey,
    };
    if (mc) payload.machineCode = mc;
    if (recipe) payload.recipe = recipe;
    if (metrics) payload.metrics = metrics;
    if (waveforms) payload.waveforms = waveforms;
    if (extra) Object.assign(payload, extra);

    return this._sendWithRetry("process", "/api/v1/ingest/process-result", payload);
  }

  // ── TELEMETRY ───────────────────────────────────────────────────────────
  async submitTelemetry(samples) {
    const norm = samples.map((s) => {
      const item = Array.isArray(s)
        ? { metric: s[0], value: s[1], ...(s[2] != null ? { unit: s[2] } : {}) }
        : { ...s };
      if (item.ts == null) item.ts = isoNow();
      if (this.machineCode && item.deviceId == null && item.machineId == null)
        item.deviceId = this.machineCode;
      return item;
    });
    if (norm.length === 0) throw new Error("submitTelemetry cần ít nhất 1 sample.");
    return this._sendWithRetry("telemetry", "/api/v1/ingest/telemetry", { samples: norm });
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────
  async heartbeat() {
    if (!this.mkKey) throw new Error("heartbeat cần mk_.");
    const url = `${this.serverUrl}/api/machine/heartbeat`;
    const headers = { "Content-Type": "application/json", "X-API-Key": this.mkKey };
    const { status, data } = await this._http("POST", url, headers, JSON.stringify({ apiKey: this.mkKey }));
    if (status >= 400) throw new St4iApiError((data && data.message) || `Heartbeat lỗi (HTTP ${status})`, { status, payload: data });
    return data;
  }

  // ── Config-sync — kéo recipe/cấu hình (server cần CONFIG_SYNC_GENERIC_ENABLED) ──
  //   Vòng lặp:  check → (khác cache) → get → apply → ack.  Auth: mk_ (scope equipment:read).
  async _cfgGet(path, params) {
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)),
    ).toString();
    const { status, data } = await this._http("GET", `${this.serverUrl}${path}?${q}`, this._authHeaders(), null);
    if (status >= 400 || (data && data.success === false))
      throw new St4iApiError((data && data.message) || `config-sync lỗi (HTTP ${status})`, { status, payload: data });
    return data;
  }

  /** Kiểm version cấu hình active (nhẹ). configKind ∈ recipe|device_settings|points|model. */
  async checkConfig({ configKind = "recipe", configCode = null, productModelCode = null, variantCode = null } = {}) {
    return this._cfgGet("/api/machine/config-sync/check",
      { configKind, machineCode: this.machineCode, configCode, productModelCode, variantCode });
  }

  /** Tải payload cấu hình đầy đủ + checksum. Cùng tham số checkConfig(). */
  async getConfig({ configKind = "recipe", configCode = null, productModelCode = null, variantCode = null } = {}) {
    return this._cfgGet("/api/machine/config-sync/get",
      { configKind, machineCode: this.machineCode, configCode, productModelCode, variantCode });
  }

  /** Báo server cấu hình máy ĐÃ ÁP. Trả {success, machineId, configKind, driftState}. */
  async ackConfig({ configKind, code = null, version = null, checksum = null }) {
    const payload = { configKind };
    if (this.machineCode) payload.machineCode = this.machineCode;
    if (code != null) payload.code = code;
    if (version != null) payload.version = version;
    if (checksum != null) payload.checksum = checksum;
    const headers = { "Content-Type": "application/json", ...this._authHeaders() };
    const { status, data } = await this._http("POST", `${this.serverUrl}/api/machine/config-sync/ack`, headers, JSON.stringify(payload));
    if (status >= 400 || (data && data.success === false))
      throw new St4iApiError((data && data.message) || `ackConfig lỗi (HTTP ${status})`, { status, payload: data });
    return data;
  }

  /**
   * Vòng lặp pull hoàn chỉnh: check → (nếu version khác cachedVersion) get → applyFn(cfg) → ack.
   * applyFn(cfg) nạp cfg.payload vào chương trình máy, PHẢI trả true khi áp thành công.
   * Trả {changed, version, driftState?}.
   */
  async syncConfig(applyFn, { configKind = "recipe", cachedVersion = null, ...selectors } = {}) {
    const chk = await this.checkConfig({ configKind, ...selectors });
    if (chk.version != null && String(chk.version) === String(cachedVersion))
      return { changed: false, version: chk.version };
    const cfg = await this.getConfig({ configKind, ...selectors });
    if (!(await applyFn(cfg))) return { changed: false, version: chk.version, applied: false };
    const ack = await this.ackConfig({ configKind, code: cfg.code, version: cfg.version, checksum: cfg.checksum });
    return { changed: true, version: cfg.version, driftState: ack.driftState };
  }

  // ── Gửi có retry + hàng đợi local ───────────────────────────────────────
  async _sendWithRetry(kind, path, payload) {
    if (this._queueLen() > 0) { try { await this.flushQueue(); } catch { /* mạng kém — thử tiếp */ } }

    const url = `${this.serverUrl}${path}`;
    const headers = { "Content-Type": "application/json", ...this._authHeaders() };
    const body = JSON.stringify(payload);

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res;
      try {
        res = await this._http("POST", url, headers, body);
      } catch (e) {
        if (attempt < this.maxRetries) { await sleep(this._backoff(attempt)); continue; }
        this._enqueue(kind, path, payload);
        throw new St4iNetworkError(`${path}: mất mạng, đã xếp vào hàng đợi. (${e.message})`);
      }

      const { status, data } = res;
      if (status >= 200 && status < 300) {
        if (data && data.ok && "data" in data) return data.data;
        return data;
      }
      if (RETRYABLE.has(status)) {
        if (attempt < this.maxRetries) { await sleep(this._backoff(attempt)); continue; }
        this._enqueue(kind, path, payload);
        throw new St4iNetworkError(`${path}: server tạm lỗi HTTP ${status} — đã xếp hàng.`);
      }
      // 4xx còn lại = lỗi vĩnh viễn -> KHÔNG xếp hàng.
      const e = (data && data.error) || {};
      throw new St4iApiError(e.message || `${path} bị từ chối (HTTP ${status})`, { status, code: e.code || "", payload: data });
    }
    throw new St4iApiError(`${path}: hết retry`, {});
  }

  // ── Hàng đợi ────────────────────────────────────────────────────────────
  _enqueue(kind, path, payload) {
    const entry = { kind, path, payload, queuedAt: isoNow() };
    if (this.queuePath) appendFileSync(this.queuePath, JSON.stringify(entry) + "\n");
    else this._memQueue.push(entry);
  }
  _queueLen() {
    if (this.queuePath) return existsSync(this.queuePath)
      ? readFileSync(this.queuePath, "utf8").split("\n").filter((l) => l.trim()).length : 0;
    return this._memQueue.length;
  }
  _drain() {
    if (this.queuePath) {
      if (!existsSync(this.queuePath)) return [];
      const lines = readFileSync(this.queuePath, "utf8").split("\n").filter((l) => l.trim());
      try { rmSync(this.queuePath); } catch { /* ignore */ }
      return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }
    const d = this._memQueue; this._memQueue = []; return d;
  }
  async flushQueue() {
    const pending = this._drain();
    if (pending.length === 0) return { sent: 0, kept: 0 };
    let sent = 0; const kept = [];
    const headers = { "Content-Type": "application/json", ...this._authHeaders() };
    for (const entry of pending) {
      let res;
      try { res = await this._http("POST", `${this.serverUrl}${entry.path}`, headers, JSON.stringify(entry.payload)); }
      catch { kept.push(entry); continue; }        // vẫn mất mạng -> giữ
      if ((res.status >= 200 && res.status < 300) || res.status === 409) sent++;   // 409 idempotent -> đã xử lý
      else if (RETRYABLE.has(res.status)) kept.push(entry);
      else sent++;                                  // 4xx payload sai -> bỏ
    }
    for (const e of kept) this._enqueue(e.kind, e.path, e.payload);
    return { sent, kept: kept.length };
  }

  _backoff(attempt) { return Math.min(this.backoffBase * 2 ** attempt, this.backoffMax); }
}

function cryptoRandom() {
  // 16 hex ngẫu nhiên (đủ cho idempotencyKey khi caller không tự đặt).
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

// ── Demo khi chạy trực tiếp: `node st4i_device_client.mjs` ─────────────────
// Đọc cấu hình từ ENV: ST4I_SERVER, ST4I_MK_KEY (hoặc ST4I_CLAIM_TOKEN + ST4I_SERIAL).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("st4i_device_client.mjs")) {
  const server = process.env.ST4I_SERVER || "https://localhost:5000";
  const client = new St4iDeviceClient({
    serverUrl: server,
    machineCode: process.env.ST4I_MACHINE_CODE || "IOT-WS3",
    serialNumber: process.env.ST4I_SERIAL || "IOT-WS3-DEVICE",
    queuePath: process.env.ST4I_QUEUE_FILE || "st4i_node_queue.jsonl",
  });

  (async () => {
    try {
      if (!client.mkKey && process.env.ST4I_CLAIM_TOKEN) {
        console.log("[bootstrap] claim mct_ -> mk_ ...");
        await client.claim(process.env.ST4I_CLAIM_TOKEN);
      }
      if (!client.mkKey && process.env.ST4I_ENROLL_TOKEN) {
        console.log("[bootstrap] enroll met_ -> mk_ ...");
        await client.enroll(process.env.ST4I_ENROLL_TOKEN, {
          machineInfo: { name: "IOT WS3", machineType: "AUTOMATION" },
        });
      }
      if (!client.mkKey) {
        console.error("Chưa có mk_. Đặt ST4I_MK_KEY, hoặc ST4I_CLAIM_TOKEN/ST4I_ENROLL_TOKEN + ST4I_SERIAL.");
        process.exit(1);
      }

      await client.heartbeat().then(() => console.log("[hb] online")).catch((e) => console.log("[hb]", e.message));

      const data = await client.submitTelemetry([
        { metric: "temperature", value: 27.4, unit: "°C", quality: "good" },
        { metric: "humidity", value: 61.2, unit: "%RH", quality: "good" },
      ]);
      console.log("[telemetry] accepted:", data);
    } catch (e) {
      console.error(`${e.name}: ${e.message}`);
      process.exit(1);
    }
  })();
}
