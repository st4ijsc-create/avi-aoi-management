/**
 * Sprint G2.4 — Component Installation Service.
 *
 * Records the RESULT of installing a component onto a board serial and links it
 * into the tamper-evident genealogy ledger as a "merge" event (re-using the
 * EXISTING event type with payload.kind="componentInstallation" — the hash-chain
 * schema / GenealogyEventType / eventTypeSchema are NOT widened).
 *
 * SAFETY: this is telemetry of an OUTCOME, not a control command. There is NO
 * write path to actuate a machine here (no commandDispatcher / driver.writeTags).
 * Stock decrements (feeder + supplier lot) clamp at ≥0.
 *
 * Failure isolation (mirrors processResultService): the installation row is
 * committed FIRST; the genealogy append + stock decrements run afterwards and a
 * failing genealogy append only logs (genealogyHash stays null) — capture never
 * blocks on the ledger.
 *
 * Reorder Andon is gated behind MES_BOM_ENABLED so the alert side-effect is opt-in;
 * BOM master CRUD is always available regardless of the flag.
 */
import * as db from "../db";
import {
  hashEntry,
  type GenealogyInput,
} from "../utils/genealogyChain";
// doc 44 W2-B2 (G5.17) — stamp the ALS correlation id on the genealogy row (trace
// metadata, OUTSIDE the hash input → verifyChain unaffected).
import { getCorrelationId } from "./observability/correlation";
import { raiseAndon } from "./andon/andonService";
import { publishToOutbox } from "./integration/outboxProducers"; // K0+-c: ADDITIVE ERP outbox (ERP_OUTBOX_ENABLED)
import type { InsertComponentInstallation } from "../../drizzle/schema";

export interface RecordComponentInstallationInput {
  serialNumber: string;        // board being assembled
  componentCode: string;
  componentSerial?: string | null;
  supplierLotId?: number | null;
  feederMaterialId?: number | null;
  machineId?: number | null;
  bomLineItemId?: number | null;
  qty?: number;
  refDesignator?: string | null;
  lotCode?: string | null;     // genealogy lotCode (board lot)
  installedAt?: Date;
}

export interface RecordComponentInstallationOutput {
  installationId: number;
  genealogy: { id: number; prevHash: string; currHash: string } | null;
  feederRemaining: number | null;
  supplierLotRemaining: number | null;
  reorderTriggered: boolean;
}

function isMesBomEnabled(): boolean {
  return process.env.MES_BOM_ENABLED === "true";
}

