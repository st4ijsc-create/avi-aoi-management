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


});
