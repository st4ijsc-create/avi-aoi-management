/**
 * W8-B (doc 29 §2) — panel def/board CRUD against the isolated cloned test DB.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { productPanelDefs, productPanelBoards } from "../../../drizzle/schema";
import * as db from "../../db";
import {
  createPanelDef,
  getPanelDef,
  listPanelDefs,
  getActivePanelDefForProduct,
  updatePanelDef,
  softDeletePanelDef,
  replaceBoards,
} from "./panelService";

const STAMP = Date.now();
let productModelId: number;
const defIds: number[] = [];

afterAll(async () => {
  const d = await getDb();
  if (d && defIds.length > 0) {
    await d.delete(productPanelBoards).where(inArray(productPanelBoards.panelDefId, defIds));
    await d.delete(productPanelDefs).where(inArray(productPanelDefs.id, defIds));
  }
  if (productModelId) await db.deleteProductModel(productModelId).catch(() => undefined);
});

describe("panelService CRUD", () => {
  it("creates a def with quick-generated rows×cols boards and reads it back", async () => {
    productModelId = await db.createProductModel({ code: `W8B-PNL-${STAMP}`, name: "W8B panel product" });

    const id = await createPanelDef({
      productModelId,
      code: "PNL-2x3-V1",
      rows: 2,
      cols: 3,
      panelWidthMm: 150,
      panelHeightMm: 60,
      boardWidthMm: 50,
      boardHeightMm: 30,
    });
    defIds.push(id);

    const def = await getPanelDef(id);
    expect(def).not.toBeNull();
    expect(def!.nUp).toBe(6);
    expect(def!.boards).toHaveLength(6);
    expect(def!.boards.map((b) => b.boardIndex)).toEqual([1, 2, 3, 4, 5, 6]);
    // Row-major offsets from explicit board dims.
    expect(Number(def!.boards[4].offsetXMm)).toBeCloseTo(50); // index 5 = row 2, col 2
    expect(Number(def!.boards[4].offsetYMm)).toBeCloseTo(30);

    const active = await getActivePanelDefForProduct(productModelId);
    expect(active?.id).toBe(id);
  });

  it("replaceBoards swaps the whole set, syncs nUp, and rejects duplicate boardIndex", async () => {
    const id = defIds[0];
    const boards = [
      { boardIndex: 1, offsetXMm: 0, offsetYMm: 0 },
      { boardIndex: 2, offsetXMm: 50, offsetYMm: 0, rotationDeg: 180, mirrored: true },
      { boardIndex: 3, offsetXMm: 100, offsetYMm: 0, skipped: true },
    ];
    const saved = await replaceBoards(id, boards);
    expect(saved).toHaveLength(3);
    expect(saved[1].mirrored).toBe(true);
    expect(Number(saved[1].rotationDeg)).toBeCloseTo(180);
    expect(saved[2].skipped).toBe(true);
    const def = await getPanelDef(id);
    expect(def!.nUp).toBe(3);

    await expect(
      replaceBoards(id, [
        { boardIndex: 1, offsetXMm: 0, offsetYMm: 0 },
        { boardIndex: 1, offsetXMm: 10, offsetYMm: 0 },
      ]),
    ).rejects.toThrow(/Duplicate boardIndex/);
    // Failed save must not have clobbered the good set.
    expect((await getPanelDef(id))!.boards).toHaveLength(3);
  });

  it("update + soft delete: deleted defs vanish from list/active resolution", async () => {
    const id2 = await createPanelDef({ productModelId, code: "PNL-1x2-V2", rows: 1, cols: 2, nUp: 2 });
    defIds.push(id2);

    await updatePanelDef(defIds[0], { isActive: false });
    let active = await getActivePanelDefForProduct(productModelId);
    expect(active?.id).toBe(id2);

    await softDeletePanelDef(id2);
    active = await getActivePanelDefForProduct(productModelId);
    expect(active).toBeNull(); // V1 inactive, V2 deleted
    const list = await listPanelDefs(productModelId);
    expect(list.map((d) => d.id)).toEqual([defIds[0]]); // deleted gone, inactive still listed
  });
});
