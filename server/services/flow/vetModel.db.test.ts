/**
 * ★★ Đợt 9 — VẾT MODEL THỰC của node `ai.*` (động cơ thật, DB `_test`, AI GIẢ — không GPU): mỗi lần gọi AI trong bước ghi sự kiện
 * `buoc.model` {nodeId, lan, vaiTro, model, nguon, phamVi, duPhong, kheBan, lyDo}; node rơi dự phòng vì khe nặng đang giữ model khác
 * ⇒ `kheBan` + lý do `khe-dang-giu-model-khac`; `flow.dongThoiGian` trả sự kiện ấy cho Flow Studio.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowRuns, aiFlows } from "../../../drizzle/schema";
import { VAI_TRO_GOC } from "../../../shared/aiRoles";
import { flowRouter } from "../../routers/flowRouter";
import { ANH_RONG, datAnhSoModel, type AnhSoModel, type GanTrongAnh } from "../ai/soModel/anhSoModel";
import { batDauRun, chayMotMuc, luuPhienBan } from "./dongCo";
import { datHamGoiAi } from "./nut/ai";

const TT = `t9vm${Math.floor(Math.random() * 1e5)}`;
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const noi = (a: string, b: string) => ({ from: { node: a, port: "main" }, to: { node: b, port: "main" } });
const dau = { e: { ...process.env } };

const anh = (gan: Partial<GanTrongAnh>[], profile: AnhSoModel["profile"]): AnhSoModel => ({
  taiLuc: 1,
  vaiTro: new Map(VAI_TRO_GOC.map((v) => [v.id, { envKey: v.envKey, taskKind: v.taskKind }])),
  profile,
  gan: gan.map((g) => ({ roleId: "extract", scopeKind: "global", scopeId: null, profileId: null, envKey: null, fallback: [], mode: "active", ...g })) as GanTrongAnh[],
});
const P = (o: Partial<{ artifactFile: string; slotClass: "nang" | "nho" | "sidecar" }>) => ({ artifactFile: "Khe-Nang-30B.gguf", slotClass: "nang" as const, artifactStatus: "available", license: "x", enabled: true, ...o });

let khoiPhucAi: ReturnType<typeof datHamGoiAi> | null = null;
beforeAll(() => {
  process.env.GGUF_DEFAULT_MODEL = "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf";
  process.env.GGUF_FAST_MODEL = "Qwen3-4B-Instruct-2507-UD-Q4_K_XL";
  process.env.LLAMA_SERVER_MODEL = "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"; // khe nặng đang giữ model này
});
afterEach(() => {
  datAnhSoModel(ANH_RONG);
  if (khoiPhucAi) datHamGoiAi(khoiPhucAi);
  khoiPhucAi = null;
});
afterAll(async () => {
  for (const k of ["GGUF_DEFAULT_MODEL", "GGUF_FAST_MODEL", "LLAMA_SERVER_MODEL"]) {
    if (dau.e[k] === undefined) delete process.env[k];
    else process.env[k] = dau.e[k];
  }
  const db = await getDb();
  if (!db) return;
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

async function chayMot(ten: string) {
  khoiPhucAi = datHamGoiAi(async () => "ok");
  const def = { id: `${TT}-${ten}`, name: ten, version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nut("a", "ai.llm", { vaiTro: "extract", loiNhac: "x", truongRa: "r" })], connections: [noi("t", "a")] };
  const { version } = await luuPhienBan(def, null);
  const runId = await batDauRun({ flowId: def.id, version, chuLuong: null, items: [{ json: {} }] });
  for (let i = 0; i < 50 && (await chayMotMuc("w-vm", undefined, TT)); i++);
  const db = (await getDb())!;
  const ev = (await db.execute(sql`SELECT payload FROM ai_flow_events WHERE "runId" = ${runId} AND kind = 'buoc.model'`)) as unknown as { payload: Record<string, unknown> }[];
  return { runId, ev: ev.map((e) => e.payload) };
}

describe("vết model của node AI (Đợt 9)", () => {
  it("không gán gì ⇒ model của env, nguon mac-dinh-env, KHÔNG dự phòng", async () => {
    const { ev } = await chayMot("macdinh");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ nodeId: "a", lan: 1, vaiTro: "extract", nguon: "mac-dinh-env", duPhong: false, kheBan: false });
    expect(typeof ev[0].model).toBe("string");
  });

  it("gán phạm vi flow → profile NHỎ có sẵn ⇒ model của profile, nguon gan-profile, phạm vi flow", async () => {
    datAnhSoModel(anh([{ scopeKind: "flow", scopeId: `${TT}-nho`, profileId: "p-nho" }], new Map([["p-nho", P({ artifactFile: "Nho-4B.gguf", slotClass: "nho" })]])));
    const { ev } = await chayMot("nho");
    expect(ev[0]).toMatchObject({ model: "Nho-4B", nguon: "gan-profile", phamVi: "flow", duPhong: false, kheBan: false });
  });

  it("★ gán profile KHE NẶNG mà server đang giữ model khác ⇒ DỰ PHÒNG về env, kheBan=true, lý do khe-dang-giu-model-khac", async () => {
    datAnhSoModel(anh([{ scopeKind: "flow", scopeId: `${TT}-nang`, profileId: "p-nang" }], new Map([["p-nang", P({})]])));
    const { ev } = await chayMot("nang");
    expect(ev[0]).toMatchObject({ nguon: "du-phong", phamVi: "flow", duPhong: true, kheBan: true });
    expect((ev[0].lyDo as string[]).join(" ")).toContain("khe-dang-giu-model-khac");
    expect(ev[0].model).not.toBe("Khe-Nang-30B"); // không phải model đã gán — đã rơi về dự phòng
  });

  it("flow.dongThoiGian trả sự kiện buoc.model cho Flow Studio (đọc qua router)", async () => {
    datAnhSoModel(anh([{ scopeKind: "flow", scopeId: `${TT}-doc`, profileId: "p-nang" }], new Map([["p-nang", P({})]])));
    const { runId } = await chayMot("doc");
    const [u] = (await (await getDb())!.execute(sql`SELECT id FROM users WHERE role = 'admin' AND "isActive" ORDER BY id LIMIT 1`)) as unknown as { id: number }[];
    const dtg = await flowRouter.createCaller({ user: { id: u.id, role: "viewer" } } as never).dongThoiGian({ runId });
    const e = dtg.suKien.find((x) => x.kind === "buoc.model");
    expect(e?.payload).toMatchObject({ nodeId: "a", lan: 1, duPhong: true, kheBan: true });
  });

  it("lỗi định tuyến KHÔNG làm hỏng node (vết là thông tin phụ)", async () => {
    datAnhSoModel({ ...ANH_RONG, taiLuc: 1, vaiTro: null as never });
    const { runId } = await chayMot("hong");
    const db = (await getDb())!;
    const [r] = await db.select().from(aiFlowRuns).where(sql`${aiFlowRuns.id} = ${runId}`);
    expect(r.status).toBe("xong");
  });
});
