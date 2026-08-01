/**
 * doc 40 W5 (MTX-13) — ZPL printer adapter tests (vitest, mock socket, NO hardware).
 *
 * A LOCAL `net.Server` on an ephemeral port captures the raw bytes the adapter
 * writes (there is no application-level reply on port 9100). HW-FAT (real Zebra
 * printer) is separate — `sent:true` here means "bytes written", not "label printed".
 */
import net from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import {
  ZplPrinter,
  createZplPrinter,
  renderSerialLabelZpl,
  escapeZplField,
  ZPL_DEFAULT_PORT,
} from "./zplPrinterAdapter";

/** A mock raw-print server that accumulates every byte it receives. */
function startPrintServer(): Promise<{ port: number; getReceived: () => string; close: () => Promise<void> }> {
  let received = "";
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.on("error", () => { /* client teardown reset — ignore in mock */ });
      sock.on("data", (chunk) => { received += chunk.toString("utf8"); });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        getReceived: () => received,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe("renderSerialLabelZpl", () => {
  it("wraps a QR + serial text between ^XA/^XZ", () => {
    const zpl = renderSerialLabelZpl({ serial: "SN-0001", title: "AVI Line 3" });
    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.trimEnd().endsWith("^XZ")).toBe(true);
    expect(zpl).toContain("^BQN,2,");        // QR command
    expect(zpl).toContain("^FDLA,SN-0001^FS"); // QR data w/ auto error-correction
    expect(zpl).toContain("AVI Line 3");      // title
    expect(zpl).toContain("^PQ1");            // default quantity
  });

  it("honours quantity and throws on empty serial", () => {
    expect(renderSerialLabelZpl({ serial: "X", quantity: 5 })).toContain("^PQ5");
    expect(() => renderSerialLabelZpl({ serial: "" })).toThrow(/serial is required/);
  });
});

describe("escapeZplField", () => {
  it("strips ^ and ~ control prefixes and newlines", () => {
    expect(escapeZplField("A^B~C\nD")).toBe("A B C D");
  });
});

describe("ZplPrinter (mock socket)", () => {
  it("default port is the JetDirect raw 9100", () => {
    expect(ZPL_DEFAULT_PORT).toBe(9100);
  });

  it("print() writes the raw ZPL bytes to the socket", async () => {
    const srv = await startPrintServer();
    cleanups.push(srv.close);
    const p = createZplPrinter({ host: "127.0.0.1", port: srv.port });
    const res = await p.print("^XA^FO10,10^A0N,30,30^FDhello^FS^XZ");
    expect(res.sent).toBe(true);
    expect(res.bytes).toBeGreaterThan(0);
    // Allow the write to land on the server.
    await new Promise((r) => setTimeout(r, 50));
    expect(srv.getReceived()).toContain("^FDhello^FS");
  });

  it("printSerialLabel() renders + sends a QR label", async () => {
    const srv = await startPrintServer();
    cleanups.push(srv.close);
    const p = new ZplPrinter({ host: "127.0.0.1", port: srv.port });
    const res = await p.printSerialLabel({ serial: "PCB-42" });
    expect(res.sent).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    const got = srv.getReceived();
    expect(got).toContain("^FDLA,PCB-42^FS");
    expect(got).toContain("^XZ");
  });

  it("ping() reports reachable when the print port answers", async () => {
    const srv = await startPrintServer();
    cleanups.push(srv.close);
    const p = new ZplPrinter({ host: "127.0.0.1", port: srv.port });
    const r = await p.ping();
    expect(r.reachable).toBe(true);
  });

  it("HONEST: print to an unreachable printer rejects (never fabricated)", async () => {
    const p = new ZplPrinter({ host: "127.0.0.1", port: 1, timeoutMs: 500 });
    await expect(p.print("^XA^XZ")).rejects.toThrow(/unreachable|refused|ECONN|timeout/i);
  });

  it("ping() on an unreachable printer returns reachable:false, never throws", async () => {
    const p = new ZplPrinter({ host: "127.0.0.1", port: 1, timeoutMs: 500 });
    const r = await p.ping();
    expect(r.reachable).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
