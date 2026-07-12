/**
 * doc 44 W3-B1 / G3.3 — RECIPE SET cấp tuyến (SYNAPSE LDS-L3 §6.1 + §12.3).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * "Phân phối recipe & khóa phiên bản":
 *
 *   • recipe_sets / recipe_set_items (mig 0259) — một bộ recipe THEO SẢN PHẨM
 *     ("MODEL-X@v3"); mỗi item trỏ MỘT phiên bản machine_recipes cụ thể —
 *     KHÔNG nhân đôi payload, catalog versioned sẵn có là nguồn sự thật.
 *   • distributeRecipeSet — phân phối tới từng máy qua ĐƯỜNG DEPLOY SẴN CÓ
 *     (db/machineRecipe.deployRecipe: FOR UPDATE theo code + second-approver
 *     gate + ledger recipe_deployments — mọi gate hiện có được GIỮ NGUYÊN).
 *     Sau deploy: XÁC NHẬN NẠP (spec §6.1 "kiểm mọi trạm đã nạp đúng recipe")
 *     — query lại machineRecipes active per code, đúng id + đúng máy. Đủ →
 *     line_states.recipe_set_ref = code + KHÓA set (locked, suốt lô).
 *   • unlockRecipeSet — gỡ khóa CHỈ khi mọi tuyến dùng set ở idle/completing/
 *     fault (exported cho orders compensation dùng sau — W3-B kế).
 *   • verifyRecipeSetRef — lineReadiness (§6.2) dùng để verify THẬT check
 *     `recipe_loaded`: mọi máy required của set đang active đúng phiên bản.
 *
 * Deploy ở đây = catalog/ledger flip (như /recipes router) — KHÔNG push lệnh
 * select_recipe xuống thiết bị (đường HITL commandDispatcher riêng, ngoài
 * phạm vi). Genealogy recipe_load_log ghi best-effort như machineRecipeRouter.
 * Kết quả nghiệp vụ trả UNION {ok:false, code} — không throw cho lý do nghiệp vụ.
 * ════════════════════════════════════════════════════════════════════════════
 */
import * as repo from "./lineStateRepo";
import { deployRecipe, getActiveRecipe, getRecipeById } from "../../db/machineRecipe";
import { recordEvent as recordGenealogyEvent } from "../equipment/recipeVersioningService";
import type { LineControllerState, RecipeSetRow, RecipeSetStatus } from "../../../drizzle/schema";

// ─── Kết quả nghiệp vụ (union, mirror lineControllerService.TransitionFailure) ─

export type RecipeSetFailure = {
  ok: false;
  code:
    | "DB_UNAVAILABLE"
    | "NOT_FOUND"
    | "LINE_NOT_FOUND"
    | "LOCKED"
    | "INVALID_STATE"
    | "CONFLICT"
    | "VALIDATION";
  message: string;
};

const DB_UNAVAILABLE: RecipeSetFailure = {
  ok: false,
  code: "DB_UNAVAILABLE",
  message: "Không có kết nối DB — recipe set cần trạng thái bền.",
};

/** Tuyến ở trạng thái nào thì ĐƯỢC phân phối recipe (spec: changeover/chuẩn bị — không đè khi đang chạy). */
const DISTRIBUTABLE_LINE_STATES: readonly LineControllerState[] = ["idle", "ready", "changeover"];
/** Tuyến ở trạng thái nào thì set ĐƯỢC gỡ khóa (hết lô / compensation — spec §6.1). */
const UNLOCKABLE_LINE_STATES: readonly LineControllerState[] = ["idle", "completing", "fault"];

// ─── CRUD draft ───────────────────────────────────────────────────────────────

export interface CreateRecipeSetInput {
  code: string;
  productModelId?: number | null;
  version?: number;
  notes?: string | null;
  /** Actor string (user id | 'api:<key>' | 'system') — chỉ để log, set tạo là draft. */
  actor?: string;
}

