/**
 * /api/external/{alerts, alerts/:alertId, alerts/:alertId/acknowledge|resolve, bulletins} — TRÍCH NGUYÊN VĂN từ server/_core/index.ts (2026-10-24) để đo được trên Express + CSDL thật
 * (index.ts không dựng được trong test). Hành vi giữ nguyên; phạm vi người gọi (rà bảo mật 2026-10-24) áp tại đây — xem `phamViCanhBaoNgoai.ts`.
 */
import type express from "express";
import { getDb } from "../db";
import { docGioTuongNhaMay } from "../utils/factoryTime";
import type { PhamViNguoiXem } from "../db/hierarchy";
import { phamViGoiNgoai, nguoiXemCuaPhamVi, phamViDaAp, thanTuChoiPhamViNgoai } from "./_phamViNgoai";
import { idsCapExternal } from "./phamViExternal";

// BG-96: chuỗi người dùng gõ đọc theo giờ tường NHÀ MÁY (cùng bản trong _core/index.ts; call site đã guard isNaN).
function parseLocalDate(dateStr: string, endOfDay = false): Date {
  return docGioTuongNhaMay(dateStr, endOfDay) ?? new Date(NaN);
}

/**
 * phạm vi người gọi (rà bảo mật 2026-10-24): master key ⇒ không lọc; token người dùng ⇒ chỉ cảnh báo định vị được vào máy/trạm/nhà máy được gán
 *   • alert_history      ⇒ qua alert_settings (machineId/factoryId): có ≥1 thuộc tính định vị và mọi thuộc tính trong phạm vi; quy tắc "toàn bộ" (cả hai NULL) ⇒ chỉ toàn quyền;
 *   • mqtt_alert_history ⇒ quy tắc MQTT cấp HỆ THỐNG, KHÔNG có cột nhà máy ⇒ chỉ toàn quyền (người dùng hẹp: không thấy, tra theo id ⇒ 403);
 *   • mqtt_connection_alerts ⇒ (targetType, targetId) máy/trạm/nhà máy trong phạm vi (targetType NULL ⇒ ẩn);
 *   • mqtt_ng_rate_alert_history ⇒ stationId.
 * `undefined` = không áp cổng nào (master key).
 */
export async function congPhamVi(nguoiXem: PhamViNguoiXem | undefined, nguon: "alert" | "mqtt" | "conn" | "ngrate") {
  if (nguoiXem === undefined) return undefined;
  const { sql } = await import("drizzle-orm");
  const sch = await import("../../drizzle/schema");
  const dsa = (a: number[] | null) => sql.join((a && a.length > 0 ? a : [-1]).map((x) => sql`${x}`), sql`, `);
  // vai toàn quyền (admin) cũng là "không giới hạn": idsTrongPhamVi trả null
  if (nguon === "mqtt") return (await idsCapExternal(nguoiXem, "factory")) === null ? undefined : sql`1 = 0`;
  if (nguon === "alert") {
    const { dieuKienViTriTrongPhamVi } = await import("../routers/_adapterPhamVi");
    const st = sch.alertSettings;
    const cond = await dieuKienViTriTrongPhamVi(nguoiXem, { machineId: st.machineId, factoryId: st.factoryId });
    return cond ? sql`${sch.alertHistory.alertSettingId} IN (SELECT ${st.id} FROM ${st} WHERE ${cond})` : undefined;
  }
  if (nguon === "ngrate") {
    const tram = await idsCapExternal(nguoiXem, "station");
    return tram === null ? undefined : sql`${sch.mqttNgRateAlertHistory.stationId} IN (${dsa(tram)})`;
  }
  const [may, tram, nm] = await Promise.all([idsCapExternal(nguoiXem, "machine"), idsCapExternal(nguoiXem, "station"), idsCapExternal(nguoiXem, "factory")]);
  if (may === null && tram === null && nm === null) return undefined;
  const c = sch.mqttConnectionAlerts;
  return sql`((${c.targetType} = 'machine' AND ${c.targetId} IN (${dsa(may)})) OR (${c.targetType} = 'station' AND ${c.targetId} IN (${dsa(tram)})) OR (${c.targetType} = 'factory' AND ${c.targetId} IN (${dsa(nm)})))`;
}

