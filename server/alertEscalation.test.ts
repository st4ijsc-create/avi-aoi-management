/**
 * W6-C (doc 27 §7 MB6) — escalation sweep + rules CRUD tests.
 *
 * DB integration against the isolated <db>_test (vitest.setup.ts / npm run
 * test:db:setup; migration 0186 applied by scripts/apply-migration-0186.mjs).
 *
 * Covers:
 *  - seeded unacknowledged mqtt_connection_alert past the rule threshold →
 *    escalated exactly once (escalatedAt set, notify + MQTT publish called);
 *  - second sweep does NOT re-escalate (no re-storm);
 *  - fresh alert (younger than threshold) is untouched;
 *  - disabled rules never escalate;
 *  - unresolved mqtt_alert_history rows escalate too (no severity filter);
 *  - severity-filtered rules skip mqtt_alert_history honestly;
 *  - alertEscalationRouter CRUD with RBAC (supervisor/admin mutate, viewer read-only).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq, like, sql } from "drizzle-orm";

import { sweepEscalations } from "./mqttAlertScheduler";
import { alertEscalationRouter } from "./routers/alertEscalationRouter";
import { getDb } from "./db";
import { alertEscalationRules, mqttConnectionAlerts, mqttAlertHistory } from "../drizzle/schema";

const MARKER = "W6C-ESCALATION-TEST";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

let db: Db;

async function cleanup() {
  await db.delete(alertEscalationRules).where(like(alertEscalationRules.name, `${MARKER}%`));
  await db.delete(mqttConnectionAlerts).where(like(mqttConnectionAlerts.title, `${MARKER}%`));
  await db.delete(mqttAlertHistory).where(like(mqttAlertHistory.ruleName, `${MARKER}%`));
}

function minutesAgo(min: number): Date {
  return new Date(Date.now() - min * 60 * 1000);
}

function makeDeps() {
  const notified: Array<{ title: string; content: string }> = [];
  const published: Array<{ topic: string; payload: Record<string, any> }> = [];
  const inApp: Array<{ userId: number; entityId: number }> = [];
  const fcm: Array<{ stationId: number }> = [];
  return {
    notified,
    published,
    inApp,
    fcm,
    deps: {
      notifyOwnerFn: async (n: { title: string; content: string }) => { notified.push(n); return true; },
      publishMqttFn: async (topic: string, payload: Record<string, any>) => { published.push({ topic, payload }); return true; },
      createNotificationFn: async (d: any) => { inApp.push({ userId: d.userId, entityId: d.entityId }); return { id: 1 }; },
      sendFcmFn: async (stationId: number) => { fcm.push({ stationId }); },
    },
  };
}

beforeAll(async () => {
  const maybeDb = await getDb();
  if (!maybeDb) throw new Error("Test DB unavailable — run `npm run test:db:setup`");
  db = maybeDb;
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
});

describe("sweepEscalations (mqtt_connection_alerts)", () => {
  it("escalates an unacknowledged alert past the threshold exactly once — no re-storm", async () => {
    await db.insert(alertEscalationRules).values({
      name: `${MARKER}-rule`, escalateAfterMin: 15, enabled: true,
      notifyRoles: [], notifyUserIds: [4242],
    });
    const [alert] = await db.insert(mqttConnectionAlerts).values({
      profileId: 999901, alertType: "connection_lost", severity: "critical",
      title: `${MARKER}-old`, message: "offline 30m",
      triggeredAt: minutesAgo(30), isAcknowledged: false, isResolved: false,
      targetType: "station", targetId: 777,
    }).returning({ id: mqttConnectionAlerts.id });

    const h1 = makeDeps();
    const r1 = await sweepEscalations(h1.deps);
    expect(r1.escalated).toBe(1);

    const [row] = await db.select().from(mqttConnectionAlerts).where(eq(mqttConnectionAlerts.id, alert.id));
    expect(row.escalatedAt).not.toBeNull();

    // Every notification channel fired once for this alert
    expect(h1.notified.length).toBe(1);
    expect(h1.notified[0].content).toContain(`conn-${alert.id}`);
    expect(h1.published.length).toBe(1);
    expect(h1.published[0].topic).toBe(`avi/escalations/conn/${alert.id}`);
    expect(h1.published[0].payload.type).toBe("ALERT_ESCALATION");
    expect(h1.published[0].payload.alertId).toBe(`conn-${alert.id}`);
    expect(h1.inApp).toEqual([{ userId: 4242, entityId: alert.id }]);
    expect(h1.fcm).toEqual([{ stationId: 777 }]); // station-scoped → FCM path invoked

    // Second sweep: nothing new — the escalatedAt IS NULL claim guarantees once-only
    const h2 = makeDeps();
    const r2 = await sweepEscalations(h2.deps);
    expect(r2.escalated).toBe(0);
    expect(h2.notified.length).toBe(0);
    expect(h2.published.length).toBe(0);
  });

  it("leaves alerts younger than the threshold and acked/resolved alerts alone", async () => {
    await db.insert(alertEscalationRules).values({
      name: `${MARKER}-rule`, escalateAfterMin: 15, enabled: true, notifyRoles: [], notifyUserIds: [],
    });
    await db.insert(mqttConnectionAlerts).values([
      {
        profileId: 999902, alertType: "connection_lost", severity: "warning",
        title: `${MARKER}-fresh`, triggeredAt: minutesAgo(5),
        isAcknowledged: false, isResolved: false,
      },
      {
        profileId: 999903, alertType: "connection_lost", severity: "warning",
        title: `${MARKER}-acked`, triggeredAt: minutesAgo(60),
        isAcknowledged: true, isResolved: false, acknowledgedAt: minutesAgo(50),
      },
      {
        profileId: 999904, alertType: "connection_lost", severity: "warning",
        title: `${MARKER}-resolved`, triggeredAt: minutesAgo(60),
        isAcknowledged: false, isResolved: true, resolvedAt: minutesAgo(40),
      },
    ]);

    const h = makeDeps();
    const r = await sweepEscalations(h.deps);
    expect(r.escalated).toBe(0);
    expect(h.published.length).toBe(0);

    const rows = await db.select().from(mqttConnectionAlerts).where(like(mqttConnectionAlerts.title, `${MARKER}%`));
    for (const row of rows) expect(row.escalatedAt).toBeNull();
  });

  it("ignores disabled rules and honours severity/alertType filters", async () => {
    await db.insert(alertEscalationRules).values([
      { name: `${MARKER}-disabled`, escalateAfterMin: 1, enabled: false, notifyRoles: [], notifyUserIds: [] },
      { name: `${MARKER}-critical-only`, escalateAfterMin: 15, enabled: true, severity: "critical", notifyRoles: [], notifyUserIds: [] },
    ]);
    await db.insert(mqttConnectionAlerts).values({
      profileId: 999905, alertType: "connection_lost", severity: "warning",
      title: `${MARKER}-warning-old`, triggeredAt: minutesAgo(120),
      isAcknowledged: false, isResolved: false,
    });

    const h = makeDeps();
    const r = await sweepEscalations(h.deps);
    // warning alert does not match the critical-only rule; disabled rule never runs
    expect(r.escalated).toBe(0);
    expect(h.published.length).toBe(0);
  });
});

describe("sweepEscalations (mqtt_alert_history)", () => {
  it("escalates unresolved history rows once; severity-filtered rules skip this source", async () => {
    await db.insert(alertEscalationRules).values({
      name: `${MARKER}-any`, escalateAfterMin: 10, enabled: true, notifyRoles: [], notifyUserIds: [],
    });
    const [hist] = await db.insert(mqttAlertHistory).values({
      ruleId: 999906, ruleName: `${MARKER}-latency`, ruleType: "LATENCY_THRESHOLD",
      triggeredValue: "900.00", thresholdValue: "500.00", message: "latency 900ms",
      isResolved: false, triggeredAt: minutesAgo(30),
    }).returning({ id: mqttAlertHistory.id });

    const h1 = makeDeps();
    const r1 = await sweepEscalations(h1.deps);
    expect(r1.escalated).toBe(1);
    expect(h1.published[0].topic).toBe(`avi/escalations/mqtt/${hist.id}`);
    expect(h1.fcm.length).toBe(0); // history rows are not station-scoped

    const [row] = await db.select().from(mqttAlertHistory).where(eq(mqttAlertHistory.id, hist.id));
    expect(row.escalatedAt).not.toBeNull();

    // no double escalation
    const h2 = makeDeps();
    expect((await sweepEscalations(h2.deps)).escalated).toBe(0);

    // a severity-filtered rule alone never touches mqtt_alert_history (no severity column)
    await cleanup();
    await db.insert(alertEscalationRules).values({
      name: `${MARKER}-sev`, escalateAfterMin: 10, enabled: true, severity: "critical", notifyRoles: [], notifyUserIds: [],
    });
    await db.insert(mqttAlertHistory).values({
      ruleId: 999907, ruleName: `${MARKER}-latency2`, ruleType: "LATENCY_THRESHOLD",
      triggeredValue: "900.00", thresholdValue: "500.00", message: "latency 900ms",
      isResolved: false, triggeredAt: minutesAgo(60),
    });
    const h3 = makeDeps();
    expect((await sweepEscalations(h3.deps)).escalated).toBe(0);
  });
});

describe("alertEscalationRouter CRUD + RBAC", () => {
  const admin = { user: { id: 1, role: "admin", name: "Admin", twoFactorEnabled: true } } as any;
  const viewer = { user: { id: 2, role: "viewer", name: "Viewer" } } as any;

  it("create → getById → update → toggle → delete round-trip (admin)", async () => {
    const caller = alertEscalationRouter.createCaller(admin);
    const created = await caller.create({
      name: `${MARKER}-crud`, description: "test rule",
      severity: "critical", alertType: "connection_lost",
      escalateAfterMin: 20, notifyRoles: ["admin"], notifyUserIds: [7],
      enabled: true,
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.escalateAfterMin).toBe(20);

    const fetched = await caller.getById({ id: created.id });
    expect(fetched.name).toBe(`${MARKER}-crud`);
    expect(fetched.notifyRoles).toEqual(["admin"]);
    expect(fetched.notifyUserIds).toEqual([7]);

    await caller.update({ id: created.id, escalateAfterMin: 45, severity: null });
    const updated = await caller.getById({ id: created.id });
    expect(updated.escalateAfterMin).toBe(45);
    expect(updated.severity).toBeNull();

    await caller.toggle({ id: created.id, enabled: false });
    expect((await caller.getById({ id: created.id })).enabled).toBe(false);

    const list = await caller.list();
    expect(list.some((r) => r.id === created.id)).toBe(true);

    await caller.delete({ id: created.id });
    await expect(caller.getById({ id: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("viewer can list but cannot mutate (FORBIDDEN)", async () => {
    const caller = alertEscalationRouter.createCaller(viewer);
    await expect(caller.list()).resolves.toBeDefined();
    await expect(caller.create({ name: `${MARKER}-nope`, escalateAfterMin: 15, notifyRoles: [], notifyUserIds: [], enabled: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
