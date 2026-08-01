/**
 * Reference plugin sidecar — SYNAPSE §6.4.3 (doc 33 §11 · P4 completion).
 *
 * A minimal out-of-process connector that speaks the JSON-lines protocol: it reads {id,method,params}
 * requests on stdin and writes {id,result|error} responses on stdout. A REAL connector (OT bridge,
 * vendor-DLL wrapper) implements the same protocol; this proves the wire and is what an operator can
 * point PLUGIN_SIDECAR_CMD at (compiled) to smoke-test supervision + transport end-to-end.
 *
 * Methods: ping → "pong" · echo → params · health → {ok,ts} · (unknown) → error.
 */
export interface SidecarRequest {
  id: number;
  method: string;
  params?: unknown;
}
export interface SidecarResponse {
  id: number;
  result?: unknown;
  error?: string;
}

/** Pure request handler (unit-testable). */
export function handleSidecarRequest(req: SidecarRequest): SidecarResponse {
  switch (req.method) {
    case "ping":
      return { id: req.id, result: "pong" };
    case "echo":
      return { id: req.id, result: req.params };
    case "health":
      return { id: req.id, result: { ok: true, ts: Date.now() } };
    default:
      return { id: req.id, error: `unknown method: ${req.method}` };
  }
}

/** Wire stdin → handler → stdout as newline-delimited JSON (run when executed directly). */
function main(): void {
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
        process.stdout.write(JSON.stringify(handleSidecarRequest(req)) + "\n");
      } catch {
        /* ignore a malformed request line */
      }
    }
  });
}

// Only run the stdio loop when this file is the process entrypoint (not when imported by tests).
if (process.argv[1] && /sampleSidecar/i.test(process.argv[1])) main();