/** Hàng có tồn tại và có NẰM TRONG phạm vi không: "ok" | "ngoai" (tồn tại nhưng ngoài phạm vi ⇒ 403) | "khong_co" (⇒ giữ nguyên hành vi cũ: 404). */
async function kiemPhamVi(
  database: any,
  nguoiXem: PhamViNguoiXem | undefined,
  nguon: "alert" | "mqtt" | "conn" | "ngrate",
  numId: number,
): Promise<"ok" | "ngoai" | "khong_co"> {
  const sch = await import("../../drizzle/schema");
  const { and, eq } = await import("drizzle-orm");
  const bang = nguon === "alert" ? sch.alertHistory : nguon === "mqtt" ? sch.mqttAlertHistory : nguon === "conn" ? sch.mqttConnectionAlerts : sch.mqttNgRateAlertHistory;
  const [co] = await database.select({ id: bang.id }).from(bang).where(eq(bang.id, numId)).limit(1);
  if (!co) return "khong_co";
  const cong = await congPhamVi(nguoiXem, nguon);
  if (!cong) return "ok";
  const [trong] = await database.select({ id: bang.id }).from(bang).where(and(eq(bang.id, numId), cong)).limit(1);
  return trong ? "ok" : "ngoai";
}

export function registerExternalAlertRoutes(app: express.Express, validateExternalAuth: express.RequestHandler) {
  // ============================================================
  // Alert Management APIs — for third-party integration
  // GET  /api/external/alerts          — List alerts (paginated, filterable)
  // GET  /api/external/alerts/:alertId — Get single alert detail
  // POST /api/external/alerts/:alertId/acknowledge — Acknowledge an alert
  // POST /api/external/alerts/:alertId/resolve     — Resolve an alert
  // ============================================================

  app.get("/api/external/alerts", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { alertHistory, alertSettings, mqttAlertHistory, mqttAlertRules, mqttConnectionAlerts } = await import("../../drizzle/schema");
      const { desc, sql, and, gte, lte, eq: eqOp, or } = await import("drizzle-orm");

      const source = (req.query.source as string) || "all"; // "alert" | "mqtt" | "connection" | "all"
      const status = req.query.status as string | undefined; // "pending" | "acknowledged" | "resolved"
      const severity = req.query.severity as string | undefined;
      const stationId = req.query.stationId ? parseInt(req.query.stationId as string, 10) : undefined;
      const startDate = req.query.startDate ? parseLocalDate(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? parseLocalDate(req.query.endDate as string) : undefined;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const offset = parseInt(req.query.offset as string, 10) || 0;

      const results: any[] = [];
      const pvNgoai = phamViGoiNgoai(req);
      const nguoiXem = nguoiXemCuaPhamVi(pvNgoai); // phạm vi người gọi (rà bảo mật 2026-10-24): master key ⇒ không lọc; token người dùng ⇒ chỉ cảnh báo định vị được vào máy/trạm/nhà máy được gán
      const congAh = await congPhamVi(nguoiXem, "alert");
      const congConn = await congPhamVi(nguoiXem, "conn");

      // 1. alertHistory (from alertSettings rules)
      if (source === "all" || source === "alert") {
        const conditions: any[] = [];
        if (congAh) conditions.push(congAh);
        if (startDate) conditions.push(gte(alertHistory.createdAt, startDate));
        if (endDate) conditions.push(lte(alertHistory.createdAt, endDate));
        if (status === "acknowledged") conditions.push(sql`${alertHistory.acknowledgedAt} IS NOT NULL`);
        if (status === "pending") conditions.push(sql`${alertHistory.acknowledgedAt} IS NULL`);

        const rows = await database
          .select({
            id: alertHistory.id,
            alertSettingId: alertHistory.alertSettingId,
            triggeredValue: alertHistory.triggeredValue,
            message: alertHistory.message,
            acknowledgedAt: alertHistory.acknowledgedAt,
            acknowledgedBy: alertHistory.acknowledgedBy,
            createdAt: alertHistory.createdAt,
            settingName: alertSettings.name,
            alertType: alertSettings.alertType,
          })
          .from(alertHistory)
          .leftJoin(alertSettings, eqOp(alertHistory.alertSettingId, alertSettings.id))
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(alertHistory.createdAt))
          .limit(limit)
          .offset(offset);

        for (const r of rows) {
          results.push({
            id: `alert-${r.id}`,
            source: "alert",
            alertType: r.alertType,
            settingName: r.settingName,
            message: r.message,
            triggeredValue: r.triggeredValue,
            status: r.acknowledgedAt ? "acknowledged" : "pending",
            acknowledgedAt: r.acknowledgedAt,
            acknowledgedBy: r.acknowledgedBy,
            createdAt: r.createdAt,
          });
        }
      }

      // 2. mqttAlertHistory (from mqtt alert rules)
      // mqtt_alert_history là quy tắc MQTT cấp HỆ THỐNG (không có cột nhà máy) ⇒ chỉ master key / toàn quyền (xem congPhamVi)
      if ((source === "all" || source === "mqtt") && (await congPhamVi(nguoiXem, "mqtt")) === undefined) {
        const conditions: any[] = [];
        if (startDate) conditions.push(gte(mqttAlertHistory.triggeredAt, startDate));
        if (endDate) conditions.push(lte(mqttAlertHistory.triggeredAt, endDate));
        if (status === "resolved") conditions.push(eqOp(mqttAlertHistory.isResolved, true));
        if (status === "pending") conditions.push(eqOp(mqttAlertHistory.isResolved, false));

        const rows = await database
          .select()
          .from(mqttAlertHistory)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(mqttAlertHistory.triggeredAt))
          .limit(limit)
          .offset(offset);

        for (const r of rows) {
          results.push({
            id: `mqtt-${r.id}`,
            source: "mqtt",
            ruleId: r.ruleId,
            ruleName: r.ruleName,
            ruleType: r.ruleType,
            message: r.message,
            triggeredValue: r.triggeredValue,
            thresholdValue: r.thresholdValue,
            status: r.isResolved ? "resolved" : "pending",
            isResolved: r.isResolved,
            resolvedAt: r.resolvedAt,
            resolvedBy: r.resolvedBy,
            resolutionNote: r.resolutionNote,
            createdAt: r.triggeredAt,
          });
        }
      }

      // 3. mqttConnectionAlerts (connection lost/disconnect alerts)
      if (source === "all" || source === "connection") {
        const conditions: any[] = [];
        if (congConn) conditions.push(congConn);
        if (startDate) conditions.push(gte(mqttConnectionAlerts.triggeredAt, startDate));
        if (endDate) conditions.push(lte(mqttConnectionAlerts.triggeredAt, endDate));
        if (severity) conditions.push(eqOp(mqttConnectionAlerts.severity, severity as any));
        if (status === "acknowledged") conditions.push(eqOp(mqttConnectionAlerts.isAcknowledged, true));
        if (status === "resolved") conditions.push(eqOp(mqttConnectionAlerts.isResolved, true));
        if (status === "pending") conditions.push(and(eqOp(mqttConnectionAlerts.isAcknowledged, false), eqOp(mqttConnectionAlerts.isResolved, false)));

        const rows = await database
          .select()
          .from(mqttConnectionAlerts)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(mqttConnectionAlerts.triggeredAt))
          .limit(limit)
          .offset(offset);

        for (const r of rows) {
          results.push({
            id: `conn-${r.id}`,
            source: "connection",
            stationId: r.targetType === "station" ? r.targetId : undefined,
            alertType: r.alertType,
            severity: r.severity,
            title: r.title,
            message: r.message,
            status: r.isResolved ? "resolved" : r.isAcknowledged ? "acknowledged" : "pending",
            isAcknowledged: r.isAcknowledged,
            acknowledgedAt: r.acknowledgedAt,
            acknowledgedBy: r.acknowledgedBy,
            isResolved: r.isResolved,
            resolvedAt: r.resolvedAt,
            createdAt: r.triggeredAt,
          });
        }
      }

      // Enrich rows that carry a station id (connection alerts) with the station name.
      // Single cheap lookup, only when needed; app has a fallback if absent.
      const stationIds = new Set<number>();
      for (const r of results) if (typeof r.stationId === "number") stationIds.add(r.stationId);
      if (stationIds.size > 0) {
        try {
          const { getStations } = await import("../db");
          const allStations = await getStations();
          const nameById = new Map<number, string>(allStations.map((s: any) => [s.id, s.name]));
          for (const r of results) {
            if (typeof r.stationId === "number") r.stationName = nameById.get(r.stationId);
          }
        } catch { /* leave stationName undefined */ }
      }

      // Sort combined results by createdAt descending
      results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json({
        success: true,
        data: results.slice(0, limit),
        pagination: { limit, offset, count: results.length },
        scopeApplied: phamViDaAp(pvNgoai),
      });
    } catch (error: any) {
      console.error("[External] alerts list error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get alerts" });
    }
  });

  app.get("/api/external/alerts/:alertId", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { alertHistory, alertSettings, mqttAlertHistory, mqttConnectionAlerts } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      const alertId = req.params.alertId; // format: "alert-123", "mqtt-456", "conn-789"
      const [source, idStr] = alertId.split("-");
      const numId = parseInt(idStr, 10);
      if (!source || isNaN(numId)) {
        return res.status(400).json({ success: false, message: "Invalid alertId format. Expected: alert-{id}, mqtt-{id}, or conn-{id}" });
      }

      let detail: any = null;

      // phạm vi người gọi (rà bảo mật 2026-10-24): master key ⇒ không lọc; token người dùng ⇒ chỉ cảnh báo định vị được vào máy/trạm/nhà máy được gán: cảnh báo CÓ TỒN TẠI nhưng ngoài phạm vi ⇒ 403 mã máy-đọc-được (quy ước cụm /api/external)
      {
        const nguon = source === "alert" ? "alert" : source === "mqtt" ? "mqtt" : source === "conn" ? "conn" : null;
        const nguoiXemGhi = nguoiXemCuaPhamVi(phamViGoiNgoai(req));
        if (nguon && (await kiemPhamVi(database, nguoiXemGhi, nguon, numId)) === "ngoai") {
          return res.status(403).json(thanTuChoiPhamViNgoai("alert", alertId));
        }
      }

      if (source === "alert") {
        const rows = await database
          .select({
            id: alertHistory.id,
            alertSettingId: alertHistory.alertSettingId,
            triggeredValue: alertHistory.triggeredValue,
            message: alertHistory.message,
            sentEmail: alertHistory.sentEmail,
            sentSms: alertHistory.sentSms,
            sentInApp: alertHistory.sentInApp,
            acknowledgedAt: alertHistory.acknowledgedAt,
            acknowledgedBy: alertHistory.acknowledgedBy,
            createdAt: alertHistory.createdAt,
            settingName: alertSettings.name,
            alertType: alertSettings.alertType,
            threshold: alertSettings.threshold,
          })
          .from(alertHistory)
          .leftJoin(alertSettings, eqOp(alertHistory.alertSettingId, alertSettings.id))
          .where(eqOp(alertHistory.id, numId))
          .limit(1);
        if (rows.length > 0) {
          const r = rows[0];
          detail = { source: "alert", ...r, id: alertId, status: r.acknowledgedAt ? "acknowledged" : "pending" };
        }
      } else if (source === "mqtt") {
        const rows = await database.select().from(mqttAlertHistory).where(eqOp(mqttAlertHistory.id, numId)).limit(1);
        if (rows.length > 0) {
          const r = rows[0];
          detail = { source: "mqtt", ...r, id: alertId, status: r.isResolved ? "resolved" : "pending" };
        }
      } else if (source === "conn") {
        const rows = await database.select().from(mqttConnectionAlerts).where(eqOp(mqttConnectionAlerts.id, numId)).limit(1);
        if (rows.length > 0) {
          const r = rows[0];
          detail = { source: "connection", ...r, id: alertId, status: r.isResolved ? "resolved" : r.isAcknowledged ? "acknowledged" : "pending" };
        }
      } else {
        return res.status(400).json({ success: false, message: "Unknown alert source. Use: alert, mqtt, or conn" });
      }

      if (!detail) {
        return res.status(404).json({ success: false, message: "Alert not found" });
      }

      res.json({ success: true, data: detail });
    } catch (error: any) {
      console.error("[External] alert detail error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get alert detail" });
    }
  });

  app.post("/api/external/alerts/:alertId/acknowledge", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { alertHistory, mqttConnectionAlerts } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      const alertId = req.params.alertId;
      // Live per-inspection NG (ALT-*) and NG-rate (NGRATE-*) alerts are ephemeral MQTT
      // events with no ack-able DB row (published from inspection flow, not persisted as
      // an alert). Accept as a 200 no-op so the app's postAction succeeds; the ack stays
      // client/local-only. See ngRateAlertService / mqttService.publishNGAlert.
      if (/^(ALT|NGRATE)-/.test(alertId)) {
        return res.json({
          success: true,
          message: "Live inspection alert acknowledged (no server-side alert record to persist)",
          alertId,
          acknowledgedAt: new Date().toISOString(),
          persisted: false,
          localOnly: true,
        });
      }
      const [source, idStr] = alertId.split("-");
      const numId = parseInt(idStr, 10);
      if (!source || isNaN(numId)) {
        return res.status(400).json({ success: false, message: "Invalid alertId format. Expected: alert-{id} or conn-{id}" });
      }

      const user = (req as any).externalUser;
      const userId = user?.id || null;
      const now = new Date();

      // phạm vi người gọi (rà bảo mật 2026-10-24): master key ⇒ không lọc; token người dùng ⇒ chỉ cảnh báo định vị được vào máy/trạm/nhà máy được gán: ghi vào cảnh báo ngoài phạm vi ⇒ 403 TRƯỚC khi đổi hàng
      {
        const nguon = source === "alert" ? "alert" : source === "conn" ? "conn" : null;
        const nguoiXemGhi = nguoiXemCuaPhamVi(phamViGoiNgoai(req));
        if (nguon && (await kiemPhamVi(database, nguoiXemGhi, nguon, numId)) === "ngoai") {
          return res.status(403).json(thanTuChoiPhamViNgoai("alert", alertId));
        }
      }

      if (source === "alert") {
        const updated = await database.update(alertHistory)
          .set({ acknowledgedAt: now, acknowledgedBy: userId })
          .where(eqOp(alertHistory.id, numId))
          .returning({ id: alertHistory.id });
        if (updated.length === 0) return res.status(404).json({ success: false, message: "Alert not found" });
      } else if (source === "conn") {
        const updated = await database.update(mqttConnectionAlerts)
          .set({ isAcknowledged: true, acknowledgedAt: now, acknowledgedBy: userId, updatedAt: now })
          .where(eqOp(mqttConnectionAlerts.id, numId))
          .returning({ id: mqttConnectionAlerts.id });
        if (updated.length === 0) return res.status(404).json({ success: false, message: "Connection alert not found" });
      } else {
        return res.status(400).json({ success: false, message: "Acknowledge is supported for alert-{id} and conn-{id} types" });
      }

      res.json({ success: true, message: "Alert acknowledged", alertId, acknowledgedAt: now.toISOString() });
    } catch (error: any) {
      console.error("[External] alert acknowledge error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to acknowledge alert" });
    }
  });

  app.post("/api/external/alerts/:alertId/resolve", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { mqttAlertHistory, mqttConnectionAlerts, mqttNgRateAlertHistory } = await import("../../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      const alertId = req.params.alertId;
      // Ephemeral per-inspection NG (ALT-*) and business-id NG-rate (NGRATE-*, uppercase)
      // alerts have no resolvable DB row reachable via this endpoint. Accept as a 200
      // no-op so the app's postAction succeeds; the resolve stays local-only. NOTE: the
      // match is case-SENSITIVE — the lowercase `ngrate-{id}` server id (carried as
      // serverAlertId in the payload) DOES resolve below.
      if (/^(ALT|NGRATE)-/.test(alertId)) {
        return res.json({
          success: true,
          message: "Live inspection alert resolved (no server-side alert record to persist)",
          alertId,
          resolvedAt: new Date().toISOString(),
          persisted: false,
          localOnly: true,
        });
      }
      const [source, idStr] = alertId.split("-");
      const numId = parseInt(idStr, 10);
      if (!source || isNaN(numId)) {
        return res.status(400).json({ success: false, message: "Invalid alertId format. Expected: mqtt-{id}, conn-{id} or ngrate-{id}" });
      }

      const user = (req as any).externalUser;
      const userId = user?.id || null;
      const now = new Date();
      const resolutionNote = req.body.resolutionNote || req.body.note || null;

      // phạm vi người gọi (rà bảo mật 2026-10-24): master key ⇒ không lọc; token người dùng ⇒ chỉ cảnh báo định vị được vào máy/trạm/nhà máy được gán: xử lý cảnh báo ngoài phạm vi ⇒ 403 TRƯỚC khi đổi hàng
      {
        const nguon = source === "mqtt" ? "mqtt" : source === "conn" ? "conn" : source === "ngrate" ? "ngrate" : null;
        const nguoiXemGhi = nguoiXemCuaPhamVi(phamViGoiNgoai(req));
        if (nguon && (await kiemPhamVi(database, nguoiXemGhi, nguon, numId)) === "ngoai") {
          return res.status(403).json(thanTuChoiPhamViNgoai("alert", alertId));
        }
      }

      if (source === "mqtt") {
        const updated = await database.update(mqttAlertHistory)
          .set({ isResolved: true, resolvedAt: now, resolvedBy: userId, resolutionNote })
          .where(eqOp(mqttAlertHistory.id, numId))
          .returning({ id: mqttAlertHistory.id });
        if (updated.length === 0) return res.status(404).json({ success: false, message: "MQTT alert not found" });
      } else if (source === "conn") {
        const updated = await database.update(mqttConnectionAlerts)
          .set({ isResolved: true, resolvedAt: now, updatedAt: now })
          .where(eqOp(mqttConnectionAlerts.id, numId))
          .returning({ id: mqttConnectionAlerts.id });
        if (updated.length === 0) return res.status(404).json({ success: false, message: "Connection alert not found" });
      } else if (source === "ngrate") {
        const updated = await database.update(mqttNgRateAlertHistory)
          .set({ isResolved: true, resolvedAt: now, resolvedBy: userId, resolutionNote })
          .where(eqOp(mqttNgRateAlertHistory.id, numId))
          .returning({ id: mqttNgRateAlertHistory.id });
        if (updated.length === 0) return res.status(404).json({ success: false, message: "NG-rate alert not found" });
      } else {
        return res.status(400).json({ success: false, message: "Resolve is supported for mqtt-{id}, conn-{id} and ngrate-{id} types" });
      }

      res.json({ success: true, message: "Alert resolved", alertId, resolvedAt: now.toISOString() });
    } catch (error: any) {
      console.error("[External] alert resolve error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to resolve alert" });
    }
  });

  // ============================================================
  // Bulletin History API — for third-party integration
  // GET /api/external/bulletins — List bulletin history (paginated)
  // ============================================================
  app.get("/api/external/bulletins", validateExternalAuth, async (req, res) => {
    try {
      const database = await getDb();
      if (!database) return res.status(500).json({ success: false, message: "Database not available" });
      const { mqttBulletinHistory } = await import("../../drizzle/schema");
      const { desc, and, gte, lte, eq: eqOp } = await import("drizzle-orm");

      const stationId = req.query.stationId ? parseInt(req.query.stationId as string, 10) : undefined;
      const startDate = req.query.startDate ? parseLocalDate(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? parseLocalDate(req.query.endDate as string) : undefined;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const offset = parseInt(req.query.offset as string, 10) || 0;

      const conditions: any[] = [];
      // phạm vi người gọi (rà bảo mật 2026-10-24): master key ⇒ không lọc; token người dùng ⇒ chỉ cảnh báo định vị được vào máy/trạm/nhà máy được gán: chỉ bản tin của trạm trong phạm vi
      const pvNgoai = phamViGoiNgoai(req);
      const tramTrongPhamVi = await idsCapExternal(nguoiXemCuaPhamVi(pvNgoai), "station");
      if (tramTrongPhamVi !== null) {
        const { inArray } = await import("drizzle-orm");
        conditions.push(inArray(mqttBulletinHistory.stationId, tramTrongPhamVi.length > 0 ? tramTrongPhamVi : [-1]));
      }
      if (stationId) conditions.push(eqOp(mqttBulletinHistory.stationId, stationId));
      if (startDate) conditions.push(gte(mqttBulletinHistory.createdAt, startDate));
      if (endDate) conditions.push(lte(mqttBulletinHistory.createdAt, endDate));

      const rows = await database
        .select()
        .from(mqttBulletinHistory)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(mqttBulletinHistory.createdAt))
        .limit(limit)
        .offset(offset);

      // Enrich with station name (single cheap lookup; app has a fallback if absent)
      let stationNameById = new Map<number, string>();
      try {
        const { getStations } = await import("../db");
        const allStations = await getStations();
        stationNameById = new Map(allStations.map((s: any) => [s.id, s.name]));
      } catch { /* leave stationName undefined */ }

      res.json({
        success: true,
        data: rows.map((r: any) => ({
          id: r.id,
          stationId: r.stationId,
          stationName: stationNameById.get(r.stationId),
          bulletinType: r.bulletinType,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          totalCount: r.totalCount,
          okCount: r.okCount,
          ngCount: r.ngCount,
          ntfCount: r.ntfCount,
          yieldRate: r.yieldRate,
          failPoints: r.failPoints,
          deliveryStatus: r.deliveryStatus,
          createdAt: r.createdAt,
        })),
        pagination: { limit, offset, count: rows.length },
        scopeApplied: phamViDaAp(pvNgoai),
      });
    } catch (error: any) {
      console.error("[External] bulletins list error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to get bulletins" });
    }
  });
}