export async function recordComponentInstallation(
  input: RecordComponentInstallationInput,
  userId: number | null,
): Promise<RecordComponentInstallationOutput> {
  if (!input.serialNumber) throw new Error("serialNumber is required");
  if (!input.componentCode) throw new Error("componentCode is required");

  const installedAt = input.installedAt ?? new Date();
  const qty = input.qty != null && input.qty > 0 ? input.qty : 1;

  // 1) Persist the installation FIRST (source of truth, never blocked by ledger).
  const row: InsertComponentInstallation = {
    serialNumber: input.serialNumber,
    componentCode: input.componentCode,
    componentSerial: input.componentSerial ?? null,
    supplierLotId: input.supplierLotId ?? null,
    feederMaterialId: input.feederMaterialId ?? null,
    machineId: input.machineId ?? null,
    bomLineItemId: input.bomLineItemId ?? null,
    qty: String(qty),
    refDesignator: input.refDesignator ?? null,
    installedAt,
    installedBy: userId,
  };
  const installationId = await db.insertComponentInstallation(row);

  // 2) Decrement stock (clamp ≥0). Isolated: a stock error must not lose the install.
  let feederRemaining: number | null = null;
  let supplierLotRemaining: number | null = null;
  let reorderTriggered = false;
  try {
    if (input.feederMaterialId != null) {
      const fr = await db.consumeFeederMaterial(input.feederMaterialId, qty);
      if (fr.found) {
        feederRemaining = fr.remaining;
        if (fr.reorderFlag) reorderTriggered = true;
      }
    }
    if (input.supplierLotId != null) {
      const sr = await db.consumeSupplierLot(input.supplierLotId, qty);
      if (sr.found) supplierLotRemaining = sr.remaining;
    }
  } catch (err) {
    console.error(
      `[componentInstallationService] stock decrement failed for installation ${installationId}:`,
      err,
    );
  }

  // 3) Append a genealogy "merge" event (component → board). Isolated: chain
  //    errors never lose the installation; genealogyHash stays null on failure.
  let genealogy: RecordComponentInstallationOutput["genealogy"] = null;
  try {
    const recordedAt = new Date();
    const eventInput: GenealogyInput = {
      serialNumber: input.serialNumber,
      parentSerial: input.componentSerial ?? null,
      eventType: "merge",
      stationCode: input.machineId != null ? String(input.machineId) : null,
      lotCode: input.lotCode ?? null,
      payload: {
        kind: "componentInstallation",
        installationId,
        componentCode: input.componentCode,
        componentSerial: input.componentSerial ?? null,
        supplierLotId: input.supplierLotId ?? null,
        feederMaterialId: input.feederMaterialId ?? null,
        bomLineItemId: input.bomLineItemId ?? null,
        qty,
        refDesignator: input.refDesignator ?? null,
      },
      recordedAt,
    };
    // G5.17 (0255) — trace id; null outside an ALS context. NOT hashed.
    const correlationId = getCorrelationId() ?? null;
    // R4 fork-fix: read-tail → compute currHash → insert ATOMICALLY (serialised
    // advisory lock inside appendGenealogyChainRow) so concurrent installs cannot
    // fork the tamper-evident hash-chain.
    const inserted = await db.appendGenealogyChainRow((prevHash) => ({
      prevHash,
      currHash: hashEntry(prevHash, eventInput),
      serialNumber: input.serialNumber,
      parentSerial: input.componentSerial ?? null,
      eventType: "merge",
      stationCode: eventInput.stationCode ?? null,
      lotCode: input.lotCode ?? null,
      productModelId: null,
      payload: eventInput.payload as Record<string, any>,
      recordedBy: userId,
      recordedAt,
      // Conditional so pre-0255 databases keep working when no context is active.
      ...(correlationId ? { correlationId } : {}),
    }));
    const { prevHash, currHash } = inserted;
    genealogy = { id: inserted.id, prevHash, currHash };

    // K0+-c: ADDITIVELY publish the genealogy (merge) record to the durable ERP
    // outbox. Fire-and-forget + error-isolated (never blocks capture); gated by
    // ERP_OUTBOX_ENABLED (no-op when off). Idempotent per genealogy row id.
    publishToOutbox({
      eventType: "genealogy-record",
      payload: {
        genealogyId: inserted.id,
        installationId,
        eventType: "merge",
        serialNumber: input.serialNumber,
        parentSerial: input.componentSerial ?? null,
        componentCode: input.componentCode,
        lotCode: input.lotCode ?? null,
        currHash,
        prevHash,
        recordedAt: recordedAt.toISOString(),
      },
      idempotencyKey: `gen-${inserted.id}`,
    });

    // Best-effort link the hash back onto the installation row.
    try {
      await db.updateComponentInstallationGenealogyHash(installationId, currHash);
    } catch {
      /* non-fatal */
    }
  } catch (err) {
    console.error(
      `[componentInstallationService] genealogy append failed for installation ${installationId}:`,
      err,
    );
  }

  // 4) Reorder Andon — gated behind MES_BOM_ENABLED. raiseAndon has its own 30s
  //    idempotency window per machine+reason. SAFETY: Andon is a signal only —
  //    no command path. Isolated so an Andon error never fails the install.
  if (reorderTriggered && isMesBomEnabled()) {
    try {
      await raiseAndon(
        {
          state: "yellow",
          reason: "material",
          title: `Feeder below reorder level (${input.componentCode})`,
          message: `Feeder material #${input.feederMaterialId} for ${input.componentCode} reached its reorder level (remaining ${feederRemaining}).`,
          machineId: input.machineId ?? null,
          raisedBySystem: true,
        },
        { id: userId ?? null, name: "system" },
      );
    } catch (err) {
      console.error(
        `[componentInstallationService] reorder Andon failed for installation ${installationId}:`,
        err,
      );
    }
  }

  return {
    installationId,
    genealogy,
    feederRemaining,
    supplierLotRemaining,
    reorderTriggered,
  };
}
