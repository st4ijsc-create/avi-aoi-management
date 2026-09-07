/**
 * Giai đoạn 3 — Digital Twin Router (G10, read-only)
 *
 * twinState: máy + health gần nhất + màu twin + vị trí layout.
 * defectHeatmap: gom số NG theo máy trong cửa sổ thời gian (cho lớp nhiệt 2D/3D).
 * whatIf: mô phỏng năng suất chuyền (pure compute, không ghi DB).
 *
 * Read-only / protected. Auto-degrade về mảng rỗng khi DB chưa sẵn sàng.
 * Không phụ thuộc hạ tầng mới.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 14 LÔ Q1 — **HÀNG RÀO TENANT**. Trước bản vá này router KHÔNG lọc gì.
 * ══════════════════════════════════════════════════════════════════════════════
 * Đo trên `aoi_management` 2026-09-07, tài khoản `maint1` (id 50, **0 nhà máy
 * được gán**) đọc được trọn dữ liệu của SIM-FAC:
 *
 *     twinState        → **43/43** máy (cả 42 máy SIM-FAC + 1 máy nhà máy 18)
 *     wipFlowState     → **4.707** WIP / 12 trạm của chuyền 1 (thuộc SIM-FAC)
 *     stationLoadHeatmap → cells của chuyền 1
 *     predictionOverlay  → chuỗi WIP của chuyền 1
 *
 * Đây ĐÚNG lớp lỗi lô K vừa vá ở `demVatThe`, và nó tái diễn vì cùng một nguyên
 * nhân: thủ tục khai `async ({ input })` — **không bóc `ctx`** — nên danh tính
 * không bao giờ rời tay handler. `twinState`/`stationLoadHeatmap`/
 * `predictionOverlay`/`wipFlowState` còn nhận `stationId`/`lineId`/`layoutId`
 * do **client TỰ KHAI**, tức một id đoán được là một cánh cửa sang tenant khác.
 *
 * **Vá ở tầng ROUTER, không ở tầng db.** Các hàm `getWipByStation` /
 * `getStationDwellAgg` / `getLatestLineBalance` / `getWipCountSeries` còn có
 * người gọi khác (socket, script seed); đổi chữ ký của chúng là đổi hợp đồng
 * của những nơi ấy. Router là chỗ danh tính CÓ MẶT, nên cổng đặt ở đây.
 *
 * **Hai trục, vì lược đồ có hai hình dạng** (luật đã ghi ở `db/hierarchy.ts`):
 *   - `machines` treo vào chuỗi phân cấp `station → line → workshop → factory`
 *     ⇒ dùng `idsTrongPhamVi("machine"|"line"|"station", …)`.
 *   - `product_inspections` mang **MÃ** tenant thẳng trên hàng (`factoryCode`)
 *     ⇒ dùng `congMaTenant`. Chiếu bảng này qua chuỗi phân cấp là dựng một quan
 *     hệ không tồn tại.
 *
 * ⚠ `null` từ `idsTrongPhamVi` = vai toàn quyền / lối không mang danh tính ⇒
 *   **KHÔNG thêm mệnh đề nào** (chiều DƯƠNG chống "vá quá tay thành chặn tất
 *   cả"). Tập RỖNG ⇒ trả 0 hàng, KHÔNG phải "không lọc".
 *
 * ⚠ Id ngoài phạm vi được xử như **KHÔNG TỒN TẠI** (hình dạng rỗng hợp lệ), chứ
 *   không ném lỗi riêng: một thông báo "bạn không được xem chuyền 42" vẫn xác
 *   nhận rằng chuyền 42 có thật.
 *
 * Nghiệm thu: `digitalTwinPhamVi.db.test.ts` (hai chiều, DB thật) +
 * `phamViTwinCanh.unit.test.ts` (phân đôi toàn tập, tầng router).
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db/connection";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { idsTrongPhamVi, trongPhamVi, congMaTenant } from "../db/hierarchy";
import { phamViCua } from "./_phamViNguoiXem";
import { machines } from "../../drizzle/schema";
import { machineHealthHistory } from "../../drizzle/schema";
import { productInspections } from "../../drizzle/schema";
import {
  colorForTwin,
  simulateWhatIf,
  stationLoadHeatmap,
  buildPredictionOverlay,
  type StationLoadInput,
  type StationForecast,
} from "../services/digitalTwinService";
import { getWipByStation, getWipCountSeries } from "../db/twin";
import { getStationDwellAgg, getLatestLineBalance } from "../db/lineBalance";
import { getMachinePositionsByLayout } from "../db/layout";
import { forecastWithConfidenceInterval, type TimeSeriesPoint } from "../services/aiTimeSeriesEngine";

export const digitalTwinRouter = router({
  // --- G10: trạng thái twin của toàn bộ máy (hoặc theo station) ---
  twinState: protectedProcedure
    .input(z.object({
      stationId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) return [] as any[];

      // ★ Q1 — cổng tenant. `null` = toàn quyền ⇒ không thêm mệnh đề nào.
      const idsMay = await idsTrongPhamVi("machine", phamViCua(ctx));
      if (idsMay !== null && idsMay.length === 0) return [];

      // ⚠ `stationId` là lời TỰ KHAI của client. Một trạm ngoài phạm vi phải cho
      //   kết quả RỖNG như thể nó không tồn tại — cổng `idsMay` bên dưới đã làm
      //   việc ấy (máy của trạm lạ không nằm trong tập id), nên không cần, và
      //   KHÔNG được, ném lỗi riêng.
      const dieuKien = [
        input?.stationId ? eq(machines.stationId, input.stationId) : undefined,
        idsMay !== null ? inArray(machines.id, idsMay) : undefined,
      ].filter((x): x is NonNullable<typeof x> => x !== undefined);

      const rows = await database
        .select()
        .from(machines)
        .where(dieuKien.length > 0 ? and(...dieuKien) : undefined)
        .limit(input?.limit ?? 500);

      if (rows.length === 0) return [];

      // Health gần nhất theo máy (1 query, lấy bản ghi mới nhất mỗi máy ở app-layer)
      const machineIds = rows.map((m) => m.id);
      const healthRows = await database
        .select({
          machineId: machineHealthHistory.machineId,
          healthScore: machineHealthHistory.healthScore,
          predictedFailureRisk: machineHealthHistory.predictedFailureRisk,
          timestamp: machineHealthHistory.timestamp,
        })
        .from(machineHealthHistory)
        // inArray → "machineId" in ($1,$2,…). NB: a raw `= ANY(${machineIds})` compiles to
        // `= ANY(($1,$2,…))` — a Postgres row-constructor, not an array — which fails with
        // SQLSTATE 42809 "op ANY/ALL (array) requires array on right side".
        .where(inArray(machineHealthHistory.machineId, machineIds))
        .orderBy(desc(machineHealthHistory.timestamp));

      const latestHealth = new Map<number, { healthScore: number; predictedFailureRisk: number | null }>();
      for (const h of healthRows) {
        if (!latestHealth.has(h.machineId)) {
          latestHealth.set(h.machineId, {
            healthScore: h.healthScore,
            predictedFailureRisk: h.predictedFailureRisk,
          });
        }
      }

      return rows.map((m) => {
        const h = latestHealth.get(m.id) ?? null;
        return {
          id: m.id,
          code: m.code,
          name: m.name,
          stationId: m.stationId,
          operationStatus: m.operationStatus,
          image2DUrl: m.image2DUrl,
          image3DUrl: m.image3DUrl,
          layoutPositionX: m.layoutPositionX,
          layoutPositionY: m.layoutPositionY,
          healthScore: h?.healthScore ?? null,
          predictedFailureRisk: h?.predictedFailureRisk ?? null,
          color: colorForTwin(m.operationStatus, h?.healthScore ?? null),
        };
      });
    }),

  // --- G10: heatmap defect (số NG theo máy trong cửa sổ thời gian) ---
  defectHeatmap: protectedProcedure
    .input(z.object({
      hours: z.number().int().min(1).max(720).optional(),
      stationId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) return [] as { machineId: number; ngCount: number; totalCount: number; ngRate: number }[];

      const since = new Date(Date.now() - (input?.hours ?? 24) * 60 * 60 * 1000);

      // ★ Q1 — TRỤC MÃ, không phải trục id: `product_inspections` mang `factoryCode`
      //   thẳng trên hàng và KHÔNG treo vào chuỗi phân cấp. `undefined` = không lọc
      //   (toàn quyền); 0 gán ⇒ `congMaTenant` cho `1 = 0` TƯỜNG MINH.
      const congMa = await congMaTenant(
        { factoryCode: productInspections.factoryCode, corporateCode: productInspections.corporateCode },
        phamViCua(ctx),
      );

      const rows = await database
        .select({
          machineId: productInspections.machineId,
          ngCount: sql<number>`count(*) FILTER (WHERE ${productInspections.overallResult} = 'NG')::int`,
          totalCount: sql<number>`count(*)::int`,
        })
        .from(productInspections)
        .where(and(gte(productInspections.inspectionTime, since), congMa))
        .groupBy(productInspections.machineId);

      return rows.map((r) => ({
        machineId: r.machineId,
        ngCount: r.ngCount,
        totalCount: r.totalCount,
        ngRate: r.totalCount > 0 ? Math.round((r.ngCount / r.totalCount) * 1000) / 10 : 0,
      }));
    }),

  // --- G10: mô phỏng what-if năng suất chuyền (pure compute) ---
  //
  // ★ Q1 — **MIỄN TRỪ CÓ LÝ DO ĐO ĐƯỢC**, ghi ở `MIEN_TRU` của
  //   `phamViTwinCanh.unit.test.ts`. Thủ tục này KHÔNG chạm CSDL: mọi con số nó
  //   trả về đều suy từ chính `input` của người gọi (`simulateWhatIf` là hàm
  //   thuần, đo được: `services/digitalTwinService.ts`). Không có hàng nào của
  //   tenant nào để rò. `stationId` trong input chỉ là NHÃN đi kèm kết quả — nó
  //   không tra cứu gì, nên một id đoán được cũng không mở được cửa nào.
  //
  // ⚠ Cố tình KHÔNG thêm cổng phạm vi giả ở đây: một cổng không đo gì làm cả hai
  //   ô của lưới phân đôi xanh mà không có phép đo nào đứng sau (họ G5/G6).
  whatIf: protectedProcedure
    .input(z.object({
      stations: z.array(z.object({
        stationId: z.number().int(),
        name: z.string().nullish(),
        cycleTimeSec: z.number().positive(),
        availability: z.number().min(0).max(1).optional(),
        yield: z.number().min(0).max(1).optional(),
      })).min(1),
      horizonHours: z.number().positive().max(720),
      cycleTimeMultiplier: z.number().positive().max(10).optional(),
    }))
    .query(async ({ input }) => {
      return simulateWhatIf(input);
    }),

  // --- G2.7: WIP flow theo station (read-only) ---
  // Trả số WIP đang trong chuyền + serials theo station, join vị trí layout (nếu có).
  wipFlowState: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive().optional(),
      layoutId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      // ★ Q1 — `lineId` và `layoutId` đều do client TỰ KHAI. Hai cổng rời nhau:
      //   (a) chuyền được hỏi phải nằm trong phạm vi; (b) trạm trả về phải nằm
      //   trong phạm vi — cần cả hai vì `getWipByStation()` KHÔNG truyền `lineId`
      //   sẽ quét MỌI chuyền.
      const pv = phamViCua(ctx);
      const [idsChuyen, idsTram] = await Promise.all([
        idsTrongPhamVi("line", pv),
        idsTrongPhamVi("station", pv),
      ]);
      const rong = { stations: [], totalWip: 0, stationCount: 0, ts: Date.now() };
      if (idsChuyen !== null && input?.lineId != null && !idsChuyen.includes(input.lineId)) {
        // Chuyền ngoài phạm vi ⇒ NHƯ KHÔNG TỒN TẠI, không phải một lỗi riêng.
        return rong;
      }
      if ((idsChuyen !== null && idsChuyen.length === 0) || (idsTram !== null && idsTram.length === 0)) {
        return rong;
      }

      const rows = await getWipByStation({ lineId: input?.lineId });
      // DB đã GROUP BY + loại exited (exitedAt IS NULL) ở SQL → count/serials thực.
      // ★ Q1 — lọc TRẠM: `getWipByStation` không biết phạm vi, nên khi gọi không
      //   kèm `lineId` nó trả trạm của MỌI chuyền. Lọc ở đây, KHÔNG "tất cả hoặc
      //   không gì" — trạm trong phạm vi vẫn phải sống sót.
      const byStation = new Map<number, { count: number; serials: string[] }>();
      for (const r of rows) {
        if (idsTram !== null && !idsTram.includes(r.currentStationId)) continue;
        byStation.set(r.currentStationId, { count: r.count, serials: r.serials });
      }

      // Vị trí station (best-effort) từ layout — read-only, optional.
      const posByStation = new Map<number, { x: number; y: number }>();
      if (input?.layoutId != null) {
        const positions = await getMachinePositionsByLayout(input.layoutId);
        for (const p of positions as any[]) {
          const sid = (p.station?.id ?? p.stationId) as number | undefined;
          // ★ Q1 — `layoutId` cũng do client TỰ KHAI. Không chặn cả lời gọi (một
          //   layout có thể trộn trạm nhiều nhà máy); lọc TỪNG trạm, cùng luật
          //   với vòng lặp WIP bên trên. Toạ độ của trạm ngoài phạm vi bị bỏ.
          if (sid != null && idsTram !== null && !idsTram.includes(sid)) continue;
          if (sid != null && !posByStation.has(sid) && p.positionX != null && p.positionY != null) {
            posByStation.set(sid, { x: Number(p.positionX), y: Number(p.positionY) });
          }
        }
      }

      const stations = Array.from(byStation.entries()).map(([stationId, v]) => ({
        stationId,
        wipCount: v.count,
        serials: v.serials,
        position: posByStation.get(stationId) ?? null,
      }));

      return {
        stations,
        totalWip: stations.reduce((a, s) => a + s.wipCount, 0),
        stationCount: stations.length,
        ts: Date.now(),
      };
    }),

  // --- G2.7: heatmap tải trạm (read-only) ---
  stationLoadHeatmap: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive(),
      hours: z.number().int().min(1).max(720).optional(),
    }))
    .query(async ({ input, ctx }) => {
      // ★ Q1 — `lineId` bắt buộc và do client TỰ KHAI ⇒ phải kiểm trước khi đọc.
      if (!(await trongPhamVi("line", input.lineId, phamViCua(ctx)))) {
        return { cells: [], bottleneckStationId: null, ts: Date.now() };
      }
      const since = new Date(Date.now() - (input.hours ?? 24) * 60 * 60 * 1000);
      const [dwellAgg, latest] = await Promise.all([
        getStationDwellAgg(input.lineId, since),
        getLatestLineBalance(input.lineId),
      ]);
      // utilization toàn chuyền (nếu có) dùng làm fallback cho mọi trạm thiếu dwell.
      const lineUtil = latest?.utilizationPct ?? null;
      const inputs: StationLoadInput[] = dwellAgg.map((d) => ({
        stationId: d.stationId,
        avgDwellMs: d.avgDwellMs,
        avgStarvedMs: d.avgStarvedMs,
        avgBlockedMs: d.avgBlockedMs,
        utilizationPct: d.avgDwellMs > 0 ? null : lineUtil,
        samples: d.samples,
      }));
      return {
        cells: stationLoadHeatmap(inputs),
        bottleneckStationId: latest?.bottleneckStationId ?? null,
        ts: Date.now(),
      };
    }),

  // --- G2.7: overlay dự báo tắc nghẽn (read-only, text+màu only) ---
  predictionOverlay: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive(),
      horizonHours: z.number().int().min(1).max(24).optional(),
      algorithm: z.enum(["ewma", "holt_winters"]).optional(),
      bucketMin: z.number().int().min(1).max(240).optional(),
      threshold: z.number().positive().max(100000).optional(),
    }))
    .query(async ({ input, ctx }) => {
      // ★ Q1 — cùng luật với `stationLoadHeatmap`. Hình dạng trả về dùng lại
      //   nhánh `available:false` đã có sẵn, nhưng với `reason` RIÊNG: "ngoài
      //   phạm vi" và "không đủ dữ liệu" là hai câu khác nhau, gộp chúng lại là
      //   nói dối một trong hai (G47 — đếm đơn vị NGHĨA).
      if (!(await trongPhamVi("line", input.lineId, phamViCua(ctx)))) {
        return { available: false as const, reason: "out_of_scope", cells: [], ts: Date.now() };
      }
      const bucketMin = input.bucketMin ?? 30;
      const lookbackHours = 24;
      const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
      const series = await getWipCountSeries(input.lineId, since, bucketMin);

      // <3 điểm → không đủ dữ liệu để dự báo: trả available:false, KHÔNG throw.
      if (series.length < 3) {
        return { available: false as const, reason: "insufficient_data", cells: [], ts: Date.now() };
      }

      const points: TimeSeriesPoint[] = series.map((b) => ({
        timestamp: new Date(b.bucketStart).getTime(),
        value: b.wipCount,
      }));
      const bucketsPerHour = Math.max(1, Math.round(60 / bucketMin));
      const horizon = Math.max(1, (input.horizonHours ?? 1) * bucketsPerHour);
      const forecast = forecastWithConfidenceInterval(points, horizon, input.algorithm ?? "ewma");
      // WIP dự báo "1h tới" = trung bình các bucket trong giờ đầu của horizon.
      const next1h = forecast.slice(0, bucketsPerHour);
      const predictedWipNext1h = next1h.length
        ? next1h.reduce((a, p) => a + Math.max(0, p.predicted), 0) / next1h.length
        : 0;

      // Ngưỡng mặc định: 1.5× WIP đỉnh lịch sử (nếu không truyền threshold).
      const histMax = points.reduce((m, p) => Math.max(m, p.value), 0);
      const threshold = input.threshold ?? Math.max(1, histMax * 1.5);

      const forecasts: StationForecast[] = [{ stationId: input.lineId, predictedWipNext1h }];
      const overlay = buildPredictionOverlay(forecasts, threshold);
      return {
        available: true as const,
        threshold,
        cells: overlay,
        ts: Date.now(),
      };
    }),
});
