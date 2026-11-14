/**
 * Luật ĐẦU VÀO step id MỚI — đường tRPC thật (orchestrationRouter): `deployWorkflow` (tạo/sửa) và `duplicateWorkflow` (sao chép) từ chối
 * id chứa "," "(" ")" xuống dòng; định nghĩa CŨ có id đó vẫn đọc / sao chép-không-bị-kiểm-sai-chỗ / mô phỏng được khi không qua đường ghi.
 * Kiểm chạy Ở SERVER (không phải ở client): gọi caller router thẳng, không qua UI. Không DB thật (FakeDb), không thiết bị.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";

const perm = vi.hoisted(() => ({ deny: new Set<string>(), calls: [] as string[] }));
const gate = vi.hoisted(() => ({ deny: new Set<string>(), calls: [] as string[] }));

function makeNe(col: { name: string }, value: unknown) {
  return (row: Record<string, unknown>) => row[col.name] !== value;
}
function makeInArray(col: { name: string }, values: unknown[]) {
  return (row: Record<string, unknown>) => values.includes(row[col.name]);
}
function makeNotInArray(col: { name: string }, values: unknown[]) {
  return (row: Record<string, unknown>) => !values.includes(row[col.name]);
}

const fake = new FakeDb();
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc, ne: makeNe, inArray: makeInArray, notInArray: makeNotInArray };
});
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

// Re-pinned 2026-10-11 (doc 81 Dot 8 task Q4): this mock exported only `requirePermission`. Since the orchestration factory
// scope (doc 81 Dot 5 E2, bb636bc9e) the copy's SOURCE must be visible to the caller, which resolves the caller's scope
// through `resolveDataScope` / `getUserAssignmentCodes` (db/reportAggregators.resolveTenantFactoryScope). Missing from the
// mock ⇒ the resolver throws ⇒ the scope is UNDECIDED; since 1ed6c55ff (Dot 5 final wave F3, R-5-l) an undecided scope never
// reads as "visible" ⇒ "Source workflow not found" — correct fail-closed behaviour; measured: green at 1ed6c55ff^, red at
// 1ed6c55ff. The harness was stale, not the code. The engineer now has a DECIDED scope: no factory assignment (filter 1=0,
// no codes ⇒ factory ids []), which still sees a machine-less workflow (nothing of it is out of scope).
vi.mock("../_core/accessControl", () => ({
  resolveDataScope: async () => ({ filter: { decided: "1=0" }, scopeApplied: true, scopeEmptyReason: null, scopeMessage: null }),
  getUserAssignmentCodes: async () => ({ corporateCodes: [], factoryCodes: [], isAdmin: false }),
  requirePermission: (moduleName: string, action: string) => async ({ ctx, next }: any) => {
    perm.calls.push(`${moduleName}.${action}`);
    if (perm.deny.has(`${moduleName}.${action}`)) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: `no ${moduleName}.${action}` });
    }
    return next({ ctx });
  },
}));
vi.mock("../_core/moduleGate", async (orig) => {
  const actual = await orig<typeof import("../_core/moduleGate")>();
  return {
    ...actual,
    moduleGate: (code: string) => async ({ ctx, next }: any) => {
      gate.calls.push(code);
      if (gate.deny.has(code)) {
        const { TRPCError } = await import("@trpc/server");
        throw new TRPCError({ code: "FORBIDDEN", message: `module ${code} not licensed` });
      }
      return next({ ctx });
    },
  };
});

import { orchestrationWorkflows } from "../../drizzle/schema";
import { orchestrationRouter } from "./orchestrationRouter";
import { startRun } from "../services/orchestration/foe/foeEngine";


const ENGINEER = { id: 10, role: "engineer", name: "eng", twoFactorEnabled: true };
const ctxOf = (user: { id: number; role: string; name: string; twoFactorEnabled?: boolean }) => ({ user }) as any;
const KY_TU: Array<[string, string]> = [[",", "comma"], ["(", "open"], [")", "close"], ["\n", "lf"], ["\r", "cr"]];
const def = (id: string) => ({ ref: "kt", name: "kt", steps: [{ id, type: "delay", ms: 1 }] });

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  perm.deny.clear();
  perm.calls.length = 0;
  gate.deny.clear();
  gate.calls.length = 0;
  process.env.FOE_ENABLED = "true";
});

describe("orchestration.deployWorkflow (tRPC, tạo/sửa) — id chứa ký tự cấm bị TỪ CHỐI ở server", () => {
  for (const [ky, ten] of KY_TU) {
    it(`id "a${JSON.stringify(ky).slice(1, -1)}b" (${ten}) ⇒ ok:false, errors[0] nêu path steps[0].id + ký tự; không ghi bảng workflows`, async () => {
      const r = await orchestrationRouter.createCaller(ctxOf(ENGINEER)).deployWorkflow({ definition: def(`a${ky}b`), totpCode: "000000" });
      expect(r.ok).toBe(false);
      expect(r.enabled).toBe(true);
      expect(r.errors).toHaveLength(1);
      expect(r.errors?.[0].path).toBe("steps[0].id");
      expect(r.errors?.[0].code).toBe("STEP_ID_FORBIDDEN_CHAR");
      expect(r.errors?.[0].kyTu).toBeTruthy();
      expect(r.message).toContain("forbidden character");
      expect(fake.store.get("orchestration_workflows") ?? []).toHaveLength(0);
    });
  }
});

describe("orchestration.duplicateWorkflow (sao chép = định nghĩa MỚI) — id xấu bị từ chối, id tốt vẫn qua", () => {
  const seed = (id: string) =>
    fake.seed(orchestrationWorkflows, [{ id: 1, ref: "src", name: "Src", version: 3, description: null, definitionJson: { ...def(id), ref: "src" }, status: "active", createdBy: 10 }]);

  for (const [ky, ten] of KY_TU) {
    it(`nguồn có id chứa ${ten} ⇒ BAD_REQUEST INVALID_VALUE (reason stepIdKyTuCam), KHÔNG tạo bản sao`, async () => {
      seed(`a${ky}b`);
      const err: any = await orchestrationRouter.createCaller(ctxOf(ENGINEER)).duplicateWorkflow({ id: 1, newRef: "src-copy" }).catch((e) => e);
      expect(err?.code).toBe("BAD_REQUEST");
      expect(err?.cause?.appCode).toBe("INVALID_VALUE");
      expect(err?.cause?.appParams?.reason).toBe("stepIdKyTuCam");
      expect(err?.cause?.appParams?.field).toBe("steps[0].id");
      expect((fake.store.get("orchestration_workflows") ?? []).some((w) => w.ref === "src-copy")).toBe(false);
    });
  }

  it("id hợp lệ bình thường ⇒ sao chép được như cũ", async () => {
    seed("buoc-1_ok");
    const res = await orchestrationRouter.createCaller(ctxOf(ENGINEER)).duplicateWorkflow({ id: 1, newRef: "src-copy" });
    expect(res.ok).toBe(true);
    expect((fake.store.get("orchestration_workflows") ?? []).some((w) => w.ref === "src-copy")).toBe(true);
  });
});
