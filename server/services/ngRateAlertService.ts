/**
 * NG Rate Alert Service
 * 
 * Tự động kiểm tra tỉ lệ NG theo điểm đo trong ngày.
 * Khi NG rate vượt ngưỡng cài đặt → gửi bản tin MQTT cảnh báo.
 * 
 * Flow:
 * 1. Sau mỗi lần submit inspection, gọi checkNgRateAfterInspection()
 * 2. Service query các threshold đang active cho station/machine tương ứng
 * 3. Tính NG rate trong ngày cho từng điểm đo
 * 4. Nếu vượt ngưỡng + qua cooldown → gửi MQTT alert + lưu history
 */

import { getDb } from "../db/connection";
import { eq, and, sql, gte, isNull, or, desc } from "drizzle-orm";
import * as schema from "../../drizzle/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NgRateAlertPayload {
  alertType: "NG_RATE_THRESHOLD";
  alertId: string;
  /**
   * Server-side resolvable id (`ngrate-{historyRowId}`). The mobile app prefers this
   * over `alertId` when resolving, so an NG-rate alert can be resolved server-side
   * (updates mqtt_ng_rate_alert_history). Undefined if the history pre-insert failed.
   */
  serverAlertId?: string;
  timestamp: string;
  severity: "warning" | "critical";
  station: {
    id: number;
    name: string;
    line: string;
    workshop: string;
    factory: string;
  };
  machine?: {
    id: number;
    name: string;
    code: string;
  };
  measurementPoint?: {
    id: number;
    code: string;
    name: string;
    referenceImageUrl?: string;
  };
  productModel?: {
    id: number;
    code: string;
    name: string;
  };
  ngRate: {
    current: number;       // NG rate hiện tại (%)
    threshold: number;     // Ngưỡng đã vượt (%)
    totalInspections: number;
    ngCount: number;
  };
  thresholdConfig: {
    id: number;
    name: string;
    warningThreshold: number;
    criticalThreshold: number;
    minSampleSize: number;
  };
  message: string;
  period: {
    date: string;          // YYYY-MM-DD
    from: string;          // ISO start of day
    to: string;            // ISO current time
  };
}

// ─── Core Function: Check NG Rate After Each Inspection ──────────────────────

/**
 * Được gọi sau mỗi lần submit inspection.
 * Kiểm tra tất cả threshold configs liên quan đến station/machine này.
 */
export async function checkNgRateAfterInspection(params: {
  stationId: number;
  machineId: number;
  inspectionId: number;
  productModelId?: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.log("[NgRateAlert] Database not available");
    return;
  }

  try {
    // 1. Lấy tất cả threshold configs active cho station này
    const thresholds = await db
      .select()
      .from(schema.mqttNgRateThresholds)
      .where(
        and(
          eq(schema.mqttNgRateThresholds.stationId, params.stationId),
          eq(schema.mqttNgRateThresholds.isEnabled, true),
          // Match machine: null (all machines) hoặc machineId cụ thể
          or(
            isNull(schema.mqttNgRateThresholds.machineId),
            eq(schema.mqttNgRateThresholds.machineId, params.machineId)
          ),
          // Match product model: null (all) hoặc productModelId cụ thể
          params.productModelId
            ? or(
                isNull(schema.mqttNgRateThresholds.productModelId),
                eq(schema.mqttNgRateThresholds.productModelId, params.productModelId)
              )
            : isNull(schema.mqttNgRateThresholds.productModelId)
        )
      );

    if (thresholds.length === 0) {
      return; // Không có threshold nào cấu hình
    }

    // 2. Kiểm tra từng threshold
    for (const threshold of thresholds) {
      await evaluateNgRateThreshold(db, threshold, params);
    }
  } catch (error) {
    console.error("[NgRateAlert] Error checking NG rate:", error);
  }
}

// ─── Evaluate Single Threshold ───────────────────────────────────────────────

