/**
 * ★★★ Lô logic-cho (dieu-phoi duyệt động cơ `__hen`) trên `_test`:
 *  (A) `logic.cho` — node kế CHƯA chạy trước hạn, chạy ĐÚNG MỘT lần sau hạn; không giữ worker (lượt vẫn `dang-chay`, hàng đợi mang availableAt tương lai);
 *      giết worker giữa lúc nhặt ⇒ vẫn đúng một lần; lượt bị huỷ trong lúc chờ ⇒ node kế KHÔNG chạy; trần tuổi lượt 7 ngày ⇒ bước lỗi QUA_TRAN_CHO.
 *  (B) VÁ LỖI THẬT: `nguoi.duyet` quá hạn không ai bấm ⇒ trước đây treo mãi. Nay mục "kiểm hết hạn" ⇒ cổng `het-han` ĐÚNG MỘT lần; trả lời trước hạn ⇒ mục kiểm biến mất
 *      (lượt đóng ngay, không đợi tới hạn); giết worker giữa lúc xử lý mục kiểm ⇒ vẫn đúng một lần.
 *  (C) `logic.dung-loi` trong động cơ: lượt `loi` với thông điệp, không thử lại; `khiLoi: nhanh-loi` ⇒ cổng `loi`.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowEvents, aiFlowRuns, aiFlowSteps, aiFlows } from "../../../drizzle/schema";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import { batDauBuoc, batDauRun, chayMotMuc, luuPhienBan, nhatMuc, traLoiCho } from "./dongCo";

const TT = `t9hen${Math.floor(Math.random() * 1e5)}`;
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters, ...extra });
const noi = (a: string, b: string, pa = "main") => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
const dau = (id: string, kenh: string) => nut(id, "du-lieu.dat", { truong: { kenh } });
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
let chu = 0;

const chayHet = async () => {
  for (let i = 0; i < 200 && (await chayMotMuc("w-hen", undefined, TT)); i++);
};
const lay = async (id: string) => (await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, id)))[0];
const buoc = (r: string, nodeId: string) => db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, r), eq(aiFlowSteps.nodeId, nodeId)));
const hangDoi = async (r: string) =>
  (await db.execute(sql`SELECT "nodeId", id, inputs, ("availableAt" > now()) AS tuong_lai FROM ai_flow_queue WHERE "runId" = ${r} ORDER BY id`)) as unknown as { nodeId: string; id: number; inputs: Record<string, unknown>; tuong_lai: boolean }[];
const deHan = (r: string) => db.execute(sql`UPDATE ai_flow_queue SET "availableAt" = now() - interval '1 second' WHERE "runId" = ${r}`);
const luongCho = (id: string, giay: unknown) => ({
  id, name: "cho", version: 1, settings: { maxConcurrentRuns: 100 },
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("c", "logic.cho", { giay }), dau("sau", "sau-khi-cho")],
  connections: [noi("t", "c"), noi("c", "sau")],
});
const luongDuyet = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: "duyet", version: 1, settings: { maxConcurrentRuns: 100 },
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "nguoi.duyet", { tieuDe: "Duyệt", hetHanGio: 1 }, extra), dau("ok", "dong-y"), dau("ko", "tu-choi"), dau("hh", "het-han")],
  connections: [noi("t", "d"), noi("d", "ok", "dong-y"), noi("d", "ko", "tu-choi"), noi("d", "hh", "het-han")],
});

beforeAll(async () => {
  db = (await getDb())!;
  chu = (await taoNguoiDungTest("admin", "admin", { tienTo: "he", ts: TT })).id;
  await luuPhienBan(luongCho(`${TT}-cho`, 3600), chu, null);
  await luuPhienBan(luongCho(`${TT}-cho0`, 0), chu, null);
  await luuPhienBan(luongCho(`${TT}-cho-sai`, 86401), chu, null); // lưu được ở tầng động cơ; bộ kiểm tham số tĩnh (router) chặn ở chỗ khác, và node tự từ chối lúc chạy
  await luuPhienBan(luongDuyet(`${TT}-duyet`), chu, null);
  await luuPhienBan(
    {
      id: `${TT}-loi`, name: "loi", version: 1, settings: { maxConcurrentRuns: 100 },
      nodes: [nut("t", "kich-hoat.thu-cong"), nut("x", "logic.dung-loi", { thongDiep: "Dừng vì {{ $json.lyDo }}" }), dau("sau", "khong-bao-gio")],
      connections: [noi("t", "x")],
    },
    chu,
    null,
  );
  await luuPhienBan(
    {
      id: `${TT}-loi-tiep`, name: "loi-tiep", version: 1, settings: { maxConcurrentRuns: 100 },
      nodes: [nut("t", "kich-hoat.thu-cong"), nut("x", "logic.dung-loi", { thongDiep: "dừng" }, { khiLoi: "nhanh-loi" })],
      connections: [noi("t", "x")],
    },
    chu,
    null,
  );
}, 120_000);

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

describe("(A) logic.cho — __hen", () => {
  it("★ node kế CHƯA chạy trước hạn (không giữ worker: lượt dang-chay, hàng đợi availableAt tương lai); tới hạn ⇒ chạy ĐÚNG MỘT lần với item nguyên vẹn", async () => {
    const r = await batDauRun({ flowId: `${TT}-cho`, version: 1, chuLuong: chu, items: [{ json: { i: 1 } }, { json: { i: 2 } }] });
    await chayHet();
    expect((await lay(r)).status).toBe("dang-chay");
    expect((await buoc(r, "c")).map((b) => b.status)).toEqual(["xong"]);
    expect(await buoc(r, "sau")).toHaveLength(0);
    const q = await hangDoi(r);
    expect(q.map((x) => [x.nodeId, x.tuong_lai])).toEqual([["sau", true]]);
    const ev = await db.select().from(aiFlowEvents).where(and(eq(aiFlowEvents.runId, r), eq(aiFlowEvents.kind, "buoc.hen")));
    expect(ev.map((e) => (e.payload as { ms: number }).ms)).toEqual([3_600_000]);
    // chạy thêm vòng worker trước hạn: vẫn không chạy
    await chayHet();
    expect(await buoc(r, "sau")).toHaveLength(0);
    await deHan(r);
    await chayHet();
    await chayHet();
    expect((await lay(r)).status).toBe("xong");
    const sau = await buoc(r, "sau");
    expect(sau).toHaveLength(1);
    expect((sau[0].input as { main: { json: { i: number } }[] }).main.map((x) => x.json.i)).toEqual([1, 2]);
  });

  it("giay = 0 ⇒ chạy ngay (không hẹn); giay ngoài 0…86400 ⇒ node TỪ CHỐI lúc chạy (bước lỗi THAM_SO_SAI, không hẹn)", async () => {
    const r = await batDauRun({ flowId: `${TT}-cho0`, version: 1, chuLuong: chu, items: [{ json: { i: 1 } }] });
    await chayHet();
    expect((await lay(r)).status).toBe("xong");
    const sai = await batDauRun({ flowId: `${TT}-cho-sai`, version: 1, chuLuong: chu, items: [{ json: { i: 1 } }] });
    await chayHet();
    expect((await lay(sai)).status).toBe("loi");
    expect((await buoc(sai, "c"))[0].status).toBe("loi");
    expect(await buoc(sai, "sau")).toHaveLength(0);
  });

  it("★ giết worker giữa lúc nhặt node kế sau hạn ⇒ lease hết ⇒ chạy lại ⇒ vẫn ĐÚNG MỘT bước xong", async () => {
    const r = await batDauRun({ flowId: `${TT}-cho`, version: 1, chuLuong: chu, items: [{ json: { i: 7 } }] });
    await chayHet();
    await deHan(r);
    const muc = await nhatMuc("w-chet", 60_000, TT, r);
    expect(muc?.nodeId).toBe("sau");
    await batDauBuoc(muc!); // worker "chết" ngay sau khi ghi bước dang-chay: không bao giờ gọi ketThucBuoc
    expect(await nhatMuc("w-khac", 60_000, TT, r)).toBeNull(); // còn lease
    await db.execute(sql`UPDATE ai_flow_queue SET "leaseUntil" = now() - interval '1 second' WHERE "runId" = ${r}`);
    await chayHet();
    expect((await lay(r)).status).toBe("xong");
    expect((await buoc(r, "sau")).filter((b) => b.status === "xong")).toHaveLength(1);
  });

  it("★ lượt bị huỷ TRONG LÚC CHỜ ⇒ node kế KHÔNG chạy (kể cả khi hết hạn)", async () => {
    const r = await batDauRun({ flowId: `${TT}-cho`, version: 1, chuLuong: chu, items: [{ json: { i: 1 } }] });
    await chayHet();
    await db.execute(sql`UPDATE ai_flow_runs SET status = 'huy', "finishedAt" = now() WHERE id = ${r}`);
    await deHan(r);
    await chayHet();
    expect(await buoc(r, "sau")).toHaveLength(0);
    expect((await lay(r)).status).toBe("huy");
    expect(await hangDoi(r)).toHaveLength(0);
  });

  it("★ trần tuổi lượt 7 ngày: lượt đã 6,5 ngày tuổi + hẹn 24 h ⇒ bước LỖI QUA_TRAN_CHO, lượt loi, node kế không chạy; lượt 1 ngày tuổi + 24 h ⇒ hẹn bình thường", async () => {
    await luuPhienBan(luongCho(`${TT}-cho-ngay`, 86400), chu, null);
    const gia = await batDauRun({ flowId: `${TT}-cho-ngay`, version: 1, chuLuong: chu, items: [{ json: {} }] });
    await db.execute(sql`UPDATE ai_flow_runs SET "startedAt" = now() - interval '6 days 12 hours' WHERE id = ${gia}`);
    await chayHet();
    const [b] = await buoc(gia, "c");
    expect(b.status).toBe("loi");
    expect((b.error as { ma?: string }).ma).toBe("QUA_TRAN_CHO");
    expect((await lay(gia)).status).toBe("loi");
    expect(await buoc(gia, "sau")).toHaveLength(0);
    const tre = await batDauRun({ flowId: `${TT}-cho-ngay`, version: 1, chuLuong: chu, items: [{ json: {} }] });
    await db.execute(sql`UPDATE ai_flow_runs SET "startedAt" = now() - interval '1 day' WHERE id = ${tre}`);
    await chayHet();
    expect((await buoc(tre, "c"))[0].status).toBe("xong");
    expect((await lay(tre)).status).toBe("dang-chay");
  });
});

describe("(B) nguoi.duyet quá hạn — mục kiểm hết hạn", () => {
  const markers = async (r: string) => (await hangDoi(r)).filter((x) => "__kiem-het-han" in x.inputs);

  it("★ chờ có hạn ⇒ ĐÚNG MỘT mục kiểm với availableAt tương lai; hết hạn không ai bấm ⇒ cổng het-han ĐÚNG MỘT lần, lượt xong", async () => {
    const r = await batDauRun({ flowId: `${TT}-duyet`, version: 1, chuLuong: chu, items: [{ json: { i: 1 } }] });
    await chayHet();
    expect((await lay(r)).status).toBe("cho-duyet");
    const m = await markers(r);
    expect(m).toHaveLength(1);
    expect(m[0].tuong_lai).toBe(true);
    await chayHet(); // trước hạn: không làm gì
    expect((await lay(r)).status).toBe("cho-duyet");
    // tới hạn (không ai bấm): đẩy cả hạn của hàng chờ lẫn mục kiểm về quá khứ
    await db.execute(sql`UPDATE ai_flow_waits SET "expiresAt" = now() - interval '1 second' WHERE "runId" = ${r}`);
    await deHan(r);
    await chayHet();
    await chayHet();
    expect((await lay(r)).status).toBe("xong");
    expect((await buoc(r, "hh")).filter((b) => b.status === "xong")).toHaveLength(1);
    expect(await buoc(r, "ok")).toHaveLength(0);
    expect(await buoc(r, "ko")).toHaveLength(0);
    const ev = await db.select().from(aiFlowEvents).where(and(eq(aiFlowEvents.runId, r), eq(aiFlowEvents.kind, "cho.het-han")));
    expect(ev).toHaveLength(1);
    // người bấm muộn: khong-co-cho, không nhân đôi
    expect((await traLoiCho({ runId: r, nodeId: "d", cong: "dong-y" })).ok).toBe(false);
    expect((await buoc(r, "ok"))).toHaveLength(0);
  });

  it("★ trả lời TRƯỚC hạn ⇒ mục kiểm biến mất, lượt đóng ngay (không đợi tới hạn), không nhánh het-han", async () => {
    const r = await batDauRun({ flowId: `${TT}-duyet`, version: 1, chuLuong: chu, items: [{ json: { i: 2 } }] });
    await chayHet();
    expect(await markers(r)).toHaveLength(1);
    expect((await traLoiCho({ runId: r, nodeId: "d", cong: "dong-y" })).ok).toBe(true);
    expect(await markers(r)).toHaveLength(0);
    await chayHet();
    expect((await lay(r)).status).toBe("xong");
    expect(await buoc(r, "hh")).toHaveLength(0);
    expect((await buoc(r, "ok")).filter((b) => b.status === "xong")).toHaveLength(1);
  });

  it("★ mục kiểm tới hạn sau khi chờ ĐÃ được trả lời (mục sót) ⇒ chỉ bỏ mục, không làm gì", async () => {
    const r = await batDauRun({ flowId: `${TT}-duyet`, version: 1, chuLuong: chu, items: [{ json: { i: 3 } }] });
    await chayHet();
    const m = (await markers(r))[0];
    // dựng lại tình huống đua: trả lời xong nhưng mục kiểm còn (chèn lại bằng tay)
    expect((await traLoiCho({ runId: r, nodeId: "d", cong: "tu-choi" })).ok).toBe(true);
    await db.execute(sql`INSERT INTO ai_flow_queue ("runId", "nodeId", lan, inputs, "uuTien", "availableAt") VALUES (${r}, 'd', 1, ${JSON.stringify({ "__kiem-het-han": [] })}::jsonb, 2, now() - interval '1 second')`);
    expect(m).toBeTruthy();
    await chayHet();
    expect(await buoc(r, "hh")).toHaveLength(0);
    expect((await buoc(r, "ko")).filter((b) => b.status === "xong")).toHaveLength(1);
    expect(await hangDoi(r)).toHaveLength(0);
  });

  it("★ giết worker giữa lúc xử lý mục kiểm ⇒ sau lease chạy lại ⇒ het-han vẫn ĐÚNG MỘT lần", async () => {
    const r = await batDauRun({ flowId: `${TT}-duyet`, version: 1, chuLuong: chu, items: [{ json: { i: 4 } }] });
    await chayHet();
    await db.execute(sql`UPDATE ai_flow_waits SET "expiresAt" = now() - interval '1 second' WHERE "runId" = ${r}`);
    await deHan(r);
    const muc = await nhatMuc("w-chet", 60_000, TT, r); // worker nhặt mục kiểm rồi chết, chưa xử lý
    expect(muc?.inputs).toHaveProperty("__kiem-het-han");
    expect(await nhatMuc("w-khac", 60_000, TT, r)).toBeNull();
    await db.execute(sql`UPDATE ai_flow_queue SET "leaseUntil" = now() - interval '1 second' WHERE "runId" = ${r}`);
    await chayHet();
    await chayHet();
    expect((await lay(r)).status).toBe("xong");
    expect((await buoc(r, "hh")).filter((b) => b.status === "xong")).toHaveLength(1);
  });

  it("lượt bị huỷ trong lúc chờ có hạn ⇒ mục kiểm bị xoá cùng hàng đợi (không làm gì sau hạn)", async () => {
    const r = await batDauRun({ flowId: `${TT}-duyet`, version: 1, chuLuong: chu, items: [{ json: { i: 5 } }] });
    await chayHet();
    expect(await markers(r)).toHaveLength(1);
    await db.execute(sql`UPDATE ai_flow_runs SET status = 'huy', "finishedAt" = now() WHERE id = ${r}`);
    await db.execute(sql`UPDATE ai_flow_waits SET "expiresAt" = now() - interval '1 second' WHERE "runId" = ${r}`);
    await deHan(r);
    await chayHet();
    expect(await buoc(r, "hh")).toHaveLength(0);
    expect((await lay(r)).status).toBe("huy");
  });
});

describe("(C) logic.dung-loi trong động cơ", () => {
  it("lượt LỖI với thông điệp đã đánh giá, mã DUNG_LOI, nhánh sau không chạy, không thử lại", async () => {
    const r = await batDauRun({ flowId: `${TT}-loi`, version: 1, chuLuong: chu, items: [{ json: { lyDo: "máy hỏng" } }] });
    await chayHet();
    const run = await lay(r);
    expect(run.status).toBe("loi");
    expect(run.error).toMatchObject({ nodeId: "x", thongDiep: "Dừng vì máy hỏng", ma: "DUNG_LOI" });
    expect(await buoc(r, "sau")).toHaveLength(0);
    expect(await buoc(r, "x")).toHaveLength(1);
  });

  it("khiLoi: nhanh-loi ⇒ lỗi KHÔNG dừng lượt: bước x `loi`, lượt xong (nối cổng loi: xem khiLoi.db.test.ts)", async () => {
    const r = await batDauRun({ flowId: `${TT}-loi-tiep`, version: 1, chuLuong: chu, items: [{ json: {} }] });
    await chayHet();
    expect((await lay(r)).status).toBe("xong");
    const [x] = await buoc(r, "x");
    expect(x.status).toBe("loi");
    expect((x.error as { thongDiep?: string }).thongDiep).toBe("dừng");
  });
});
