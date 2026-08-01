/**
 * doc 44 W6-2 / G5.11 — impact priority + dedup (PURE unit tests, no DB).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  computeIssueImpact,
  dedupIssues,
  issueFingerprint,
  prioritizeIssues,
  impactAlertEnabled,
  type IssueImpactContext,
} from "./factoryCommandPriority";
import type { CommandIssue } from "./factoryCommandService";

function issue(over: Partial<CommandIssue>): CommandIssue {
  return {
    id: over.id ?? "x",
    kind: over.kind ?? "alarm",
    machineId: over.machineId ?? 1,
    machineCode: over.machineCode ?? "M1",
    severity: over.severity ?? "warning",
    label: over.label ?? "l",
    ageMinutes: over.ageMinutes ?? 0,
    ...over,
  };
}

const ctx = (over: Partial<IssueImpactContext> = {}): IssueImpactContext => ({
  machineStatus: over.machineStatus ?? "running",
  oeePercent: over.oeePercent ?? null,
  lineProducing: over.lineProducing ?? false,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("computeIssueImpact", () => {
  it("critical outscores warning outscores info, all else equal", () => {
    const c = computeIssueImpact(issue({ severity: "critical" }), ctx());
    const w = computeIssueImpact(issue({ severity: "warning" }), ctx());
    const i = computeIssueImpact(issue({ severity: "info" }), ctx());
    expect(c).toBeGreaterThan(w);
    expect(w).toBeGreaterThan(i);
  });

  it("a stopped machine on a PRODUCING line outranks the same on a stopped line", () => {
    const producing = computeIssueImpact(
      issue({ kind: "offline", severity: "warning" }),
      ctx({ machineStatus: "down", lineProducing: true }),
    );
    const stopped = computeIssueImpact(
      issue({ kind: "offline", severity: "warning" }),
      ctx({ machineStatus: "down", lineProducing: false }),
    );
    expect(producing).toBeGreaterThan(stopped);
  });

  it("production impact can lift a warning above a low-value critical", () => {
    // warning on a down machine, line producing (big hole)
    const warnBigHole = computeIssueImpact(
      issue({ severity: "warning", kind: "offline" }),
      ctx({ machineStatus: "down", lineProducing: true, oeePercent: 20 }),
    );
    // critical but machine idle on an already-stopped line (little marginal loss)
    const critIdle = computeIssueImpact(
      issue({ severity: "critical", kind: "pdm" }),
      ctx({ machineStatus: "idle", lineProducing: false, oeePercent: 95 }),
    );
    expect(warnBigHole).toBeGreaterThan(critIdle);
  });

  it("lower OEE increases impact (mild); age boosts but stays bounded", () => {
    const lowOee = computeIssueImpact(issue({}), ctx({ oeePercent: 10 }));
    const highOee = computeIssueImpact(issue({}), ctx({ oeePercent: 95 }));
    expect(lowOee).toBeGreaterThan(highOee);

    const old = computeIssueImpact(issue({ ageMinutes: 600 }), ctx());
    const fresh = computeIssueImpact(issue({ ageMinutes: 0 }), ctx());
    expect(old - fresh).toBeLessThanOrEqual(6); // age boost capped
    expect(old).toBeGreaterThan(fresh);
  });

  it("is bounded to 0..100 and never throws on NaN age", () => {
    const s = computeIssueImpact(issue({ ageMinutes: Number.NaN }), ctx({ machineStatus: "down", lineProducing: true, oeePercent: 0 }));
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe("issueFingerprint / dedupIssues", () => {
  it("fingerprint groups by machine + kind", () => {
    expect(issueFingerprint(issue({ machineId: 3, kind: "andon" }))).toBe("3:andon");
    expect(issueFingerprint(issue({ machineId: 3, kind: "alarm" }))).not.toBe("3:andon");
  });

  it("collapses same machine+kind into ONE row with count", () => {
    const rows = dedupIssues([
      issue({ id: "a1", machineId: 5, kind: "alarm", severity: "warning", ageMinutes: 3 }),
      issue({ id: "a2", machineId: 5, kind: "alarm", severity: "warning", ageMinutes: 9 }),
      issue({ id: "a3", machineId: 5, kind: "alarm", severity: "warning", ageMinutes: 1 }),
      issue({ id: "b1", machineId: 5, kind: "andon", severity: "critical", ageMinutes: 2 }),
    ]);
    expect(rows).toHaveLength(2);
    const alarm = rows.find((r) => r.kind === "alarm")!;
    expect(alarm.count).toBe(3);
    const andon = rows.find((r) => r.kind === "andon")!;
    expect(andon.count).toBe(1);
  });

  it("representative = highest impact, tie → oldest", () => {
    const rows = dedupIssues([
      issue({ id: "lo", machineId: 1, kind: "alarm", impact: 30, ageMinutes: 5 }),
      issue({ id: "hi", machineId: 1, kind: "alarm", impact: 80, ageMinutes: 2 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("hi");
    expect(rows[0].count).toBe(2);

    const tie = dedupIssues([
      issue({ id: "young", machineId: 1, kind: "alarm", impact: 50, ageMinutes: 2 }),
      issue({ id: "old", machineId: 1, kind: "alarm", impact: 50, ageMinutes: 40 }),
    ]);
    expect(tie[0].id).toBe("old");
  });

  it("does not mutate the input", () => {
    const input = [issue({ id: "a", machineId: 1, kind: "alarm" })];
    const before = JSON.stringify(input);
    dedupIssues(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("prioritizeIssues (flag-gated)", () => {
  const list: CommandIssue[] = [
    issue({ id: "info-old", machineId: 1, kind: "alarm", severity: "info", ageMinutes: 120 }),
    issue({ id: "crit-fresh", machineId: 2, kind: "andon", severity: "critical", ageMinutes: 1 }),
    issue({ id: "warn-a", machineId: 3, kind: "alarm", severity: "warning", ageMinutes: 5 }),
    issue({ id: "warn-b", machineId: 3, kind: "alarm", severity: "warning", ageMinutes: 50 }),
  ];
  const noCtx = () => null;

  it("flag OFF → legacy severity-then-age sort, NO dedup, NO impact/count", () => {
    vi.stubEnv("IMPACT_ALERT_ENABLED", "false");
    expect(impactAlertEnabled()).toBe(false);
    const out = prioritizeIssues(list, noCtx);
    expect(out).toHaveLength(4); // no dedup
    expect(out[0].id).toBe("crit-fresh"); // critical first
    expect(out.every((i) => i.impact === undefined)).toBe(true);
    expect(out.every((i) => i.count === undefined)).toBe(true);
  });

  it("flag OFF preserves severity → age ordering among warnings", () => {
    vi.stubEnv("IMPACT_ALERT_ENABLED", "false");
    const out = prioritizeIssues(list, noCtx);
    const warnIdx = out.map((i) => i.id).filter((id) => id.startsWith("warn"));
    expect(warnIdx).toEqual(["warn-b", "warn-a"]); // older warning first
  });

  it("flag ON → dedups machine 3's two alarms and stamps impact", () => {
    vi.stubEnv("IMPACT_ALERT_ENABLED", "true");
    expect(impactAlertEnabled()).toBe(true);
    const getCtx = (iss: CommandIssue): IssueImpactContext =>
      ctx({ machineStatus: iss.machineId === 2 ? "down" : "running", lineProducing: true });
    const out = prioritizeIssues(list, getCtx);
    // machine 3 had two alarms → collapsed to one row with count 2
    expect(out).toHaveLength(3);
    const m3 = out.find((i) => i.machineId === 3)!;
    expect(m3.count).toBe(2);
    expect(out.every((i) => typeof i.impact === "number")).toBe(true);
    // sorted by impact desc
    for (let k = 1; k < out.length; k++) {
      expect(out[k - 1].impact!).toBeGreaterThanOrEqual(out[k].impact!);
    }
  });
});
