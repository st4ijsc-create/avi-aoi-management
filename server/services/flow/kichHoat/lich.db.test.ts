/**
 * Đợt 8.1 Task 4a — kích hoạt LỊCH trên CSDL `_test`: kiểm cron 5 trường, mỗi mốc phút đúng MỘT lượt (khoá idempotency
 * UNIQUE — hai tiến trình bắn trùng vẫn một lượt), mốc khác ⇒ lượt mới, chỉ luồng BẬT có node lịch được nạp, lượt chạy hết.
 * Đồng hồ GIẢ (`bayGio`) — không chờ cron thật.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../../drizzle/schema";
import { chayMotMuc, luuPhienBan } from "../dongCo";
import { banLich, docMucLich, khoaLich, kiemCron, kiemMuiGio, kiemThamSoKichHoat, mocPhut } from "./lich";

const TT = "t8lh";
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const noi = (a: string, b: string) => ({ from: { node: a, port: "main" }, to: { node: b, port: "main" } });

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

describe("kiểm cron / múi giờ (thuần)", () => {
  it("đúng 5 trường; 6 trường (giây) và rác bị từ chối", () => {
    expect(kiemCron("0 6 * * *")).toBeNull();
    expect(kiemCron("*/15 7-19 * * 1-6")).toBeNull();
    expect(kiemCron("0 0 6 * * *")).toMatch(/5 trường/);
    expect(kiemCron("60 6 * * *")).toMatch(/không hợp lệ/);
    expect(kiemCron("")).toMatch(/thiếu/);
    expect(kiemMuiGio("Asia/Ho_Chi_Minh")).toBeNull();
    expect(kiemMuiGio("Sao/Hoa")).toMatch(/múi giờ/);
    expect(kiemThamSoKichHoat({ nodes: [nut("l", "kich-hoat.lich", { cron: "x" }), nut("t", "kich-hoat.thu-cong")] })).toHaveLength(1);
  });

  it("khoá theo PHÚT: hai thời điểm trong cùng phút ⇒ cùng khoá; khoá dài ⇒ băm ≤ 128", () => {
    const a = new Date("2026-10-20T23:00:05Z");
    const b = new Date("2026-10-20T23:00:59Z");
    expect(khoaLich("f", "n", a)).toBe(khoaLich("f", "n", b));
    expect(mocPhut(a)).toBe("2026-10-20T23:00Z");
    expect(khoaLich("x".repeat(64), "y".repeat(64), a).length).toBeLessThanOrEqual(128);
  });
});

describe("banLich (Đợt 8.1, DB)", () => {
  it("mỗi mốc phút đúng MỘT lượt (kể cả hai bên bắn đồng thời); mốc khác ⇒ lượt mới; lượt chạy hết", async () => {
    const { version } = await luuPhienBan(
      {
        id: `${TT}-a`, name: "lịch", version: 1,
        nodes: [nut("l", "kich-hoat.lich", { cron: "0 6 * * *" }), nut("d", "du-lieu.dat", { truong: { moc: "{{ $json.moc }}" } })],
        connections: [noi("l", "d")],
      },
      null,
    );
    const bayGio = new Date("2026-10-20T23:00:01Z");
    const [r1, r2] = await Promise.all([
      banLich({ flowId: `${TT}-a`, version, nodeId: "l", bayGio }),
      banLich({ flowId: `${TT}-a`, version, nodeId: "l", bayGio: new Date("2026-10-20T23:00:40Z") }),
    ]);
    expect([r1, r2].filter(Boolean)).toHaveLength(1);
    expect(await banLich({ flowId: `${TT}-a`, version, nodeId: "l", bayGio })).toBeNull();
    const r3 = await banLich({ flowId: `${TT}-a`, version, nodeId: "l", bayGio: new Date("2026-10-21T23:00:00Z") });
    expect(r3).toBeTruthy();
    const db = (await getDb())!;
    const runs = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.flowId, `${TT}-a`));
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.triggerKind === "lich")).toBe(true);
    await chayHet();
    const sau = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.flowId, `${TT}-a`));
    expect(sau.map((r) => r.status)).toEqual(["xong", "xong"]);
    const [b] = await db.select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, (r1 ?? r2)!));
    expect(b).toBeTruthy();
    const d = (await db.select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, (r1 ?? r2)!))).find((x) => x.nodeId === "d")!;
    expect((d.output as { main: { json: { moc: string } }[] }).main[0].json.moc).toBe("2026-10-20T23:00Z");
  });

  it("docMucLich: chỉ luồng BẬT, đúng phiên bản hoạt động, bỏ node lịch tắt", async () => {
    const { version } = await luuPhienBan(
      {
        id: `${TT}-b`, name: "lịch b", version: 1,
        nodes: [nut("l1", "kich-hoat.lich", { cron: "0 6 * * *" }), { ...nut("l2", "kich-hoat.lich", { cron: "0 7 * * *" }), disabled: true }, nut("d", "du-lieu.dat")],
        connections: [noi("l1", "d"), noi("l2", "d")],
      },
      null,
    );
    expect((await docMucLich(TT)).filter((m) => m.flowId === `${TT}-b`)).toHaveLength(0);
    const db = (await getDb())!;
    await db.update(aiFlows).set({ enabled: true, activeVersion: version }).where(eq(aiFlows.id, `${TT}-b`));
    const muc = (await docMucLich(TT)).filter((m) => m.flowId === `${TT}-b`);
    expect(muc).toEqual([{ flowId: `${TT}-b`, version, nodeId: "l1", cron: "0 6 * * *", muiGio: "Asia/Ho_Chi_Minh" }]);
    await db.update(aiFlows).set({ enabled: false }).where(eq(aiFlows.id, `${TT}-b`));
    expect((await docMucLich(TT)).filter((m) => m.flowId === `${TT}-b`)).toHaveLength(0);
  });
});
