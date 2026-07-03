/**
 * W5-21 — Master alarm service tests (pure: priority derivation, SEED∪DB merge,
 * shelving/suppression, EEMUA-191 KPIs). No DB — every unit is pure over its inputs.
 */
import { describe, it, expect } from "vitest";
import {
  derivePriority,
  normalizeConsequence,
  timeBand,
  mergeAlarmMappings,
  isAlarmSuppressed,
  computeAlarmKpis,
  type AlarmKpiEvent,
  type ShelveCheckable,
} from "./alarmMasterService";
import { SEED_ALARM_MAPPINGS } from "./alarmTaxonomy";

describe("derivePriority — EEMUA-191 consequence × time matrix", () => {
  it("severe consequence + short time → critical", () => {
    expect(derivePriority("severe", 5)).toBe("critical");
  });
  it("severe + long time → high (still serious even with time)", () => {
    expect(derivePriority("severe", 120)).toBe("high");
  });
  it("major + short → high; major + long → medium", () => {
    expect(derivePriority("major", 5)).toBe("high");
    expect(derivePriority("major", 60)).toBe("medium");
  });
  it("minor + medium → low; minor + short → medium", () => {
    expect(derivePriority("minor", 20)).toBe("low");
    expect(derivePriority("minor", 3)).toBe("medium");
  });
  it("none consequence → always low", () => {
    expect(derivePriority("none", 1)).toBe("low");
  });
  it("aliases + fail-safe: 'critical'→severe, unknown→minor, null time→medium band", () => {
    expect(normalizeConsequence("critical")).toBe("severe");
    expect(normalizeConsequence("wat")).toBe("minor");
    expect(timeBand(null)).toBe("medium");
    // unknown consequence (→minor) with null time (→medium band) = low
    expect(derivePriority("wat", null)).toBe("low");
  });
  it("time band boundaries: <10 short, 10..30 medium, >30 long", () => {
    expect(timeBand(9)).toBe("short");
    expect(timeBand(10)).toBe("medium");
    expect(timeBand(30)).toBe("medium");
    expect(timeBand(31)).toBe("long");
  });
});

describe("mergeAlarmMappings — SEED ∪ DB (DB overrides by vendor+native)", () => {
  it("returns the pure seed when there are no DB rows", () => {
    const merged = mergeAlarmMappings([]);
    expect(merged.length).toBe(SEED_ALARM_MAPPINGS.length);
  });
  it("appends a NEW db mapping (user-authored reaches the runtime set)", () => {
    const merged = mergeAlarmMappings([
      { vendor: "acme", nativeCode: "X-1", standardCode: "CUSTOM_FAULT", severity: "high" },
    ]);
    expect(merged.length).toBe(SEED_ALARM_MAPPINGS.length + 1);
    expect(merged.find((m) => m.vendor === "acme" && m.nativeCode === "X-1")?.standardCode).toBe("CUSTOM_FAULT");
  });
  it("OVERRIDES a seeded (vendor, native) with the DB row (case-insensitive vendor)", () => {
    const merged = mergeAlarmMappings([
      { vendor: "FANUC", nativeCode: "SRVO-050", standardCode: "OVERRIDDEN", severity: "low" },
    ]);
    // no new row added — it replaced the seed entry
    expect(merged.length).toBe(SEED_ALARM_MAPPINGS.length);
    const hit = merged.find((m) => m.vendor.toLowerCase() === "fanuc" && m.nativeCode === "SRVO-050");
    expect(hit?.standardCode).toBe("OVERRIDDEN");
    expect(hit?.severity).toBe("low");
  });
});