async function evaluateNgRateThreshold(
  db: any,
  threshold: schema.MqttNgRateThreshold,
  params: { stationId: number; machineId: number; inspectionId: number; productModelId?: number }
): Promise<void> {
  // Check cooldown
  if (threshold.lastTriggeredAt) {
    const cooldownMs = (threshold.cooldownMinutes ?? 30) * 60 * 1000;
    const elapsed = Date.now() - new Date(threshold.lastTriggeredAt).getTime();
    if (elapsed < cooldownMs) {
      return; // Still in cooldown
    }
  }

  // Tính start of today (00:00:00)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Build conditions cho query NG rate
  const machineCondition = threshold.machineId
    ? eq(schema.productInspections.machineId, threshold.machineId)
    : eq(schema.productInspections.machineId, params.machineId);

  const productCondition = threshold.productModelId
    ? eq(schema.productInspections.productModelId, threshold.productModelId)
    : undefined;

  if (threshold.measurementPointId) {
    // ── NG rate cho điểm đo cụ thể ──
    await evaluatePointNgRate(db, threshold, params, todayStart, machineCondition, productCondition);
  } else {
    // ── NG rate tổng thể (overall) cho station/machine ──
    await evaluateOverallNgRate(db, threshold, params, todayStart, machineCondition, productCondition);
  }
}

// ─── Evaluate NG Rate for Specific Measurement Point ─────────────────────────

async function evaluatePointNgRate(
  db: any,
  threshold: schema.MqttNgRateThreshold,
  params: { stationId: number; machineId: number; inspectionId: number; productModelId?: number },
  todayStart: Date,
  machineCondition: any,
  productCondition: any
): Promise<void> {
  // Query: đếm tổng và đếm NG cho điểm đo cụ thể trong ngày
  const conditions = [
    gte(schema.productInspections.inspectionTime, todayStart),
    machineCondition,
  ];
  if (productCondition) conditions.push(productCondition);

  const result = await db
    .select({
      total: sql<number>`COUNT(*)`.as("total"),
      ngCount: sql<number>`SUM(CASE WHEN ${schema.measurementResults.result} = 'NG' THEN 1 ELSE 0 END)`.as("ngCount"),
    })
    .from(schema.measurementResults)
    .innerJoin(
      schema.productInspections,
      eq(schema.measurementResults.inspectionId, schema.productInspections.id)
    )
    .where(
      and(
        eq(schema.measurementResults.pointDefId, threshold.measurementPointId!),
        ...conditions
      )
    );

  const total = Number(result[0]?.total || 0);
  const ngCount = Number(result[0]?.ngCount || 0);

  if (total < (threshold.minSampleSize ?? 10)) {
    return; // Chưa đủ mẫu
  }

  const ngRate = (ngCount / total) * 100;
  const warningThreshold = Number(threshold.warningThreshold);
  const criticalThreshold = Number(threshold.criticalThreshold);

  let severity: "warning" | "critical" | null = null;
  let triggeredThreshold: number = 0;

  if (ngRate >= criticalThreshold) {
    severity = "critical";
    triggeredThreshold = criticalThreshold;
  } else if (ngRate >= warningThreshold) {
    severity = "warning";
    triggeredThreshold = warningThreshold;
  }

  if (!severity) return; // Chưa vượt ngưỡng

  // Lấy thông tin điểm đo
  const pointDef = await db
    .select()
    .from(schema.measurementPointDefs)
    .where(eq(schema.measurementPointDefs.id, threshold.measurementPointId!))
    .limit(1);

  // Gửi alert
  await sendNgRateAlert(db, threshold, {
    ...params,
    ngRate: parseFloat(ngRate.toFixed(2)),
    triggeredThreshold,
    total,
    ngCount,
    severity,
    pointDef: pointDef[0] || null,
  });
}

// ─── Evaluate Overall NG Rate (no specific point) ────────────────────────────

async function evaluateOverallNgRate(
  db: any,
  threshold: schema.MqttNgRateThreshold,
  params: { stationId: number; machineId: number; inspectionId: number; productModelId?: number },
  todayStart: Date,
  machineCondition: any,
  productCondition: any
): Promise<void> {
  // Query: đếm tổng inspections và đếm NG trong ngày
  const conditions = [
    gte(schema.productInspections.inspectionTime, todayStart),
    machineCondition,
  ];
  if (productCondition) conditions.push(productCondition);

  const result = await db
    .select({
      total: sql<number>`COUNT(*)`.as("total"),
      ngCount: sql<number>`SUM(CASE WHEN ${schema.productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`.as("ngCount"),
    })
    .from(schema.productInspections)
    .where(and(...conditions));

  const total = Number(result[0]?.total || 0);
  const ngCount = Number(result[0]?.ngCount || 0);

  if (total < (threshold.minSampleSize ?? 10)) {
    return; // Chưa đủ mẫu
  }

  const ngRate = (ngCount / total) * 100;
  const warningThreshold = Number(threshold.warningThreshold);
  const criticalThreshold = Number(threshold.criticalThreshold);

  let severity: "warning" | "critical" | null = null;
  let triggeredThreshold: number = 0;

  if (ngRate >= criticalThreshold) {
    severity = "critical";
    triggeredThreshold = criticalThreshold;
  } else if (ngRate >= warningThreshold) {
    severity = "warning";
    triggeredThreshold = warningThreshold;
  }

  if (!severity) return;

  await sendNgRateAlert(db, threshold, {
    ...params,
    ngRate: parseFloat(ngRate.toFixed(2)),
    triggeredThreshold,
    total,
    ngCount,
    severity,
    pointDef: null,
  });
}

