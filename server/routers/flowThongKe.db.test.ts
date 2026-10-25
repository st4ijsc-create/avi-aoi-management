/**
 * ★★ Lô B7-D — `flow.thongKe` (SQL trực tiếp trên ai_flow_runs / steps / events, không bảng mới) với dữ liệu gieo CÓ SỐ BIẾT TRƯỚC (`_test`):
 * tỉ lệ thành công, p50/p90 thời gian lượt xong, theo node, token + lời gọi theo model, ước lượng đổi khe; cửa sổ ngày; phạm vi luồng.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray, like, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiFlowRuns, aiFlows } from "../../drizzle/schema";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { luuPhienBan } from "../services/flow/dongCo";
import { flowRouter } from "./flowRouter";

const TT = `t9tk${Math.floor(Math.random() * 1e5)}`;
const FLOW = `${TT}-a`;
const FLOW_KHAC = `${TT}-b`;
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
let admin = 0;
const goi = () => flowRouter.createCaller({ user: { id: admin, role: "admin", twoFactorEnabled: true } } as never);
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });

async function run(flowId: string, status: string, batDauTruoc: string, giay: number | null): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`INSERT INTO ai_flow_runs (id, "flowId", version, "triggerKind", status, "startedAt", "finishedAt")
    VALUES (${id}, ${flowId}, 1, 'thu-cong', ${status}, now() - ${batDauTruoc}::interval,
            ${giay === null ? null : sql`now() - ${batDauTruoc}::interval + (${giay}::int * interval '1 second')`})`);
  return id;
}
let khoa = 0;
async function buoc(runId: string, nodeId: string, status: string, giay: number): Promise<void> {
  await db.execute(sql`INSERT INTO ai_flow_steps ("runId", "nodeId", lan, "lanThu", status, "idempotencyKey", "startedAt", "finishedAt")
    VALUES (${runId}, ${nodeId}, 1, 1, ${status}, ${`k-${TT}-${khoa++}`}, now() - interval '1 hour', now() - interval '1 hour' + (${giay}::int * interval '1 second'))`);
}
async function model(runId: string, payload: Record<string, unknown>): Promise<void> {
  await db.execute(sql`INSERT INTO ai_flow_events ("runId", kind, payload) VALUES (${runId}, 'buoc.model', ${JSON.stringify(payload)}::jsonb)`);
}

beforeAll(async () => {
  db = (await getDb())!;
  admin = (await taoNguoiDungTest("admin", "admin", { tienTo: "tk", ts: TT })).id;
  await luuPhienBan({ id: FLOW, name: "a", version: 1, nodes: [nut("t", "kich-hoat.thu-cong")], connections: [] }, admin, null);
  await luuPhienBan({ id: FLOW_KHAC, name: "b", version: 1, nodes: [nut("t", "kich-hoat.thu-cong")], connections: [] }, admin, null);
  // 4 lượt xong: 10 / 20 / 30 / 40 giây (p50 = 25, p90 = 37); 1 loi, 1 huy, 1 đang chạy, 1 chờ duyệt; 1 lượt xong CŨ (10 ngày)
  const xong = [await run(FLOW, "xong", "1 hour", 10), await run(FLOW, "xong", "1 hour", 20), await run(FLOW, "xong", "1 hour", 30), await run(FLOW, "xong", "1 hour", 40)];
  const loi = await run(FLOW, "loi", "1 hour", 5);
  await run(FLOW, "huy", "1 hour", 1);
  await run(FLOW, "dang-chay", "1 hour", null);
  await run(FLOW, "cho-duyet", "1 hour", null);
  const cu = await run(FLOW, "xong", "10 days", 100);
  await run(FLOW_KHAC, "xong", "1 hour", 999); // luồng khác — không lẫn
  // bước: node "a" 1/2/3 giây xong + 4 giây lỗi; node "b" một bước 8 giây
  for (const [i, g] of [1, 2, 3].entries()) await buoc(xong[i], "a", "xong", g);
  await buoc(loi, "a", "loi", 4);
  await buoc(xong[3], "b", "xong", 8);
  await buoc(cu, "a", "xong", 50); // ngoài cửa sổ 7 ngày
  // model: lượt xong[0]: A, A, B (một lần đổi A→B), một lời gọi không báo token; lượt xong[1]: B rồi A (một lần đổi), có kheBan
  await model(xong[0], { nodeId: "a", model: "model-A", tokVao: 100, tokRa: 10, kheBan: false });
  await model(xong[0], { nodeId: "a", model: "model-A", tokVao: 200, tokRa: 20, kheBan: false });
  await model(xong[0], { nodeId: "b", model: "model-B", tokVao: 50, tokRa: 5, kheBan: true });
  await model(xong[0], { nodeId: "b", model: "model-B", kheBan: false }); // không báo token
  await model(xong[1], { nodeId: "a", model: "model-B", tokVao: 1, tokRa: 1, kheBan: false });
  await model(xong[1], { nodeId: "a", model: "model-A", tokVao: 2, tokRa: 2, kheBan: false });
  await model(cu, { nodeId: "a", model: "model-A", tokVao: 9999, tokRa: 9999, kheBan: false }); // ngoài cửa sổ
}, 120_000);

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

describe("flow.thongKe", () => {
  it("★ lượt theo trạng thái + tỉ lệ thành công (xong / đã đóng) trong 7 ngày; lượt cũ và luồng khác KHÔNG lẫn", async () => {
    const r = await goi().thongKe({ flowId: FLOW, ngay: 7 });
    expect(r.luot).toEqual({ tong: 8, xong: 4, loi: 1, huy: 1, dangChay: 1, choDuyet: 1, tiLeThanhCong: 0.6667 });
    const rong = await goi().thongKe({ flowId: FLOW, ngay: 30 });
    expect(rong.luot).toMatchObject({ tong: 9, xong: 5, tiLeThanhCong: 0.7143 }); // 30 ngày gồm lượt cũ
  });

  it("★ p50 / p90 thời gian lượt xong (giây): 10,20,30,40 ⇒ 25 và 37", async () => {
    const r = await goi().thongKe({ flowId: FLOW, ngay: 7 });
    expect(r.thoiGianLuotXongGiay).toEqual({ soLuot: 4, p50: 25, p90: 37 });
  });

  it("★ theo node: số bước, số lỗi, p50/p90 (node a: 1,2,3 xong + 4 lỗi; bước ngoài cửa sổ bị loại)", async () => {
    const r = await goi().thongKe({ flowId: FLOW, ngay: 7 });
    expect(r.theoNut).toEqual([
      { nodeId: "a", soBuoc: 4, soLoi: 1, p50Giay: 2.5, p90Giay: 3.7 },
      { nodeId: "b", soBuoc: 1, soLoi: 0, p50Giay: 8, p90Giay: 8 },
    ]);
  });

  it("★ theo model: số lời gọi + tổng token (lời gọi không báo token đếm riêng); lời gọi ngoài cửa sổ bị loại", async () => {
    const r = await goi().thongKe({ flowId: FLOW, ngay: 7 });
    expect(r.theoModel).toEqual([
      { model: "model-A", soLoiGoi: 3, tokenVao: 302, tokenRa: 32, khongBaoToken: 0 },
      { model: "model-B", soLoiGoi: 3, tokenVao: 51, tokenRa: 6, khongBaoToken: 1 },
    ].sort((a, b) => b.soLoiGoi - a.soLoiGoi || 0));
  });

  it("★ đổi khe ƯỚC LƯỢNG = số lần model đổi giữa hai lời gọi liên tiếp trong cùng lượt (A,A,B,B ⇒ 1; B,A ⇒ 1) = 2; lượt kheBan = 1; có ghi chú 'UOC LUONG'", async () => {
    const r = await goi().thongKe({ flowId: FLOW, ngay: 7 });
    expect(r.doiKhe).toMatchObject({ uocLuong: 2, luotKheBan: 1 });
    expect(r.doiKhe.ghiChu).toContain("UOC LUONG");
  });

  it("luồng không có lượt ⇒ số 0 / null (không lỗi chia 0); ngày ngoài 1…90 và luồng không tồn tại bị từ chối", async () => {
    const trong = await goi().thongKe({ flowId: FLOW_KHAC, ngay: 1 });
    expect(trong.luot.tiLeThanhCong).toBe(0 + 1); // 1 lượt xong ⇒ 100 %
    await luuPhienBan({ id: `${TT}-c`, name: "c", version: 1, nodes: [nut("t", "kich-hoat.thu-cong")], connections: [] }, admin, null);
    const r = await goi().thongKe({ flowId: `${TT}-c` });
    expect(r).toMatchObject({ ngay: 7, luot: { tong: 0, tiLeThanhCong: null }, thoiGianLuotXongGiay: { soLuot: 0, p50: null, p90: null }, theoNut: [], theoModel: [] });
    await expect(goi().thongKe({ flowId: FLOW, ngay: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(goi().thongKe({ flowId: FLOW, ngay: 91 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(goi().thongKe({ flowId: `${TT}-khong-co` })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
