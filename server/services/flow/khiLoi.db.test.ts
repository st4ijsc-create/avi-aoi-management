/**
 * ★★★ khiLoi = "nhanh-loi" DÙNG ĐƯỢC (dieu-phoi 2026-10-26; trước đây cổng `loi` không node nào khai ⇒ kiemLuong từ chối nối ⇒ lỗi rơi im lặng):
 *   • cổng `loi` là cổng ẨN của mọi node, nối được CHỈ khi node đặt khiLoi = nhanh-loi (mặc định/dung/tiep-tuc ⇒ lưu bị từ chối);
 *   • lỗi node ⇒ MỖI item đầu vào đi cổng `loi`, giữ nguyên item gốc + `loi: { ma, thongDiep, nodeId }` — không mất item; lượt vẫn xong;
 *   • cổng `loi` CHƯA nối ⇒ động cơ ghi `cong.khong-noi { nodeId, cong: "loi", soItem }` (như `khac` của logic.chon);
 *   • node không lỗi ⇒ không item nào ra `loi`.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowEvents, aiFlowRuns, aiFlowSteps, aiFlows } from "../../../drizzle/schema";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import { batDauRun, chayMotMuc, itemLoi, luuPhienBan } from "./dongCo";

const TT = `t9kl${Math.floor(Math.random() * 1e5)}`;
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters, ...extra });
const noi = (a: string, b: string, pa = "main") => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
const dau = (id: string, kenh: string) => nut(id, "du-lieu.dat", { truong: { kenh } });
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
let chu = 0;

const luong = (id: string, khiLoi: string | undefined, noiLoi: boolean, thongDiep = "hỏng {{ $json.i }}") => ({
  id, name: "khiLoi", version: 1, settings: { maxConcurrentRuns: 100 },
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("x", "logic.dung-loi", { thongDiep }, khiLoi ? { khiLoi } : {}), dau("tot", "binh-thuong"), dau("xl", "xu-ly-loi")],
  connections: [noi("t", "x"), ...(noiLoi ? [noi("x", "xl", "loi")] : [])],
});
const chayHet = async () => {
  for (let i = 0; i < 200 && (await chayMotMuc("w-kl", undefined, TT)); i++);
};
const buoc = (r: string, nodeId: string) => db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, r), eq(aiFlowSteps.nodeId, nodeId)));
const lay = async (id: string) => (await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, id)))[0];

beforeAll(async () => {
  db = (await getDb())!;
  chu = (await taoNguoiDungTest("admin", "admin", { tienTo: "kl", ts: TT })).id;
  await luuPhienBan(luong(`${TT}-noi`, "nhanh-loi", true), chu, null);
  await luuPhienBan(luong(`${TT}-ko-noi`, "nhanh-loi", false), chu, null);
  await luuPhienBan(luong(`${TT}-dung`, undefined, false), chu, null);
}, 120_000);

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

describe("itemLoi (thuần)", () => {
  it("mỗi item vào (mọi cổng) thành một item lỗi giữ nguyên trường gốc; không item vào ⇒ MỘT item chỉ mang loi; ma vắng ⇒ không khoá ma; đè khoá loi cũ", () => {
    const a = { json: { i: 1 } };
    const b = { json: { i: 2, loi: "cu" } };
    expect(itemLoi({ main: [a], phu: [b] }, "n", "MA", "tin")).toEqual([
      { json: { i: 1, loi: { ma: "MA", thongDiep: "tin", nodeId: "n" } } },
      { json: { i: 2, loi: { ma: "MA", thongDiep: "tin", nodeId: "n" } } },
    ]);
    expect(itemLoi({}, "n", undefined, "tin")).toEqual([{ json: { loi: { thongDiep: "tin", nodeId: "n" } } }]);
    expect(itemLoi([a], "n", undefined, "t")).toEqual([{ json: { i: 1, loi: { thongDiep: "t", nodeId: "n" } } }]);
    expect(itemLoi(undefined, "n", "M", "t")).toHaveLength(1);
    expect(a.json).toEqual({ i: 1 }); // không đột biến item gốc
  });
});

describe("khiLoi = nhanh-loi", () => {
  it("★ lỗi node ⇒ MỖI item vào đi cổng loi, giữ item gốc + loi {ma, thongDiep, nodeId}; lượt XONG; nhánh thường không chạy", async () => {
    const r = await batDauRun({ flowId: `${TT}-noi`, version: 1, chuLuong: chu, items: [{ json: { i: 1, giu: "a" } }, { json: { i: 2, giu: "b" } }] });
    await chayHet();
    expect((await lay(r)).status).toBe("xong");
    const [x] = await buoc(r, "x");
    expect(x.status).toBe("loi");
    const [xl] = await buoc(r, "xl");
    expect(xl.status).toBe("xong");
    expect((xl.input as { main: { json: Record<string, unknown> }[] }).main.map((i) => i.json)).toEqual([
      { i: 1, giu: "a", loi: { ma: "DUNG_LOI", thongDiep: "hỏng 1", nodeId: "x" } },
      { i: 2, giu: "b", loi: { ma: "DUNG_LOI", thongDiep: "hỏng 1", nodeId: "x" } },
    ]);
    expect(await buoc(r, "tot")).toHaveLength(0);
  });

  it("★ cổng loi CHƯA nối ⇒ sự kiện cong.khong-noi {nodeId, cong:'loi', soItem}; lượt vẫn xong", async () => {
    const r = await batDauRun({ flowId: `${TT}-ko-noi`, version: 1, chuLuong: chu, items: [{ json: { i: 1 } }, { json: { i: 2 } }, { json: { i: 3 } }] });
    await chayHet();
    expect((await lay(r)).status).toBe("xong");
    const ev = await db.select().from(aiFlowEvents).where(and(eq(aiFlowEvents.runId, r), eq(aiFlowEvents.kind, "cong.khong-noi")));
    expect(ev.map((e) => e.payload)).toEqual([{ nodeId: "x", cong: "loi", soItem: 3 }]);
  });

  it("khiLoi mặc định (dung): lượt LỖI như cũ, không item nào đi đâu", async () => {
    const r = await batDauRun({ flowId: `${TT}-dung`, version: 1, chuLuong: chu, items: [{ json: { i: 1 } }] });
    await chayHet();
    expect((await lay(r)).status).toBe("loi");
  });

  it("★ nối từ cổng `loi` khi khiLoi KHÔNG phải nhanh-loi (mặc định / dung / tiep-tuc) ⇒ LƯU BỊ TỪ CHỐI", async () => {
    for (const k of [undefined, "dung", "tiep-tuc"]) {
      await expect(luuPhienBan(luong(`${TT}-tu-choi-${k ?? "mac-dinh"}`, k, true), chu, null), String(k)).rejects.toThrow(/không có cổng ra 'loi'/);
    }
  });

  it("node KHÔNG lỗi ⇒ không item ra cổng loi, không sự kiện cong.khong-noi", async () => {
    await luuPhienBan(
      {
        id: `${TT}-ok`, name: "ok", version: 1, settings: { maxConcurrentRuns: 100 },
        nodes: [nut("t", "kich-hoat.thu-cong"), nut("g", "logic.gom", { truongRa: "ds" }, { khiLoi: "nhanh-loi" }), dau("xl", "xu-ly-loi")],
        connections: [noi("t", "g"), noi("g", "xl", "loi")],
      },
      chu,
      null,
    );
    const r = await batDauRun({ flowId: `${TT}-ok`, version: 1, chuLuong: chu, items: [{ json: { i: 1 } }] });
    await chayHet();
    expect((await lay(r)).status).toBe("xong");
    expect(await buoc(r, "xl")).toHaveLength(0);
    expect(await db.select().from(aiFlowEvents).where(and(eq(aiFlowEvents.runId, r), eq(aiFlowEvents.kind, "cong.khong-noi")))).toHaveLength(0);
  });
});
