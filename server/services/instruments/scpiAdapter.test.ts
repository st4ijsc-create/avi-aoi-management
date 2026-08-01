/**
 * doc 40 W5 (MTX-10) — SCPI adapter tests (vitest, mock SCPI server, NO hardware).
 *
 * Spins up a LOCAL `net.Server` that speaks a minimal SCPI raw-socket dialect
 * (line-terminated; `?` = query → one reply line; non-query = execute, no reply),
 * so these run WITHOUT any bench instrument. HW-FAT (real RF/FCT box) is separate.
 */
import net from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import {
  ScpiClient,
  createScpiClient,
  parseIdn,
  parseScpiNumbers,
  SCPI_DEFAULT_PORT,
} from "./scpiAdapter";

/**
 * A tiny mock SCPI instrument. Answers each `?`-terminated command line with a
 * canned reply; records non-query commands (which produce NO reply). Replies are
 * looked up via `replies(cmd)`; a null/undefined return means "no reply" (execute).
 */
function startScpiServer(
  replies: (cmd: string) => string | null | undefined,
): Promise<{ port: number; received: string[]; close: () => Promise<void> }> {
  const received: string[] = [];
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.on("error", () => { /* client teardown reset — ignore in mock */ });
      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const cmd = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!cmd) continue;
          received.push(cmd);
          const reply = replies(cmd);
          if (reply != null) sock.write(reply + "\n");
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        received,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe("parseIdn", () => {
  it("splits the 4 canonical *IDN? fields", () => {
    const id = parseIdn("Keysight,N9020B,MY5555,A.20.15");
    expect(id.manufacturer).toBe("Keysight");
    expect(id.model).toBe("N9020B");
    expect(id.serial).toBe("MY5555");
    expect(id.firmware).toBe("A.20.15");
    expect(id.raw).toBe("Keysight,N9020B,MY5555,A.20.15");
  });
  it("tolerates short/whitespace replies without throwing", () => {
    const id = parseIdn("  Rohde&Schwarz , SMB100A ");
    expect(id.manufacturer).toBe("Rohde&Schwarz");
    expect(id.model).toBe("SMB100A");
    expect(id.serial).toBe("");
    expect(id.firmware).toBe("");
  });
});

describe("parseScpiNumbers", () => {
  it("single number", () => {
    expect(parseScpiNumbers("3.14159")).toBe(3.14159);
  });
  it("scientific notation", () => {
    expect(parseScpiNumbers("1.234E-3")).toBeCloseTo(0.001234, 9);
  });
  it("comma list → number[]", () => {
    expect(parseScpiNumbers("-40.2, -38.7, -35.0")).toEqual([-40.2, -38.7, -35.0]);
  });
  it("non-numeric → null", () => {
    expect(parseScpiNumbers("ERROR: no data")).toBeNull();
  });
});

describe("ScpiClient (mock SCPI server)", () => {
  it("default port is the Keysight raw-socket 5025", () => {
    expect(SCPI_DEFAULT_PORT).toBe(5025);
  });

  it("connect → identify() round-trips *IDN?", async () => {
    const srv = await startScpiServer((cmd) =>
      cmd === "*IDN?" ? "ACME,RF-9000,SN12345,1.0.7" : null,
    );
    cleanups.push(srv.close);
    const c = createScpiClient({ host: "127.0.0.1", port: srv.port });
    await c.connect();
    expect(c.isConnected()).toBe(true);
    const id = await c.identify();
    expect(id.model).toBe("RF-9000");
    expect(id.serial).toBe("SN12345");
    expect(srv.received).toContain("*IDN?");
    await c.disconnect();
    expect(c.isConnected()).toBe(false);
  });

  it("measure() parses a numeric FCT/RF reading", async () => {
    const srv = await startScpiServer((cmd) => {
      if (cmd === "MEAS:VOLT:DC?") return "4.998";
      return null;
    });
    cleanups.push(srv.close);
    const c = new ScpiClient({ host: "127.0.0.1", port: srv.port });
    await c.connect();
    // measure() adds the trailing '?' automatically.
    const v = await c.measure("MEAS:VOLT:DC");
    expect(v).toBeCloseTo(4.998, 3);
    await c.disconnect();
  });

  it("measure() parses a comma-separated RF trace → number[]", async () => {
    const srv = await startScpiServer((cmd) =>
      cmd === "TRAC:DATA? TRACE1" ? "-40.1,-42.3,-39.8" : null,
    );
    cleanups.push(srv.close);
    const c = new ScpiClient({ host: "127.0.0.1", port: srv.port });
    await c.connect();
    const trace = await c.measure("TRAC:DATA? TRACE1");
    expect(trace).toEqual([-40.1, -42.3, -39.8]);
    await c.disconnect();
  });

  it("write() executes (no reply) and serialises with subsequent query", async () => {
    const srv = await startScpiServer((cmd) => (cmd === "READ?" ? "1.0" : null));
    cleanups.push(srv.close);
    const c = new ScpiClient({ host: "127.0.0.1", port: srv.port });
    await c.connect();
    await c.write("*RST");
    await c.write("CONF:VOLT:DC 10");
    const r = await c.query("READ?");
    expect(r).toBe("1.0");
    // *RST + CONF... produced no replies; only READ? replied.
    expect(srv.received).toEqual(["*RST", "CONF:VOLT:DC 10", "READ?"]);
    await c.disconnect();
  });

  it("concurrent queries are serialised (replies not interleaved)", async () => {
    const srv = await startScpiServer((cmd) => {
      if (cmd === "Q1?") return "111";
      if (cmd === "Q2?") return "222";
      if (cmd === "Q3?") return "333";
      return null;
    });
    cleanups.push(srv.close);
    const c = new ScpiClient({ host: "127.0.0.1", port: srv.port });
    await c.connect();
    const [a, b, d] = await Promise.all([c.query("Q1?"), c.query("Q2?"), c.query("Q3?")]);
    expect([a, b, d]).toEqual(["111", "222", "333"]);
    await c.disconnect();
  });

  it("HONEST: query on an unreachable endpoint rejects (never fabricated)", async () => {
    const c = new ScpiClient({ host: "127.0.0.1", port: 1, timeoutMs: 500 });
    await expect(c.connect()).rejects.toThrow(/unreachable|refused|ECONN|timeout/i);
  });

  it("query throws when not connected", async () => {
    const c = new ScpiClient({ host: "127.0.0.1", port: 5025 });
    await expect(c.query("*IDN?")).rejects.toThrow(/not connected/);
  });

  it("query read-timeout rejects when the instrument never replies", async () => {
    // Server accepts the connection but never answers → read timeout.
    const srv = await startScpiServer(() => null);
    cleanups.push(srv.close);
    const c = new ScpiClient({ host: "127.0.0.1", port: srv.port, timeoutMs: 300 });
    await c.connect();
    await expect(c.query("*IDN?")).rejects.toThrow(/timeout/i);
    await c.disconnect();
  });
});
