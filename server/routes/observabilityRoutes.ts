/**
 * Observability HTTP health routes — SYNAPSE §5.12 (doc 37 C1 · P2 "expose the health-getters").
 * ============================================================================
 *   GET /api/observability/health   — aggregated platform health (OT store-forward buffer,
 *                                      OT connection supervisors, SLO burn-rate rollup,
 *                                      decision-trace ring depth).
 *   GET /api/observability/slo       — SLO catalogue + per-SLO latest status + burn-rate.
 *   GET /api/observability/metrics   — SLO + decision-trace signals in Prometheus text format
 *                                      (dependency-free; complements /metrics for scrapers/alerts).
 *
 * READ-ONLY. Several subsystems (store-forward, connection-supervisor, SLO evaluator) already keep
 * honest health-getters but never exposed them over HTTP — this route surfaces them for a Control
 * Tower / SRE dashboard and for a liveness probe on the observability plane itself.
 *
 * AUTH — a signed-in browser session with a privileged role (admin / supervisor). No session → 401;
 * an authenticated non-privileged user → 403. The Prometheus endpoint additionally accepts an
 * unauthenticated scrape ONLY from loopback (Prometheus is expected to run beside the app); any
 * other origin must be an authorized session. No mutations on any route.
 */
import type express from "express";
import type { Request } from "express";

/**
 * ★★★★ Review TOÀN NHÁNH Pha 9 · **I-6** — hai vị từ này **đã rút về một chủ**
 * (`server/routes/_congLoopback.ts`) vì bề mặt thứ hai cần đúng cặp ấy:
 * `POST /api/ai/local-kb/feedback`. Giữ hai bản sao ⇒ bản yếu hơn quyết định lưới nào đỏ.
 */
import { laLoopback as isLoopback, doiVaiDacQuyen as requirePrivileged } from "./_congLoopback";

export function registerObservabilityRoutes(app: express.Express): void {
  // ── GET /api/observability/health — aggregated platform health ──────────────
  app.get("/api/observability/health", async (req, res) => {
    const auth = await requirePrivileged(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, message: auth.message });
    try {
      const [{ getStatus: storeForwardStatus }, { listSupervisorStatuses }, sloMod, { decisionRingInfo }] =
        await Promise.all([
          import("../services/ot/storeForward"),
          import("../services/ot/otManager"),
          import("../services/observability/sloAlerting"),
          import("../services/observability/decisionTrace"),
        ]);

      const storeForward = storeForwardStatus();
      const supervisors = listSupervisorStatuses();
      const sloHealth = sloMod.getSloHealth();
      const ring = decisionRingInfo();

      const connectedSupervisors = supervisors.filter((s) => s.connected).length;
      // Overall status: worst of the contributing signals (best-effort rollup).
      const degraded =
        sloHealth.worstSeverity === "warning" ||
        storeForward.droppedOverflow > 0 ||
        storeForward.droppedAge > 0 ||
        (supervisors.length > 0 && connectedSupervisors < supervisors.length);
      const down = sloHealth.worstSeverity === "critical";
      const status = down ? "critical" : degraded ? "degraded" : "ok";

      res.setHeader("Cache-Control", "no-store");
      return res.json({
        success: true,
        status,
        observabilityEnabled: sloMod.observabilityEnabled(),
        generatedAt: new Date().toISOString(),
        otStoreForward: {
          enabled: storeForward.enabled,
          bufferedCount: storeForward.bufferedCount,
          buffered: storeForward.buffered,
          backfilled: storeForward.backfilled,
          deduped: storeForward.deduped,
          droppedOverflow: storeForward.droppedOverflow,
          droppedAge: storeForward.droppedAge,
          lastBufferedAt: storeForward.lastBufferedAt,
          lastBackfillAt: storeForward.lastBackfillAt,
          maxEntries: storeForward.maxEntries,
        },
        otConnections: {
          total: supervisors.length,
          connected: connectedSupervisors,
          supervisors: supervisors.map((s) => ({
            adapterId: s.adapterId,
            code: s.code,
            protocol: s.protocol,
            state: s.state,
            connected: s.connected,
            activeEndpoint: s.activeEndpoint,
            activeLabel: s.activeLabel,
            reconnects: s.reconnects,
            failovers: s.failovers,
            lastError: s.lastError,
            lastConnectedAt: s.lastConnectedAt,
          })),
        },
        slo: sloHealth,
        decisionTrace: { ringDepth: ring.depth, ringCapacity: ring.capacity, totalRecorded: ring.totalRecorded },
      });
    } catch (err: any) {
      console.error("[Observability] /health error:", err?.message || err);
      return res.status(500).json({ success: false, message: "Internal error building health." });
    }
  });

  // ── GET /api/observability/slo — SLO catalogue + latest status + burn-rate ──
  app.get("/api/observability/slo", async (req, res) => {
    const auth = await requirePrivileged(req);
    if (!auth.ok) return res.status(auth.status).json({ success: false, message: auth.message });
    try {
      const [{ DEFAULT_SLOS }, sloMod] = await Promise.all([
        import("../services/observability/slo"),
        import("../services/observability/sloAlerting"),
      ]);
      const snapshot = sloMod.getSloSnapshot();
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        success: true,
        health: sloMod.getSloHealth(),
        slos: DEFAULT_SLOS.map((target) => {
          const evalRec = snapshot.find((s) => s.sloId === target.id);
          return { target, evaluation: evalRec ?? null };
        }),
      });
    } catch (err: any) {
      console.error("[Observability] /slo error:", err?.message || err);
      return res.status(500).json({ success: false, message: "Internal error building SLO view." });
    }
  });

  // ── GET /api/observability/metrics — Prometheus text (SLO + decision-trace) ─
  app.get("/api/observability/metrics", async (req, res) => {
    // Allow a loopback scrape (Prometheus beside the app); otherwise require a privileged session.
    if (!isLoopback(req)) {
      const auth = await requirePrivileged(req);
      if (!auth.ok) return res.status(auth.status).type("text/plain").send("# unauthorized\n");
    }
    try {
      const { renderSloPrometheus } = await import("../services/observability/sloAlerting");
      /**
       * ★★★ Review TOÀN NHÁNH Pha 8 · **C-2 §3 — CẮT ĐƯỜNG IM LẶNG.**
       * Hai bộ đếm sổ phiên (`soPhien_ghiSoLoi_total` · `soPhien_chanDaThuHoi_total`) trước lượt vá
       * **chỉ đọc được TỪ LƯỚI** — tức chúng chứng minh "không im lặng" trong test, còn trong sản
       * xuất thì vẫn im lặng. Ghép vào đây vì bề mặt này **đã có** phép xác thực (loopback **hoặc**
       * phiên admin/supervisor) ⇒ không mở thêm cửa nào, và Prometheus cạnh app đọc được ngay.
       */
      const { renderSoPhienPrometheus } = await import("../_core/demSoPhien");
      res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.send(`${renderSloPrometheus()}\n${renderSoPhienPrometheus()}`);
    } catch (err: any) {
      console.error("[Observability] /metrics error:", err?.message || err);
      return res.status(500).type("text/plain").send("# metrics error\n");
    }
  });

  console.log(
    "[Observability] health routes enabled: GET /api/observability/{health,slo,metrics}",
  );
}
