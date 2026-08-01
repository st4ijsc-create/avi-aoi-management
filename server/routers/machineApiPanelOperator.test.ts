/**
 * W8-B (doc 29 §2.3/§3.2 — migration 0192) — ingest stamping through the REAL
 * machineApi.submitInspection pipeline against the isolated test DB:
 *
 *   • panelId/boardIndex (additive zod fields) persist to
 *     product_inspections.panelSerial/boardIndex;
 *   • operatorId (badge code) resolves via the badge master → operatorUserId
 *     stamped; unknown badge → NULL + auto_seen row; NEVER a rejection;
 *   • absent fields → NULL columns (single-board/legacy behaviour unchanged);
 *   • st4i-standard adapter carries panel_id/board_index into the canonical
 *     top-level fields (normalize → submit wiring proof).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { machineApiRouter } from "./machineApiRouters";
import * as db from "../db";
import { getDb } from "../db/connection";
import { productInspections, operatorBadges, users } from "../../drizzle/schema";
import { issueBadge, _resetBadgeCache } from "../services/operatorBadgeService";
import { getVisionAdapter } from "../services/vision";
import "../services/vision"; // side-effect: register built-in adapters
import type { TrpcContext } from "../_core/context";

const STAMP = Date.now();
const API_KEY = `W8B-PANEL-${STAMP}`;
const BADGE_KNOWN = `W8B-BDG-${STAMP}`;
const BADGE_UNKNOWN = `W8B-UNK-${STAMP}`;

let machineId: number;
let operatorUser: number;
const inspectionIds: number[] = [];

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1, // soft-ref pattern used by sibling machineApi tests
    code: `W8B-PANEL-${STAMP}`,
    name: "W8-B panel/operator test machine",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
  const d = await getDb();
  const [u] = await d!
    .insert(users)
    .values({ openId: `w8b-op-${STAMP}`, name: "W8B Operator", role: "user" })
    .returning({ id: users.id });
  operatorUser = u.id;
  await issueBadge({ badgeCode: BADGE_KNOWN, userId: operatorUser, validFrom: new Date("2026-01-01T00:00:00") });
  _resetBadgeCache();
});

afterAll(async () => {
  const d = await getDb();
  if (d) {
    if (inspectionIds.length > 0) {
      await d.delete(productInspections).where(inArray(productInspections.id, inspectionIds));
    }
    await d.delete(operatorBadges).where(like(operatorBadges.badgeCode, `W8B-%-${STAMP}`));
    await d.delete(users).where(eq(users.id, operatorUser));
  }
  if (machineId) await db.deleteMachine(machineId);
});

describe("submitInspection × panel/boardIndex + operator badge stamping (0192)", () => {
  it("persists panelId → panelSerial + boardIndex, and resolves the badge → operatorUserId", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    const r = await caller.submitInspection({
      apiKey: API_KEY,
      serialNumber: `SN-W8B-${STAMP}-1`,
      overallResult: "OK",
      operatorId: BADGE_KNOWN,
      panelId: `PNL-${STAMP}`,
      boardIndex: 3,
      measurements: [],
    });
    expect(r.success).toBe(true);
    inspectionIds.push(r.inspectionId!);

    const row = await db.getProductInspectionById(r.inspectionId!);
    expect(row?.panelSerial).toBe(`PNL-${STAMP}`);
    expect(row?.boardIndex).toBe(3);
    expect(row?.operatorId).toBe(BADGE_KNOWN); // badge code kept verbatim
    expect(row?.operatorUserId).toBe(operatorUser);
  });

  it("UNKNOWN badge: submission accepted, operatorUserId NULL, badge auto-registered auto_seen", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    const r = await caller.submitInspection({
      apiKey: API_KEY,
      serialNumber: `SN-W8B-${STAMP}-2`,
      overallResult: "NG",
      operatorId: BADGE_UNKNOWN,
      measurements: [],
    });
    expect(r.success).toBe(true); // never rejected over badge state
    inspectionIds.push(r.inspectionId!);

    const row = await db.getProductInspectionById(r.inspectionId!);
    expect(row?.operatorUserId ?? null).toBeNull();
    expect(row?.operatorId).toBe(BADGE_UNKNOWN);

    await new Promise((resolve) => setTimeout(resolve, 200)); // fire-and-forget insert
    const d = await getDb();
    const seen = await d!.select().from(operatorBadges).where(eq(operatorBadges.badgeCode, BADGE_UNKNOWN));
    expect(seen).toHaveLength(1);
    expect(seen[0].source).toBe("auto_seen");
    expect(seen[0].userId).toBeNull();
  });

  it("absent panel/operator fields → NULL columns (legacy single-board behaviour unchanged)", async () => {
    const caller = machineApiRouter.createCaller(ctx());
    const r = await caller.submitInspection({
      apiKey: API_KEY,
      serialNumber: `SN-W8B-${STAMP}-3`,
      overallResult: "OK",
      measurements: [],
    });
    expect(r.success).toBe(true);
    inspectionIds.push(r.inspectionId!);

    const row = await db.getProductInspectionById(r.inspectionId!);
    expect(row?.panelSerial ?? null).toBeNull();
    expect(row?.boardIndex ?? null).toBeNull();
    expect(row?.operatorUserId ?? null).toBeNull();
  });

  it("st4i-standard normalize → submit: panel_id/board_index flow through the canonical layer", async () => {
    const adapter = getVisionAdapter("st4i-standard");
    const canonical = adapter.normalize({
      spec_version: 1,
      header: {
        machine_code: `W8B-PANEL-${STAMP}`,
        serial_number: `SN-W8B-${STAMP}-4`,
        program_name: "W8B-PROG",
        panel_id: "PNL-ST4I-88",
        board_index: 2,
        operator_id: BADGE_KNOWN,
        started_at: "2026-07-04T08:00:00+07:00",
        finished_at: "2026-07-04T08:00:05+07:00",
        result: "OK",
      },
      measurements: [],
    });
    // Canonical top-level fields (not just rawExtras) — the ingest contract.
    expect(canonical.panelId).toBe("PNL-ST4I-88");
    expect(canonical.boardIndex).toBe(2);
    expect(canonical.rawExtras).toMatchObject({ panel_id: "PNL-ST4I-88", board_index: 2 });

    const caller = machineApiRouter.createCaller(ctx());
    const r = await caller.submitInspection({ ...canonical, apiKey: API_KEY });
    expect(r.success).toBe(true);
    inspectionIds.push(r.inspectionId!);

    const row = await db.getProductInspectionById(r.inspectionId!);
    expect(row?.panelSerial).toBe("PNL-ST4I-88");
    expect(row?.boardIndex).toBe(2);
    expect(row?.operatorUserId).toBe(operatorUser);
  });
});
