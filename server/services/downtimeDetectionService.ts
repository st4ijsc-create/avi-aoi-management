/**
 * Downtime Auto-Detection Service
 * Automatically detects machine downtime based on inactivity
 */

import { getDb } from '../db';
import { sql, eq, isNull, and } from 'drizzle-orm';
import { downtimeEvents, machines } from '../../drizzle/schema';

// Track last activity timestamp per machine
const lastActivityMap = new Map<number, Date>();

// Configuration
const DOWNTIME_THRESHOLD_MINUTES = 10; // Machine inactive for 10 minutes = downtime
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

let detectionInterval: NodeJS.Timeout | null = null;

/**
 * Update last activity timestamp for a machine
 */
export function recordMachineActivity(machineId: number): void {
  lastActivityMap.set(machineId, new Date());
}

/**
 * Check for inactive machines and create downtime events
 */
async function checkForDowntimes(): Promise<void> {
  const now = new Date();
  const thresholdTime = new Date(now.getTime() - DOWNTIME_THRESHOLD_MINUTES * 60 * 1000);
  
  try {
    const db = await getDb();
    if (!db) return;
    
    // Get all machines with their last activity
    for (const [machineId, lastActivity] of Array.from(lastActivityMap.entries())) {
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
          // Get machine code
          const machineResult = await db.select({ code: machines.code })
            .from(machines)
            .where(eq(machines.id, machineId))
            .limit(1);
          
          if (machineResult.length > 0) {
            const machineCode = machineResult[0].code;
            
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
              const machineResult = await db.select({ code: machines.code })
                .from(machines)
                .where(eq(machines.id, machineId))
                .limit(1);
              const machineCode = machineResult.length > 0 ? machineResult[0].code : 'UNKNOWN';
              
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
  
  console.log(`[Downtime Detection] Starting service (threshold: ${DOWNTIME_THRESHOLD_MINUTES} minutes)`);
  
  // Run check immediately
  checkForDowntimes();
  
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
    thresholdMinutes: DOWNTIME_THRESHOLD_MINUTES,
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

    const history = (recentDowntimes.rows || []).map((r: any) =>
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
    });

    const parsed = JSON.parse(response.text);
    if (parsed.likelyCause) return parsed;

    const match = response.text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return null;
  } catch {
    return null;
  }
}
