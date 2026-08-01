/**
 * Hierarchy Tree Router
 * 
 * Cung cấp API cho App client để lấy toàn bộ cây phân cấp:
 *   Factory → Workshop → Production Line → Station → Machine
 * 
 * Và tự động sinh chuỗi MQTT Subscription topics tối ưu theo từng cấp.
 * 
 * MQTT Topic Pattern: avi/{factoryId}/workshop/{workshopId}/station/{stationId}/{messageType}
 */
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MachineNode {
  id: number;
  code: string;
  name: string;
  machineType: string;
  operationStatus: string;
}

interface StationNode {
  id: number;
  code: string;
  name: string;
  orderIndex: number;
  machines: MachineNode[];
}

interface LineNode {
  id: number;
  code: string;
  name: string;
  stations: StationNode[];
}

interface WorkshopNode {
  id: number;
  code: string;
  name: string;
  lines: LineNode[];
}

interface FactoryNode {
  id: number;
  code: string;
  name: string;
  workshops: WorkshopNode[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MQTT_MESSAGE_TYPES = ["inspection", "errors", "status", "heartbeat", "summary/daily", "summary/weekly"] as const;

// ─── Exported helpers for REST proxy ─────────────────────────────────────────

/** Assemble flat joined rows into a nested tree structure. */
export function buildHierarchyTree(rows: Awaited<ReturnType<typeof db.getFullHierarchyFlat>>): FactoryNode[] {
  return buildTree(rows);
}

/** Generate MQTT topics — used by REST proxy at /api/external/hierarchy/mqtt-topics */
export function generateMqttTopicsForScope(
  tree: FactoryNode[],
  scope: { level: string; factoryId?: number; workshopId?: number; lineId?: number; stationId?: number },
  messageTypes?: string[],
) {
  return generateMqttTopics(tree, scope, messageTypes);
}

/** Get MQTT message types list — used by REST proxy */
export function getMqttMessageTypesList() {
  return MQTT_MESSAGE_TYPES.map(type => ({
    type,
    qos: type === "errors" ? 2 : (type === "status" || type === "heartbeat") ? 0 : 1,
    description: {
      inspection: "Kết quả kiểm tra",
      errors: "Cảnh báo NG",
      status: "Trạng thái máy",
      heartbeat: "Heartbeat",
      "summary/daily": "Báo cáo ngày",
      "summary/weekly": "Báo cáo tuần",
    }[type],
  }));
}

/**
 * Assemble flat joined rows into a nested tree structure.
 */
function buildTree(rows: Awaited<ReturnType<typeof db.getFullHierarchyFlat>>): FactoryNode[] {
  const factoryMap = new Map<number, FactoryNode>();

  for (const row of rows) {
    // Factory
    if (!factoryMap.has(row.factoryId)) {
      factoryMap.set(row.factoryId, {
        id: row.factoryId,
        code: row.factoryCode,
        name: row.factoryName,
        workshops: [],
      });
    }
    const factory = factoryMap.get(row.factoryId)!;

    if (row.workshopId == null) continue;

    // Workshop
    let workshop = factory.workshops.find(w => w.id === row.workshopId);
    if (!workshop) {
      workshop = {
        id: row.workshopId,
        code: row.workshopCode!,
        name: row.workshopName!,
        lines: [],
      };
      factory.workshops.push(workshop);
    }

    if (row.lineId == null) continue;

    // Line
    let line = workshop.lines.find(l => l.id === row.lineId);
    if (!line) {
      line = {
        id: row.lineId,
        code: row.lineCode!,
        name: row.lineName!,
        stations: [],
      };
      workshop.lines.push(line);
    }

    if (row.stationId == null) continue;

    // Station
    let station = line.stations.find(s => s.id === row.stationId);
    if (!station) {
      station = {
        id: row.stationId,
        code: row.stationCode!,
        name: row.stationName!,
        orderIndex: row.stationOrderIndex ?? 0,
        machines: [],
      };
      line.stations.push(station);
    }

    if (row.machineId == null) continue;

    // Machine (avoid duplicate)
    if (!station.machines.some(m => m.id === row.machineId)) {
      station.machines.push({
        id: row.machineId,
        code: row.machineCode!,
        name: row.machineName!,
        machineType: row.machineType!,
        operationStatus: row.machineOperationStatus!,
      });
    }
  }

  return Array.from(factoryMap.values());
}

/**
 * Generate MQTT subscription topics based on scope level.
 * 
 * Scope levels:
 * Topics use the canonical published prefix `avi/factory/...` so they match what the
 * publishers (mqttService NG alerts/summary/bulletin, ngRateAlertService) actually emit.
 *
 * Scope levels:
 *  - "all"       → subscribe mọi factory dùng wildcard `avi/factory/+/workshop/+/station/+/#`
 *  - "factory"   → `avi/factory/{factoryId}/workshop/+/station/+/#`
 *  - "workshop"  → `avi/factory/{factoryId}/workshop/{workshopId}/station/+/#`
 *  - "line"      → list các station topics thuộc line đó
 *  - "station"   → `avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/#`
 */
function generateMqttTopics(
  tree: FactoryNode[],
  scope: { level: string; factoryId?: number; workshopId?: number; lineId?: number; stationId?: number },
  messageTypes?: string[],
): { topic: string; description: string; qos: number }[] {
  const types = messageTypes && messageTypes.length > 0 ? messageTypes : undefined;

  // Helper: build a single topic suffix or wildcard
  const suffix = (type?: string) => type ?? "#";
  const qosFor = (type?: string): number => {
    if (!type) return 1;
    if (type === "errors") return 2;
    if (type === "status" || type === "heartbeat") return 0;
    return 1;
  };

  const topics: { topic: string; description: string; qos: number }[] = [];

  if (scope.level === "all") {
    if (types) {
      for (const t of types) {
        topics.push({ topic: `avi/factory/+/workshop/+/station/+/${t}`, description: `All factories - ${t}`, qos: qosFor(t) });
      }
    } else {
      topics.push({ topic: `avi/factory/+/workshop/+/station/+/#`, description: "All factories - all messages", qos: 1 });
    }
    return topics;
  }

  if (scope.level === "factory" && scope.factoryId) {
    const fId = scope.factoryId;
    const factory = tree.find(f => f.id === fId);
    const desc = factory ? factory.name : `Factory ${fId}`;
    if (types) {
      for (const t of types) {
        topics.push({ topic: `avi/factory/${fId}/workshop/+/station/+/${t}`, description: `${desc} - ${t}`, qos: qosFor(t) });
      }
    } else {
      topics.push({ topic: `avi/factory/${fId}/workshop/+/station/+/#`, description: `${desc} - all messages`, qos: 1 });
    }
    return topics;
  }

  if (scope.level === "workshop" && scope.factoryId && scope.workshopId) {
    const fId = scope.factoryId;
    const wId = scope.workshopId;
    const factory = tree.find(f => f.id === fId);
    const workshop = factory?.workshops.find(w => w.id === wId);
    const desc = workshop ? `${factory!.name} / ${workshop.name}` : `Workshop ${wId}`;
    if (types) {
      for (const t of types) {
        topics.push({ topic: `avi/factory/${fId}/workshop/${wId}/station/+/${t}`, description: `${desc} - ${t}`, qos: qosFor(t) });
      }
    } else {
      topics.push({ topic: `avi/factory/${fId}/workshop/${wId}/station/+/#`, description: `${desc} - all messages`, qos: 1 });
    }
    return topics;
  }

  if (scope.level === "line" && scope.lineId) {
    // For a line, we enumerate all stations belonging to that line
    for (const factory of tree) {
      for (const workshop of factory.workshops) {
        for (const line of workshop.lines) {
          if (line.id === scope.lineId) {
            for (const station of line.stations) {
              if (types) {
                for (const t of types) {
                  topics.push({
                    topic: `avi/factory/${factory.id}/workshop/${workshop.id}/station/${station.id}/${t}`,
                    description: `${factory.name} / ${workshop.name} / ${line.name} / ${station.name} - ${t}`,
                    qos: qosFor(t),
                  });
                }
              } else {
                topics.push({
                  topic: `avi/factory/${factory.id}/workshop/${workshop.id}/station/${station.id}/#`,
                  description: `${factory.name} / ${workshop.name} / ${line.name} / ${station.name} - all`,
                  qos: 1,
                });
              }
            }
          }
        }
      }
    }
    return topics;
  }

  if (scope.level === "station" && scope.stationId) {
    for (const factory of tree) {
      for (const workshop of factory.workshops) {
        for (const line of workshop.lines) {
          for (const station of line.stations) {
            if (station.id === scope.stationId) {
              if (types) {
                for (const t of types) {
                  topics.push({
                    topic: `avi/factory/${factory.id}/workshop/${workshop.id}/station/${station.id}/${t}`,
                    description: `${station.name} - ${t}`,
                    qos: qosFor(t),
                  });
                }
              } else {
                topics.push({
                  topic: `avi/factory/${factory.id}/workshop/${workshop.id}/station/${station.id}/#`,
                  description: `${station.name} - all messages`,
                  qos: 1,
                });
              }
              return topics;
            }
          }
        }
      }
    }
    return topics;
  }

  return topics;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const hierarchyTreeRouter = router({
  /**
   * Lấy toàn bộ cây phân cấp: Factory → Workshop → Line → Station → Machine
   * App client dùng để hiển thị tree selector và cấu hình MQTT subscription.
   */
  getTree: protectedProcedure.query(async () => {
    const rows = await db.getFullHierarchyFlat();
    return buildTree(rows);
  }),

  /**
   * Lấy cây phân cấp cho 1 factory cụ thể
   */
  getFactoryTree: protectedProcedure
    .input(z.object({ factoryId: z.number() }))
    .query(async ({ input }) => {
      const rows = await db.getFactoryHierarchyFlat(input.factoryId);
      const tree = buildTree(rows as any);
      return tree[0] ?? null;
    }),

  /**
   * Sinh danh sách MQTT subscription topics tối ưu theo scope.
   * 
   * Client gửi scope (level + id) và nhận lại danh sách topics cần subscribe. 
   * 
   * Scope levels:
   *   "all"      → subscribe tất cả
   *   "factory"  → subscribe 1 factory (dùng wildcard cho workshop/station)
   *   "workshop" → subscribe 1 workshop (dùng wildcard cho station)
   *   "line"     → subscribe tất cả station trong 1 line
   *   "station"  → subscribe 1 station cụ thể
   * 
   * messageTypes (optional): Chỉ subscribe các loại message cần thiết
   *   ["inspection", "errors", "status", "heartbeat", "summary/daily", "summary/weekly"]
   *   Nếu không truyền → dùng wildcard # cho tất cả message types.
   */
  getMqttTopics: protectedProcedure
    .input(z.object({
      level: z.enum(["all", "factory", "workshop", "line", "station"]),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      stationId: z.number().optional(),
      messageTypes: z.array(z.enum(["inspection", "errors", "status", "heartbeat", "summary/daily", "summary/weekly"])).optional(),
    }))
    .query(async ({ input }) => {
      const rows = await db.getFullHierarchyFlat();
      const tree = buildTree(rows);
      return generateMqttTopics(tree, input, input.messageTypes);
    }),

  /**
   * Lấy danh sách tất cả message types hỗ trợ bởi MQTT system
   */
  getMqttMessageTypes: protectedProcedure.query(() => {
    return MQTT_MESSAGE_TYPES.map(type => ({
      type,
      qos: type === "errors" ? 2 : (type === "status" || type === "heartbeat") ? 0 : 1,
      description: {
        inspection: "Kết quả kiểm tra",
        errors: "Cảnh báo NG",
        status: "Trạng thái máy",
        heartbeat: "Heartbeat",
        "summary/daily": "Báo cáo ngày",
        "summary/weekly": "Báo cáo tuần",
      }[type],
    }));
  }),

  /**
   * Lấy thông tin tóm tắt hierarchy (số lượng mỗi cấp) — để hiển thị trên dashboard
   */
  getSummary: protectedProcedure.query(async () => {
    const rows = await db.getFullHierarchyFlat();
    const tree = buildTree(rows);

    let totalWorkshops = 0;
    let totalLines = 0;
    let totalStations = 0;
    let totalMachines = 0;

    for (const factory of tree) {
      totalWorkshops += factory.workshops.length;
      for (const workshop of factory.workshops) {
        totalLines += workshop.lines.length;
        for (const line of workshop.lines) {
          totalStations += line.stations.length;
          for (const station of line.stations) {
            totalMachines += station.machines.length;
          }
        }
      }
    }

    return {
      factories: tree.length,
      workshops: totalWorkshops,
      lines: totalLines,
      stations: totalStations,
      machines: totalMachines,
    };
  }),
});