export async function createRecipeSet(
  input: CreateRecipeSetInput,
): Promise<{ ok: true; recipeSet: RecipeSetRow } | RecipeSetFailure> {
  const code = input.code?.trim();
  if (!code) return { ok: false, code: "VALIDATION", message: "code recipe set là bắt buộc (vd MODEL-X@v3)." };
  if (!(await repo.isDbAvailable())) return DB_UNAVAILABLE;
  const existing = await repo.getRecipeSetByCode(code);
  if (existing) {
    return { ok: false, code: "CONFLICT", message: `Recipe set '${code}' đã tồn tại (id=${existing.id}).` };
  }
  try {
    const row = await repo.insertRecipeSet({
      code,
      productModelId: input.productModelId ?? null,
      version: input.version ?? 1,
      status: "draft" satisfies RecipeSetStatus,
      notes: input.notes ?? null,
    });
    if (!row) return DB_UNAVAILABLE;
    console.log(`[RecipeSet] created '${code}' (id=${row.id}, draft) by ${input.actor ?? "system"}`);
    return { ok: true, recipeSet: row };
  } catch (err) {
    // Race với unique(code) — pre-check ở trên chỉ là fast-path.
    return {
      ok: false,
      code: "CONFLICT",
      message: `Không tạo được recipe set '${code}': ${(err as Error)?.message ?? err}`,
    };
  }
}

export interface AddRecipeSetItemInput {
  recipeSetId: number;
  machineId: number;
  machineRecipeId: number;
  stationId?: number | null;
  required?: boolean;
}

export async function addRecipeSetItem(
  input: AddRecipeSetItemInput,
): Promise<{ ok: true; item: repo.RecipeSetItemDetail } | RecipeSetFailure> {
  if (!(await repo.isDbAvailable())) return DB_UNAVAILABLE;
  const set = await repo.getRecipeSetById(input.recipeSetId);
  if (!set) return { ok: false, code: "NOT_FOUND", message: `Không tìm thấy recipe set id=${input.recipeSetId}.` };
  if (set.locked) {
    return { ok: false, code: "LOCKED", message: `Recipe set '${set.code}' đang KHÓA (suốt lô) — không sửa item.` };
  }
  if (set.status === "retired") {
    return { ok: false, code: "INVALID_STATE", message: `Recipe set '${set.code}' đã retired — không sửa item.` };
  }
  const recipe = await getRecipeById(input.machineRecipeId).catch(() => undefined);
  if (!recipe) {
    return {
      ok: false,
      code: "VALIDATION",
      message: `machine_recipe id=${input.machineRecipeId} không tồn tại — item phải trỏ một PHIÊN BẢN recipe có thật.`,
    };
  }
  try {
    const row = await repo.insertRecipeSetItem({
      recipeSetId: input.recipeSetId,
      machineId: input.machineId,
      machineRecipeId: input.machineRecipeId,
      stationId: input.stationId ?? null,
      required: input.required ?? true,
    });
    if (!row) return DB_UNAVAILABLE;
    return {
      ok: true,
      item: {
        id: row.id,
        recipeSetId: row.recipeSetId,
        stationId: row.stationId ?? null,
        machineId: row.machineId,
        required: row.required,
        machineRecipeId: row.machineRecipeId,
        recipeCode: recipe.code,
        recipeVersion: recipe.version,
        recipeStatus: recipe.status,
        machineCode: null,
        machineName: null,
      },
    };
  } catch (err) {
    // unique(recipe_set_id, machine_id) — mỗi máy MỘT recipe trong một set.
    return {
      ok: false,
      code: "CONFLICT",
      message: `Máy ${input.machineId} đã có item trong set '${set.code}' (unique per máy): ${(err as Error)?.message ?? err}`,
    };
  }
}

export async function removeRecipeSetItem(
  itemId: number,
  recipeSetId: number,
): Promise<{ ok: true; removed: boolean } | RecipeSetFailure> {
  if (!(await repo.isDbAvailable())) return DB_UNAVAILABLE;
  const set = await repo.getRecipeSetById(recipeSetId);
  if (!set) return { ok: false, code: "NOT_FOUND", message: `Không tìm thấy recipe set id=${recipeSetId}.` };
  if (set.locked) {
    return { ok: false, code: "LOCKED", message: `Recipe set '${set.code}' đang KHÓA (suốt lô) — không sửa item.` };
  }
  const items = await repo.listRecipeSetItems(recipeSetId);
  if (!items.some((i) => i.id === itemId)) {
    return { ok: false, code: "NOT_FOUND", message: `Item id=${itemId} không thuộc recipe set '${set.code}'.` };
  }
  const removed = await repo.deleteRecipeSetItem(itemId);
  return { ok: true, removed };
}

/** Catalog view (mới nhất trước) — read-only, trả thẳng data. */
export async function listRecipeSets(limit = 100) {
  return repo.listRecipeSets(limit);
}

export interface RecipeSetDetail {
  recipeSet: RecipeSetRow;
  items: repo.RecipeSetItemDetail[];
}

/** Set + items (join recipe version + máy). Null khi không tồn tại. */
export async function getRecipeSetDetail(ref: { id?: number; code?: string }): Promise<RecipeSetDetail | null> {
  const set = await resolveSet(ref);
  if (!set) return null;
  const items = await repo.listRecipeSetItems(set.id);
  return { recipeSet: set, items };
}

