/**
 * Tests — dataRetentionService extensions (doc 27 §4 R1/R3/R6 · §8 B2 · §11
 * decision #2 "12-month retention for everything").
 *
 * Config-level (pure):
 *   • every doc-27 table is covered with a 365-day default window;
 *   • command_log is NEVER a target (append-only compliance ledger);
 *   • the two inspection tables capture image keys / ids for the image lifecycle.
 *
 * DB-level (isolated <db>_test via vitest.setup.ts / npm run test:db:setup):
 *   • runRetentionOnce deletes rows older than the window and keeps fresh rows
 *     (notifications, package_activity_logs);
 *   • pruning product_inspections/measurement_results removes the matching
 *     image files under a temp local uploads root in the same sweep (gap R6);
 *   • getNativeRetentionTables returns an empty set on plain PostgreSQL
 *     (timescaledb absent) instead of throwing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { sql } from "drizzle-orm";

import {
  getRetentionTargets,
  getNativeRetentionTables,
  runRetentionOnce,
} from "./dataRetentionService";
import { getDb } from "../db/connection";

const MARKER = "W1A-RETENTION-TEST";

// ── Config-level assertions (no DB needed) ────────────────────────────────────

describe("retention target configuration (doc 27 decision #2)", () => {
  const targets = getRetentionTargets();
  const byTable = new Map(targets.map((t) => [t.table, t]));

  const twelveMonthTables = [
    "product_inspections",
    "measurement_results",
    "audit_logs",
    "notifications",
    "mqtt_alert_history",
    "mqtt_ng_rate_alert_history",
    "mqtt_connection_logs",
    "mqtt_reconnect_logs",
    "package_activity_logs",
  ];

  it.each(twelveMonthTables)("covers %s with a 365-day default", (table) => {
    const t = byTable.get(table);
    expect(t, `${table} missing from TARGETS`).toBeDefined();
    expect(t!.defaultDays).toBe(365);
  });

  it("NEVER prunes command_log (append-only compliance ledger, doc 27 B2)", () => {
    expect(byTable.has("command_log")).toBe(false);
  });

  it("keeps pre-existing telemetry/log targets intact", () => {
    for (const table of [
      "ot_telemetry",
      "machine_heartbeats",
      "mqtt_message_logs",
      "mqtt_message_history",
      "oee_metrics",
      "process_results",
      "inference_results",
    ]) {
      expect(byTable.has(table), `${table} should remain a target`).toBe(true);
    }
  });

  it("captures image artifacts from the inspection tables (gap R6 coupling)", () => {
    const mr = byTable.get("measurement_results")!;
    expect(mr.captureColumns).toEqual(["imageKey", "defectCropKey"]);
    expect(typeof mr.onDeleted).toBe("function");

    const pi = byTable.get("product_inspections")!;
    expect(pi.captureColumns).toEqual(["id"]);
    expect(typeof pi.onDeleted).toBe("function");
    expect(pi.column).toBe("inspectionTime");
  });

  it("uses correct age columns for the new log tables", () => {
    expect(byTable.get("mqtt_alert_history")!.column).toBe("triggeredAt");
    expect(byTable.get("mqtt_ng_rate_alert_history")!.column).toBe("triggeredAt");
    expect(byTable.get("mqtt_connection_logs")!.column).toBe("timestamp");
    expect(byTable.get("mqtt_reconnect_logs")!.column).toBe("timestamp");
    expect(byTable.get("audit_logs")!.column).toBe("createdAt");
    expect(byTable.get("notifications")!.column).toBe("createdAt");
    expect(byTable.get("package_activity_logs")!.column).toBe("createdAt");
  });
});

// ── DB integration (isolated test DB) ────────────────────────────────────────

describe("runRetentionOnce against the isolated test DB", () => {
  let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  let tmpUploads: string;
  const envBackup: Record<string, string | undefined> = {};

  function setEnv(key: string, value: string | undefined) {
    if (!(key in envBackup)) envBackup[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  async function cleanupRows() {
    await db.execute(sql`DELETE FROM notifications WHERE title LIKE ${MARKER + "%"}`);
    await db.execute(sql`DELETE FROM package_activity_logs WHERE message LIKE ${MARKER + "%"}`);
    await db.execute(
      sql`DELETE FROM measurement_results WHERE "inspectionId" IN
          (SELECT id FROM product_inspections WHERE "serialNumber" LIKE ${MARKER + "%"})`,
    );
    await db.execute(sql`DELETE FROM product_inspections WHERE "serialNumber" LIKE ${MARKER + "%"}`);
  }

  beforeAll(async () => {
    const maybe = await getDb();
    if (!maybe) throw new Error("test DB unavailable — run: npm run test:db:setup");
    db = maybe;
    tmpUploads = await fs.promises.mkdtemp(path.join(os.tmpdir(), "retention-img-"));
    setEnv("STORAGE_MODE", "local");
    setEnv("LOCAL_STORAGE_DIR", tmpUploads);
    setEnv("DATA_RETENTION_DRY_RUN", undefined);
    await cleanupRows();
  });

  afterAll(async () => {
    await cleanupRows();
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.promises.rm(tmpUploads, { recursive: true, force: true }).catch(() => {});
  });

  it("getNativeRetentionTables is an empty set on plain PostgreSQL", async () => {
    const set = await getNativeRetentionTables(db);
    expect(set).toBeInstanceOf(Set);
    expect(set.size).toBe(0); // test DB has no timescaledb → no native policies
  });

  it("prunes >365d rows from log tables and keeps fresh rows", async () => {
    await db.execute(sql`
      INSERT INTO notifications ("userId", type, title, message, "createdAt")
      VALUES (1, 'INFO', ${MARKER + "-old"}, 'old', now() - interval '400 days'),
             (1, 'INFO', ${MARKER + "-new"}, 'new', now() - interval '10 days')`);
    await db.execute(sql`
      INSERT INTO package_activity_logs ("packageDbId", "packageId", event, message, "createdAt")
      VALUES (999999, ${MARKER}, 'presign', ${MARKER + "-old"}, now() - interval '400 days'),
             (999999, ${MARKER}, 'presign', ${MARKER + "-new"}, now() - interval '10 days')`);

    await runRetentionOnce();

    const notif = (await db.execute(
      sql`SELECT title FROM notifications WHERE title LIKE ${MARKER + "%"}`,
    )) as unknown as Array<{ title: string }>;
    expect(notif.map((r) => r.title)).toEqual([MARKER + "-new"]);

    const pal = (await db.execute(
      sql`SELECT message FROM package_activity_logs WHERE message LIKE ${MARKER + "%"}`,
    )) as unknown as Array<{ message: string }>;
    expect(pal.map((r) => r.message)).toEqual([MARKER + "-new"]);
  });

  it("prunes old inspections + measurements AND their image files in one sweep (R6)", async () => {
    // Since Đợt 3 (0180) product_inspections.machineId and
    // measurement_results.pointDefId are FK-enforced — resolve real parents
    // instead of the old orphan sentinels (999999 / 1).
    const [{ id: machineId }] = (await db.execute(
      sql`SELECT id FROM machines ORDER BY id LIMIT 1`,
    )) as unknown as Array<{ id: number }>;
    const [{ id: pointDefId }] = (await db.execute(
      sql`SELECT id FROM measurement_point_defs ORDER BY id LIMIT 1`,
    )) as unknown as Array<{ id: number }>;

    // Old inspection (>365d) with one measurement carrying an imageKey.
    const insOld = (await db.execute(sql`
      INSERT INTO product_inspections
        ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "createdAt")
      VALUES (${machineId}, ${MARKER + "-old"}, 'OK', 'OK', now() - interval '400 days', now() - interval '400 days')
      RETURNING id`)) as unknown as Array<{ id: number }>;
    const oldId = insOld[0].id;

    const insNew = (await db.execute(sql`
      INSERT INTO product_inspections
        ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "createdAt")
      VALUES (${machineId}, ${MARKER + "-new"}, 'OK', 'OK', now() - interval '5 days', now() - interval '5 days')
      RETURNING id`)) as unknown as Array<{ id: number }>;
    const newId = insNew[0].id;

    const oldKey = `inspections/${oldId}/p1-test.jpg`;
    const newKey = `inspections/${newId}/p1-test.jpg`;
    await db.execute(sql`
      INSERT INTO measurement_results ("inspectionId", "pointDefId", result, "imageKey", "createdAt")
      VALUES (${oldId}, ${pointDefId}, 'OK', ${oldKey}, now() - interval '400 days'),
             (${newId}, ${pointDefId}, 'OK', ${newKey}, now() - interval '5 days')`);

    // Materialize the image files under the temp local uploads root.
    for (const key of [oldKey, newKey]) {
      const p = path.join(tmpUploads, key);
      await fs.promises.mkdir(path.dirname(p), { recursive: true });
      await fs.promises.writeFile(p, "img");
    }

    await runRetentionOnce();

    const rows = (await db.execute(
      sql`SELECT "serialNumber" FROM product_inspections WHERE "serialNumber" LIKE ${MARKER + "%"}`,
    )) as unknown as Array<{ serialNumber: string }>;
    expect(rows.map((r) => r.serialNumber)).toEqual([MARKER + "-new"]);

    const meas = (await db.execute(
      sql`SELECT id FROM measurement_results WHERE "inspectionId" IN (${oldId}, ${newId})`,
    )) as unknown as Array<{ id: number }>;
    expect(meas.length).toBe(1); // only the fresh measurement survives

    // Old files gone (key capture + per-inspection dir removal); fresh intact.
    expect(fs.existsSync(path.join(tmpUploads, oldKey))).toBe(false);
    expect(fs.existsSync(path.join(tmpUploads, `inspections/${oldId}`))).toBe(false);
    expect(fs.existsSync(path.join(tmpUploads, newKey))).toBe(true);
  });

  it("respects per-table disable (days <= 0)", async () => {
    setEnv("RETENTION_NOTIFICATIONS_DAYS", "0");
    await db.execute(sql`
      INSERT INTO notifications ("userId", type, title, message, "createdAt")
      VALUES (1, 'INFO', ${MARKER + "-disabled"}, 'old', now() - interval '400 days')`);

    await runRetentionOnce();

    const rows = (await db.execute(
      sql`SELECT title FROM notifications WHERE title = ${MARKER + "-disabled"}`,
    )) as unknown as Array<{ title: string }>;
    expect(rows.length).toBe(1); // untouched — retention disabled for this table
    setEnv("RETENTION_NOTIFICATIONS_DAYS", undefined);
  });
});
