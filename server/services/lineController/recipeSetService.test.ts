/**
 * doc 44 W3-B1 / G3.3 — Recipe Set service tests (spec §6.1).
 *
 * Covers: CRUD draft (create + duplicate CONFLICT, addItem validate/locked/
 * duplicate, removeItem), distribute qua đường deploy sẵn có (already_active
 * fast-path, deploy gate second-approver GIỮ NGUYÊN → per-máy failed), XÁC
 * NHẬN NẠP (đủ → set line.recipe_set_ref + KHÓA set; thiếu máy required →
 * confirmed=false, KHÔNG ref/khóa; máy optional fail không chặn), gates
 * (locked/retired/line-state/empty/not-found/db), verifyRecipeSetRef (legacy
 * ref, đúng/sai phiên bản, sai máy), unlock quy tắc idle/completing/fault +
 * idempotent, lockStatus shape.
 *
 * lineStateRepo + db/machineRecipe được mock in-memory (deploy mock giữ
 * semantics: approvedBy null → THROW như deployRecipe thật).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── hoisted fixture ───────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  dbAvailable: true,
  sets: new Map<number, any>(),
  itemsBySet: new Map<number, any[]>(),
  lines: new Map<number, any>(),
  lineStates: new Map<number, any>(),
  // recipeId → {id, code, name, version, status, machineId, approvedBy}
  recipes: new Map<number, any>(),
  seq: 1,
  depSeq: 9000,
}));

function nextId() {
  return h.seq++;
}

// ── mocks ─────────────────────────────────────────────────────────────────────
vi.mock("./lineStateRepo", () => ({
  isDbAvailable: vi.fn(async () => h.dbAvailable),
  getLineRow: vi.fn(async (id: number) => h.lines.get(id) ?? null),
  ensureLineState: vi.fn(async (id: number) => {
    if (!h.lines.has(id)) return null;
    if (!h.lineStates.has(id)) {
      h.lineStates.set(id, { lineId: id, state: "idle", recipeSetRef: null, activeOrderId: null, taktTargetS: null });
    }
    return h.lineStates.get(id);
  }),
  updateLineContext: vi.fn(async (lineId: number, patch: any) => {
    if (!h.lineStates.has(lineId)) {
      h.lineStates.set(lineId, { lineId, state: "idle", recipeSetRef: null, activeOrderId: null, taktTargetS: null });
    }
    const row = h.lineStates.get(lineId);
    if (patch.recipeSetRef !== undefined) row.recipeSetRef = patch.recipeSetRef;
    if (patch.activeOrderId !== undefined) row.activeOrderId = patch.activeOrderId;
    if (patch.taktTargetS !== undefined) row.taktTargetS = patch.taktTargetS;
    return { ...row };
  }),
  getRecipeSetById: vi.fn(async (id: number) => h.sets.get(id) ?? null),
  getRecipeSetByCode: vi.fn(async (code: string) => [...h.sets.values()].find((s) => s.code === code) ?? null),
  listRecipeSets: vi.fn(async () =>
    [...h.sets.values()].map((s) => ({ ...s, itemCount: (h.itemsBySet.get(s.id) ?? []).length })),
  ),
  insertRecipeSet: vi.fn(async (values: any) => {
    if ([...h.sets.values()].some((s) => s.code === values.code)) {
      throw new Error(`duplicate key value violates unique constraint "recipe_sets_code_unique"`);
    }
    const row = {
      id: nextId(),
      code: values.code,
      productModelId: values.productModelId ?? null,
      version: values.version ?? 1,
      locked: false,
      lockedAt: null,
      lockedBy: null,
      status: values.status ?? "draft",
      notes: values.notes ?? null,
      createdAt: new Date(),
    };
    h.sets.set(row.id, row);
    return row;
  }),
  listRecipeSetItems: vi.fn(async (setId: number) =>
    (h.itemsBySet.get(setId) ?? []).map((it: any) => {
      const r = h.recipes.get(it.machineRecipeId);
      return {
        id: it.id,
        recipeSetId: setId,
        stationId: it.stationId ?? null,
        machineId: it.machineId,
        required: it.required,
        machineRecipeId: it.machineRecipeId,
        recipeCode: r?.code ?? "?",
        recipeVersion: r?.version ?? 0,
        recipeStatus: r?.status ?? "?",
        machineCode: `M-${it.machineId}`,
        machineName: `Machine ${it.machineId}`,
      };
    }),
  ),
  insertRecipeSetItem: vi.fn(async (values: any) => {
    const list = h.itemsBySet.get(values.recipeSetId) ?? [];
    if (list.some((it: any) => it.machineId === values.machineId)) {
      throw new Error(`duplicate key value violates unique constraint "uq_recipe_set_items_set_machine"`);
    }
    const row = { id: nextId(), required: true, stationId: null, ...values };
    list.push(row);
    h.itemsBySet.set(values.recipeSetId, list);
    return row;
  }),
  deleteRecipeSetItem: vi.fn(async (itemId: number) => {
    for (const [setId, list] of h.itemsBySet) {
      const idx = list.findIndex((it: any) => it.id === itemId);
      if (idx >= 0) {
        list.splice(idx, 1);
        h.itemsBySet.set(setId, list);
        return true;
      }
    }
    return false;
  }),
  lockRecipeSet: vi.fn(async (id: number, lockedBy: string) => {
    const s = h.sets.get(id);
    if (!s) return null;
    Object.assign(s, { locked: true, lockedAt: new Date(), lockedBy, status: "active" });
    return { ...s };
  }),
  unlockRecipeSetRow: vi.fn(async (id: number) => {
    const s = h.sets.get(id);
    if (!s) return null;
    Object.assign(s, { locked: false, lockedAt: null, lockedBy: null });
    return { ...s };
  }),
  getLineStatesByRecipeRef: vi.fn(async (code: string) =>
    [...h.lineStates.values()]
      .filter((l) => l.recipeSetRef === code)
      .map((l) => ({ lineId: l.lineId, state: l.state })),
  ),
}));

vi.mock("../../db/machineRecipe", () => ({
  getRecipeById: vi.fn(async (id: number) => h.recipes.get(id)),
  getActiveRecipe: vi.fn(async (opts: { code?: string }) =>
    [...h.recipes.values()].find((r) => r.code === opts.code && r.status === "active"),
  ),
  deployRecipe: vi.fn(async (input: any) => {
    const target = h.recipes.get(input.recipeId);
    if (!target) throw new Error(`Recipe #${input.recipeId} not found`);
    // Semantics THẬT của db/machineRecipe.deployRecipe (second-approver gate).
    if (target.approvedBy == null) {
      throw new Error("Recipe chưa được trình duyệt (second-approver) — cần một người khác duyệt trước khi deploy.");
    }
    const previous = [...h.recipes.values()].find((r) => r.code === target.code && r.status === "active");
    if (previous && previous.id !== target.id) previous.status = "archived";
    target.status = "active";
    target.machineId = input.machineId;
    return {
      id: h.depSeq++,
      recipeId: target.id,
      machineId: input.machineId,
      previousRecipeId: previous && previous.id !== target.id ? previous.id : null,
      status: "deployed",
    };
  }),
}));

vi.mock("../equipment/recipeVersioningService", () => ({
  recordEvent: vi.fn(async () => ({ id: 1 })),
}));

// ── SUT ───────────────────────────────────────────────────────────────────────
import {
  createRecipeSet,
  addRecipeSetItem,
  removeRecipeSetItem,
  listRecipeSets,
  getRecipeSetDetail,
  distributeRecipeSet,
  distributeRecipeSetByCode,
  verifyRecipeSetRef,
  unlockRecipeSet,
  getRecipeSetLockStatus,
} from "./recipeSetService";
import { deployRecipe } from "../../db/machineRecipe";
import { recordEvent } from "../equipment/recipeVersioningService";

// ── seed helpers ──────────────────────────────────────────────────────────────
function seedLine(id: number, state = "idle") {
  h.lines.set(id, { id, code: `L-${id}`, name: `Line ${id}`, workshopId: 1, isActive: true });
  h.lineStates.set(id, { lineId: id, state, recipeSetRef: null, activeOrderId: null, taktTargetS: null });
}

function seedRecipe(id: number, over: Record<string, unknown> = {}) {
  h.recipes.set(id, {
    id,
    code: `R-${id}`,
    name: `Recipe ${id}`,
    version: 1,
    status: "draft",
    machineId: null,
    approvedBy: 99,
    ...over,
  });
  return h.recipes.get(id);
}

async function seedSet(code = "MODEL-X@v3"): Promise<any> {
  const res = await createRecipeSet({ code, actor: "test" });
  expect(res.ok).toBe(true);
  return (res as any).recipeSet;
}

beforeEach(() => {
  h.dbAvailable = true;
  h.sets.clear();
  h.itemsBySet.clear();
  h.lines.clear();
  h.lineStates.clear();
  h.recipes.clear();
  h.seq = 1;
  h.depSeq = 9000;
  vi.clearAllMocks();
});

// ═══ CRUD draft ═══════════════════════════════════════════════════════════════

describe("CRUD draft", () => {
  it("create → draft, chưa khóa; trùng code → CONFLICT", async () => {
    const created = await createRecipeSet({ code: "MODEL-X@v3", productModelId: 5, notes: "note" });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.recipeSet.status).toBe("draft");
      expect(created.recipeSet.locked).toBe(false);
    }
    const dup = await createRecipeSet({ code: "MODEL-X@v3" });
    expect(!dup.ok && dup.code).toBe("CONFLICT");

    const empty = await createRecipeSet({ code: "   " });
    expect(!empty.ok && empty.code).toBe("VALIDATION");
  });

  it("addItem: recipe không tồn tại → VALIDATION; ok → item kèm code/version", async () => {
    const set = await seedSet();
    const bad = await addRecipeSetItem({ recipeSetId: set.id, machineId: 1, machineRecipeId: 777 });
    expect(!bad.ok && bad.code).toBe("VALIDATION");

    seedRecipe(10, { code: "SCREW-01", version: 3 });
    const ok = await addRecipeSetItem({ recipeSetId: set.id, machineId: 1, machineRecipeId: 10, stationId: 9 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.item.recipeCode).toBe("SCREW-01");
      expect(ok.item.recipeVersion).toBe(3);
      expect(ok.item.required).toBe(true);
    }
  });

  it("addItem: máy trùng trong set → CONFLICT (unique per máy); set khóa → LOCKED", async () => {
    const set = await seedSet();
    seedRecipe(10);
    seedRecipe(11, { code: "R-11" });
    expect((await addRecipeSetItem({ recipeSetId: set.id, machineId: 1, machineRecipeId: 10 })).ok).toBe(true);
    const dup = await addRecipeSetItem({ recipeSetId: set.id, machineId: 1, machineRecipeId: 11 });
    expect(!dup.ok && dup.code).toBe("CONFLICT");

    h.sets.get(set.id).locked = true;
    const locked = await addRecipeSetItem({ recipeSetId: set.id, machineId: 2, machineRecipeId: 11 });
    expect(!locked.ok && locked.code).toBe("LOCKED");
  });

  it("removeItem: set khóa → LOCKED; item lạ → NOT_FOUND; ok → removed", async () => {
    const set = await seedSet();
    seedRecipe(10);
    const added = await addRecipeSetItem({ recipeSetId: set.id, machineId: 1, machineRecipeId: 10 });
    const itemId = added.ok ? added.item.id : -1;

    const missing = await removeRecipeSetItem(4242, set.id);
    expect(!missing.ok && missing.code).toBe("NOT_FOUND");

    h.sets.get(set.id).locked = true;
    const locked = await removeRecipeSetItem(itemId, set.id);
    expect(!locked.ok && locked.code).toBe("LOCKED");

    h.sets.get(set.id).locked = false;
    const ok = await removeRecipeSetItem(itemId, set.id);
    expect(ok.ok && (ok as any).removed).toBe(true);
  });

  it("list + get detail (items join phiên bản recipe)", async () => {
    const set = await seedSet("MODEL-Y@v1");
    seedRecipe(10, { code: "GLUE-01", version: 2 });
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 3, machineRecipeId: 10 });

    const list = await listRecipeSets();
    expect(list).toHaveLength(1);
    expect(list[0].itemCount).toBe(1);

    const detail = await getRecipeSetDetail({ code: "MODEL-Y@v1" });
    expect(detail?.items[0]).toMatchObject({ machineId: 3, recipeCode: "GLUE-01", recipeVersion: 2 });
    expect(await getRecipeSetDetail({ code: "nope" })).toBeNull();
  });
});

// ═══ Distribute + xác nhận nạp (spec §6.1) ═════════════════════════════════════

describe("distributeRecipeSet — phân phối + xác nhận nạp + khóa", () => {
  it("happy path: already_active fast-path + deploy qua đường sẵn có → confirmed, line ref set, set KHÓA + active", async () => {
    seedLine(1, "changeover");
    const set = await seedSet();
    // Máy 1: recipe đã active ĐÚNG (id + máy) → không deploy lại.
    seedRecipe(10, { code: "SCREW-01", status: "active", machineId: 1 });
    // Máy 2: recipe approved, draft → phải deploy.
    seedRecipe(20, { code: "GLUE-01", approvedBy: 42 });
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 1, machineRecipeId: 10 });
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 2, machineRecipeId: 20 });

    const res = await distributeRecipeSet(1, set.id, { actor: "7", actorId: 7 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.confirmed).toBe(true);
    expect(res.locked).toBe(true);
    expect(res.missing).toEqual([]);
    const byMachine = new Map(res.results.map((r) => [r.machineId, r.status]));
    expect(byMachine.get(1)).toBe("already_active");
    expect(byMachine.get(2)).toBe("deployed");
    // deployRecipe (đường recipe_deployments sẵn có) CHỈ gọi cho máy 2.
    expect(vi.mocked(deployRecipe)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deployRecipe)).toHaveBeenCalledWith(
      expect.objectContaining({ recipeId: 20, machineId: 2, deployedBy: 7 }),
    );
    // Xác nhận nạp đủ → recipe_set_ref + KHÓA suốt lô + status active.
    expect(h.lineStates.get(1).recipeSetRef).toBe("MODEL-X@v3");
    expect(h.sets.get(set.id)).toMatchObject({ locked: true, lockedBy: "7", status: "active" });
    // Genealogy recipe_load_log best-effort cho deploy.
    expect(vi.mocked(recordEvent)).toHaveBeenCalledWith(
      "load",
      expect.objectContaining({ id: 20 }),
      expect.objectContaining({ machineId: 2 }),
    );
  });

  it("máy required chưa nạp được (gate second-approver GIỮ NGUYÊN) → confirmed=false, KHÔNG ref, KHÔNG khóa", async () => {
    seedLine(1, "idle");
    const set = await seedSet();
    seedRecipe(20, { code: "GLUE-01", approvedBy: null }); // CHƯA duyệt → deploy throw
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 2, machineRecipeId: 20 });

    const res = await distributeRecipeSet(1, set.id, { actorId: 7 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.confirmed).toBe(false);
    expect(res.locked).toBe(false);
    expect(res.results[0]).toMatchObject({ status: "failed", machineId: 2 });
    expect(res.results[0].error).toContain("second-approver");
    expect(res.missing).toHaveLength(1);
    expect(h.lineStates.get(1).recipeSetRef).toBeNull();
    expect(h.sets.get(set.id).locked).toBe(false);
  });

  it("máy OPTIONAL (required=false) fail không chặn xác nhận; máy required vẫn phải đúng", async () => {
    seedLine(1, "idle");
    const set = await seedSet();
    seedRecipe(10, { code: "SCREW-01", status: "active", machineId: 1 });
    seedRecipe(20, { code: "GLUE-01", approvedBy: null }); // optional, sẽ fail
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 1, machineRecipeId: 10 });
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 2, machineRecipeId: 20, required: false });

    const res = await distributeRecipeSet(1, set.id, { actorId: 7 });
    expect(res.ok && res.confirmed).toBe(true);
    if (res.ok) {
      expect(res.results.find((r) => r.machineId === 2)?.status).toBe("failed");
      expect(res.locked).toBe(true);
    }
  });

  it("gates: set khóa → LOCKED; retired → INVALID_STATE; set rỗng → VALIDATION; không set → NOT_FOUND; không line → LINE_NOT_FOUND; line producing → INVALID_STATE; mất DB → DB_UNAVAILABLE", async () => {
    seedLine(1, "idle");
    const set = await seedSet();
    seedRecipe(10);
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 1, machineRecipeId: 10 });

    h.sets.get(set.id).locked = true;
    expect((await distributeRecipeSet(1, set.id)) as any).toMatchObject({ ok: false, code: "LOCKED" });
    h.sets.get(set.id).locked = false;

    h.sets.get(set.id).status = "retired";
    expect((await distributeRecipeSet(1, set.id)) as any).toMatchObject({ ok: false, code: "INVALID_STATE" });
    h.sets.get(set.id).status = "draft";

    const emptySet = await seedSet("EMPTY@v1");
    expect((await distributeRecipeSet(1, emptySet.id)) as any).toMatchObject({ ok: false, code: "VALIDATION" });

    expect((await distributeRecipeSet(1, 777)) as any).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await distributeRecipeSet(404, set.id)) as any).toMatchObject({ ok: false, code: "LINE_NOT_FOUND" });

    h.lineStates.get(1).state = "producing";
    expect((await distributeRecipeSet(1, set.id)) as any).toMatchObject({ ok: false, code: "INVALID_STATE" });
    h.lineStates.get(1).state = "idle";

    h.dbAvailable = false;
    expect((await distributeRecipeSet(1, set.id)) as any).toMatchObject({ ok: false, code: "DB_UNAVAILABLE" });
  });

  it("distributeRecipeSetByCode: resolve theo code (REST §13.2); code lạ → NOT_FOUND", async () => {
    seedLine(1, "ready");
    const set = await seedSet("MODEL-Z@v2");
    seedRecipe(10, { code: "SCREW-01", status: "active", machineId: 1 });
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 1, machineRecipeId: 10 });

    const res = await distributeRecipeSetByCode(1, "MODEL-Z@v2", { actor: "api:erp" });
    expect(res.ok && res.confirmed).toBe(true);
    expect(h.lineStates.get(1).recipeSetRef).toBe("MODEL-Z@v2");
    expect(h.sets.get(set.id).lockedBy).toBe("api:erp");

    expect((await distributeRecipeSetByCode(1, "NOPE@v1")) as any).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

// ═══ verifyRecipeSetRef (readiness §6.2 dùng) ═════════════════════════════════

describe("verifyRecipeSetRef — verify phiên bản THẬT", () => {
  it("ref legacy (không có recipe_sets record) → found:false", async () => {
    expect(await verifyRecipeSetRef("LEGACY-TEXT@v9")).toEqual({ found: false });
  });

  it("mọi máy required active đúng id + máy → ok:true", async () => {
    const set = await seedSet();
    seedRecipe(10, { code: "SCREW-01", status: "active", machineId: 1 });
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 1, machineRecipeId: 10 });
    const v = await verifyRecipeSetRef("MODEL-X@v3");
    expect(v).toMatchObject({ found: true, ok: true, requiredCount: 1, missing: [] });
  });

  it("active là PHIÊN BẢN KHÁC / máy khác / không active → missing kèm reason", async () => {
    const set = await seedSet();
    // Item khóa v1 (id=10) nhưng active hiện tại là id=11 (v2) — sai phiên bản.
    seedRecipe(10, { code: "SCREW-01", version: 1, status: "archived" });
    seedRecipe(11, { code: "SCREW-01", version: 2, status: "active", machineId: 1 });
    // Item đúng id nhưng active đang gắn máy khác.
    seedRecipe(20, { code: "GLUE-01", status: "active", machineId: 99 });
    // Item không có active nào.
    seedRecipe(30, { code: "FLUX-01", status: "draft" });
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 1, machineRecipeId: 10 });
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 2, machineRecipeId: 20 });
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 3, machineRecipeId: 30 });

    const v = await verifyRecipeSetRef("MODEL-X@v3");
    expect(v.found && !v.ok).toBe(true);
    if (v.found) {
      expect(v.missing).toHaveLength(3);
      const reasons = v.missing.map((m) => m.reason).join(" | ");
      expect(reasons).toContain("v2");
      expect(reasons).toContain("máy");
      expect(reasons).toContain("active");
    }
  });

  it("item required=false không tính vào verify", async () => {
    const set = await seedSet();
    seedRecipe(30, { code: "FLUX-01", status: "draft" });
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 3, machineRecipeId: 30, required: false });
    const v = await verifyRecipeSetRef("MODEL-X@v3");
    expect(v).toMatchObject({ found: true, ok: true, requiredCount: 0 });
  });
});

// ═══ Lock / unlock (spec §6.1 — khóa suốt lô) ═════════════════════════════════

describe("unlock / lockStatus — chỉ gỡ khi tuyến idle/completing/fault", () => {
  async function seedLockedSetOnLine(lineState: string) {
    seedLine(1, "idle");
    const set = await seedSet();
    seedRecipe(10, { code: "SCREW-01", status: "active", machineId: 1 });
    await addRecipeSetItem({ recipeSetId: set.id, machineId: 1, machineRecipeId: 10 });
    const res = await distributeRecipeSet(1, set.id, { actor: "7", actorId: 7 });
    expect(res.ok && res.locked).toBe(true);
    h.lineStates.get(1).state = lineState;
    return set;
  }

  it("tuyến producing/held đang dùng set → INVALID_STATE (khóa suốt lô)", async () => {
    const set = await seedLockedSetOnLine("producing");
    const res = await unlockRecipeSet({ id: set.id }, { actor: "7" });
    expect(!res.ok && res.code).toBe("INVALID_STATE");
    if (!res.ok) expect(res.message).toContain("producing");
    expect(h.sets.get(set.id).locked).toBe(true);
  });

  it("mọi tuyến dùng set ở idle/completing/fault → unlock ok; chưa khóa → idempotent unlocked:false", async () => {
    const set = await seedLockedSetOnLine("completing");
    const res = await unlockRecipeSet({ code: "MODEL-X@v3" }, { actor: "7", reason: "hết lô" });
    expect(res.ok && (res as any).unlocked).toBe(true);
    expect(h.sets.get(set.id)).toMatchObject({ locked: false, lockedBy: null });

    const again = await unlockRecipeSet({ id: set.id });
    expect(again.ok && (again as any).unlocked).toBe(false);

    expect((await unlockRecipeSet({ code: "nope" })) as any).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("lockStatus: locked/lockedBy/lockedAt + linesUsing (tuyến + trạng thái FSM)", async () => {
    const set = await seedLockedSetOnLine("producing");
    const status = await getRecipeSetLockStatus({ id: set.id });
    expect(status).toMatchObject({
      code: "MODEL-X@v3",
      locked: true,
      lockedBy: "7",
      status: "active",
      linesUsing: [{ lineId: 1, state: "producing" }],
    });
    expect(status?.lockedAt).toBeTruthy();
    expect(await getRecipeSetLockStatus({ code: "nope" })).toBeNull();
  });
});
