/**
 * DB-integration tests for panel-level yield (doc 51 CASE #7).
 *
 * SMT lines panelize: one physical panel carries N boards and a panel is
 * scrapped as a UNIT, so a panel is NG if ANY of its boards is NG. The
 * pre-existing dashboard yield is board-level (over-counts good units on a
 * scrapped panel). getPanelYieldStats surfaces the panel numbers ALONGSIDE the
 * board numbers without changing the existing functions.
 *
 * Each scenario runs on its OWN machine so the machineId filter isolates it
 * from other suite data (runs against the isolated cloned test DB —
 * vitest.setup.ts).
 *
 * Mutation-tests (each fails if the fix is removed):
 *  - Scenario A locks "panel NG iff ANY board NG" (panel 0% while board 75%).
 *  - Scenario C locks that panel-less boards are EXCLUDED from panel aggregation.
 *  - Scenario E locks that panel FPY uses the FIRST inspection per board while
 *    panel final yield uses ALL rows (FPY 100% vs final 0% on the same panel).
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as db from "../db";

describe("panel-level yield (doc 51 CASE #7)", () => {
  const ts = Date.now();
  const range = { startDate: new Date("2026-05-01T00:00:00Z"), endDate: new Date("2026-05-31T00:00:00Z") };
  const t0 = new Date("2026-05-10T03:00:00Z").getTime();

  let productModelId: number;
  let machineA: number; // one panel, 8 boards, 2 NG
  let machineB: number; // one panel, all OK
  let machineC: number; // standalone boards, no panel
  let machineE: number; // panel with an OK-first / NG-retest board

  async function insp(machineId: number, opts: {
    serial: string;
    result: "OK" | "NG" | "NTF";
    panelSerial?: string | null;
    boardIndex?: number | null;
    minutes?: number;
  }) {
    await db.createProductInspection({
      machineId,
      productModelId,
      serialNumber: opts.serial,
      overallResult: opts.result,
      originalResult: opts.result === "NTF" ? "NG" : opts.result,
      panelSerial: opts.panelSerial ?? null,
      boardIndex: opts.boardIndex ?? null,
      inspectionTime: new Date(t0 + (opts.minutes ?? 0) * 60_000),
    });
  }

  beforeAll(async () => {
    const factoryId = await db.createFactory({ code: `TEST_FAC_PANEL_${ts}`, name: "Panel test factory" });
    const workshopId = await db.createWorkshop({ factoryId, code: `TEST_WS_PANEL_${ts}`, name: "Panel test workshop" });
    const lineId = await db.createProductionLine({ workshopId, code: `TEST_LINE_PANEL_${ts}`, name: "Panel test line" });
    const stationId = await db.createStation({ lineId, code: `TEST_ST_PANEL_${ts}`, name: "Panel test station", sequence: 1 });
    productModelId = await db.createProductModel({ code: `PROD_PANEL_${ts}`, name: "Panel test product", version: "1.0" });

    const mk = async (suffix: string) => db.createMachine({
      stationId,
      code: `M_PANEL_${suffix}_${ts}`,
      name: `Panel ${suffix} machine`,
      machineType: "AOI",
      apiKey: `test_panel_${suffix}_${ts}`,
    });
    machineA = await mk("A");
    machineB = await mk("B");
    machineC = await mk("C");
    machineE = await mk("E");

    // ── Scenario A: 1 panel, 8 boards, boards 7 & 8 NG (no retests) ──
    const panelA = `PANEL_A_${ts}`;
    for (let i = 1; i <= 8; i++) {
      await insp(machineA, {
        serial: `A_B${i}_${ts}`,
        result: i >= 7 ? "NG" : "OK",
        panelSerial: panelA,
        boardIndex: i,
      });
    }

    // ── Scenario B: 1 panel, 4 boards, all OK ──
    const panelB = `PANEL_B_${ts}`;
    for (let i = 1; i <= 4; i++) {
      await insp(machineB, { serial: `B_B${i}_${ts}`, result: "OK", panelSerial: panelB, boardIndex: i });
    }

    // ── Scenario C: 3 standalone boards, NO panel (2 OK, 1 NG) ──
    await insp(machineC, { serial: `C_B1_${ts}`, result: "OK", panelSerial: null });
    await insp(machineC, { serial: `C_B2_${ts}`, result: "OK", panelSerial: "" }); // empty string = no panel
    await insp(machineC, { serial: `C_B3_${ts}`, result: "NG", panelSerial: null });

    // ── Scenario E: 1 panel, 2 boards. Board 1 OK-first then NG-retest ──
    // First inspection per board is OK for BOTH → panel FPY = 100%.
    // But a later NG row exists → panel final yield sees NG → 0%.
    const panelE = `PANEL_E_${ts}`;
    await insp(machineE, { serial: `E_B1_${ts}`, result: "OK", panelSerial: panelE, boardIndex: 1, minutes: 0 });
    await insp(machineE, { serial: `E_B1_${ts}`, result: "NG", panelSerial: panelE, boardIndex: 1, minutes: 30 });
    await insp(machineE, { serial: `E_B2_${ts}`, result: "OK", panelSerial: panelE, boardIndex: 2, minutes: 0 });
  });

  it("A: 1 panel / 8 boards / 2 NG → board yield 75%, panel yield 0% (panel is NG)", async () => {
    const s = await db.getPanelYieldStats({ machineId: machineA, ...range });
    // Board-level (unchanged math): 6 OK of 8.
    expect(s.boardTotal).toBe(8);
    expect(s.boardNg).toBe(2);
    expect(s.boardYieldRate).toBe(75);
    // Panel-level: the single panel has NG boards → NG panel.
    expect(s.panelTotal).toBe(1);
    expect(s.panelNg).toBe(1);
    expect(s.panelPass).toBe(0);
    expect(s.panelYieldRate).toBe(0);
    // Panel FPY: not every board first-passed → 0%.
    expect(s.panelFirstTotal).toBe(1);
    expect(s.panelFirstPass).toBe(0);
    expect(s.panelFpy).toBe(0);
    expect(s.boardsWithoutPanel).toBe(0);
  });

  it("B: 1 panel all OK → panel PASS (yield 100%, FPY 100%)", async () => {
    const s = await db.getPanelYieldStats({ machineId: machineB, ...range });
    expect(s.boardTotal).toBe(4);
    expect(s.boardYieldRate).toBe(100);
    expect(s.panelTotal).toBe(1);
    expect(s.panelPass).toBe(1);
    expect(s.panelNg).toBe(0);
    expect(s.panelYieldRate).toBe(100);
    expect(s.panelFirstTotal).toBe(1);
    expect(s.panelFirstPass).toBe(1);
    expect(s.panelFpy).toBe(100);
  });

  it("C: standalone boards (no panelSerial) do NOT enter panel aggregation", async () => {
    const s = await db.getPanelYieldStats({ machineId: machineC, ...range });
    // Board metrics still count them (3 boards, 2 OK / 1 NG).
    expect(s.boardTotal).toBe(3);
    expect(s.boardNg).toBe(1);
    // No panels at all.
    expect(s.panelTotal).toBe(0);
    expect(s.panelPass).toBe(0);
    expect(s.panelYieldRate).toBe(0);
    expect(s.panelFirstTotal).toBe(0);
    expect(s.panelFpy).toBe(0);
    // Both NULL and '' panel serials are reported as panel-less.
    expect(s.boardsWithoutPanel).toBe(3);
  });

  it("E: panel FPY uses FIRST inspection per board (100%) while final yield uses all rows (0%)", async () => {
    const s = await db.getPanelYieldStats({ machineId: machineE, ...range });
    expect(s.panelTotal).toBe(1);
    // Final yield: the panel has an NG row → NG panel → 0%.
    expect(s.panelYieldRate).toBe(0);
    // FPY: both boards' FIRST inspection was OK → panel first-passed → 100%.
    expect(s.panelFirstTotal).toBe(1);
    expect(s.panelFirstPass).toBe(1);
    expect(s.panelFpy).toBe(100);
  });
});
