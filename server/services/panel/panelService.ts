/**
 * Panel/Board multi-up master service (doc 29 §2 — W8-B, migration 0192).
 *
 * CRUD over product_panel_defs / product_panel_boards + the "active panel def"
 * resolver used by analytics (panel-aware heatmap) and the InspectionDetail
 * "Board i/n" chip. Pure transform math lives in ./panelTransform.ts.
 *
 * Conventions: getDb()-guarded (reads degrade to []/null when the DB is offline,
 * writers throw), soft refs (productModelId validated by the caller/router),
 * soft delete via deletedAt + isActive.
 */
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { appError } from "../../_core/appError";
import { DbUnavailableError } from "../../_core/dbErrors";
import { getDb } from "../../db/connection";
import {
  productPanelDefs,
  productPanelBoards,
  type ProductPanelDef,
  type ProductPanelBoard,
} from "../../../drizzle/schema";
import { generateGridBoards } from "./panelTransform";

export interface PanelBoardInput {
  boardIndex: number;
  offsetXMm: number;
  offsetYMm: number;
  rotationDeg?: number;
  mirrored?: boolean;
  skipped?: boolean;
  refDesPrefix?: string | null;
}

export interface PanelDefInput {
  productModelId: number;
  code: string;
  name?: string | null;
  rows?: number;
  cols?: number;
  nUp?: number;
  panelWidthMm?: number | null;
  panelHeightMm?: number | null;
  boardWidthMm?: number | null;
  boardHeightMm?: number | null;
  originCorner?: string;
  serialScheme?: string;
  fiducials?: Array<{ x: number; y: number; type?: string }> | null;
  isActive?: boolean;
}

export type PanelDefWithBoards = ProductPanelDef & { boards: ProductPanelBoard[] };

function decOrNull(v: number | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  return v === null ? null : String(v);
}

/** List (non-deleted) panel defs of a product, newest version first, with boards. */
export async function listPanelDefs(productModelId: number): Promise<PanelDefWithBoards[]> {
  const db = await getDb();
  if (!db) return [];
  const defs = await db
    .select()
    .from(productPanelDefs)
    .where(and(eq(productPanelDefs.productModelId, productModelId), isNull(productPanelDefs.deletedAt)))
    .orderBy(desc(productPanelDefs.version), desc(productPanelDefs.createdAt));
  const out: PanelDefWithBoards[] = [];
  for (const def of defs) {
    out.push({ ...def, boards: await listBoards(def.id) });
  }
  return out;
}

export async function getPanelDef(id: number): Promise<PanelDefWithBoards | null> {
  const db = await getDb();
  if (!db) return null;
  const [def] = await db.select().from(productPanelDefs).where(eq(productPanelDefs.id, id)).limit(1);
  if (!def || def.deletedAt) return null;
  return { ...def, boards: await listBoards(def.id) };
}

/**
 * The ACTIVE panel def of a product (newest active, non-deleted version) or null
 * when the product is single-board — consumers MUST treat null as "no panel"
 * and degrade honestly (doc 29: never fabricate a panel).
 */
export async function getActivePanelDefForProduct(
  productModelId: number,
): Promise<PanelDefWithBoards | null> {
  const db = await getDb();
  if (!db) return null;
  const [def] = await db
    .select()
    .from(productPanelDefs)
    .where(
      and(
        eq(productPanelDefs.productModelId, productModelId),
        eq(productPanelDefs.isActive, true),
        isNull(productPanelDefs.deletedAt),
      ),
    )
    .orderBy(desc(productPanelDefs.version), desc(productPanelDefs.createdAt))
    .limit(1);
  if (!def) return null;
  return { ...def, boards: await listBoards(def.id) };
}

async function listBoards(panelDefId: number): Promise<ProductPanelBoard[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(productPanelBoards)
    .where(eq(productPanelBoards.panelDefId, panelDefId))
    .orderBy(asc(productPanelBoards.boardIndex));
}

/**
 * Create a panel def. When `boards` is omitted, a rows×cols grid is
 * quick-generated (panelTransform.generateGridBoards). nUp defaults to the
 * board count. Returns the id.
 */
