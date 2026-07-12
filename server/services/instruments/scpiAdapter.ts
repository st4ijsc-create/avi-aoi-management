/**
 * doc 40 W5 (MTX-10) — SCPI-over-TCP instrument adapter (RF / FCT bench instruments).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SCPI (Standard Commands for Programmable Instruments, IEEE-488.2) is a TEXT
 * protocol. Most modern bench instruments (spectrum/network analyzers, RF signal
 * generators, DMMs, power supplies, electronic loads) expose it over a raw TCP
 * socket — the classic "SCPI raw socket" port is 5025 (Keysight/Agilent), some
 * vendors use 5000/5555. This adapter speaks that raw-socket dialect with a
 * pure-Node `net.Socket` (NO dependency).
 *
 * Protocol shape (well-specified, spec-verified — this is a PUBLIC standard):
 *   • Every message is a line terminated by `\n` (LF). Commands with a trailing
 *     `?` are QUERIES and produce exactly one reply line; commands without `?`
 *     just execute and produce NO reply.
 *   • `*IDN?` → "<manufacturer>,<model>,<serial>,<firmware>" (4 comma fields).
 *   • A measurement query (e.g. "MEAS:VOLT:DC?", "FETC?", "READ?") returns one or
 *     more comma-separated numbers.
 *
 * HONESTY / NO-FAKE: every method opens/uses a REAL TCP socket. When the endpoint
 * is unreachable connect()/query() REJECT with a clear error — never a fabricated
 * reading. This adapter is READ/QUERY oriented (identify + measure); it does not
 * open any gated actuation path. Validated with a mock SCPI server (see
 * scpiAdapter.test.ts) — NOT yet validated against real hardware (HW-FAT pending).
 * ════════════════════════════════════════════════════════════════════════════
 */
import net from "node:net";

/** The classic Keysight/Agilent SCPI raw-socket port. */
export const SCPI_DEFAULT_PORT = 5025;

export interface ScpiEndpoint {
  host: string;
  /** Raw-socket SCPI port (default 5025). */
  port?: number;
  /** Per-operation connect/read timeout (ms). Default 5000, floor 500. */
  timeoutMs?: number;
  /** Line terminator to append on write / split on read. Default "\n". */
  terminator?: string;
}

/** Parsed `*IDN?` identity. `raw` is the untouched reply for auditing. */
export interface ScpiIdentity {
  manufacturer: string;
  model: string;
  serial: string;
  firmware: string;
  raw: string;
}

function resolve(ep: ScpiEndpoint) {
  return {
    host: ep.host,
    port: ep.port ?? SCPI_DEFAULT_PORT,
    timeoutMs: Math.max(500, ep.timeoutMs ?? 5000),
    terminator: ep.terminator ?? "\n",
  };
}

/**
 * Parse a `*IDN?` reply into its four canonical fields. SCPI mandates
 * "manufacturer,model,serial,firmware" but tolerates extra/short fields — we map
 * positionally and default missing fields to "" (never throw). Exported for tests.
 */
export function parseIdn(raw: string): ScpiIdentity {
  const parts = String(raw ?? "").trim().split(",").map((s) => s.trim());
  return {
    manufacturer: parts[0] ?? "",
    model: parts[1] ?? "",
    serial: parts[2] ?? "",
    firmware: parts[3] ?? "",
    raw: String(raw ?? "").trim(),
  };
}

/**
 * Parse a numeric SCPI reply → number (single) or number[] (comma list). Handles
 * scientific notation (e.g. "1.234E-3") and NaN/Inf sentinels (9.9E37 = +overflow
 * per IEEE-488.2 → returned as-is for the caller to interpret). Returns null when
 * the reply has no parseable number. Exported for tests.
 */
export function parseScpiNumbers(raw: string): number | number[] | null {
  const finite = String(raw ?? "")
    .trim()
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (finite.length === 0) return null;
  return finite.length === 1 ? finite[0] : finite;
}

/**
 * A persistent SCPI session. Instruments carry state (ranges, trigger config) so a
 * single reused socket is the correct model — connect once, issue many commands,
 * disconnect. All commands are SERIALISED through an internal queue so replies are
 * never interleaved even under concurrent callers.
 */
