/**
 * Backup Scheduler Service
 *
 * Drives `scheduled_backups` table: registers node-cron jobs, executes
 * pg_dump via backupService, writes a `backup_logs` row per run, and
 * enforces per-config `retentionCount` by deleting oldest files on disk.
 *
 * Standards: ISO 22301 (DR), ISO 9001:2015 §7.5.3 (control of records).
 */

import cron, { ScheduledTask } from "node-cron";
import * as fs from "fs";
import * as path from "path";
import * as db from "../db";
import {
  createPgDump,
  listBackupFiles,
  deleteBackupFile,
  TABLE_CATEGORIES,
} from "./backupService";

const activeJobs = new Map<number, ScheduledTask>();

export function scheduleToCron(s: {
  schedule: string;
  scheduleTime: string;
  scheduleDayOfWeek?: number | null;
  scheduleDayOfMonth?: number | null;
}): string {
  const [hour, minute] = (s.scheduleTime || "02:00").split(":").map(Number);
  const sched = (s.schedule || "DAILY").toUpperCase();
  switch (sched) {
    case "WEEKLY":
      return `${minute} ${hour} * * ${s.scheduleDayOfWeek ?? 0}`;
    case "MONTHLY":
      return `${minute} ${hour} ${s.scheduleDayOfMonth ?? 1} * *`;
    case "HOURLY":
      return `${minute} * * * *`;
    case "DAILY":
    default:
      return `${minute} ${hour} * * *`;
  }
}

export function computeNextRun(s: {
  schedule: string;
  scheduleTime: string;
  scheduleDayOfWeek?: number | null;
  scheduleDayOfMonth?: number | null;
}): Date {
  const [hour, minute] = (s.scheduleTime || "02:00").split(":").map(Number);
  const next = new Date();
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  const sched = (s.schedule || "DAILY").toUpperCase();
  if (sched === "DAILY") {
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  } else if (sched === "WEEKLY") {
    const dow = s.scheduleDayOfWeek ?? 0;
    while (next.getDay() !== dow || next.getTime() <= Date.now()) {
      next.setDate(next.getDate() + 1);
    }
  } else if (sched === "MONTHLY") {
    const dom = s.scheduleDayOfMonth ?? 1;
    next.setDate(dom);
    if (next.getTime() <= Date.now()) next.setMonth(next.getMonth() + 1);
  } else {
    next.setMinutes(next.getMinutes() + 60);
  }
  return next;
}

function enforceRetention(prefix: string, retention: number): number {
  if (!retention || retention <= 0) return 0;
  const all = listBackupFiles();
  const owned = all.filter(f => f.fileName.startsWith(`backup_${prefix}_`));
  // listBackupFiles already sorts newest-first
  const stale = owned.slice(retention);
  for (const f of stale) {
    try {
      deleteBackupFile(f.fileName);
    } catch {
      /* swallow — best effort */
    }
  }
  return stale.length;
}

export async function executeScheduledBackup(backupId: number): Promise<void> {
  const startedAt = new Date();
  let status: "SUCCESS" | "FAILED" = "SUCCESS";
  let errorMessage: string | undefined;
  let fileName: string | undefined;
  let fileSize: number | undefined;
  let recordCount = 0;

  try {
    const rows = await db.getScheduledBackupById(backupId);
    const cfg = Array.isArray(rows) ? rows[0] : rows;
    if (!cfg || !cfg.isEnabled) return;

    const categories: string[] = Array.isArray(cfg.categories) ? cfg.categories : [];
    const tables = categories.flatMap(c => TABLE_CATEGORIES[c] ?? []);

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL not configured");

    const safeLabel = (cfg.name || `sched_${backupId}`)
      .replace(/[^a-z0-9]/gi, "_")
      .slice(0, 64);

    const result = await createPgDump({
      databaseUrl,
      tables: tables.length > 0 ? tables : undefined,
      label: safeLabel,
    });

    fileName = result.fileName;
    fileSize = result.fileSizeBytes;
    recordCount = result.tableCount;

    enforceRetention(safeLabel, cfg.retentionCount ?? 7);

    await db.updateScheduledBackup(backupId, {
      lastRunAt: startedAt,
      lastRunStatus: "SUCCESS" as any,
      nextRunAt: computeNextRun(cfg as any),
    } as any);
  } catch (err: any) {
    status = "FAILED";
    errorMessage = err?.message ?? String(err);
    try {
      await db.updateScheduledBackup(backupId, {
        lastRunAt: startedAt,
        lastRunStatus: "FAILED" as any,
      } as any);
    } catch {
      /* ignore */
    }
  }

  try {
    await db.createBackupLog?.({
      userId: 0, // system run
      action: "BACKUP" as any,
      categories: [] as any,
      status: status as any,
      fileName: fileName ?? null,
      fileSize: fileSize ?? null,
      recordCount,
      errorMessage: errorMessage ?? null,
    } as any);
  } catch {
    /* ignore */
  }
}

export function scheduleBackup(cfg: {
  id: number;
  schedule: string;
  scheduleTime: string;
  scheduleDayOfWeek?: number | null;
  scheduleDayOfMonth?: number | null;
}): void {
  stopScheduledBackup(cfg.id);
  try {
    const expr = scheduleToCron(cfg);
    const task = cron.schedule(expr, () => {
      executeScheduledBackup(cfg.id).catch(e =>
        console.error(`[BackupScheduler] job ${cfg.id} failed:`, e)
      );
    });
    activeJobs.set(cfg.id, task);
    console.log(`[BackupScheduler] scheduled backup ${cfg.id} (${expr})`);
  } catch (err) {
    console.error(`[BackupScheduler] failed to schedule backup ${cfg.id}:`, err);
  }
}

export function stopScheduledBackup(id: number): void {
  const task = activeJobs.get(id);
  if (task) {
    task.stop();
    activeJobs.delete(id);
  }
}

export async function initializeScheduledBackups(): Promise<void> {
  try {
    const list = await db.listScheduledBackups?.(true);
    if (!Array.isArray(list)) return;
    for (const cfg of list) {
      scheduleBackup({
        id: cfg.id,
        schedule: String(cfg.schedule),
        scheduleTime: cfg.scheduleTime,
        scheduleDayOfWeek: cfg.scheduleDayOfWeek ?? null,
        scheduleDayOfMonth: cfg.scheduleDayOfMonth ?? null,
      });
    }
    console.log(`[BackupScheduler] initialized ${list.length} backup jobs`);
  } catch (err) {
    console.error("[BackupScheduler] initialize failed:", err);
  }
}

export function shutdownScheduledBackups(): void {
  for (const [, task] of activeJobs) task.stop();
  activeJobs.clear();
}