export async function createPanelDef(
  input: PanelDefInput,
  boards?: PanelBoardInput[],
): Promise<number> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const rows = input.rows ?? 1;
  const cols = input.cols ?? 1;
  const boardList: PanelBoardInput[] =
    boards && boards.length > 0
      ? boards
      : generateGridBoards({
          rows,
          cols,
          panelWidthMm: input.panelWidthMm,
          panelHeightMm: input.panelHeightMm,
          boardWidthMm: input.boardWidthMm,
          boardHeightMm: input.boardHeightMm,
        });
  assertBoardIndexes(boardList);

  const [def] = await db
    .insert(productPanelDefs)
    .values({
      productModelId: input.productModelId,
      code: input.code,
      name: input.name ?? null,
      rows,
      cols,
      nUp: input.nUp ?? boardList.length,
      panelWidthMm: decOrNull(input.panelWidthMm) ?? null,
      panelHeightMm: decOrNull(input.panelHeightMm) ?? null,
      boardWidthMm: decOrNull(input.boardWidthMm) ?? null,
      boardHeightMm: decOrNull(input.boardHeightMm) ?? null,
      originCorner: input.originCorner ?? "top_left",
      serialScheme: input.serialScheme ?? "suffix",
      fiducials: input.fiducials ?? null,
      isActive: input.isActive ?? true,
    })
    .returning({ id: productPanelDefs.id });
  await replaceBoardsInternal(def.id, boardList);
  return def.id;
}

export async function updatePanelDef(
  id: number,
  patch: Partial<Omit<PanelDefInput, "productModelId">>,
): Promise<ProductPanelDef | null> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.code !== undefined) set.code = patch.code;
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.rows !== undefined) set.rows = patch.rows;
  if (patch.cols !== undefined) set.cols = patch.cols;
  if (patch.nUp !== undefined) set.nUp = patch.nUp;
  if (patch.panelWidthMm !== undefined) set.panelWidthMm = decOrNull(patch.panelWidthMm);
  if (patch.panelHeightMm !== undefined) set.panelHeightMm = decOrNull(patch.panelHeightMm);
  if (patch.boardWidthMm !== undefined) set.boardWidthMm = decOrNull(patch.boardWidthMm);
  if (patch.boardHeightMm !== undefined) set.boardHeightMm = decOrNull(patch.boardHeightMm);
  if (patch.originCorner !== undefined) set.originCorner = patch.originCorner;
  if (patch.serialScheme !== undefined) set.serialScheme = patch.serialScheme;
  if (patch.fiducials !== undefined) set.fiducials = patch.fiducials;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  const [row] = await db
    .update(productPanelDefs)
    .set(set)
    .where(eq(productPanelDefs.id, id))
    .returning();
  return row ?? null;
}

/** Soft delete (deletedAt + isActive=false). Boards are kept for history. */
export async function softDeletePanelDef(id: number): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  await db
    .update(productPanelDefs)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(productPanelDefs.id, id));
  return { success: true };
}

/**
 * Replace the FULL board set of a panel def (the editor saves the whole table).
 * boardIndex uniqueness is validated here (clear error, not a raw constraint).
 */
export async function replaceBoards(
  panelDefId: number,
  boards: PanelBoardInput[],
): Promise<ProductPanelBoard[]> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  assertBoardIndexes(boards);
  const [def] = await db
    .select({ id: productPanelDefs.id })
    .from(productPanelDefs)
    .where(and(eq(productPanelDefs.id, panelDefId), isNull(productPanelDefs.deletedAt)))
    .limit(1);
  if (!def) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "panelDefinition" }, `Panel def ${panelDefId} not found`);
  await replaceBoardsInternal(panelDefId, boards);
  // Keep nUp in sync with the actual board count (doc 29: nUp thường = rows*cols).
  await db
    .update(productPanelDefs)
    .set({ nUp: boards.length, updatedAt: new Date() })
    .where(eq(productPanelDefs.id, panelDefId));
  return listBoards(panelDefId);
}

async function replaceBoardsInternal(panelDefId: number, boards: PanelBoardInput[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  await db.transaction(async (tx) => {
    await tx.delete(productPanelBoards).where(eq(productPanelBoards.panelDefId, panelDefId));
    if (boards.length > 0) {
      await tx.insert(productPanelBoards).values(
        boards.map((b) => ({
          panelDefId,
          boardIndex: b.boardIndex,
          offsetXMm: String(b.offsetXMm),
          offsetYMm: String(b.offsetYMm),
          rotationDeg: String(b.rotationDeg ?? 0),
          mirrored: b.mirrored ?? false,
          skipped: b.skipped ?? false,
          refDesPrefix: b.refDesPrefix ?? null,
        })),
      );
    }
  });
}

function assertBoardIndexes(boards: PanelBoardInput[]): void {
  const seen = new Set<number>();
  for (const b of boards) {
    if (!Number.isInteger(b.boardIndex) || b.boardIndex < 1) {
      throw new Error(`boardIndex must be a positive integer (got ${b.boardIndex})`);
    }
    if (seen.has(b.boardIndex)) {
      throw new Error(`Duplicate boardIndex ${b.boardIndex} in board set`);
    }
    seen.add(b.boardIndex);
  }
}
