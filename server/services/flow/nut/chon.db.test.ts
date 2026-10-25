/**
 * ★★★ Lô logic-chon — `logic.chon` / `logic.gom` với ĐỘNG CƠ THẬT trên `_test` (×3): item đi ĐÚNG nhánh (mỗi nhánh một node đánh dấu), `khac` bắt phần còn lại, trần ⇒ lượt LỖI rõ,
 * cổng `khac` CHƯA NỐI ⇒ động cơ ghi sự kiện `cong.khong-noi` (không bỏ âm thầm); đã nối ⇒ không có sự kiện.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiFlowEvents, aiFlowRuns, aiFlowSteps, aiFlows } from "../../../../drizzle/schema";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";
import { batDauRun, chayMotMuc, luuPhienBan } from "../dongCo";

const TT = `t7ch${Math.floor(Math.random() * 1e5)}`;
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const noi = (a: string, b: string, pa = "main") => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
const danhDau = (id: string, kenh: string) => nut(id, "du-lieu.dat", { truong: { kenh } });
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
let chu = 0;

const luongChon = (id: string, noiKhac: boolean) => ({
  id, name: "chon", version: 1, settings: { maxConcurrentRuns: 100 },
  nodes: [
    nut("t", "kich-hoat.thu-cong"),
    nut("c", "logic.chon", { giaTri: "{{ $json.nhan }}", nhanh: [{ so: "eq", dich: "a" }, { so: "in", dich: ["b", "c"] }] }),
    danhDau("ma", "1"),
    danhDau("mb", "2"),
    ...(noiKhac ? [danhDau("mk", "khac")] : []),
  ],
  connections: [noi("t", "c"), noi("c", "ma", "nhanh-1"), noi("c", "mb", "nhanh-2"), ...(noiKhac ? [noi("c", "mk", "khac")] : [])],
});
const chayHet = async () => {
  for (let i = 0; i < 400 && (await chayMotMuc("w-ch", undefined, TT)); i++);
};
async function chay(flowId: string, items: { json: Record<string, unknown> }[]) {
  const r = await batDauRun({ flowId, version: 1, chuLuong: chu, items });
  await chayHet();
  const [run] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, r));
  const dau = async (nodeId: string) => {
    const [b] = await db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, r), eq(aiFlowSteps.nodeId, nodeId)));
    return ((b?.output as { main?: { json: Record<string, unknown> }[] } | null)?.main ?? []).length === 0 && !b ? null : (b?.input as { main?: { json: Record<string, unknown> }[] } | null)?.main ?? [];
  };
  const events = await db.select().from(aiFlowEvents).where(and(eq(aiFlowEvents.runId, r), eq(aiFlowEvents.kind, "cong.khong-noi")));
  return { id: r, status: run.status, loi: run.error as { ma?: string; thongDiep?: string } | null, dau, events };
}

beforeAll(async () => {
  db = (await getDb())!;
  chu = (await taoNguoiDungTest("admin", "admin", { tienTo: "ch", ts: TT })).id;
  await luuPhienBan(luongChon(`${TT}-noi`, true), chu, null);
  await luuPhienBan(luongChon(`${TT}-ko-noi`, false), chu, null);
  await luuPhienBan({ id: `${TT}-gom`, name: "gom", version: 1, settings: { maxConcurrentRuns: 100 }, nodes: [nut("t", "kich-hoat.thu-cong"), nut("g", "logic.gom", { truongRa: "ds" })], connections: [noi("t", "g")] } as never, chu, null);
}, 120_000);

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

const ITEMS = [{ json: { nhan: "a", i: 1 } }, { json: { nhan: "b", i: 2 } }, { json: { nhan: "x", i: 3 } }, { json: { nhan: "c", i: 4 } }, { json: { nhan: "a", i: 5 } }, { json: { i: 6 } }];

describe("logic.chon trong động cơ", () => {
  for (const lan of [1, 2, 3]) {
    it(`★ lần ${lan}: item đi ĐÚNG nhánh; khac bắt phần còn lại; Σ = vào; cổng khac đã nối ⇒ không sự kiện`, async () => {
      const r = await chay(`${TT}-noi`, ITEMS);
      expect(r.status).toBe("xong");
      expect((await r.dau("ma"))!.map((x) => x.json.i)).toEqual([1, 5]);
      expect((await r.dau("mb"))!.map((x) => x.json.i)).toEqual([2, 4]);
      expect((await r.dau("mk"))!.map((x) => x.json.i)).toEqual([3, 6]);
      expect(r.events.length).toBe(0);
    });
  }

  it("★ cổng khac CHƯA NỐI: item khac bị bỏ nhưng động cơ GHI sự kiện cong.khong-noi {nodeId, cong, soItem}; lượt vẫn xong", async () => {
    const r = await chay(`${TT}-ko-noi`, ITEMS);
    expect(r.status).toBe("xong");
    expect(r.events.length).toBe(1);
    expect(r.events[0].payload).toEqual({ nodeId: "c", cong: "khac", soItem: 2 });
    expect(await r.dau("mk")).toBeNull(); // không có node nối
    // không có item khac ⇒ không sự kiện
    const r2 = await chay(`${TT}-ko-noi`, [{ json: { nhan: "a" } }]);
    expect(r2.events.length).toBe(0);
  });

  it("trần: 1001 item ⇒ lượt LỖI QUA_TRAN_ITEM (không cắt, không nhánh nào chạy); đúng 1000 ⇒ xong", async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ json: { nhan: "a", i } }));
    const lon = await chay(`${TT}-noi`, mk(1001));
    expect(lon.status).toBe("loi");
    expect(await lon.dau("ma")).toBeNull();
    const vua = await chay(`${TT}-noi`, mk(1000));
    expect(vua.status).toBe("xong");
    expect((await vua.dau("ma"))!.length).toBe(1000);
  });
});

describe("logic.gom trong động cơ", () => {
  it("N item ⇒ 1 item { ds, soItem }; 1001 ⇒ lượt LỖI", async () => {
    const r = await batDauRun({ flowId: `${TT}-gom`, version: 1, chuLuong: chu, items: ITEMS });
    await chayHet();
    const [b] = await db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, r), eq(aiFlowSteps.nodeId, "g")));
    const ra = (b.output as { main: { json: { ds: unknown[]; soItem: number } }[] }).main;
    expect(ra.length).toBe(1);
    expect(ra[0].json.soItem).toBe(6);
    expect(ra[0].json.ds.length).toBe(6);
    const lon = await batDauRun({ flowId: `${TT}-gom`, version: 1, chuLuong: chu, items: Array.from({ length: 1001 }, (_, i) => ({ json: { i } })) });
    await chayHet();
    const [run] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, lon));
    expect(run.status).toBe("loi");
  });
});