async function resolveSet(ref: { id?: number; code?: string }): Promise<RecipeSetRow | null> {
  if (ref.id != null) return repo.getRecipeSetById(ref.id);
  if (ref.code) return repo.getRecipeSetByCode(ref.code.trim());
  return null;
}

// ─── Xác nhận nạp / verify (spec §6.1 "kiểm mọi trạm đã nạp đúng recipe") ─────

export interface RecipeSetMissing {
  machineId: number;
  machineCode: string | null;
  recipeCode: string;
  expectedVersion: number;
  reason: string;
}

/**
 * Kiểm các item REQUIRED: máy đã có active recipe ĐÚNG PHIÊN BẢN chưa
 * (machineRecipes: active row per code phải là chính machineRecipeId của item
 * và đang gắn đúng máy). Lỗi đọc → tính là MISSING (default-deny, không đoán).
 */
async function verifyItems(items: repo.RecipeSetItemDetail[]): Promise<RecipeSetMissing[]> {
  const missing: RecipeSetMissing[] = [];
  for (const item of items) {
    if (!item.required) continue;
    const base = {
      machineId: item.machineId,
      machineCode: item.machineCode,
      recipeCode: item.recipeCode,
      expectedVersion: item.recipeVersion,
    };
    try {
      const active = await getActiveRecipe({ code: item.recipeCode });
      if (!active) {
        missing.push({ ...base, reason: `chưa có phiên bản active cho code '${item.recipeCode}'` });
      } else if (active.id !== item.machineRecipeId) {
        missing.push({ ...base, reason: `active v${active.version} ≠ phiên bản khóa v${item.recipeVersion}` });
      } else if (active.machineId !== item.machineId) {
        missing.push({
          ...base,
          reason: `active đang gắn máy ${active.machineId ?? "none"} ≠ máy yêu cầu ${item.machineId}`,
        });
      }
    } catch (err) {
      missing.push({ ...base, reason: `không kiểm được: ${(err as Error)?.message ?? err}` });
    }
  }
  return missing;
}

export type RecipeSetVerification =
  | { found: false }
  | { found: true; ok: boolean; requiredCount: number; missing: RecipeSetMissing[] };

/**
 * Verify một recipe_set_ref (line_states.recipe_set_ref) — lineReadiness §6.2
 * dùng để nâng check `recipe_loaded` từ "text tồn tại" lên "đúng phiên bản
 * thật". found=false = ref text legacy (không có recipe_sets record) — caller
 * giữ hành vi cũ.
 */
export async function verifyRecipeSetRef(code: string): Promise<RecipeSetVerification> {
  const set = await repo.getRecipeSetByCode(code);
  if (!set) return { found: false };
  const items = await repo.listRecipeSetItems(set.id);
  const required = items.filter((i) => i.required);
  const missing = await verifyItems(required);
  return { found: true, ok: missing.length === 0, requiredCount: required.length, missing };
}

// ─── Phân phối + khóa (spec §6.1) ────────────────────────────────────────────

export interface DistributeItemResult {
  itemId: number;
  machineId: number;
  machineCode: string | null;
  recipeCode: string;
  recipeVersion: number;
  required: boolean;
  status: "already_active" | "deployed" | "failed";
  deploymentId?: number;
  error?: string;
}

export interface DistributeResult {
  ok: true;
  lineId: number;
  recipeSetId: number;
  code: string;
  results: DistributeItemResult[];
  /** Xác nhận nạp (spec §6.1): MỌI máy required đang active đúng phiên bản. */
  confirmed: boolean;
  missing: RecipeSetMissing[];
  /** true khi confirmed → set đã bị khóa suốt lô + line.recipe_set_ref = code. */
  locked: boolean;
}

export interface DistributeOptions {
  /** Actor string cho audit/lock ('42' | 'api:<key>' | 'system'). */
  actor?: string;
  /** users.id cho recipe_deployments.deployedBy (NOT NULL, không FK) — 0 = system/API. */
  actorId?: number;
  notes?: string | null;
}

