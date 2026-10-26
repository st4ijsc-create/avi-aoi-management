/**
 * (c) ĐO: giết worker GIỮA lượt `tich-hop.thong-bao` (SIGKILL tiến trình con ngay sau khi thông báo đã ghi CSDL) ⇒ đúng MỘT thông báo, bước `khong-ro`,
 * lượt `loi`; worker thay thế (sau khi hết hạn thuê) KHÔNG gửi lại. Mở bằng LUONG_KILL=1 (sinh tiến trình tsx; không chạy trong lưới thường).
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../drizzle/schema";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import { batDauRun, chayMotMuc, luuPhienBan } from "./dongCo";

const RUN = `kl_${Date.now().toString(36)}`;
const TT = `t1kl${Math.floor(Math.random() * 1e5)}`;
const FL = `${TT}-kill`;
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
let nhan = 0;
let admin = 0;

beforeAll(async () => {
  db = (await getDb())!;
  nhan = (await taoNguoiDungTest("nhan", "admin", { tienTo: "kl", ts: RUN })).id;
  admin = (await taoNguoiDungTest("admin", "admin", { tienTo: "kl", ts: RUN })).id;
}, 60_000);

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await db.execute(sql`DELETE FROM notifications WHERE "userId" = ${nhan} AND title LIKE ${`${RUN}%`}`);
});

describe.skipIf(process.env.LUONG_KILL !== "1")("(c) giết worker giữa lượt thông báo", () => {
  it("SIGKILL sau khi gửi ⇒ đúng 1 thông báo; worker thay thế không gửi lại; bước khong-ro, lượt loi", async () => {
    const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
    await luuPhienBan(
      {
        id: FL, name: "kill", version: 1, settings: { maxConcurrentRuns: 100 },
        nodes: [nut("t", "kich-hoat.thu-cong"), nut("n", "tich-hop.thong-bao", { nguoiNhan: [nhan], tieuDe: `${RUN} báo cáo`, noiDung: "x" })],
        connections: [{ from: { node: "t", port: "main" }, to: { node: "n", port: "main" } }],
      } as never,
      admin,
      null,
    );
    const r = await batDauRun({ flowId: FL, version: 1, chuLuong: admin, items: [{ json: {} }] });
    const con = spawnSync("npx", ["tsx", "server/services/flow/__killWorker.ts", TT], { env: { ...process.env }, encoding: "utf8", shell: true, timeout: 120_000 });
    expect(con.stdout).toContain("DA_GUI");
    expect(con.stdout).not.toContain("CON_THOAT_BINH_THUONG");
    const dem = async () => Number(((await db.execute(sql`SELECT count(*)::int AS n FROM notifications WHERE "userId" = ${nhan} AND title LIKE ${`${RUN}%`}`)) as unknown as { n: number }[])[0].n);
    expect(await dem()).toBe(1);
    // worker thay thế: hết hạn thuê mục hàng, chạy lại
    await db.execute(sql`UPDATE ai_flow_queue SET "leaseUntil" = now() - interval '1 second' WHERE "runId" = ${r}`);
    for (let i = 0; i < 20 && (await chayMotMuc("w-thay-the", undefined, TT)); i++);
    expect(await dem()).toBe(1);
    const [run] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, r));
    const [b] = await db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, r), eq(aiFlowSteps.nodeId, "n")));
    expect(run.status).toBe("loi");
    expect(b.status).toBe("khong-ro");
  }, 300_000);
});
