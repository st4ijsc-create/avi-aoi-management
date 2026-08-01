/**
 * Plugin sidecar transport tests — SYNAPSE §6.4.3 (doc 33 §11 · P4 completion).
 *
 * Codec correctness over in-memory streams (deterministic), a REAL child-process round-trip via
 * nodeSpawner + transport, the sample sidecar handler, and bootstrap flag-gating.
 */
import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";

import { StdioTransport } from "./stdioTransport";
import { spawnSidecarWithTransport } from "./nodeSpawner";
import { handleSidecarRequest } from "./sampleSidecar";
import { pluginSidecarEnabled, startPluginSidecar, stopPluginSidecar } from "./pluginSidecarBootstrap";

/** An inline node echo sidecar (JSON-lines) so the real-spawn test needs no external file. */
const ECHO =
  "let b='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{b+=c;let i;" +
  "while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i).trim();b=b.slice(i+1);if(!l)continue;" +
  "try{const r=JSON.parse(l);const res=r.method==='ping'?{id:r.id,result:'pong'}:" +
  "r.method==='echo'?{id:r.id,result:r.params}:{id:r.id,error:'unknown method'};" +
  "process.stdout.write(JSON.stringify(res)+'\\n');}catch(e){}}});";

describe("StdioTransport (JSON-lines codec)", () => {
  function wireEcho(): StdioTransport {
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const t = new StdioTransport(toChild, fromChild);
    toChild.setEncoding("utf8");
    let b = "";
    toChild.on("data", (c: string) => {
      b += c;
      let i: number;
      while ((i = b.indexOf("\n")) >= 0) {
        const line = b.slice(0, i).trim();
        b = b.slice(i + 1);
        if (!line) continue;
        const req = JSON.parse(line);
        fromChild.write(JSON.stringify({ id: req.id, result: req.params ?? req.method }) + "\n");
      }
    });
    return t;
  }

  it("correlates concurrent responses by id", async () => {
    const t = wireEcho();
    const [a, b] = await Promise.all([t.request("m1", "p1"), t.request("m2", "p2")]);
    expect(a).toBe("p1");
    expect(b).toBe("p2");
    expect(t.inFlight()).toBe(0);
  });

  it("rejects on a sidecar error response", async () => {
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const t = new StdioTransport(toChild, fromChild);
    toChild.setEncoding("utf8");
    toChild.on("data", (c: string) => {
      const req = JSON.parse(String(c).trim());
      fromChild.write(JSON.stringify({ id: req.id, error: "boom" }) + "\n");
    });
    await expect(t.request("x")).rejects.toThrow("boom");
  });

  it("times out a silent sidecar and clears the pending entry", async () => {
    const t = new StdioTransport(new PassThrough(), new PassThrough(), { timeoutMs: 30 });
    await expect(t.request("x")).rejects.toThrow(/timeout/);
    expect(t.inFlight()).toBe(0);
  });

  it("reassembles a response split across chunks", async () => {
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const t = new StdioTransport(toChild, fromChild);
    toChild.setEncoding("utf8");
    toChild.on("data", (c: string) => {
      const req = JSON.parse(String(c).trim());
      const msg = JSON.stringify({ id: req.id, result: "ok" }) + "\n";
      fromChild.write(msg.slice(0, 4)); // partial
      fromChild.write(msg.slice(4)); // rest incl. newline
    });
    expect(await t.request("x")).toBe("ok");
  });
});

describe("nodeSpawner + real child round-trip", () => {
  it("pings and echoes a real out-of-process sidecar", async () => {
    const { handle, transport } = spawnSidecarWithTransport({ command: process.execPath, args: ["-e", ECHO] });
    try {
      expect(await transport.request("ping")).toBe("pong");
      expect(await transport.request("echo", { a: 1, b: [2, 3] })).toEqual({ a: 1, b: [2, 3] });
    } finally {
      transport.close();
      handle.kill();
    }
  });
});

describe("sampleSidecar handler", () => {
  it("handles ping / echo / health / unknown", () => {
    expect(handleSidecarRequest({ id: 1, method: "ping" }).result).toBe("pong");
    expect(handleSidecarRequest({ id: 2, method: "echo", params: { x: 5 } }).result).toEqual({ x: 5 });
    expect((handleSidecarRequest({ id: 3, method: "health" }).result as { ok: boolean }).ok).toBe(true);
    expect(handleSidecarRequest({ id: 4, method: "nope" }).error).toMatch(/unknown/);
  });
});

describe("pluginSidecarBootstrap", () => {
  it("gated off by default; start is a no-op, stop is idempotent", () => {
    expect(pluginSidecarEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(pluginSidecarEnabled({ PLUGIN_SIDECAR: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    delete process.env.PLUGIN_SIDECAR;
    expect(() => startPluginSidecar()).not.toThrow();
    expect(() => stopPluginSidecar()).not.toThrow();
  });
});