/**
 * Phân phối recipe set tới MỌI máy của set trên một tuyến rồi XÁC NHẬN NẠP:
 *   1. Gate: set tồn tại + chưa khóa + chưa retired; tuyến tồn tại và đang
 *      idle/ready/changeover (không đè recipe khi tuyến producing/held).
 *   2. Từng item: nếu active đã ĐÚNG (id + máy) → 'already_active'; ngược lại
 *      deployRecipe (đường recipe_deployments sẵn có — GIỮ second-approver
 *      gate + FOR UPDATE + ledger). Lỗi per-máy KHÔNG chặn máy khác.
 *   3. Xác nhận: verify lại mọi item required → đủ thì set
 *      line_states.recipe_set_ref = code + KHÓA set (locked — suốt lô).
 * Thiếu máy → confirmed=false, KHÔNG set ref, KHÔNG khóa (honest partial report).
 */
export async function distributeRecipeSet(
  lineId: number,
  recipeSetId: number,
  opts: DistributeOptions = {},
): Promise<DistributeResult | RecipeSetFailure> {
  if (!(await repo.isDbAvailable())) return DB_UNAVAILABLE;

  const set = await repo.getRecipeSetById(recipeSetId);
  if (!set) return { ok: false, code: "NOT_FOUND", message: `Không tìm thấy recipe set id=${recipeSetId}.` };
  return distributeResolved(lineId, set, opts);
}

/** Biến thể theo code (REST §13.2 POST /v1/lines/:id/recipe {recipeSetCode}). */
export async function distributeRecipeSetByCode(
  lineId: number,
  code: string,
  opts: DistributeOptions = {},
): Promise<DistributeResult | RecipeSetFailure> {
  if (!(await repo.isDbAvailable())) return DB_UNAVAILABLE;
  const set = await repo.getRecipeSetByCode(code.trim());
  if (!set) return { ok: false, code: "NOT_FOUND", message: `Không tìm thấy recipe set code='${code}'.` };
  return distributeResolved(lineId, set, opts);
}

async function distributeResolved(
  lineId: number,
  set: RecipeSetRow,
  opts: DistributeOptions,
): Promise<DistributeResult | RecipeSetFailure> {
  const actor = opts.actor?.trim() || "system";

  if (set.status === "retired") {
    return { ok: false, code: "INVALID_STATE", message: `Recipe set '${set.code}' đã retired — không phân phối.` };
  }
  if (set.locked) {
    return {
      ok: false,
      code: "LOCKED",
      message: `Recipe set '${set.code}' đang KHÓA suốt lô (bởi ${set.lockedBy ?? "?"}) — gỡ khóa (unlockRecipeSet, khi các tuyến idle/completing/fault) trước khi phân phối lại.`,
    };
  }

  const line = await repo.getLineRow(lineId);
  if (!line) return { ok: false, code: "LINE_NOT_FOUND", message: `Không tìm thấy production line id=${lineId}.` };
  const state = await repo.ensureLineState(lineId);
  if (!state) return DB_UNAVAILABLE;
  if (!DISTRIBUTABLE_LINE_STATES.includes(state.state)) {
    return {
      ok: false,
      code: "INVALID_STATE",
      message: `Tuyến ${line.code} đang '${state.state}' — chỉ phân phối recipe khi tuyến ở [${DISTRIBUTABLE_LINE_STATES.join(", ")}] (spec §6.1 changeover/chuẩn bị).`,
    };
  }

  const items = await repo.listRecipeSetItems(set.id);
  if (items.length === 0) {
    return { ok: false, code: "VALIDATION", message: `Recipe set '${set.code}' không có item nào — không có gì để phân phối.` };
  }

  // 2 — phân phối per-máy qua đường deploy sẵn có (mỗi máy isolated try/catch).
  const results: DistributeItemResult[] = [];
  for (const item of items) {
    const base = {
      itemId: item.id,
      machineId: item.machineId,
      machineCode: item.machineCode,
      recipeCode: item.recipeCode,
      recipeVersion: item.recipeVersion,
      required: item.required,
    };
    try {
      const active = await getActiveRecipe({ code: item.recipeCode });
      if (active && active.id === item.machineRecipeId && active.machineId === item.machineId) {
        results.push({ ...base, status: "already_active" });
        continue;
      }
      const deployment = await deployRecipe({
        recipeId: item.machineRecipeId,
        machineId: item.machineId,
        deployedBy: opts.actorId ?? 0,
        notes: opts.notes ?? `recipe-set ${set.code} → line ${line.code} (distribute, actor=${actor})`,
      });
      results.push({ ...base, status: "deployed", deploymentId: deployment.id });
      // Genealogy recipe_load_log — best-effort như machineRecipeRouter (fail-soft).
      try {
        const deployed = await getRecipeById(deployment.recipeId);
        if (deployed) {
          await recordGenealogyEvent("load", deployed, {
            performedBy: opts.actorId ?? null,
            machineId: item.machineId,
            notes: `recipe-set ${set.code} → line ${line.code}`,
            meta: { deploymentId: deployment.id, recipeSetId: set.id, recipeSetCode: set.code, lineId },
          });
        }
      } catch (err) {
        console.error("[RecipeSet] genealogy record failed:", (err as Error)?.message ?? err);
      }
    } catch (err) {
      // Giữ nguyên mọi gate hiện có: recipe chưa second-approve → deployRecipe
      // THROW → per-máy 'failed' (không nuốt gate, không chặn máy khác).
      results.push({ ...base, status: "failed", error: (err as Error)?.message ?? String(err) });
    }
  }

  // 3 — xác nhận nạp: verify lại mọi item required từ catalog (nguồn sự thật).
  const missing = await verifyItems(items.filter((i) => i.required));
  const confirmed = missing.length === 0;

  let locked = false;
  if (confirmed) {
    const ctx = await repo.updateLineContext(lineId, { recipeSetRef: set.code });
    if (!ctx) return DB_UNAVAILABLE;
    const lockedRow = await repo.lockRecipeSet(set.id, actor);
    locked = !!lockedRow?.locked;
    console.log(
      `[RecipeSet] '${set.code}' distributed + CONFIRMED on line ${line.code} (${results.length} máy) — set LOCKED (suốt lô) by ${actor}`,
    );
  } else {
    console.warn(
      `[RecipeSet] '${set.code}' distribute on line ${line.code}: ${missing.length} máy required CHƯA nạp đúng — không set ref, không khóa.`,
    );
  }

  return {
    ok: true,
    lineId,
    recipeSetId: set.id,
    code: set.code,
    results,
    confirmed,
    missing,
    locked,
  };
}