describe("isAlarmSuppressed — shelving / suppression", () => {
  const NOW = 1_000_000_000_000;
  const masters: ShelveCheckable[] = [
    { alarmKey: "OVERTEMP", isSuppressed: true },
    { alarmKey: "COLLISION_DETECT", shelvedUntil: new Date(NOW + 60_000) }, // shelved (future)
    { alarmKey: "COMMS_LOSS", shelvedUntil: new Date(NOW - 60_000) },       // expired shelve (past)
    { alarmKey: "FORCE_LIMIT_EXCEEDED", assetType: "ROBOT", isSuppressed: true },
  ];

  it("design-suppressed code → suppressed:true reason 'suppressed'", () => {
    const r = isAlarmSuppressed(masters, { standardCode: "OVERTEMP" }, NOW);
    expect(r.suppressed).toBe(true);
    expect(r.reason).toBe("suppressed");
  });
  it("shelved-in-future code → suppressed:true reason 'shelved'", () => {
    const r = isAlarmSuppressed(masters, { standardCode: "COLLISION_DETECT" }, NOW);
    expect(r.suppressed).toBe(true);
    expect(r.reason).toBe("shelved");
  });
  it("EXPIRED shelve → not suppressed (raises again)", () => {
    expect(isAlarmSuppressed(masters, { standardCode: "COMMS_LOSS" }, NOW).suppressed).toBe(false);
  });
  it("no matching master → not suppressed", () => {
    expect(isAlarmSuppressed(masters, { standardCode: "SOMETHING_ELSE" }, NOW).suppressed).toBe(false);
  });
  it("asset-scoped master matches its assetType but null target assetType still matches by key", () => {
    expect(isAlarmSuppressed(masters, { standardCode: "FORCE_LIMIT_EXCEEDED" }, NOW).suppressed).toBe(true);
  });
});

describe("computeAlarmKpis — EEMUA-191 metrics over a fixture", () => {
  const H = 3_600_000;
  it("counts alarms, rate, flood windows, chattering, standing, bad-actors", () => {
    const base = 10_000_000_000_000;
    const events: AlarmKpiEvent[] = [];
    // 12 raises of A within a single 10-min flood window → flood + chattering + bad-actor.
    for (let i = 0; i < 12; i++) events.push({ key: "A", raisedAt: base + i * 1_000, resolvedAt: base + i * 1_000 + 500 });
    // 2 raises of B, spread across hours (not chattering).
    events.push({ key: "B", raisedAt: base + 2 * H, resolvedAt: base + 2 * H + 100 });
    events.push({ key: "B", raisedAt: base + 5 * H, resolvedAt: base + 5 * H + 100 });
    // 1 STANDING alarm C: unresolved, raised 48h before "now".
    const now = base + 6 * H;
    events.push({ key: "C", raisedAt: now - 48 * H, resolvedAt: null });

    const k = computeAlarmKpis(events, { operatorCount: 2, now });
    expect(k.totalAlarms).toBe(15);
    // flood: the burst of 12 in one 10-min bucket exceeds the default threshold (10).
    expect(k.floodWindowCount).toBeGreaterThanOrEqual(1);
    expect(k.peakWindowCount).toBe(12);
    // chattering: A recurred >=3 within 60 min.
    expect(k.chattering.some((c) => c.key === "A")).toBe(true);
    expect(k.chattering.some((c) => c.key === "B")).toBe(false);
    // standing: C is unresolved and older than 24h.
    expect(k.standingCount).toBe(1);
    expect(k.standing[0].key).toBe("C");
    // bad actors ranked by count → A first.
    expect(k.badActors[0].key).toBe("A");
    expect(k.badActors[0].count).toBe(12);
    // alarms/operator/hour halves with 2 operators.
    expect(k.alarmsPerOperatorHour).toBeCloseTo(k.alarmsPerHour / 2, 6);
  });

  it("empty history → zeroed, non-crashing KPIs", () => {
    const k = computeAlarmKpis([]);
    expect(k.totalAlarms).toBe(0);
    expect(k.alarmsPerHour).toBe(0);
    expect(k.badActors).toEqual([]);
    expect(k.standingCount).toBe(0);
  });
});