// ─── Send MQTT Alert ─────────────────────────────────────────────────────────

async function sendNgRateAlert(
  db: any,
  threshold: schema.MqttNgRateThreshold,
  data: {
    stationId: number;
    machineId: number;
    inspectionId: number;
    productModelId?: number;
    ngRate: number;
    triggeredThreshold: number;
    total: number;
    ngCount: number;
    severity: "warning" | "critical";
    pointDef: schema.MeasurementPointDef | null;
  }
): Promise<void> {
  try {
    // Lấy thông tin station hierarchy
    const stationInfo = await db
      .select({
        station: schema.stations,
        line: schema.productionLines,
        workshop: schema.workshops,
        factory: schema.factories,
      })
      .from(schema.stations)
      .innerJoin(schema.productionLines, eq(schema.stations.lineId, schema.productionLines.id))
      .innerJoin(schema.workshops, eq(schema.productionLines.workshopId, schema.workshops.id))
      .innerJoin(schema.factories, eq(schema.workshops.factoryId, schema.factories.id))
      .where(eq(schema.stations.id, data.stationId))
      .limit(1);

    if (stationInfo.length === 0) {
      console.error("[NgRateAlert] Station not found:", data.stationId);
      return;
    }

    const { station, line, workshop, factory } = stationInfo[0];

    // Lấy thông tin machine
    const machineInfo = await db
      .select()
      .from(schema.machines)
      .where(eq(schema.machines.id, data.machineId))
      .limit(1);

    // Lấy thông tin product model
    let productModelInfo = null;
    if (data.productModelId) {
      const pmResult = await db
        .select()
        .from(schema.productModels)
        .where(eq(schema.productModels.id, data.productModelId))
        .limit(1);
      productModelInfo = pmResult[0] || null;
    }

    // Build alert message
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0];
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);

    const pointLabel = data.pointDef
      ? `điểm đo ${data.pointDef.code} (${data.pointDef.name})`
      : "tổng thể";

    const message =
      `[${data.severity === "critical" ? "🔴 CRITICAL" : "🟡 WARNING"}] ` +
      `Tỉ lệ NG ${pointLabel} đạt ${data.ngRate}% ` +
      `(ngưỡng: ${data.triggeredThreshold}%) - ` +
      `${data.ngCount}/${data.total} sản phẩm NG trong ngày ${dateStr} - ` +
      `Trạm: ${station.name}, Máy: ${machineInfo[0]?.name || "N/A"}`;

    // Build MQTT topic
    const topic = `avi/factory/${factory.id}/workshop/${workshop.id}/station/${data.stationId}/ng-rate-alert`;

    // Build payload
    const alertId = `NGRATE-${dateStr.replace(/-/g, "")}-${threshold.id}-${Date.now()}`;

    // Pre-persist the alert-history row FIRST (before publishing) so its row id can be
    // embedded in the payload as serverAlertId=`ngrate-{id}`. That lets the mobile app
    // resolve this NG-rate alert server-side (resolve-v2 updates this same row). The
    // delivery flags + full payload are filled in by the UPDATE after publishing below.
    let alertHistoryId: number | null = null;
    try {
      const [inserted] = await db.insert(schema.mqttNgRateAlertHistory).values({
        thresholdId: threshold.id,
        stationId: data.stationId,
        machineId: data.machineId,
        measurementPointId: threshold.measurementPointId,
        pointName: data.pointDef?.name || null,
        pointCode: data.pointDef?.code || null,
        productModelName: productModelInfo?.name || null,
        currentNgRate: String(data.ngRate),
        thresholdValue: String(data.triggeredThreshold),
        totalInspections: data.total,
        ngCount: data.ngCount,
        severity: data.severity,
        message,
        mqttTopic: topic,
        triggeredAt: new Date(),
      }).returning({ id: schema.mqttNgRateAlertHistory.id });
      alertHistoryId = inserted?.id ?? null;
    } catch (err) {
      console.error("[NgRateAlert] Failed to pre-save alert history:", err);
    }

    const payload: NgRateAlertPayload = {
      alertType: "NG_RATE_THRESHOLD",
      alertId,
      serverAlertId: alertHistoryId != null ? `ngrate-${alertHistoryId}` : undefined,
      timestamp: new Date().toISOString(),
      severity: data.severity,
      station: {
        id: station.id,
        name: station.name,
        line: line.name,
        workshop: workshop.name,
        factory: factory.name,
      },
      machine: machineInfo[0]
        ? {
            id: machineInfo[0].id,
            name: machineInfo[0].name,
            code: machineInfo[0].code,
          }
        : undefined,
      measurementPoint: data.pointDef
        ? {
            id: data.pointDef.id,
            code: data.pointDef.code,
            name: data.pointDef.name,
            referenceImageUrl: data.pointDef.referenceImageUrl || undefined,
          }
        : undefined,
      productModel: productModelInfo
        ? {
            id: productModelInfo.id,
            code: productModelInfo.code,
            name: productModelInfo.name,
          }
        : undefined,
      ngRate: {
        current: data.ngRate,
        threshold: data.triggeredThreshold,
        totalInspections: data.total,
        ngCount: data.ngCount,
      },
      thresholdConfig: {
        id: threshold.id,
        name: threshold.name,
        warningThreshold: Number(threshold.warningThreshold),
        criticalThreshold: Number(threshold.criticalThreshold),
        minSampleSize: threshold.minSampleSize ?? 10,
      },
      message,
      period: {
        date: dateStr,
        from: todayStart.toISOString(),
        to: new Date().toISOString(),
      },
    };

    const payloadStr = JSON.stringify(payload);
    let sentLocal = false;
    let sentExternal = false;
    let sentFcm = false;

    // ── Publish to local MQTT broker ──
    if (threshold.sendMqttLocal) {
      try {
        const { isMqttRunning } = await import("./mqttService");
        if (isMqttRunning()) {
          const Aedes = await import("aedes");
          const { aedes } = await import("./mqttService");
          if (aedes) {
            aedes.publish(
              {
                topic,
                payload: Buffer.from(payloadStr),
                qos: 1,
                retain: false,
                cmd: "publish",
                dup: false,
              },
              (error) => {
                if (error) {
                  console.error("[NgRateAlert] MQTT local publish error:", error);
                }
              }
            );
            sentLocal = true;
            console.log(`[NgRateAlert] Published to local MQTT: ${topic}`);
          }
        }
      } catch (err) {
        console.error("[NgRateAlert] Failed to publish to local MQTT:", err);
      }
    }

    // ── Publish to external MQTT broker ──
    if (threshold.sendMqttExternal) {
      try {
        const { publishToExternalMqtt, isExternalMqttConnected } = await import("./mqttService");
        if (isExternalMqttConnected()) {
          const externalTopic = `avi-aoi/factory/${factory.id}/workshop/${workshop.id}/station/${data.stationId}/ng-rate-alert`;
          sentExternal = publishToExternalMqtt(externalTopic, payloadStr);
          if (sentExternal) {
            console.log(`[NgRateAlert] Published to external MQTT: ${externalTopic}`);
          }
        }
      } catch (err) {
        console.error("[NgRateAlert] Failed to publish to external MQTT:", err);
      }
    }

    // ── Send FCM push notification ──
    if (threshold.sendFcm) {
      try {
        const { sendNGAlertPushNotification } = await import("./fcmService");
        await sendNGAlertPushNotification({
          stationId: data.stationId,
          stationName: station.name,
          machineId: data.machineId,
          machineName: machineInfo[0]?.name || "N/A",
          productCode: productModelInfo?.code || "N/A",
          ngCount: data.ngCount,
          measurementResults: data.pointDef
            ? [
                {
                  pointName: data.pointDef.code,
                  result: "NG",
                  measuredValue: data.ngRate,
                },
              ]
            : [],
          inspectionId: data.inspectionId,
        });
        sentFcm = true;
        console.log("[NgRateAlert] FCM notification sent");
      } catch (err) {
        console.error("[NgRateAlert] Failed to send FCM:", err);
      }
    }

    // ── Log message to mqtt_message_logs ──
    try {
      await db.insert(schema.mqttMessageLogs).values({
        messageType: "NG_ALERT",
        topic,
        payload: payload as any,
        stationId: data.stationId,
        inspectionId: data.inspectionId,
        deliveryStatus: sentLocal || sentExternal || sentFcm ? "DELIVERED" : "FAILED",
        deliveredAt: sentLocal || sentExternal || sentFcm ? new Date() : null,
      });
    } catch (err) {
      console.error("[NgRateAlert] Failed to log message:", err);
    }

    // ── Update alert history with delivery result + full payload ──
    // (row was pre-inserted above to obtain serverAlertId; here we fill in the rest)
    if (alertHistoryId != null) {
      try {
        await db.update(schema.mqttNgRateAlertHistory)
          .set({
            sentMqttLocal: sentLocal,
            sentMqttExternal: sentExternal,
            sentFcm: sentFcm,
            payload: payload as any,
          })
          .where(eq(schema.mqttNgRateAlertHistory.id, alertHistoryId));
      } catch (err) {
        console.error("[NgRateAlert] Failed to update alert history:", err);
      }
    }

    // ── Fire-and-forget AI enrichment (non-blocking) ──
    if (alertHistoryId) {
      fireAiEnrichment(db, alertHistoryId, payload);
    }

    // ── Update lastTriggeredAt trên threshold ──
    try {
      await db
        .update(schema.mqttNgRateThresholds)
        .set({ lastTriggeredAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.mqttNgRateThresholds.id, threshold.id));
    } catch (err) {
      console.error("[NgRateAlert] Failed to update lastTriggeredAt:", err);
    }

    console.log(
      `[NgRateAlert] 🚨 Alert triggered: ${threshold.name} - NG rate ${data.ngRate}% (${data.severity}) - Point: ${data.pointDef?.code || "overall"}`
    );
  } catch (error) {
    console.error("[NgRateAlert] Error sending alert:", error);
  }
}