// ─── Khóa / gỡ khóa (spec §6.1 — exported cho orders compensation W3-B kế) ────

export interface RecipeSetLockStatus {
  id: number;
  code: string;
  version: number;
  status: RecipeSetStatus;
  locked: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
  /** Các tuyến đang trỏ recipe_set_ref = code (kèm trạng thái FSM). */
  linesUsing: Array<{ lineId: number; state: LineControllerState }>;
}

export async function getRecipeSetLockStatus(ref: { id?: number; code?: string }): Promise<RecipeSetLockStatus | null> {
  const set = await resolveSet(ref);
  if (!set) return null;
  const linesUsing = await repo.getLineStatesByRecipeRef(set.code);
  return {
    id: set.id,
    code: set.code,
    version: set.version,
    status: set.status,
    locked: set.locked,
    lockedAt: set.lockedAt ? new Date(set.lockedAt).toISOString() : null,
    lockedBy: set.lockedBy ?? null,
    linesUsing,
  };
}

/**
 * Gỡ khóa một recipe set — CHỈ khi mọi tuyến đang dùng set (recipe_set_ref =
 * code) ở idle/completing/fault (hết lô / đang bù trừ). Idempotent khi set
 * chưa khóa. Orders compensation (W3-B kế) gọi hàm này khi hủy lô.
 */
export async function unlockRecipeSet(
  ref: { id?: number; code?: string },
  opts: { actor?: string; reason?: string } = {},
): Promise<{ ok: true; recipeSet: RecipeSetRow; unlocked: boolean } | RecipeSetFailure> {
  if (!(await repo.isDbAvailable())) return DB_UNAVAILABLE;
  const set = await resolveSet(ref);
  if (!set) return { ok: false, code: "NOT_FOUND", message: `Không tìm thấy recipe set (${JSON.stringify(ref)}).` };
  if (!set.locked) return { ok: true, recipeSet: set, unlocked: false }; // idempotent

  const linesUsing = await repo.getLineStatesByRecipeRef(set.code);
  const busy = linesUsing.filter((l) => !UNLOCKABLE_LINE_STATES.includes(l.state));
  if (busy.length > 0) {
    return {
      ok: false,
      code: "INVALID_STATE",
      message: `Recipe set '${set.code}' đang khóa suốt lô — tuyến còn chạy: ${busy
        .map((l) => `line ${l.lineId}='${l.state}'`)
        .join(", ")}. Chỉ gỡ khóa khi mọi tuyến ở [${UNLOCKABLE_LINE_STATES.join(", ")}].`,
    };
  }

  const row = await repo.unlockRecipeSetRow(set.id);
  if (!row) return DB_UNAVAILABLE;
  console.log(
    `[RecipeSet] '${set.code}' UNLOCKED by ${opts.actor ?? "system"}${opts.reason ? ` — ${opts.reason}` : ""}`,
  );
  return { ok: true, recipeSet: row, unlocked: true };
}
