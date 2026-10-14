/**
 * doc 81 Đợt 12 task P fix 1 (I-1) — the cross-replica STOP sync is started on EVERY central process, whatever OT_GATEWAY_ENABLED
 * says: central's pending-STOP sweep and the edge-fallback STOP send real STOPs with the gateway off, and those must be broadcast.
 * A source check of the boot file (server/_core/index.ts — the controller's integration hunk): the start call exists and no
 * OT_GATEWAY_ENABLED condition encloses it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("I-1 — otStopEpochSync starts on every central process", () => {
  it("★ index.ts calls startOtStopEpochSync, not under an OT_GATEWAY_ENABLED condition", () => {
    // DOT12_BOOT_FILE: a copy of the boot file, for RED runs only
    const src = readFileSync(process.env.DOT12_BOOT_FILE || path.resolve(__dirname, "../../_core/index.ts"), "utf8");
    const at = src.indexOf("startOtStopEpochSync");
    expect(at).toBeGreaterThan(0);
    // the enclosing statement: from the previous blank line / statement end to the call
    const before = src.slice(Math.max(0, at - 1_200), at);
    const block = before.slice(before.lastIndexOf("\n\n"));
    expect(block).toContain('import("../services/ot/otStopEpochSync")');
    expect(block).not.toMatch(/if\s*\([^)]*OT_GATEWAY_ENABLED/);
    // and the call is at statement level of startServer (two-space indent), not nested in a conditional block
    const line = block.split("\n").find((l) => l.includes('import("../services/ot/otStopEpochSync")'))!;
    expect(line.match(/^\s*/)![0].length).toBe(2);
  });
});
