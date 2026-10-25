/**
 * ★★★ Lô B7-B — bộ quét cắt tỉa lượt cũ (dieu-phoi duyệt): TẮT mặc định, chỉ báo khi chưa tắt DRY_RUN, chỉ lượt ĐÃ ĐÓNG, hạng ngoai-ghi/ot giữ lâu, luật đếm 10.000 (ở đây hạ xuống 2 để thử),
 * lượt cha còn con mở thì giữ, CASCADE dọn bảng con, ghi FLOW_CAT_TIA vào audit_logs. Cô lập bằng tiền tố luồng của lượt chạy (không đụng dữ liệu luồng khác trong `_test`).
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowRuns, aiFlows } from "../../../drizzle/schema";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import { luuPhienBan } from "./dongCo";
import { chayCatTiaMotLan, docCauHinhCatTia } from "./catTia";

const TT = `t9ct${Math.floor(Math.random() * 1e5)}`;
const F_THUONG = `${TT}-thuong`;
const F_CAO = `${TT}-cao`;
const F_DEM = `${TT}-dem`;
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const env = (them: Record<string, string> = {}): NodeJS.ProcessEnv => ({ FLOW_RETENTION_ENABLED: "true", FLOW_RETENTION_DRY_RUN: "false", ...them }) as NodeJS.ProcessEnv;

/** Gieo một lượt đã đóng/đang mở với tuổi (ngày) cho trước + MỘT bước + MỘT sự kiện (để thử CASCADE). */
async function run(flowId: string, status: string, tuoiNgay: number, opts: { parent?: string; epKetThuc?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  const dong = status === "xong" || status === "loi" || status === "huy" || opts.epKetThuc === true; // epKetThuc: dữ liệu BẤT THƯỜNG — lượt chưa đóng mà đã có finishedAt
  await db.execute(sql`INSERT INTO ai_flow_runs (id, "flowId", version, "triggerKind", status, "parentRunId", "startedAt", "finishedAt")
    VALUES (${id}, ${flowId}, 1, 'thu-cong', ${status}, ${opts.parent ?? null}, now() - (${tuoiNgay}::numeric * interval '1 day') - interval '1 minute',
            ${dong ? sql`now() - (${tuoiNgay}::numeric * interval '1 day')` : null})`);
  await db.execute(sql`INSERT INTO ai_flow_steps ("runId", "nodeId", lan, "lanThu", status, "idempotencyKey") VALUES (${id}, 't', 1, 1, 'xong', ${`k-${id}`})`);
  await db.execute(sql`INSERT INTO ai_flow_events ("runId", kind) VALUES (${id}, 'run.bat-dau')`);
  return id;
}
const con = async (ids: string[]) => new Set(((await db.execute(sql`SELECT id FROM ai_flow_runs WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`)) as unknown as { id: string }[]).map((r) => r.id));
const dem = async (bang: "ai_flow_steps" | "ai_flow_events", ids: string[]) =>
  ((await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(bang)} WHERE "runId" IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`)) as unknown as { n: number }[])[0].n;

beforeAll(async () => {
  db = (await getDb())!;
  const u = (await taoNguoiDungTest("admin", "admin", { tienTo: "ct", ts: TT })).id;
  await luuPhienBan({ id: F_THUONG, name: "t", version: 1, nodes: [nut("t", "kich-hoat.thu-cong")], connections: [] }, u, null);
  await luuPhienBan({ id: F_DEM, name: "d", version: 1, nodes: [nut("t", "kich-hoat.thu-cong")], connections: [] }, u, null);
  await luuPhienBan({ id: F_CAO, name: "c", version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nut("g", "tich-hop.http-gui", { url: "https://dich.test/x" })], connections: [{ from: { node: "t", port: "main" }, to: { node: "g", port: "main" } }] }, u, null);
}, 120_000);

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

describe("cấu hình", () => {
  it("mặc định TẮT + chỉ báo; số hợp lệ đọc từ env, rác ⇒ mặc định (14 / 365 / 10.000 / 500)", () => {
    expect(docCauHinhCatTia({} as NodeJS.ProcessEnv)).toEqual({ batHoatDong: false, chiBao: true, ngay: 14, ngayNgoaiGhi: 365, giuMoiNhat: 10_000, lo: 500, nhapPhut: 60 });
    expect(docCauHinhCatTia({ FLOW_RETENTION_ENABLED: "true", FLOW_RETENTION_DRY_RUN: "false", FLOW_RETENTION_DAYS: "30", FLOW_RETENTION_DAYS_NGOAI_GHI: "90", FLOW_RETENTION_GIU_MOI_NHAT: "100", FLOW_RETENTION_BATCH: "50" } as unknown as NodeJS.ProcessEnv))
      .toMatchObject({ batHoatDong: true, chiBao: false, ngay: 30, ngayNgoaiGhi: 90, giuMoiNhat: 100, lo: 50 });
    for (const v of ["0", "-3", "abc", "1.5", ""]) expect(docCauHinhCatTia({ FLOW_RETENTION_DAYS: v } as unknown as NodeJS.ProcessEnv).ngay, v).toBe(14);
    expect(docCauHinhCatTia({ FLOW_RETENTION_ENABLED: "TRUE" } as unknown as NodeJS.ProcessEnv).batHoatDong).toBe(false); // chỉ đúng chuỗi "true"
    expect(docCauHinhCatTia({ FLOW_RETENTION_ENABLED: "true", FLOW_RETENTION_DRY_RUN: "0" } as unknown as NodeJS.ProcessEnv).chiBao).toBe(true); // chỉ đúng "false" mới xoá thật
  });
});

describe("cắt tỉa", () => {
  it("★ TẮT (mặc định) ⇒ không làm gì dù có lượt rất cũ", async () => {
    const cu = await run(F_THUONG, "xong", 100);
    expect(await chayCatTiaMotLan({} as NodeJS.ProcessEnv, F_THUONG)).toEqual({ chay: false, chiBao: true, soLuot: 0, soLo: 0 });
    expect((await con([cu])).has(cu)).toBe(true);
  });

  it("★ chỉ báo (DRY_RUN mặc định khi bật): đếm số SẼ xoá, KHÔNG xoá gì", async () => {
    const cu = await run(F_THUONG, "xong", 200);
    const r = await chayCatTiaMotLan({ FLOW_RETENTION_ENABLED: "true" } as unknown as NodeJS.ProcessEnv, F_THUONG);
    expect(r).toMatchObject({ chay: true, chiBao: true });
    expect(r.soLuot).toBeGreaterThanOrEqual(1);
    expect((await con([cu])).has(cu)).toBe(true);
  });

  it("★ luật tuổi: xoá lượt thường ĐÃ ĐÓNG quá 14 ngày (xong/loi/huy); giữ lượt trẻ hơn; KHÔNG BAO GIỜ xoá dang-chay / cho-duyet dù rất cũ; bảng con đi theo CASCADE", async () => {
    const xoa = [await run(F_THUONG, "xong", 15), await run(F_THUONG, "loi", 30), await run(F_THUONG, "huy", 90)];
    const giu = [await run(F_THUONG, "xong", 13), await run(F_THUONG, "dang-chay", 500), await run(F_THUONG, "cho-duyet", 500), await run(F_THUONG, "dang-chay", 400, { epKetThuc: true })];
    const r = await chayCatTiaMotLan(env(), F_THUONG);
    expect(r.chiBao).toBe(false);
    const con1 = await con([...xoa, ...giu]);
    expect(xoa.every((i) => !con1.has(i))).toBe(true);
    expect(giu.every((i) => con1.has(i))).toBe(true);
    expect(await dem("ai_flow_steps", xoa)).toBe(0);
    expect(await dem("ai_flow_events", xoa)).toBe(0);
    expect(await dem("ai_flow_steps", giu)).toBe(4);
  });

  it("★ hạng ngoai-ghi GIỮ LÂU: 30 ngày / 364 ngày giữ, 366 ngày xoá; luật đếm KHÔNG áp cho hạng này", async () => {
    const giu = [await run(F_CAO, "xong", 30), await run(F_CAO, "xong", 364)];
    const xoa = [await run(F_CAO, "xong", 366)];
    await chayCatTiaMotLan(env({ FLOW_RETENTION_GIU_MOI_NHAT: "1" }), F_CAO); // đếm=1 sẽ xoá 363 lượt nếu luật đếm áp — không được
    const c = await con([...giu, ...xoa]);
    expect(giu.every((i) => c.has(i))).toBe(true);
    expect(xoa.every((i) => !c.has(i))).toBe(true);
  });

  it("★ luật ĐẾM (giữ N mới nhất): ngoài N mới nhất VÀ đã đóng > 24 giờ ⇒ xoá dù trẻ hơn 14 ngày; lượt < 24 giờ ngoài N vẫn giữ", async () => {
    const moi = [await run(F_DEM, "xong", 2), await run(F_DEM, "xong", 3)]; // 2 mới nhất
    const ngoai = [await run(F_DEM, "xong", 4), await run(F_DEM, "xong", 5), await run(F_DEM, "loi", 6)];
    const rat = await run(F_DEM, "xong", 0.2); // mới nhất tuyệt đối (<24 h) — thuộc nhóm N
    await chayCatTiaMotLan(env({ FLOW_RETENTION_GIU_MOI_NHAT: "3" }), F_DEM);
    const c = await con([...moi, ...ngoai, rat]);
    expect(c.has(rat)).toBe(true);
    expect(c.has(moi[0])).toBe(true); // hạng 2 (2 ngày)
    expect(c.has(moi[1])).toBe(true); // hạng 3 (3 ngày)
    expect(ngoai.every((i) => !c.has(i))).toBe(true);
  });

  it("lượt ngoài N nhưng đóng < 24 giờ ⇒ GIỮ", async () => {
    const f = `${TT}-dem2`;
    const u = (await taoNguoiDungTest("admin", "admin", { tienTo: "ct2", ts: TT })).id;
    await luuPhienBan({ id: f, name: "d2", version: 1, nodes: [nut("t", "kich-hoat.thu-cong")], connections: [] }, u, null);
    const a = await run(f, "xong", 0.1);
    const b = await run(f, "xong", 0.3);
    const c = await run(f, "xong", 0.5);
    await chayCatTiaMotLan(env({ FLOW_RETENTION_GIU_MOI_NHAT: "1" }), f);
    expect((await con([a, b, c])).size).toBe(3);
  });

  it("★ lượt CHA còn lượt con đang mở ⇒ GIỮ; hết con mở ⇒ xoá", async () => {
    const f = `${TT}-cha`;
    const u = (await taoNguoiDungTest("admin", "admin", { tienTo: "ct3", ts: TT })).id;
    await luuPhienBan({ id: f, name: "cha", version: 1, nodes: [nut("t", "kich-hoat.thu-cong")], connections: [] }, u, null);
    const cha = await run(f, "xong", 40);
    const conMo = await run(f, "dang-chay", 1, { parent: cha });
    await chayCatTiaMotLan(env(), f);
    expect((await con([cha])).has(cha)).toBe(true);
    await db.execute(sql`UPDATE ai_flow_runs SET status = 'xong', "finishedAt" = now() WHERE id = ${conMo}`);
    await chayCatTiaMotLan(env(), f);
    expect((await con([cha])).has(cha)).toBe(false);
  });

  it("★ lô: xoá theo lô (FLOW_RETENTION_BATCH nhỏ) vẫn xoá HẾT; ghi MỘT dòng FLOW_CAT_TIA vào audit_logs (soLuot, cửa sổ, userId null)", async () => {
    const f = `${TT}-lo`;
    const u = (await taoNguoiDungTest("admin", "admin", { tienTo: "ct4", ts: TT })).id;
    await luuPhienBan({ id: f, name: "lo", version: 1, nodes: [nut("t", "kich-hoat.thu-cong")], connections: [] }, u, null);
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await run(f, "xong", 20 + i));
    const r = await chayCatTiaMotLan(env({ FLOW_RETENTION_BATCH: "3" }), f);
    expect(r).toMatchObject({ soLuot: 7, soLo: 3 });
    expect((await con(ids)).size).toBe(0);
    const h = (await db.execute(sql`SELECT "userId", details, status FROM audit_logs WHERE action = 'FLOW_CAT_TIA' AND "entityName" = ${f}`)) as unknown as { userId: number | null; details: string; status: string }[];
    expect(h).toHaveLength(1);
    expect(h[0].userId).toBeNull();
    expect(JSON.parse(h[0].details)).toMatchObject({ soLuot: 7, chiBao: false, ngay: 14, ngayNgoaiGhi: 365, soLo: 3 });
  });
});
