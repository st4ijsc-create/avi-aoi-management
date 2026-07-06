/**
 * Sprint S1 — Traceability Router (G6)
 *
 * Truy xuất genealogy 2 chiều từ 1 serial:
 *  upstream  : serial → lot → supplier lot → material receipt (nhà cung cấp)
 *  downstream: serial → lot disposition → customer return ref (khách hàng)
 *
 * bySerial: trả về cây lineage gộp (wip + upstream material + downstream disposition).
 * byLot   : tra cứu theo lotNumber (danh sách serial + disposition).
 *
 * Read-only / protected. Auto-degrade về null/[] khi DB chưa sẵn sàng.
 */
import { z } from "zod";
import { moduleProcedure, router } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_PRODUCTION (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_PRODUCTION");
import { getDb } from "../db/connection";
import { listInstallationsBySerial } from "../db/bom"; // G2.4: component installs for a serial
import { eq, or } from "drizzle-orm";
import {
  wipTracking,
  lotDisposition,
  supplierLots,
  materialReceipts,
} from "../../drizzle/schema";

export const traceabilityRouter = router({
  // Cây genealogy 2 chiều cho 1 serial number.
  bySerial: protectedProcedure
    .input(z.object({ serialNumber: z.string().min(1) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) {
        return { serialNumber: input.serialNumber, found: false, wip: [], upstream: [], downstream: [], components: [] };
      }

      // WIP record(s) cho serial (kèm chuỗi cha qua parentSerialNumber).
      const wipRows = await database
        .select()
        .from(wipTracking)
        .where(or(
          eq(wipTracking.serialNumber, input.serialNumber),
          eq(wipTracking.parentSerialNumber, input.serialNumber),
        ));

      // G2.4 (additive): component installations for this serial (component → board).
      const components = await listInstallationsBySerial(input.serialNumber);

      // Disposition liên quan serial (downstream: rework/scrap/return + customerReturnRef).
      const dispRows = await database
        .select()
        .from(lotDisposition)
        .where(eq(lotDisposition.serialNumber, input.serialNumber));

      // Upstream: từ supplierLotId của disposition → supplier lot → material receipt.
      const supplierLotIds = Array.from(
        new Set(dispRows.map((d) => d.supplierLotId).filter((v): v is number => typeof v === "number")),
      );

      const upstream: {
        supplierLot: typeof supplierLots.$inferSelect;
        receipt: typeof materialReceipts.$inferSelect | null;
      }[] = [];

      for (const lotId of supplierLotIds) {
        const [lot] = await database
          .select()
          .from(supplierLots)
          .where(eq(supplierLots.id, lotId))
          .limit(1);
        if (!lot) continue;
        let receipt: typeof materialReceipts.$inferSelect | null = null;
        if (lot.receiptId) {
          const [r] = await database
            .select()
            .from(materialReceipts)
            .where(eq(materialReceipts.id, lot.receiptId))
            .limit(1);
          receipt = r ?? null;
        }
        upstream.push({ supplierLot: lot, receipt });
      }

      const downstream = dispRows.map((d) => ({
        disposition: d.disposition,
        lotNumber: d.lotNumber,
        quantity: d.quantity,
        reason: d.reason,
        defectCode: d.defectCode,
        customerReturnRef: d.customerReturnRef,
        decidedAt: d.decidedAt,
      }));

      return {
        serialNumber: input.serialNumber,
        found: wipRows.length > 0 || dispRows.length > 0 || components.length > 0,
        wip: wipRows,
        upstream,
        downstream,
        components,
      };
    }),

  // Tra cứu theo lotNumber: serial trong lot + các disposition.
  byLot: protectedProcedure
    .input(z.object({ lotNumber: z.string().min(1) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { lotNumber: input.lotNumber, found: false, wip: [], dispositions: [] };

      const wipRows = await database
        .select()
        .from(wipTracking)
        .where(eq(wipTracking.lotNumber, input.lotNumber));

      const dispRows = await database
        .select()
        .from(lotDisposition)
        .where(eq(lotDisposition.lotNumber, input.lotNumber));

      return {
        lotNumber: input.lotNumber,
        found: wipRows.length > 0 || dispRows.length > 0,
        wip: wipRows,
        dispositions: dispRows,
      };
    }),
});
