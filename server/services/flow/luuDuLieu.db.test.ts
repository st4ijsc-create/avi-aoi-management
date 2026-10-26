/**
 * ★★★ Lô C (dieu-phoi duyệt): settings.luuDuLieu và settings.timeoutS THI HÀNH THẬT; settings.errorFlowId lưu được nhưng cảnh báo "chưa hỗ trợ" (trên `_test`).
 *   luuDuLieu — day-du giữ; chi-loi gỡ input/output các bước khi lượt KHÔNG `loi`; khong gỡ luôn. Chỉ gỡ lúc ĐÓNG lượt (giữa chừng `$node()` còn dùng được); trạng thái / thời gian / lỗi giữ nguyên;
 *               lượt gọi đồng bộ (agent, mcp) được miễn.
 *   timeoutS  — trần tuổi lượt: mục "kiểm hạn lượt" bền trong hàng đợi (kể cả khi lượt đang chờ duyệt / hẹn giờ) ⇒ tới hạn lượt `loi` QUA_HAN_LUOT; lượt xong sớm ⇒ mục kiểm không giữ lượt mở.
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
import { flowRouter, CANH_BAO_ERROR_FLOW_ID } from "../../routers/flowRouter";
import { batDauRun, chayMotMuc, luuPhienBan, traLoiCho } from "./dongCo";

const TT = `t9ld${Math.floor(Math.random() * 1e5)}`;
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters, ...extra });
const noi = (a: string, b: string, pa = "main") => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
let chu = 0;
const goi = () => flowRouter.createCaller({ user: { id: chu, role: "admin", twoFactorEnabled: true } } as never);
const chayHet = async () => {
  for (let i = 0; i < 200 && (await chayMotMuc("w-ld", undefined, TT)); i++);
};
const lay = async (id: string) => (await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, id)))[0];
const buoc = (r: string) => db.select().from(aiFlowSteps).where(eq(aiFlowSteps.runId, r)).orderBy(aiFlowSteps.id);
const hangDoi = async (r: string) => (await db.execute(sql`SELECT "nodeId", inputs FROM ai_flow_queue WHERE "runId" = ${r}`)) as unknown as { nodeId: string; inputs: Record<string, unknown> }[];

const luong = (id: string, settings: Record<string, unknown>, nodes?: unknown[], connections?: unknown[]) => ({
  id, name: id, version: 1, settings: { uuTien: "background", maxConcurrentRuns: 50, ...settings },
  nodes: nodes ?? [nut("t", "kich-hoat.thu-cong"), nut("a", "du-lieu.dat", { truong: { k: "{{ $json.x }}" } }), nut("b", "du-lieu.dat", { truong: { lai: "{{ $node(\"a\").json.k }}" } })],
  connections: connections ?? [noi("t", "a"), noi("a", "b")],
});

beforeAll(async () => {
  db = (await getDb())!;
  chu = (await taoNguoiDungTest("admin", "admin", { tienTo: "ld", ts: TT })).id;
}, 120_000);

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

describe("settings.luuDuLieu", () => {
  const chay = async (id: string, settings: Record<string, unknown>, triggerKind?: string, nodes?: unknown[], conn?: unknown[]) => {
    await luuPhienBan(luong(id, settings, nodes, conn), chu, null);
    const r = await batDauRun({ flowId: id, version: 1, chuLuong: chu, items: [{ json: { x: 7 } }], ...(triggerKind ? { triggerKind } : {}) });
    await chayHet();
    return r;
  };
  const coDuLieu = async (r: string) => (await buoc(r)).map((b) => b.input !== null || b.output !== null);

  it("day-du (mặc định) giữ input/output; $node() chạy đúng trong lượt", async () => {
    const r = await chay(`${TT}-dd`, { luuDuLieu: "day-du" });
    expect((await lay(r)).status).toBe("xong");
    expect(await coDuLieu(r)).toEqual([true, true, true]);
    expect(((await buoc(r))[2].output as { main: { json: { lai: unknown } }[] }).main[0].json.lai).toBe(7); // $node("a") thấy đầu ra bước trước
  });

  it("★ khong: SAU khi lượt xong, input/output MỌI bước = NULL; trạng thái, thời gian, sự kiện giữ nguyên", async () => {
    const r = await chay(`${TT}-kh`, { luuDuLieu: "khong" });
    expect((await lay(r)).status).toBe("xong");
    const bs = await buoc(r);
    expect(bs.map((b) => [b.input, b.output])).toEqual([[null, null], [null, null], [null, null]]);
    expect(bs.map((b) => b.status)).toEqual(["xong", "xong", "xong"]);
    expect(bs.every((b) => b.finishedAt !== null)).toBe(true);
    expect((await db.select().from(aiFlowEvents).where(eq(aiFlowEvents.runId, r))).map((e) => e.kind)).toContain("run.xong");
  });

  it("★ chi-loi: lượt XONG ⇒ gỡ; lượt LỖI ⇒ GIỮ input/output (để điều tra) cùng lỗi", async () => {
    const ok = await chay(`${TT}-cl-ok`, { luuDuLieu: "chi-loi" });
    expect(await coDuLieu(ok)).toEqual([false, false, false]);
    const nodes = [nut("t", "kich-hoat.thu-cong"), nut("a", "du-lieu.dat", { truong: { k: "{{ $json.x }}" } }), nut("x", "logic.dung-loi", { thongDiep: "hỏng" })];
    const loi = await chay(`${TT}-cl-loi`, { luuDuLieu: "chi-loi" }, undefined, nodes, [noi("t", "a"), noi("a", "x")]);
    expect((await lay(loi)).status).toBe("loi");
    const bs = await buoc(loi);
    expect(bs.map((b) => b.status)).toEqual(["xong", "xong", "loi"]);
    expect(bs.map((b) => b.input !== null)).toEqual([true, true, true]);
    expect((bs[2].error as { thongDiep: string }).thongDiep).toBe("hỏng");
  });

  it("★ chỉ gỡ lúc ĐÓNG: lượt đang chờ duyệt còn đủ dữ liệu; duyệt xong và đóng ⇒ gỡ", async () => {
    const nodes = [nut("t", "kich-hoat.thu-cong"), nut("a", "du-lieu.dat", { truong: { k: 1 } }), nut("d", "nguoi.duyet", { tieuDe: "d" }), nut("z", "du-lieu.dat", { truong: { z: 1 } })];
    const r = await chay(`${TT}-cho`, { luuDuLieu: "khong" }, undefined, nodes, [noi("t", "a"), noi("a", "d"), noi("d", "z", "dong-y")]);
    expect((await lay(r)).status).toBe("cho-duyet");
    expect((await buoc(r)).some((b) => b.output !== null)).toBe(true);
    expect((await traLoiCho({ runId: r, nodeId: "d", cong: "dong-y" })).ok).toBe(true);
    await chayHet();
    expect((await lay(r)).status).toBe("xong");
    expect((await buoc(r)).every((b) => b.input === null && b.output === null)).toBe(true);
  });

  it("★ lượt gọi ĐỒNG BỘ (mcp / agent) được MIỄN: dữ liệu bước giữ để người gọi đọc kết quả", async () => {
    const r = await chay(`${TT}-mcp`, { luuDuLieu: "khong" }, "mcp");
    expect((await lay(r)).status).toBe("xong");
    expect(await coDuLieu(r)).toEqual([true, true, true]);
  });

  it("dongThoiGian báo duLieuDaGo đúng theo cấu hình + trạng thái", async () => {
    const r = await chay(`${TT}-dtg`, { luuDuLieu: "khong" });
    const dt = await goi().dongThoiGian({ runId: r });
    expect(dt).toMatchObject({ luuDuLieu: "khong", duLieuDaGo: true });
    const dd = await chay(`${TT}-dtg2`, { luuDuLieu: "day-du" });
    expect(await goi().dongThoiGian({ runId: dd })).toMatchObject({ luuDuLieu: "day-du", duLieuDaGo: false });
    const m = await chay(`${TT}-dtg3`, { luuDuLieu: "khong" }, "mcp");
    expect(await goi().dongThoiGian({ runId: m })).toMatchObject({ luuDuLieu: "khong", duLieuDaGo: false });
  });
});

describe("settings.timeoutS", () => {
  const cho = (id: string, timeoutS: number, nodes: unknown[], conn: unknown[]) => luuPhienBan(luong(id, { timeoutS }, nodes, conn), chu, null);
  const haiNut = [nut("t", "kich-hoat.thu-cong"), nut("d", "nguoi.duyet", { tieuDe: "d", hetHanGio: 48 }), nut("ok", "du-lieu.dat", { truong: { ok: 1 } })];
  const denHan = (r: string) => db.execute(sql`UPDATE ai_flow_queue SET "availableAt" = now() - interval '1 second' WHERE "runId" = ${r} AND inputs ? '__kiem-han-luot'`);

  it("★ lượt ĐANG CHỜ DUYỆT quá timeoutS ⇒ lượt loi QUA_HAN_LUOT (hàng đợi + hàng chờ dọn sạch); trước hạn thì không đụng", async () => {
    await cho(`${TT}-th1`, 3600, haiNut, [noi("t", "d"), noi("d", "ok", "dong-y")]);
    const r = await batDauRun({ flowId: `${TT}-th1`, version: 1, chuLuong: chu });
    await chayHet();
    expect((await lay(r)).status).toBe("cho-duyet");
    expect((await hangDoi(r)).filter((x) => "__kiem-han-luot" in x.inputs)).toHaveLength(1);
    await chayHet(); // chưa tới hạn: không làm gì
    expect((await lay(r)).status).toBe("cho-duyet");
    await denHan(r);
    await chayHet();
    const run = await lay(r);
    expect(run.status).toBe("loi");
    expect(run.error).toMatchObject({ ma: "QUA_HAN_LUOT" });
    expect((run.error as { thongDiep: string }).thongDiep).toContain("3600");
    expect(await hangDoi(r)).toHaveLength(0);
    const [w] = (await db.execute(sql`SELECT count(*)::int AS n FROM ai_flow_waits WHERE "runId" = ${r}`)) as unknown as { n: number }[];
    expect(w.n).toBe(0);
    expect((await traLoiCho({ runId: r, nodeId: "d", cong: "dong-y" })).ok).toBe(false); // trả lời muộn bị từ chối
  });

  it("★ lượt ĐANG HẸN GIỜ (logic.cho) dài hơn timeoutS ⇒ loi QUA_HAN_LUOT; node kế không chạy", async () => {
    const nodes = [nut("t", "kich-hoat.thu-cong"), nut("c", "logic.cho", { giay: 3600 }), nut("sau", "du-lieu.dat", { truong: { sau: 1 } })];
    await cho(`${TT}-th2`, 60, nodes, [noi("t", "c"), noi("c", "sau")]);
    const r = await batDauRun({ flowId: `${TT}-th2`, version: 1, chuLuong: chu });
    await chayHet();
    expect((await lay(r)).status).toBe("dang-chay");
    await denHan(r);
    await chayHet();
    expect((await lay(r)).status).toBe("loi");
    expect((await lay(r)).error).toMatchObject({ ma: "QUA_HAN_LUOT" });
    expect((await buoc(r)).some((b) => b.nodeId === "sau")).toBe(false);
  });

  it("★ lượt xong SỚM: mục kiểm hạn lượt KHÔNG giữ lượt mở và được gỡ; timeoutS cao hơn thời gian thật ⇒ không ảnh hưởng", async () => {
    await cho(`${TT}-th3`, 3600, [nut("t", "kich-hoat.thu-cong"), nut("a", "du-lieu.dat", { truong: { a: 1 } })], [noi("t", "a")]);
    const r = await batDauRun({ flowId: `${TT}-th3`, version: 1, chuLuong: chu });
    await chayHet();
    expect((await lay(r)).status).toBe("xong");
    expect(await hangDoi(r)).toHaveLength(0);
  });

  it("không đặt timeoutS ⇒ không có mục kiểm hạn lượt", async () => {
    await luuPhienBan(luong(`${TT}-th4`, {}, haiNut, [noi("t", "d"), noi("d", "ok", "dong-y")]), chu, null);
    const r = await batDauRun({ flowId: `${TT}-th4`, version: 1, chuLuong: chu });
    await chayHet();
    expect((await hangDoi(r)).filter((x) => "__kiem-han-luot" in x.inputs)).toHaveLength(0);
  });

  it("timeoutS vượt trần 7 ngày bị schema từ chối lúc lưu", async () => {
    await expect(luuPhienBan(luong(`${TT}-th5`, { timeoutS: 7 * 24 * 3600 + 1 }), chu, null)).rejects.toThrow();
  });
});

describe("settings.errorFlowId — chưa hỗ trợ", () => {
  it("★ lưu có errorFlowId ⇒ vẫn lưu được (giữ để nhập/xuất không vỡ) + canhBao nói thẳng; không có ⇒ canhBao rỗng; luồng lỗi KHÔNG được gọi", async () => {
    const id = `${TT}-ef`;
    const nodes = [nut("t", "kich-hoat.thu-cong"), nut("x", "logic.dung-loi", { thongDiep: "hỏng" })];
    const kq = await goi().luu({ definition: luong(id, { errorFlowId: `${TT}-luong-loi` }, nodes, [noi("t", "x")]) });
    expect(kq.canhBao).toEqual([CANH_BAO_ERROR_FLOW_ID]);
    const khong = await goi().luu({ definition: luong(`${TT}-ef2`, {}, nodes, [noi("t", "x")]) });
    expect(khong.canhBao).toEqual([]);
    const r = await batDauRun({ flowId: id, version: kq.version, chuLuong: chu });
    await chayHet();
    expect((await lay(r)).status).toBe("loi");
    expect((await db.select().from(aiFlowRuns).where(and(eq(aiFlowRuns.flowId, `${TT}-luong-loi`)))).length).toBe(0);
  });
});
