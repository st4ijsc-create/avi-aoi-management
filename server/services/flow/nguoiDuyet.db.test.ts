/** Đợt 8.1 — `nguoi.duyet` (chờ dài) trên CSDL `_test`: lượt dừng ở `cho-duyet`, trả lời đi đúng cổng, trả lời lần hai bị từ chối, quá hạn ⇒ `het-han`. */
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../drizzle/schema";
import { batDauRun, chayMotMuc, luuPhienBan, traLoiCho } from "./dongCo";

const TT = "t8nd";
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const noi = (a: string, pa: string, b: string, pb = "main") => ({ from: { node: a, port: pa }, to: { node: b, port: pb } });

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

async function chayHet() {
  for (let i = 0; i < 100 && (await chayMotMuc("w", undefined, TT)); i++);
}
const run = async (id: string) => (await (await getDb())!.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, id)))[0];

describe("nguoi.duyet (Đợt 8.1, DB)", () => {
  async function taoLuong() {
    return luuPhienBan(
      {
        id: `${TT}-a`, name: "duyệt", version: 1,
        nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "nguoi.duyet", { tieuDe: "Duyệt RCA {{ $json.may }}", hetHanGio: 1 }), nut("ok", "du-lieu.dat", { truong: { kq: "dong-y" } }), nut("ko", "du-lieu.dat", { truong: { kq: "tu-choi" } }), nut("hh", "du-lieu.dat", { truong: { kq: "het-han" } })],
        connections: [noi("t", "main", "d"), noi("d", "dong-y", "ok"), noi("d", "tu-choi", "ko"), noi("d", "het-han", "hh")],
      },
      null,
    );
  }

  it("dừng chờ ⇒ đồng ý ⇒ nhánh dong-y chạy, lượt xong; trả lời lần hai ⇒ khong-co-cho", async () => {
    const { version } = await taoLuong();
    const r = await batDauRun({ flowId: `${TT}-a`, version, items: [{ json: { may: "AOI-2" } }] });
    await chayHet();
    expect((await run(r)).status).toBe("cho-duyet");
    const [w] = (await (await getDb())!.execute(sql`SELECT payload FROM ai_flow_waits WHERE "runId" = ${r}`)) as unknown as { payload: { tieuDe: string } }[];
    expect(w.payload.tieuDe).toBe("Duyệt RCA AOI-2");
    const [a, b] = await Promise.all([
      traLoiCho({ runId: r, nodeId: "d", cong: "dong-y", them: { duyet: { dongY: true, nguoi: 1 } } }),
      traLoiCho({ runId: r, nodeId: "d", cong: "tu-choi" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    await chayHet();
    expect((await run(r)).status).toBe("xong");
    const buoc = await (await getDb())!.select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, r));
    const chay = buoc.filter((x) => ["ok", "ko"].includes(x.nodeId)).map((x) => x.nodeId);
    expect(chay).toHaveLength(1);
  });

  it("quá hạn ⇒ cổng het-han dù người chọn đồng ý", async () => {
    const { version } = await taoLuong();
    const r = await batDauRun({ flowId: `${TT}-a`, version, items: [{ json: {} }] });
    await chayHet();
    await (await getDb())!.execute(sql`UPDATE ai_flow_waits SET "expiresAt" = now() - interval '1 minute' WHERE "runId" = ${r}`);
    expect(await traLoiCho({ runId: r, nodeId: "d", cong: "dong-y" })).toEqual({ ok: true, cong: "het-han" });
    await chayHet();
    const buoc = await (await getDb())!.select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, r));
    expect(buoc.some((x) => x.nodeId === "hh" && x.status === "xong")).toBe(true);
    expect((await run(r)).status).toBe("xong");
  });
});
