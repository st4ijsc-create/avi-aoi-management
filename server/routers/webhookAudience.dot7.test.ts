/**
 * doc 81 Đợt 7 task I3 — the `orchestration.run.finished` webhook reaches only subscribers whose scope contains the run's
 * factory. Two layers, measured separately:
 *   • the dispatcher (webhookRouter.sendWebhookEvent): with an AUDIENCE, a matching subscriber receives the event only when
 *     the audience answers exactly `true` for it — `false`, a throw or anything else ⇒ not delivered (fail-closed per
 *     subscriber); without one, every matching subscriber receives it (the existing events, unchanged);
 *   • the census: every place that emits an orchestration run event passes an audience, and only for a run that exists.
 * The audience itself (the webhook owner's scope against the run, real resolver) is measured on `_test` in
 * orchestrationScope.dot5.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const st = vi.hoisted(() => ({ configs: [] as Array<Record<string, unknown>>, inserts: 0 }));
vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: async () => st.configs.filter((c) => c.isEnabled !== false) }) }),
    insert: () => ({ values: async () => { st.inserts += 1; } }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
}));

import { sendWebhookEvent } from "./webhookRouter";

const cfg = (id: number, createdBy: number, events: string[] = ["orchestration.run.finished"]) => ({
  id, name: `wh${id}`, url: `http://127.0.0.1:9/hook${id}`, secret: null, events, headers: null, isEnabled: true,
  retryCount: 0, retryDelayMs: 1, timeoutMs: 500, createdBy,
});
let fetchSpy: ReturnType<typeof vi.fn>;
const posted = () => fetchSpy.mock.calls.map((c) => String(c[0]));
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  st.configs = [cfg(1, 11), cfg(2, 22), cfg(3, 33, ["*"]), cfg(4, 44, ["alert.triggered"])];
  st.inserts = 0;
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => "" }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe("doc 81 Đợt 7 I3 — webhookRouter.sendWebhookEvent with an audience (fail-closed per subscriber)", () => {
  it("★ only the subscribers the audience admits (exactly true) receive the event; '*' subscribers are judged too", async () => {
    await sendWebhookEvent("orchestration.run.finished", { runId: 7 }, async (wh) => wh.createdBy === 11 || wh.createdBy === 33);
    await settle();
    expect(posted().sort()).toEqual(["http://127.0.0.1:9/hook1", "http://127.0.0.1:9/hook3"]);
  });

  it("★ an audience that THROWS or answers anything but true ⇒ that subscriber gets nothing (undecidable ⇒ not delivered)", async () => {
    await sendWebhookEvent("orchestration.run.finished", { runId: 7 }, async (wh) => {
      if (wh.createdBy === 11) throw new Error("scope lookup failed");
      return (wh.createdBy === 22 ? "yes" : false) as never;
    });
    await settle();
    expect(posted()).toEqual([]);
  });

  it("control: no audience ⇒ every matching subscriber receives it (existing events unchanged)", async () => {
    await sendWebhookEvent("orchestration.run.finished", { runId: 7 });
    await settle();
    expect(posted().sort()).toEqual(["http://127.0.0.1:9/hook1", "http://127.0.0.1:9/hook2", "http://127.0.0.1:9/hook3"]);
  });
});

describe("doc 81 Đợt 7 I3 — census: every orchestration run event is emitted with an audience, only for a run that exists", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (f !== "node_modules") walk(p);
      } else if (f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes(".__mut__")) files.push(p);
    }
  };
  walk(join(ROOT, "server"));

  /** Every emit / sendWebhookEvent call naming an `orchestration.` event: its full argument text (paren-matched). */
  function orchestrationEventCalls(src: string): string[] {
    const out: string[] = [];
    for (const m of src.matchAll(/\b(emit|sendWebhookEvent)\s*\(/g)) {
      let depth = 0;
      let i = m.index! + m[0].length - 1;
      const from = i + 1;
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")" && --depth === 0) break;
      }
      const args = src.slice(from, i);
      if (/^\s*["'`]orchestration\./.test(args)) out.push(args);
    }
    return out;
  }
  /** The calls without a third (audience) argument at top level. */
  function withoutAudience(calls: string[]): string[] {
    return calls.filter((args) => {
      let depth = 0;
      let commas = 0;
      for (const ch of args) {
        if ("([{".includes(ch)) depth++;
        else if (")]}".includes(ch)) depth--;
        else if (ch === "," && depth === 0) commas++;
      }
      return commas < 2;
    });
  }

  it("★ every orchestration run event in server/ passes an audience; the API route emits only for an existing run", () => {
    const found: Array<{ file: string; args: string }> = [];
    for (const f of files) for (const args of orchestrationEventCalls(readFileSync(f, "utf8"))) found.push({ file: relative(ROOT, f).split("\\").join("/"), args });
    expect(found.map((x) => x.file)).toEqual(["server/api/v1/router.ts"]); // pinned: a new emitter ⇒ classify it here
    expect(withoutAudience(found.map((x) => x.args))).toEqual([]);
    const api = readFileSync(join(ROOT, "server/api/v1/router.ts"), "utf8");
    expect(api).toMatch(/if \(typeof result\.runId === "number"\) \{\s*void emit\(\s*"orchestration\.run\.finished",[\s\S]*?orchestrationRunWebhookAudience\(result\.runId\),/);
  });

  it("§self the instrument sees an emit without an audience", () => {
    expect(withoutAudience(orchestrationEventCalls(`void emit("orchestration.run.finished", { runId: 1, x: f(a, b) });`))).toHaveLength(1);
    expect(withoutAudience(orchestrationEventCalls(`void emit("orchestration.run.finished", { runId: 1 }, aud(1));`))).toHaveLength(0);
    expect(orchestrationEventCalls(`void emit("andon.raised", {});`)).toHaveLength(0);
  });
});
