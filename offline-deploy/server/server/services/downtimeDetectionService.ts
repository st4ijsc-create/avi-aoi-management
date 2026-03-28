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
