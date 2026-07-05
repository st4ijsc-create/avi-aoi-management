/**
 * W8-C (doc 27 §7 Đợt 6 leftover — web admin UI for escalation rules) —
 * tests for the ADDITIVE alertEscalation endpoints:
 *
 *   recentEscalations — merges escalated rows from BOTH tables the sweep claims
 *     (mqtt_connection_alerts + mqtt_alert_history), newest-first, with honest
 *     nulls (history has no severity column and no ack concept).
 *   listNotifiableUsers — supervisor-gated minimal user directory for the
 *     notifyUserIds picker (user.list itself is admin-only).
 *
 * CONCURRENCY NOTE: this file inserts rows with escalatedAt ALREADY SET, so the
 * sweep in alertEscalation.test.ts (parallel worker) can never claim them (its
 * atomic claim requires escalatedAt IS NULL) — no cross-file interference in
 * either direction. Assertions here are scoped to this file's PREFIX.
 *
 * Real-DB integration (isolated <db>_test). Honest skip when unavailable.
 */
import { describe, it, expect, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { getDb } from "../db/connection";
import { alertEscalationRouter } from "./alertEscalationRouter";
import { mqttConnectionAlerts, mqttAlertHistory } from "../../drizzle/schema";

const PREFIX = `W8C-ESC-${Date.now()}`;

const viewer = { user: { id: 13, role: "viewer", name: "Viewer" } } as any;
const admin2fa = { user: { id: 1, role: "admin", name: "Admin", twoFactorEnabled: true } } as any;

const db = await getDb();
if (!db) {
  // eslint-disable-next-line no-console
  console.warn("[alertEscalationAdditions.test] SKIP — test DB unreachable (run `npm run test:db:setup`).");
}

describe.skipIf(!db)("alertEscalation additions (recentEscalations / listNotifiableUsers, W8-C)", () => {
  afterAll(async () => {
    if (!db) return;
    await db.delete(mqttConnectionAlerts).where(like(mqttConnectionAlerts.title, `${PREFIX}%`));
    await db.delete(mqttAlertHistory).where(like(mqttAlertHistory.ruleName, `${PREFIX}%`));
  });

  it("merges escalated rows from both sources newest-first with honest nulls", async () => {
    const now = Date.now();
    await db!.insert(mqttConnectionAlerts).values({
      profileId: 999905,
      alertType: "connection_lost",
      severity: "critical",
      title: `${PREFIX}-conn-esc`,
      message: "offline",
      triggeredAt: new Date(now - 60 * 60_000),
      escalatedAt: new Date(now - 5 * 60_000),
      isAcknowledged: false,
      isResolved: false,
    });
    await db!.insert(mqttAlertHistory).values({
      ruleId: 999906,
      ruleName: `${PREFIX}-hist-esc`,
      ruleType: "LATENCY_THRESHOLD",
      triggeredValue: "1500",
      thresholdValue: "1000",
      message: "latency high",
      triggeredAt: new Date(now - 90 * 60_000),
      escalatedAt: new Date(now - 2 * 60_000), // newer escalation than the conn one
      isResolved: false,
    });

    const caller = alertEscalationRouter.createCaller(viewer); // read is protectedProcedure
    const rows = await caller.recentEscalations({ limit: 200 });
    const mine = rows.filter((r) => r.title.startsWith(PREFIX));
    expect(mine.length).toBe(2);
    // Newest escalation first (the history row).
    expect(mine[0].source).toBe("mqtt");
    expect(mine[0].severity).toBeNull(); // history has no severity column — honest null
    expect(mine[0].isAcknowledged).toBeNull(); // history rows have no ack concept
    expect(mine[1].source).toBe("conn");
    expect(mine[1].severity).toBe("critical");
    expect(mine[1].isAcknowledged).toBe(false);
  });

  it("listNotifiableUsers is supervisor-gated (viewer FORBIDDEN) and never leaks password hashes", async () => {
    await expect(
      alertEscalationRouter.createCaller(viewer).listNotifiableUsers(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const users = await alertEscalationRouter.createCaller(admin2fa).listNotifiableUsers();
    expect(Array.isArray(users)).toBe(true);
    for (const u of users.slice(0, 5)) {
      expect(u).toHaveProperty("id");
      expect(u).toHaveProperty("role");
      expect(u).not.toHaveProperty("passwordHash");
    }
  });
});
