/**
 * Doc 80 Đợt 0 — Task 5 (Phụ lục C §3 IR-02): lint badge/KPI has THREE states.
 * The audit measured `lint?.ok ?? true` ⇒ an HTTP 431 / network error still showed
 * "Lint OK / Pass". Now: ok · errors · unreadable (error or loading) — and unreadable
 * locks Save/Build.
 */
import { describe, it, expect } from "vitest";
import { deriveIrLintState } from "./irLintState";

describe("IR-02 — deriveIrLintState", () => {
  it("query error (e.g. HTTP 431) ⇒ unreadable, locked, reason carries the message", () => {
    const s = deriveIrLintState({ data: undefined, error: new Error("HTTP 431"), isFetching: false }, true);
    expect(s.status).toBe("unreadable");
    expect(s.reason).toBe("error");
    expect(s.errorMessage).toBe("HTTP 431");
    expect(s.canSaveOrBuild).toBe(false);
  });

  it("final wave item 1 — the error is TRANSLATED (mapTrpcError), not the raw message", () => {
    // A raw SQL-shaped message is exactly what the translator must never show; `mapTrpcError`
    // replaces it with the generic client sentence. Reverting to `q.error.message` fails here.
    const leak = new Error("Failed query: select * from ir_flows where id = 1");
    const s = deriveIrLintState({ data: undefined, error: leak, isFetching: false }, true);
    expect(s.status).toBe("unreadable");
    expect(s.errorMessage).toBeTruthy();
    expect(s.errorMessage).not.toContain("Failed query");
    expect(s.errorMessage).not.toContain("select *");
    // A zod-shaped message (JSON issues array) is summarised, not dumped as JSON.
    const zod = new Error(JSON.stringify([{ path: ["flow", "blocks"], message: "Required" }]));
    const z = deriveIrLintState({ data: undefined, error: zod, isFetching: false }, true);
    expect(z.errorMessage).not.toMatch(/^\[/);
    expect(z.errorMessage).toContain("blocks");
  });

  it("error wins even over stale data that said ok", () => {
    const s = deriveIrLintState({ data: { ok: true }, error: new Error("boom"), isFetching: false }, true);
    expect(s.status).toBe("unreadable");
    expect(s.canSaveOrBuild).toBe(false);
  });

  it("loading / fetching / no data yet ⇒ unreadable (loading), locked", () => {
    for (const q of [
      { data: undefined, error: null, isFetching: true },
      { data: { ok: true }, error: null, isFetching: true },
      { data: undefined, error: null, isFetching: false },
    ]) {
      const s = deriveIrLintState(q, true);
      expect(s.status).toBe("unreadable");
      expect(s.reason).toBe("loading");
      expect(s.canSaveOrBuild).toBe(false);
    }
  });

  it("debounced input not yet linted (result is for an older draft) ⇒ unreadable (loading)", () => {
    const s = deriveIrLintState({ data: { ok: true }, error: null, isFetching: false }, false);
    expect(s.status).toBe("unreadable");
    expect(s.canSaveOrBuild).toBe(false);
  });

  it("data ok ⇒ ok; data not ok ⇒ errors (both readable ⇒ Save/Build allowed)", () => {
    const ok = deriveIrLintState({ data: { ok: true }, error: null, isFetching: false }, true);
    expect(ok).toMatchObject({ status: "ok", reason: null, canSaveOrBuild: true });
    const bad = deriveIrLintState({ data: { ok: false }, error: null, isFetching: false }, true);
    expect(bad).toMatchObject({ status: "errors", reason: null, canSaveOrBuild: true });
  });
});
