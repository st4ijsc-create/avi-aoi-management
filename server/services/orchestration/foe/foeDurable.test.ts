/**
 * FOE durable auto-resume gate test — SYNAPSE §5.1.6 (doc 33 I5).
 * The DB re-drive path is covered by the FOE DB-integration suite; here we assert the
 * flag gate: with FOE_DURABLE off, auto-resume is a pure no-op (never touches the DB).
 */
import { describe, it, expect, afterEach } from "vitest";

import { autoResumeInterruptedRuns, foeDurableEnabled } from "./foeEngine";

const prev = process.env.FOE_DURABLE;
afterEach(() => {
  if (prev === undefined) delete process.env.FOE_DURABLE;
  else process.env.FOE_DURABLE = prev;
});

describe("foeDurable — auto-resume gate", () => {
  it("FOE_DURABLE off (default) → no-op, no DB access", async () => {
    delete process.env.FOE_DURABLE;
    expect(foeDurableEnabled()).toBe(false);
    const r = await autoResumeInterruptedRuns([1, 2, 3]);
    expect(r).toEqual({ enabled: false, resumed: 0, runIds: [] });
  });

  it("foeDurableEnabled reads the flag", () => {
    process.env.FOE_DURABLE = "true";
    expect(foeDurableEnabled()).toBe(true);
    process.env.FOE_DURABLE = "false";
    expect(foeDurableEnabled()).toBe(false);
  });
});