export class ScpiClient {
  private ep: ReturnType<typeof resolve>;
  private sock: net.Socket | null = null;
  private connected = false;
  /** Tail of the op chain — every op awaits the previous one (single-writer). */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(endpoint: ScpiEndpoint) {
    this.ep = resolve(endpoint);
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Open the persistent socket. Rejects (honest) when unreachable. */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sock = new net.Socket();
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        try { sock.destroy(); } catch { /* ignore */ }
        reject(new Error(`SCPI ${this.ep.host}:${this.ep.port} unreachable: ${err.message}`));
      };
      sock.setTimeout(this.ep.timeoutMs);
      sock.once("timeout", () => fail(new Error("connect timeout")));
      sock.once("error", fail);
      sock.connect(this.ep.port, this.ep.host, () => {
        if (settled) return;
        settled = true;
        sock.setTimeout(0);
        sock.removeListener("error", fail);
        // Post-connect errors (peer reset during teardown) must not crash the process.
        sock.on("error", () => { /* swallowed — recorded via connected=false on close */ });
        sock.on("close", () => { this.connected = false; });
        this.sock = sock;
        this.connected = true;
        resolve();
      });
    });
  }

  /** Close the socket (graceful FIN). Idempotent. */
  async disconnect(): Promise<void> {
    const sock = this.sock;
    this.sock = null;
    this.connected = false;
    if (sock) {
      try { sock.end(); } catch { /* ignore */ }
    }
  }

  /** Enqueue an op so all socket traffic is strictly serialised (no interleave). */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.chain.then(op, op);
    // Keep the chain from rejecting future ops due to a prior failure.
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * Write a command WITHOUT expecting a reply (e.g. "*RST", "OUTP ON",
   * "CONF:VOLT:DC"). Throws when not connected.
   */
  write(command: string): Promise<void> {
    return this.enqueue(() => this.rawWrite(command));
  }

  private rawWrite(command: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.sock || !this.connected) return reject(new Error("SCPI: not connected"));
      const line = command.endsWith(this.ep.terminator) ? command : command + this.ep.terminator;
      this.sock.write(line, "utf8", (err) => (err ? reject(err) : resolve()));
    });
  }

  /**
   * Send a QUERY (a command producing one reply line) and return the trimmed reply
   * text. The caller is responsible for including the trailing `?`. Throws when not
   * connected or on read timeout.
   */
  query(command: string): Promise<string> {
    return this.enqueue(() => this.rawQuery(command));
  }

  private rawQuery(command: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const sock = this.sock;
      if (!sock || !this.connected) return reject(new Error("SCPI: not connected"));
      let buf = "";
      const term = this.ep.terminator;
      const to = setTimeout(() => {
        cleanup();
        reject(new Error(`SCPI query "${command}" timeout after ${this.ep.timeoutMs}ms`));
      }, this.ep.timeoutMs);
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const idx = buf.indexOf(term);
        if (idx === -1) return;
        cleanup();
        resolve(buf.slice(0, idx).trim());
      };
      const onErr = (err: Error) => { cleanup(); reject(err); };
      function cleanup() {
        clearTimeout(to);
        sock!.off("data", onData);
        sock!.off("error", onErr);
      }
      sock.on("data", onData);
      sock.once("error", onErr);
      const line = command.endsWith(term) ? command : command + term;
      sock.write(line, "utf8", (err) => { if (err) onErr(err); });
    });
  }

  /** `*IDN?` → parsed identity. */
  async identify(): Promise<ScpiIdentity> {
    return parseIdn(await this.query("*IDN?"));
  }

  /** `*RST` (reset to defaults) — no reply. */
  async reset(): Promise<void> {
    return this.write("*RST");
  }

  /**
   * Issue a measurement query and parse the reply into a number (or number[] for a
   * comma-separated result, e.g. an RF trace / multi-channel FCT read). Returns null
   * when the instrument returns a non-numeric reply. Convenience over query().
   */
  async measure(command: string): Promise<number | number[] | null> {
    // A SCPI query always contains '?' (possibly mid-command, e.g. "TRAC:DATA? TRACE1").
    // Only append '?' for a bare command stem like "MEAS:VOLT:DC".
    const q = command.includes("?") ? command : command + "?";
    return parseScpiNumbers(await this.query(q));
  }
}

export function createScpiClient(endpoint: ScpiEndpoint): ScpiClient {
  return new ScpiClient(endpoint);
}
