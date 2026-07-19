/**
 * W5-C (doc 27 F7) — /andon TV board pure helpers (node env, no DOM):
 * URL param parsing (cycle/lines/factory/theme/thresholds with safe fallbacks),
 * auto-cycle sequencing and tile status classification priority.
 */
import { describe, it, expect } from "vitest";
import {
  parseAndonBoardParams,
  nextCycleIndex,
  tileStatus,
  agoLabel,
  isNewAndonRaise,
  ANDON_DEFAULT_WARN_PCT,
  ANDON_DEFAULT_CRIT_PCT,
} from "./andonBoard";

describe("parseAndonBoardParams", () => {
  it("parses the full URL contract", () => {
    const p = parseAndonBoardParams("?cycle=30&lines=12,14&factory=2&theme=dark&warn=97&crit=92&sound=0");
    expect(p).toEqual({ cycleSec: 30, lineIds: [12, 14], factoryId: 2, theme: "dark", warnPct: 97, critPct: 92, sound: false });
  });

  it("W8: sound defaults ON; only explicit 0/false/off mutes", () => {
    expect(parseAndonBoardParams("").sound).toBe(true);
    expect(parseAndonBoardParams("?sound=1").sound).toBe(true);
    expect(parseAndonBoardParams("?sound=garbage").sound).toBe(true); // unknown value → keep ringing
    expect(parseAndonBoardParams("?sound=0").sound).toBe(false);
    expect(parseAndonBoardParams("?sound=false").sound).toBe(false);
    expect(parseAndonBoardParams("?sound=off").sound).toBe(false);
  });

  it("falls back safely on garbage", () => {
    const p = parseAndonBoardParams("?cycle=abc&lines=L1,-3,0,7&factory=x&theme=blue&warn=200&crit=-5");
    expect(p.cycleSec).toBe(0); // invalid cycle → cycling off
    expect(p.lineIds).toEqual([7]); // only valid positive integers survive
    expect(p.factoryId).toBeNull();
    expect(p.theme).toBeNull();
    expect(p.warnPct).toBe(ANDON_DEFAULT_WARN_PCT);
    expect(p.critPct).toBe(ANDON_DEFAULT_CRIT_PCT);
  });

  it("clamps cycle to a 5s minimum and never inverts warn/crit bands", () => {
    expect(parseAndonBoardParams("?cycle=1").cycleSec).toBe(5);
    const inverted = parseAndonBoardParams("?warn=80&crit=90");
    expect(inverted.warnPct).toBeGreaterThanOrEqual(inverted.critPct);
  });

  it("empty search → all defaults", () => {
    expect(parseAndonBoardParams("")).toEqual({
      cycleSec: 0, lineIds: [], factoryId: null, theme: null,
      warnPct: ANDON_DEFAULT_WARN_PCT, critPct: ANDON_DEFAULT_CRIT_PCT,
      sound: true,
    });
  });
});

describe("isNewAndonRaise (W8 chime/flash/spotlight trigger)", () => {
  it("rings on a new red/call/yellow raise", () => {
    expect(isNewAndonRaise({ event: "raised", status: "raised", state: "red" })).toBe(true);
    expect(isNewAndonRaise({ event: "raised", status: "raised", state: "call" })).toBe(true);
    expect(isNewAndonRaise({ event: "raised", status: "raised", state: "yellow" })).toBe(true);
  });
  it("stays silent on ack/resolve/escalate echoes", () => {
    expect(isNewAndonRaise({ event: "acknowledged", status: "acknowledged", state: "red" })).toBe(false);
    expect(isNewAndonRaise({ event: "resolved", status: "resolved", state: "red" })).toBe(false);
    expect(isNewAndonRaise({ event: "escalated", status: "raised", state: "red" })).toBe(false);
  });
  it("legacy payload without `event` falls back to status", () => {
    expect(isNewAndonRaise({ status: "raised", state: "red" })).toBe(true);
    expect(isNewAndonRaise({ status: "acknowledged", state: "red" })).toBe(false);
  });
  it("green raise = return-to-normal → no bell; garbage → no bell", () => {
    expect(isNewAndonRaise({ event: "raised", status: "raised", state: "green" })).toBe(false);
    expect(isNewAndonRaise({ event: "raised", status: "raised" })).toBe(false);
    expect(isNewAndonRaise(null)).toBe(false);
    expect(isNewAndonRaise(undefined)).toBe(false);
  });
});

describe("nextCycleIndex", () => {
  it("wraps through all views (0 = all-lines overview)", () => {
    expect(nextCycleIndex(0, 3)).toBe(1);
    expect(nextCycleIndex(1, 3)).toBe(2);
    expect(nextCycleIndex(2, 3)).toBe(0);
  });
  it("stays at 0 when there is nothing to cycle", () => {
    expect(nextCycleIndex(0, 1)).toBe(0);
    expect(nextCycleIndex(5, 0)).toBe(0);
  });
});

describe("tileStatus priority", () => {
  const base = { finalYield: 99, andonState: null as any, online: true, warnPct: 95, critPct: 90 };
  it("active red/call andon beats everything", () => {
    expect(tileStatus({ ...base, andonState: "red", online: false, finalYield: 50 })).toBe("andon");
    expect(tileStatus({ ...base, andonState: "call" })).toBe("andon");
  });
  it("yellow andon does NOT take the tile (badge only)", () => {
    expect(tileStatus({ ...base, andonState: "yellow" })).toBe("good");
  });
  it("offline beats yield colouring", () => {
    expect(tileStatus({ ...base, online: false, finalYield: 50 })).toBe("offline");
  });
  it("yield bands: crit < warn < good; unknown online (null) still coloured", () => {
    expect(tileStatus({ ...base, finalYield: 89.9 })).toBe("crit");
    expect(tileStatus({ ...base, finalYield: 94.9 })).toBe("warn");
    expect(tileStatus({ ...base, finalYield: 95 })).toBe("good");
    expect(tileStatus({ ...base, online: null, finalYield: 80 })).toBe("crit");
  });
  it("no data today → idle", () => {
    expect(tileStatus({ ...base, finalYield: null })).toBe("idle");
  });
});

describe("agoLabel", () => {
  it("formats s/m/h/d compactly and never goes negative", () => {
    const now = 1_000_000_000;
    expect(agoLabel(now - 30_000, now)).toBe("30s");
    expect(agoLabel(now - 5 * 60_000, now)).toBe("5m");
    expect(agoLabel(now - 3 * 3_600_000, now)).toBe("3h");
    expect(agoLabel(now - 23 * 3_600_000, now)).toBe("23h");
    expect(agoLabel(now - 26 * 3_600_000, now)).toBe("1d");
    expect(agoLabel(now - 2 * 24 * 3_600_000, now)).toBe("2d");
    expect(agoLabel(now + 60_000, now)).toBe("0s");
  });
});
