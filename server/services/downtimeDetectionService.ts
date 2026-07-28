/**
 * Downtime Auto-Detection Service
 * Automatically detects machine downtime based on inactivity
 */

import { getDb } from '../db';
import { sql, eq, isNull, and } from 'drizzle-orm';
import { downtimeEvents, machines } from '../../drizzle/schema';
// doc69 W1 "modelfix" — shared env→GGUF-basename resolver; the downtime RCA below must PIN a text
// model (un-pinned calls used to land on the 0.6B RAG embedder → repetition garbage).
import { resolveLogicalModel } from './ai/modelResolver';

// Track last activity timestamp per machine
const lastActivityMap = new Map<number, Date>();

// Configuration
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

/**
 * doc 40 MON-F4 — ngưỡng bất-hoạt (phút) đưa ra env DOWNTIME_INACTIVITY_MINUTES (default
 * 10). Trước đây hard-code 10' → không chỉnh được theo dây chuyền.
 */
function thresholdMinutes(): number {
  const n = Number(process.env.DOWNTIME_INACTIVITY_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

let detectionInterval: NodeJS.Timeout | null = null;

/**
 * Update last activity timestamp for a machine
 */
export function recordMachineActivity(machineId: number): void {
  lastActivityMap.set(machineId, new Date());
}

/**
 * doc 40 MON-F4 — nạp lastActivity lúc START từ MAX(ot_telemetry.ts / product_inspections.
 * inspectionTime / machines.lastHeartbeat) mỗi máy. Trước đây map in-memory rỗng sau restart
 * → máy im-lặng-từ-boot không có mốc để so ngưỡng ⇒ downtime KHÔNG bao giờ được phát hiện.
 * KHÔNG ghi đè giá trị đang chạy (recordMachineActivity thắng). Máy chưa từng hoạt động
 * (mọi nguồn null ⇒ GREATEST = epoch) bị BỎ QUA — không bịa mốc. Non-throwing.
 */
async function seedLastActivityFromDb(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;
    const res = await db.execute(sql.raw(`
      SELECT m.id AS "machineId",
        GREATEST(
          COALESCE(t.max_ts, 'epoch'::timestamptz),
          COALESCE(i.max_ts::timestamptz, 'epoch'::timestamptz),
          COALESCE(m."lastHeartbeat"::timestamptz, 'epoch'::timestamptz)
        ) AS last_activity
      FROM machines m
      LEFT JOIN (
        SELECT "machineId", MAX(ts) AS max_ts FROM ot_telemetry
        WHERE "machineId" IS NOT NULL GROUP BY "machineId"
      ) t ON t."machineId" = m.id
      LEFT JOIN (
        SELECT "machineId", MAX("inspectionTime") AS max_ts FROM product_inspections
        GROUP BY "machineId"
      ) i ON i."machineId" = m.id
      WHERE m."isActive" = true
    `));
    const rows = (((res as any).rows ?? res) || []) as Array<{ machineId: number; last_activity: string | Date | null }>;
    let seeded = 0;
    for (const row of rows) {
      const id = Number(row.machineId);
      if (!Number.isFinite(id) || row.last_activity == null) continue;
      if (lastActivityMap.has(id)) continue; // đừng ghi đè hoạt động đang ghi live
      const d = new Date(row.last_activity);
      if (Number.isNaN(d.getTime()) || d.getTime() <= 0) continue; // epoch = chưa từng hoạt động
      lastActivityMap.set(id, d);
      seeded += 1;
    }
    console.log(`[Downtime Detection] seeded lastActivity for ${seeded} machine(s) from history`);
    return seeded;
  } catch (err) {
    console.error('[Downtime Detection] seed failed:', (err as Error)?.message ?? err);
    return 0;
  }
}

/**
 * Check for inactive machines and create downtime events
 */
async function checkForDowntimes(): Promise<void> {
  const now = new Date();
  const thresholdTime = new Date(now.getTime() - thresholdMinutes() * 60 * 1000);

  try {
    const db = await getDb();
    if (!db) return;

    // doc 40 MON-F4 — quét theo DANH SÁCH máy đang active (không chỉ theo map). Máy có
    // seed/live lastActivity mới được xét (undefined ⇒ chưa có mốc thật → bỏ qua, không bịa).
    // Lấy code trong 1 truy vấn (thay vì query từng máy) để đối chiếu + ghi downtime.
    const activeMachines = await db.select({ id: machines.id, code: machines.code })
      .from(machines)
      .where(eq(machines.isActive, true));
    const codeById = new Map<number, string>();
    for (const m of activeMachines) codeById.set(m.id, m.code);

    // Xét mọi máy active CÓ mốc lastActivity (seed lúc boot hoặc ghi live).
    for (const machineId of codeById.keys()) {
      const lastActivity = lastActivityMap.get(machineId);
      if (!lastActivity) continue; // chưa có mốc hoạt động → không đủ cơ sở suy downtime
      const machineCode = codeById.get(machineId)!;
      // Check if machine is inactive beyond threshold
      if (lastActivity < thresholdTime) {
        // Check if there's already an active downtime for this machine
        const existingDowntime = await db.select({ id: downtimeEvents.id })
          .from(downtimeEvents)
          .where(and(
            eq(downtimeEvents.machineId, machineId),
            isNull(downtimeEvents.endTime)
          ))
          .limit(1);

        if (existingDowntime.length === 0) {
          // Create auto-detected downtime event
          await db.insert(downtimeEvents).values({
            machineId,
            machineCode,
            category: 'unplanned',
            reason: 'Auto-detected: Machine inactive',
            startTime: lastActivity,
            detectionMethod: 'AUTO',
          });

          console.log(`[Downtime Detection] Auto-created downtime for machine ${machineCode} (ID: ${machineId})`);

          // Emit socket event if available
          try {
            const socketModule = await import('../_core/socket');
            const io = (socketModule as any).io;
            if (io) {
              const event = {
                id: `DT-AUTO-${Date.now()}-${machineId}`,
                machineId,
                machineCode,
                startTime: lastActivity,
                category: 'unplanned' as const,
                reason: 'Auto-detected: Machine inactive',
                detectionMethod: 'AUTO',
              };
              io.to("global").emit("downtime:start", event);
              io.to(`machine:${machineId}`).emit("downtime:start", event);
            }
          } catch (err) {
            // Socket.io not available, skip emit
          }
        }
      } else {
        // Machine is active, check if there's an auto-detected downtime to close
        const activeDowntime = await db.select({
            id: downtimeEvents.id,
            startTime: downtimeEvents.startTime,
          })
          .from(downtimeEvents)
          .where(and(
            eq(downtimeEvents.machineId, machineId),
            isNull(downtimeEvents.endTime),
            eq(downtimeEvents.detectionMethod, 'AUTO')
          ))
          .orderBy(sql`${downtimeEvents.startTime} DESC`)
          .limit(1);
        
        if (activeDowntime.length > 0) {
          const downtimeRow = activeDowntime[0];
          const startTime = new Date(downtimeRow.startTime);
          const duration = Math.round((now.getTime() - startTime.getTime()) / 60000);
          
          // Auto-end the downtime
          await db.update(downtimeEvents)
            .set({
              endTime: now,
              duration,
              resolution: 'Auto-resolved: Machine became active',
            })
            .where(eq(downtimeEvents.id, downtimeRow.id));
          
          console.log(`[Downtime Detection] Auto-ended downtime for machine ID: ${machineId}`);
          
          // Emit socket event
          try {
            const socketModule = await import('../_core/socket');
            const io = (socketModule as any).io;
            if (io) {
              const event = {
                id: `DT-AUTO-${downtimeRow.id}`,
                machineId,
                machineCode,
                startTime,
                endTime: now,
                duration,
                category: 'unplanned' as const,
                reason: 'Auto-detected: Machine inactive',
                resolution: 'Auto-resolved: Machine became active',
              };
              io.to("global").emit("downtime:end", event);
              io.to(`machine:${machineId}`).emit("downtime:end", event);
            }
          } catch (err) {
            // Socket.io not available, skip emit
          }
        }
      }
    }
  } catch (error) {
    console.error('[Downtime Detection] Error checking for downtimes:', error);
  }
}

/**
 * Start the downtime detection service
 */
export function startDowntimeDetection(): void {
  if (detectionInterval) {
    console.log('[Downtime Detection] Service already running');
    return;
  }
  
  console.log(`[Downtime Detection] Starting service (threshold: ${thresholdMinutes()} minutes)`);

  // doc 40 MON-F4 — nạp lastActivity từ lịch sử TRƯỚC lần quét đầu tiên, để máy đã im lặng
  // từ trước khi restart vẫn có mốc để phát hiện downtime (không còn "vô hình từ boot").
  void seedLastActivityFromDb().then(() => checkForDowntimes()).catch(() => {});

  // Then run periodically
  detectionInterval = setInterval(checkForDowntimes, CHECK_INTERVAL_MS);
}

/**
 * Stop the downtime detection service
 */
export function stopDowntimeDetection(): void {
  if (detectionInterval) {
    clearInterval(detectionInterval);
    detectionInterval = null;
    console.log('[Downtime Detection] Service stopped');
  }
}

/**
 * Get current configuration
 */
export function getDowntimeDetectionConfig() {
  return {
    enabled: detectionInterval !== null,
    thresholdMinutes: thresholdMinutes(),
    checkIntervalSeconds: CHECK_INTERVAL_MS / 1000,
    trackedMachines: lastActivityMap.size,
  };
}

// ─── AI Root Cause Analysis ─────────────────────────────────────────────────

export interface DowntimeRootCauseAnalysis {
  likelyCause: string;
  confidence: number;
  possibleCauses: string[];
  suggestedActions: string[];
  estimatedRecoveryMinutes: number | null;
}

/**
 * Generate AI-powered root cause analysis for a downtime event.
 * Non-blocking — returns null on any failure.
 */
export async function analyzeDowntimeRootCause(params: {
  machineId: number;
  machineCode: string;
  downtimeDurationMinutes: number;
  category: string;
  reason?: string;
}): Promise<DowntimeRootCauseAnalysis | null> {
  try {
    const { generateText } = await import('./aiGgufEngine');
    const db = await getDb();
    if (!db) return null;

    // Get recent downtime history for this machine
    const recentDowntimes = await db.execute(sql.raw(`
      SELECT category, reason, duration, "startTime", "endTime"
      FROM downtime_events
      WHERE "machineId" = ${params.machineId}
        AND "startTime" > NOW() - INTERVAL '7 days'
      ORDER BY "startTime" DESC
      LIMIT 10
    `));

    const history = (((recentDowntimes as any).rows ?? recentDowntimes) || []).map((r: any) =>
      `${r.category}: ${r.reason || 'unknown'} (${r.duration || '?'}min)`
    ).join('; ');

    const response = await generateText({
      systemPrompt: `You are a manufacturing equipment reliability expert. Analyze machine downtime events and provide root cause analysis.
Reply in JSON: { "likelyCause": string, "confidence": number(0-1), "possibleCauses": string[], "suggestedActions": string[], "estimatedRecoveryMinutes": number|null }`,
      prompt: `Machine ${params.machineCode} (ID: ${params.machineId}) is down.
Current downtime: ${params.downtimeDurationMinutes} minutes
Category: ${params.category}
Reason: ${params.reason || 'Auto-detected inactivity'}
Recent 7-day history: ${history || 'No recent downtimes'}

Analyze the likely root cause and suggest recovery actions.`,
      maxTokens: 512,
      temperature: 0.3,
      jsonMode: true,
    }, resolveLogicalModel('chat'));

    const parsed = JSON.parse(response.text);
    if (parsed.likelyCause) return parsed;

    const match = response.text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return null;
  } catch {
    return null;
  }
}