// ─── AI Enrichment: Non-blocking root cause & recommendations ────────────────

interface AiAlertEnrichment {
  likelyCause: string;
  confidence: "low" | "medium" | "high";
  suggestedActions: string[];
  trendContext: string;
}

/**
 * Non-blocking AI enrichment for NG rate alerts.
 * Queries recent defect data and uses GGUF to generate root cause hypothesis,
 * suggested corrective actions, and trend context.
 * Returns null if AI is unavailable or fails — alert delivery is never blocked.
 */
async function enrichAlertWithAI(
  db: any,
  payload: NgRateAlertPayload
): Promise<AiAlertEnrichment | null> {
  try {
    const { generateText } = await import("./aiGgufEngine");

    // Gather recent defect data for context
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let topDefects: string[] = [];
    try {
      const defectRows = await db
        .select({
          label: schema.measurementResults.result,
          cnt: sql<number>`COUNT(*)`.as("cnt"),
        })
        .from(schema.measurementResults)
        .innerJoin(
          schema.productInspections,
          eq(schema.measurementResults.inspectionId, schema.productInspections.id)
        )
        .where(
          and(
            eq((schema.productInspections as any).stationId, payload.station.id),
            gte(schema.productInspections.inspectionTime, todayStart),
            eq(schema.measurementResults.result, "NG")
          )
        )
        .groupBy(schema.measurementResults.result)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(5);
      topDefects = defectRows.map((r: any) => `${r.label}(${r.cnt})`);
    } catch {
      // Non-critical — continue without defect details
    }

    const prompt = `NG rate threshold alert triggered in AOI inspection system:
- Station: ${payload.station.name} (Line: ${payload.station.line}, Workshop: ${payload.station.workshop})
- Machine: ${payload.machine?.name || "N/A"} (Code: ${payload.machine?.code || "N/A"})
- Measurement Point: ${payload.measurementPoint ? `${payload.measurementPoint.code} - ${payload.measurementPoint.name}` : "Overall"}
- Product: ${payload.productModel?.name || "N/A"}
- Current NG Rate: ${payload.ngRate.current}% (Threshold: ${payload.ngRate.threshold}%)
- NG Count: ${payload.ngRate.ngCount} / ${payload.ngRate.totalInspections} inspections today
- Severity: ${payload.severity}
- Top defects today: ${topDefects.length > 0 ? topDefects.join(", ") : "N/A"}
- Period: ${payload.period.date}

Analyze this NG rate spike and respond in JSON format:
{
  "likelyCause": "Most likely root cause based on the data pattern",
  "confidence": "low|medium|high",
  "suggestedActions": ["Action 1", "Action 2", "Action 3"],
  "trendContext": "Brief context about the trend severity and urgency"
}`;

    const result = await generateText({
      systemPrompt:
        "You are a manufacturing quality expert specializing in AOI (Automated Optical Inspection) systems. " +
        "Analyze NG rate alerts and provide actionable root cause analysis. Be concise and specific.",
      prompt,
      maxTokens: 512,
      temperature: 0.3,
      jsonMode: true,
    });

    // Parse JSON response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      likelyCause: parsed.likelyCause || "Unable to determine",
      confidence: ["low", "medium", "high"].includes(parsed.confidence) ? parsed.confidence : "low",
      suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.slice(0, 5) : [],
      trendContext: parsed.trendContext || "",
    };
  } catch (err) {
    console.log("[NgRateAlert] AI enrichment skipped:", (err as Error).message);
    return null;
  }
}

