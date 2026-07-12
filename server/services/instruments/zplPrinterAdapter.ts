/**
 * doc 40 W5 (MTX-13) — ZPL label-printer adapter (Zebra, TCP 9100 raw / JetDirect).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Zebra printers (and most industrial label printers) accept ZPL II over a raw TCP
 * socket on port 9100 (the "RAW"/JetDirect port). This is a ONE-WAY, fire-and-forget
 * path: we open a socket, stream the ZPL bytes, wait for the OS write buffer to
 * drain, then close. The printer does NOT send a reply to a plain print job (status
 * queries use the separate SGD/`~HS` channel which we deliberately do NOT implement
 * here — this adapter's contract is "send a label", nothing more).
 *
 * HONESTY / NO-FAKE: print() opens a REAL socket and reports the byte count actually
 * written. When the endpoint is unreachable it REJECTS with a clear error — it never
 * pretends a label was printed. Because there is no application-level ack on port
 * 9100, `sent:true` means "bytes handed to the printer's TCP stack", NOT "label
 * physically printed" — that distinction is stated honestly and cannot be closed
 * without the status channel + real hardware (HW-FAT). Validated with a mock socket
 * that captures the bytes (see zplPrinterAdapter.test.ts).
 *
 * Pure Node `net.Socket` — NO dependency.
 * ════════════════════════════════════════════════════════════════════════════
 */
import net from "node:net";

/** Zebra raw/JetDirect print port. */
export const ZPL_DEFAULT_PORT = 9100;

export interface ZplEndpoint {
  host: string;
  /** Raw print port (default 9100). */
  port?: number;
  /** Connect/write timeout (ms). Default 5000, floor 500. */
  timeoutMs?: number;
}

function resolve(ep: ZplEndpoint) {
  return {
    host: ep.host,
    port: ep.port ?? ZPL_DEFAULT_PORT,
    timeoutMs: Math.max(500, ep.timeoutMs ?? 5000),
  };
}

/** Escape ZPL control characters (^ and ~) inside a field-data string. */
export function escapeZplField(text: string): string {
  // ZPL uses ^ and ~ as command prefixes; the safest portable approach for data is
  // to strip the control prefixes (a caret/tilde in a serial would corrupt the
  // stream). Newlines are removed (one label field is single-line here).
  return String(text ?? "").replace(/[\^~]/g, " ").replace(/[\r\n]+/g, " ");
}

export interface SerialLabelOptions {
  /** The serial / barcode payload (also encoded into the QR). Required. */
  serial: string;
  /** Optional human-readable title line above the serial. */
  title?: string;
  /** Field origin X in dots (default 30). */
  originX?: number;
  /** Field origin Y in dots (default 30). */
  originY?: number;
  /** QR magnification factor 1..10 (default 6). */
  qrMagnification?: number;
  /** Print quantity (^PQ). Default 1. */
  quantity?: number;
}

/**
 * Render a ZPL II label with a QR code (encoding `serial`) plus human-readable text.
 * Pure string builder — no I/O — so it is trivially unit-testable and reusable by
 * callers that want to inspect/deploy the template before printing.
 *
 * Layout: title (optional) on top, QR on the left, serial text to the right.
 */
export function renderSerialLabelZpl(opts: SerialLabelOptions): string {
  const serial = escapeZplField(opts.serial);
  if (!serial) throw new Error("renderSerialLabelZpl: serial is required");
  const x = opts.originX ?? 30;
  const y = opts.originY ?? 30;
  const mag = Math.min(10, Math.max(1, Math.round(opts.qrMagnification ?? 6)));
  const qty = Math.max(1, Math.round(opts.quantity ?? 1));
  const title = opts.title ? escapeZplField(opts.title) : "";

  const lines: string[] = ["^XA"];
  let cursorY = y;
  if (title) {
    lines.push(`^FO${x},${cursorY}^A0N,28,28^FD${title}^FS`);
    cursorY += 40;
  }
  // QR code (^BQ): model 2, magnification `mag`; ^FD prefix "LA," = auto error-correction.
  lines.push(`^FO${x},${cursorY}^BQN,2,${mag}^FDLA,${serial}^FS`);
  // Human-readable serial text to the right of the QR.
  lines.push(`^FO${x + 20 * mag + 40},${cursorY + 10}^A0N,30,30^FD${serial}^FS`);
  lines.push(`^PQ${qty}`);
  lines.push("^XZ");
  return lines.join("\n") + "\n";
}

export interface PrintResult {
  sent: boolean;
  /** Bytes handed to the printer's TCP stack (NOT a physical-print confirmation). */
  bytes: number;
}

export class ZplPrinter {
  private ep: ReturnType<typeof resolve>;
  constructor(endpoint: ZplEndpoint) {
    this.ep = resolve(endpoint);
  }

  /**
   * Cheap reachability probe: open the print port and immediately close. Never
   * throws — returns { reachable, error? }. (Does NOT print.)
   */
  async ping(): Promise<{ reachable: boolean; error?: string }> {
    try {
      const sock = await this.open();
      try { sock.end(); } catch { /* ignore */ }
      return { reachable: true };
    } catch (err) {
      return { reachable: false, error: (err as Error)?.message ?? String(err) };
    }
  }

  /** Open a socket under the timeout; rejects (honest) when unreachable. */
  private open(): Promise<net.Socket> {
    return new Promise<net.Socket>((resolve, reject) => {
      const sock = new net.Socket();
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        try { sock.destroy(); } catch { /* ignore */ }
        reject(new Error(`ZPL printer ${this.ep.host}:${this.ep.port} unreachable: ${err.message}`));
      };
      sock.setTimeout(this.ep.timeoutMs);
      sock.once("timeout", () => fail(new Error("connect timeout")));
      sock.once("error", fail);
      sock.connect(this.ep.port, this.ep.host, () => {
        if (settled) return;
        settled = true;
        sock.setTimeout(0);
        sock.removeListener("error", fail);
        sock.on("error", () => { /* post-connect reset during teardown — swallowed */ });
        resolve(sock);
      });
    });
  }

  /**
   * Send a raw ZPL job (fire-and-forget). Opens a socket, writes the bytes, waits
   * for the OS buffer to flush, then closes gracefully. Rejects when unreachable.
   *
   * NOTE (honest): the returned `sent:true` means bytes were written to the socket,
   * NOT that a label physically printed (port 9100 has no app-level ack).
   */
  async print(zpl: string): Promise<PrintResult> {
    const payload = Buffer.from(zpl, "utf8");
    const sock = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        // `write` callback fires when the data is handed to the kernel; that plus the
        // graceful `end()` below is the strongest delivery guarantee available on 9100.
        sock.write(payload, (err) => (err ? reject(err) : resolve()));
      });
      return { sent: true, bytes: payload.length };
    } finally {
      // Graceful FIN so the printer reads the full job before the socket closes.
      await new Promise<void>((resolve) => {
        try { sock.end(() => resolve()); } catch { resolve(); }
      });
    }
  }

  /** Convenience: render a serial/QR label and print it. */
  async printSerialLabel(opts: SerialLabelOptions): Promise<PrintResult> {
    return this.print(renderSerialLabelZpl(opts));
  }
}

export function createZplPrinter(endpoint: ZplEndpoint): ZplPrinter {
  return new ZplPrinter(endpoint);
}
