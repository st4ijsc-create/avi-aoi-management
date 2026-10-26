/**
 * `aiGguf.soModelGoGan` (lô UX Trung tâm Model): admin gỡ mềm một gán; người không phải admin ⇒ FORBIDDEN; gán không có / đã gỡ ⇒ NOT_FOUND; ảnh sổ model được làm mới.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiModelBindings } from "../../drizzle/schema";
import { datGanModel } from "../services/ai/soModel/datGan";
import { layAnhSoModel } from "../services/ai/soModel/anhSoModel";
import { lamMoiAnhSoModel } from "../services/ai/soModel/napSoModel";
import { aiGgufRouter } from "./aiGgufRouter";

const SCOPE = `t9gg-${Math.floor(Math.random() * 1e5)}`;
const admin = () => aiGgufRouter.createCaller({ user: { id: 7, role: "admin", twoFactorEnabled: true } } as never);
const vai = (role: string) => aiGgufRouter.createCaller({ user: { id: 8, role, twoFactorEnabled: true } } as never);
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;

beforeAll(async () => {
  db = (await getDb())!;
});
afterAll(async () => {
  await db.delete(aiModelBindings).where(eq(aiModelBindings.scopeId, SCOPE));
});

describe("aiGguf.soModelGoGan", () => {
  it("★ admin gỡ ⇒ hàng retired (còn trong bảng), trả vai/phạm vi/chế độ; ảnh sổ model làm mới (hàng biến mất); gỡ lần hai ⇒ NOT_FOUND", async () => {
    const g = await datGanModel(db, { roleId: "code.plc", scopeKind: "project", scopeId: SCOPE, profileId: null, envKey: "GGUF_CODE_MODEL", fallback: [], mode: "thu" }, null);
    await lamMoiAnhSoModel();
    expect(layAnhSoModel().gan.some((x) => x.id === g.id)).toBe(true); // ảnh đã nạp hàng này TRƯỚC khi gỡ (chống "vắng sẵn")
    const kq = await admin().soModelGoGan({ id: g.id });
    expect(kq).toMatchObject({ id: g.id, roleId: "code.plc", scopeKind: "project", scopeId: SCOPE, mode: "thu", envKey: "GGUF_CODE_MODEL" });
    const [h] = await db.select().from(aiModelBindings).where(eq(aiModelBindings.id, g.id));
    expect(h.retiredAt).not.toBeNull();
    expect(layAnhSoModel().gan.some((x) => x.id === g.id)).toBe(false);
    await expect(admin().soModelGoGan({ id: g.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(admin().soModelGoGan({ id: 2_000_000_000 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("★ người không phải admin (supervisor / engineer / viewer) ⇒ FORBIDDEN, hàng GIỮ NGUYÊN", async () => {
    const g = await datGanModel(db, { roleId: "code.plc", scopeKind: "project", scopeId: SCOPE, profileId: null, envKey: "GGUF_CODE_MODEL", fallback: [], mode: "shadow" }, null);
    for (const r of ["supervisor", "engineer", "viewer"]) await expect(vai(r).soModelGoGan({ id: g.id }), r).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [h] = await db.select().from(aiModelBindings).where(eq(aiModelBindings.id, g.id));
    expect(h.retiredAt).toBeNull();
  });

  it("đầu vào sai (id âm / 0 / thừa khoá / chuỗi) ⇒ BAD_REQUEST", async () => {
    for (const x of [{ id: 0 }, { id: -1 }, { id: 1, thua: 1 }, { id: "1" }]) await expect(admin().soModelGoGan(x as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