/**
 * Fire-and-forget: enrich alert history record with AI analysis after delivery.
 * Updates the payload JSON field with aiAnalysis data.
 */
function fireAiEnrichment(db: any, alertHistoryId: number, payload: NgRateAlertPayload): void {
  enrichAlertWithAI(db, payload)
    .then(async (enrichment) => {
      if (!enrichment) return;
      try {
        const enrichedPayload = { ...payload, aiAnalysis: enrichment };
        await db
          .update(schema.mqttNgRateAlertHistory)
          .set({ payload: enrichedPayload as any })
          .where(eq(schema.mqttNgRateAlertHistory.id, alertHistoryId));
        console.log(`[NgRateAlert] AI enrichment saved for alert #${alertHistoryId}`);
      } catch (err) {
        console.error("[NgRateAlert] Failed to save AI enrichment:", err);
      }
    })
    .catch(() => {
      // Silently ignore — AI enrichment is optional
    });
}

// ─── Utility: Get current NG rate stats for a station (for dashboard) ────────

export async function getNgRateStatsForStation(stationId: number): Promise<
  Array<{
    pointId: number;
    pointCode: string;
    pointName: string;
    totalInspections: number;
    ngCount: number;
    ngRate: number;
  }>
> {
  const db = await getDb();
  if (!db) return [];

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Lấy danh sách tất cả machines thuộc station
  const machinesInStation = await db
    .select({ id: schema.machines.id })
    .from(schema.machines)
    .where(eq(schema.machines.stationId, stationId));

  if (machinesInStation.length === 0) return [];

  const machineIds = machinesInStation.map((m) => m.id);

  // Query NG rate per measurement point trong ngày
  const results = await db
    .select({
      pointId: schema.measurementResults.pointDefId,
      pointCode: schema.measurementPointDefs.code,
      pointName: schema.measurementPointDefs.name,
      total: sql<number>`COUNT(*)`.as("total"),
      ngCount:
        sql<number>`SUM(CASE WHEN ${schema.measurementResults.result} = 'NG' THEN 1 ELSE 0 END)`.as(
          "ngCount"
        ),
    })
    .from(schema.measurementResults)
    .innerJoin(
      schema.productInspections,
      eq(schema.measurementResults.inspectionId, schema.productInspections.id)
    )
    .innerJoin(
      schema.measurementPointDefs,
      eq(schema.measurementResults.pointDefId, schema.measurementPointDefs.id)
    )
    .where(
      and(
        gte(schema.productInspections.inspectionTime, todayStart),
        sql`${schema.productInspections.machineId} IN (${sql.raw(machineIds.join(","))})`
      )
    )
    .groupBy(
      schema.measurementResults.pointDefId,
      schema.measurementPointDefs.code,
      schema.measurementPointDefs.name
    );

  return results.map((r) => ({
    pointId: r.pointId,
    pointCode: r.pointCode,
    pointName: r.pointName,
    totalInspections: Number(r.total),
    ngCount: Number(r.ngCount),
    ngRate: r.total > 0 ? parseFloat(((Number(r.ngCount) / Number(r.total)) * 100).toFixed(2)) : 0,
  }));
}
