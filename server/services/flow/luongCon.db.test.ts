/**
 * ★★ Luồng AI Đợt 8.4 — LUỒNG CON + AGENT trên CSDL `_test` (router thật qua `createCaller`, model GIẢ):
 *   1. `luong.goi-con`: cha CHỜ BỀN ⇒ con chạy ⇒ cha đi tiếp với đầu ra node cuối của con; con chờ duyệt ⇒ cha vẫn chờ ⇒ duyệt
 *      con ⇒ cha xong; con lỗi ⇒ cha lỗi; chạy lại bước chờ KHÔNG tạo con thứ hai.
 *   2. BỘ TẤN CÔNG HẠNG (0 lọt): (a) lưu cha gọi con `ngoai-ghi` ⇒ cha thành `ngoai-ghi` ⇒ kỹ sư không bật / không chạy tay;
 *      (b) cha `thuan` đã bật, con đổi phiên bản hoạt động sang `ngoai-ghi` ⇒ CHẠY bị từ chối, 0 lượt con; (c) cùng tấn công
 *      qua tool `ai.agent` ⇒ tool trả TỪ CHỐI, 0 lượt con; (d) id con là biểu thức / tự gọi ⇒ không lưu được; (e) agent khai
 *      tool `ngoai-ghi` ⇒ cha `ngoai-ghi`.
 *   3. `ai.agent`: tool luồng con chạy đồng bộ, kết quả là DỮ LIỆU quay lại model; chữ "gọi tool" trong nội dung KHÔNG chạy gì;
 *      tool lạ / tham số sai kiểu ⇒ quan sát lỗi; trần lượt.
 */
import { vi, beforeAll } from "vitest";
import { donLuongTheoTienTo, donNhaMayVaNguoiTheoMa } from "./__donDuLieuTest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../drizzle/schema";
import { flowRouter } from "../../routers/flowRouter";
import { batDauBuoc, batDauRun, chayMotMuc, nhatMuc, thucThi, ketThucBuoc, traLoiCho } from "./dongCo";
import { BO_KIEM_CHO_QUA, __datBoKiemChuLuongChoTest } from "./boKiemPhamVi";
import { datHamGoiAgent, type HamGoiAgent } from "./nut/agent";

const TT = "t84lc";
beforeAll(async () => {
  // Dọn dữ liệu SÓT của lượt trước bị ngắt (afterAll không chạy) — xem flow/__donDuLieuTest.ts
  await donLuongTheoTienTo(TT);
  await donNhaMayVaNguoiTheoMa(TT + "F", TT + "-nd-");
});
// Lưới này kiểm luồng con / agent qua động cơ, KHÔNG phải phạm vi ⇒ cho-qua-hết; phạm vi thật: flowPhamViLuong.db.test.ts
beforeAll(() => __datBoKiemChuLuongChoTest(async () => BO_KIEM_CHO_QUA));
afterAll(() => __datBoKiemChuLuongChoTest(null));
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0], parameters });
const noi = (a: string, b: string, pa = "main") => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
const def = (id: string, nodes: unknown[], connections: unknown[]) => ({ id: `${TT}-${id}`, name: id, version: 1, nodes, connections });

let uid = 0;
let fidLc = 0;
const goi = (role: string) => flowRouter.createCaller({ user: { id: uid, role } } as never);
const db = async () => (await getDb())!;

beforeAll(async () => {
  const [uMoi] = (await (await db()).execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
    VALUES (${TT + "-nd-" + Date.now().toString(36)}, ${TT + "_nd_" + Date.now().toString(36)}, ${"người gọi"}, ${"password"}, ${"engineer"}, true, false, now()) RETURNING id`)) as unknown as { id: number }[];
  uid = uMoi.id;
  // Đợt 9 — luồng có phạm vi nhà máy: người gọi (vai engineer) thuộc ĐÚNG MỘT nhà máy của test ⇒ luồng mới tự gán nhà máy ấy.
  const d0 = await db();
  const [fa] = (await d0.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${TT + "F"}, ${"T84 F"}, true) RETURNING id`)) as unknown as { id: number }[];
  fidLc = fa.id;
  await d0.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid}, ${TT + "F"})`);
});
afterAll(async () => {
  const d = await getDb();
  if (!d) return;
  const runs = await d.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await d.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await d.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await d.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" = ${uid} AND "factoryCode" = ${TT + "F"}`);
  await d.execute(sql`DELETE FROM factories WHERE id = ${fidLc}`);
  await d.execute(sql`DELETE FROM users WHERE id = ${uid}`);
});
let cuAgent: HamGoiAgent | null = null;
afterEach(() => {
  if (cuAgent) datHamGoiAgent(cuAgent);
  cuAgent = null;
});

async function chayHet() {
  for (let i = 0; i < 300 && (await chayMotMuc("w-lc", undefined, TT)); i++);
}
const layRun = async (id: string) => (await (await db()).select().from(aiFlowRuns).where(eq(aiFlowRuns.id, id)))[0];
const runCua = async (flowSuffix: string) => (await db()).select().from(aiFlowRuns).where(eq(aiFlowRuns.flowId, `${TT}-${flowSuffix}`));
async function raCua(runId: string, nodeId: string): Promise<Record<string, unknown>[]> {
  const b = (await (await db()).select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, runId), eq(aiFlowSteps.nodeId, nodeId)))).find((x) => x.status === "xong");
  return ((b?.output as { main?: { json: Record<string, unknown> }[] } | null)?.main ?? []).map((i) => i.json);
}
/** Lưu + đặt phiên bản hoạt động (bật) bằng vai cho trước. */
async function luuVaBat(d: ReturnType<typeof def>, role = "engineer") {
  // admin tạo luồng mặc định NULL (toàn hệ thống — kỹ sư không dùng được); luồng con dùng chung phải thuộc nhà máy của kỹ sư.
  const r = await goi(role).luu({ definition: d, factoryId: role === "admin" ? fidLc : undefined });
  await goi(role).datPhienBanHoatDong({ flowId: d.id, version: r.version, bat: true });
  return r;
}

// Luồng con dùng chung
const CON_NHAN_DOI = def("con-x2", [nut("vao", "kich-hoat.thu-cong"), nut("tinh", "du-lieu.dat", { truong: { ketQua: "{{ $json.x * 2 }}" } })], [noi("vao", "tinh")]);
const CON_GHI = def("con-ghi", [nut("vao", "kich-hoat.thu-cong"), nut("gui", "tich-hop.http-gui", { url: "https://khong-duoc-phep.invalid/x", phuongThuc: "POST" })], [noi("vao", "gui")]);

describe("luong.goi-con — chờ bền (DB)", () => {
  it("cha chờ ⇒ con chạy ⇒ cha đi tiếp với đầu ra node cuối của con; lượt con mang parentRunId", async () => {
    await luuVaBat(CON_NHAN_DOI);
    const cha = def("cha-1", [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: `${TT}-con-x2` }), nut("sau", "du-lieu.dat", { truong: { sau: true } })], [noi("t", "g"), noi("g", "sau")]);
    const { version, hang } = await goi("engineer").luu({ definition: cha });
    expect(hang).toBe("thuan");
    const runId = await batDauRun({ flowId: cha.id, version, items: [{ json: { x: 21 } }, { json: { x: 5 } }] });
    await chayHet();
    expect((await layRun(runId)).status).toBe("xong");
    expect(await raCua(runId, "sau")).toEqual([{ x: 21, ketQua: 42, sau: true }, { x: 5, ketQua: 10, sau: true }]);
    const con = await runCua("con-x2");
    expect(con).toHaveLength(1);
    expect(con[0]).toMatchObject({ parentRunId: runId, status: "xong", triggerKind: "luong-con" });
  });

  it("con dừng chờ DUYỆT ⇒ cha vẫn chờ (không xong sớm); duyệt con ⇒ cha xong; chạy lại bước chờ KHÔNG tạo con thứ hai", async () => {
    const conDuyet = def("con-duyet", [nut("vao", "kich-hoat.thu-cong"), nut("d", "nguoi.duyet", { tieuDe: "duyệt con" }), nut("ok", "du-lieu.dat", { truong: { daDuyet: true } })], [noi("vao", "d"), noi("d", "ok", "dong-y")]);
    await luuVaBat(conDuyet);
    const cha = def("cha-2", [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: conDuyet.id })], [noi("t", "g")]);
    const { version } = await goi("engineer").luu({ definition: cha });
    const runId = await batDauRun({ flowId: cha.id, version, items: [{ json: { a: 1 } }] });
    await chayHet();
    expect((await layRun(runId)).status).toBe("cho-duyet");
    const [con] = await runCua("con-duyet");
    expect(con.status).toBe("cho-duyet");
    // Kẻ gian thử "duyệt" hàng chờ luồng-con của CHA qua API duyệt ⇒ không phải hàng chờ duyệt.
    await expect(goi("engineer").duyet({ runId, nodeId: "g", dongY: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Mô phỏng sập + chạy lại bước `g` của cha (idempotent): hàng chờ đã có ⇒ không tạo con thứ hai.
    const d = await db();
    await d.execute(sql`INSERT INTO ai_flow_queue ("runId", "nodeId", lan, inputs) VALUES (${runId}, 'g', 1, ${JSON.stringify({ main: [{ json: { a: 1 } }] })}::jsonb)`);
    const muc = await nhatMuc("w-lc", undefined, TT);
    expect(muc?.nodeId).toBe("g");
    const bd = await batDauBuoc(muc!);
    if (bd.tiep) await ketThucBuoc(muc!, bd.def, bd.lanThu, { ok: true, ra: await thucThi(bd.def, bd.ngu) });
    expect(await runCua("con-duyet")).toHaveLength(1);
    expect(await traLoiCho({ runId: con.id, nodeId: "d", cong: "dong-y" })).toEqual({ ok: true, cong: "dong-y" });
    await chayHet();
    expect((await layRun(con.id)).status).toBe("xong");
    expect((await layRun(runId)).status).toBe("xong");
    expect(await raCua(runId, "g")).toEqual([{ a: 1, daDuyet: true }]);
  });

  it("cha LỖI ở nhánh khác trong lúc chờ con ⇒ lượt con đang chạy bị HUỶ theo (không mồ côi)", async () => {
    const conCho = def("con-cho", [nut("vao", "kich-hoat.thu-cong"), nut("d", "nguoi.duyet", { tieuDe: "chờ" })], [noi("vao", "d")]);
    await luuVaBat(conCho);
    const cha = def("cha-huy", [
      nut("t", "kich-hoat.thu-cong"),
      nut("g", "luong.goi-con", { flowId: conCho.id }),
      nut("hong", "tich-hop.http-doc", { url: "https://khong-duoc-phep.invalid/" }),
    ], [noi("t", "g"), noi("t", "hong")]);
    const { version, hang } = await goi("engineer").luu({ definition: cha });
    expect(hang).toBe("doc");
    const runId = await batDauRun({ flowId: cha.id, version });
    await chayHet();
    expect((await layRun(runId)).status).toBe("loi");
    const [con] = await runCua("con-cho");
    expect(con).toMatchObject({ parentRunId: runId, status: "huy" });
    const [w] = (await (await db()).execute(sql`SELECT count(*)::int AS n FROM ai_flow_waits WHERE "runId" IN (${runId}, ${con.id})`)) as unknown as { n: number }[];
    expect(w.n).toBe(0);
  });

  it("con LỖI ⇒ bước cha lỗi ⇒ lượt cha `loi` có lý do", async () => {
    const conLoi = def("con-loi", [nut("vao", "kich-hoat.thu-cong"), nut("doc", "tich-hop.http-doc", { url: "https://khong-duoc-phep.invalid/" })], [noi("vao", "doc")]);
    await luuVaBat(conLoi);
    const cha = def("cha-3", [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: conLoi.id })], [noi("t", "g")]);
    const { version, hang } = await goi("engineer").luu({ definition: cha });
    expect(hang).toBe("doc");
    const runId = await batDauRun({ flowId: cha.id, version });
    await chayHet();
    const r = await layRun(runId);
    expect(r.status).toBe("loi");
    expect(JSON.stringify(r.error)).toMatch(/luồng con .*con-loi.* lỗi/);
  });
});

describe("BỘ TẤN CÔNG HẠNG — luồng hạng thấp gọi hạng cao (0 lọt)", () => {
  it("(a) lưu cha gọi con `ngoai-ghi` ⇒ cha `ngoai-ghi` ⇒ kỹ sư KHÔNG bật, KHÔNG chạy tay; admin được", async () => {
    await luuVaBat(CON_GHI, "admin");
    const cha = def("cha-a", [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: CON_GHI.id })], [noi("t", "g")]);
    const r = await goi("engineer").luu({ definition: cha });
    expect(r.hang).toBe("ngoai-ghi");
    await expect(goi("engineer").datPhienBanHoatDong({ flowId: cha.id, version: r.version, bat: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(goi("engineer").chayTay({ flowId: cha.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await runCua("cha-a")).toHaveLength(0);
  });

  it("(b) cha `thuan` ĐÃ BẬT; con đổi phiên bản hoạt động sang `ngoai-ghi` ⇒ cha VẪN chạy đúng bản đã GHIM (H1); định nghĩa cha bị can thiệp trỏ bản `ngoai-ghi` ⇒ TỪ CHỐI lúc chạy, 0 lượt con", async () => {
    const con = def("con-doi", [nut("vao", "kich-hoat.thu-cong"), nut("x", "du-lieu.dat", { truong: { y: 1 } })], [noi("vao", "x")]);
    await luuVaBat(con);
    const cha = def("cha-b", [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: con.id })], [noi("t", "g")]);
    const rc = await luuVaBat(cha);
    expect(rc.hang).toBe("thuan");
    const agent = def("cha-b-agent", [nut("t", "kich-hoat.thu-cong"), nut("a", "ai.agent", { loiNhac: "làm việc", luongCon: [{ flowId: con.id, ten: "lam_viec" }] })], [noi("t", "a")]);
    const ra = await luuVaBat(agent);
    expect(ra.hang).toBe("thuan");
    // Đổi con: phiên bản mới hạng `ngoai-ghi`, admin đặt hoạt động.
    const con2 = { ...con, nodes: [nut("vao", "kich-hoat.thu-cong"), nut("gui", "tich-hop.http-gui", { url: "https://khong-duoc-phep.invalid/x", phuongThuc: "POST" })], connections: [noi("vao", "gui")] };
    await luuVaBat(con2, "admin");
    // H1: cha đã GHIM con@1 lúc lưu ⇒ bật con@2 (ngoai-ghi) KHÔNG đổi cha: lượt cha chạy con ĐÚNG bản 1 và xong.
    const { runId: runGhim } = await goi("engineer").chayTay({ flowId: cha.id });
    await chayHet();
    expect((await layRun(runGhim)).status).toBe("xong");
    expect((await runCua("con-doi")).filter((x) => x.parentRunId === runGhim).map((x) => x.version)).toEqual([1]);
    // Lớp phòng thủ thứ hai: ai đó sửa THẲNG định nghĩa cha (bỏ qua `luu`) để trỏ bản `ngoai-ghi` mà hạng cha vẫn `thuan` ⇒ TỪ CHỐI lúc chạy.
    // (động cơ nhớ định nghĩa theo flowId@version ⇒ chèn MỘT PHIÊN BẢN MỚI do kẻ gian dựng thẳng trong CSDL, hạng ghi vẫn `thuan`, rồi bật nó)
    const bang = await (await db()).execute(sql`INSERT INTO ai_flow_versions ("flowId", version, definition, "riskClass") SELECT "flowId", version + 100, jsonb_set(definition, '{nodes,1,parameters,version}', '2'::jsonb), 'thuan' FROM ai_flow_versions WHERE "flowId" = ${cha.id} AND version = ${rc.version} RETURNING version`) as unknown as { version: number }[];
    await (await db()).execute(sql`UPDATE ai_flows SET "activeVersion" = ${bang[0].version}, enabled = true WHERE id = ${cha.id}`);
    const { runId } = await goi("engineer").chayTay({ flowId: cha.id });
    await chayHet();
    const r = await layRun(runId);
    expect(r.status).toBe("loi");
    expect(JSON.stringify(r.error)).toMatch(/từ chối: luồng con .*hạng 'ngoai-ghi' cao hơn hạng 'thuan'/);
    expect((await runCua("con-doi")).filter((x) => x.parentRunId === runId)).toHaveLength(0);
    // (c) cùng tấn công qua TOOL agent: model gọi tool ⇒ agent đã ghim bản 1 ⇒ chạy bản 1 (không bị bản ngoai-ghi mới ảnh hưởng).
    cuAgent = datHamGoiAgent(async ({ tinNhan }) => {
      const daCoKq = tinNhan.some((m) => m.role === "tool");
      return daCoKq ? { chu: "Không làm được.", toolCalls: [] } : { chu: "", toolCalls: [{ id: "c1", type: "function", function: { name: "lam_viec", arguments: "{}" } }] };
    });
    const { runId: runA } = await goi("engineer").chayTay({ flowId: agent.id });
    await chayHet();
    expect((await layRun(runA)).status).toBe("xong");
    const [kq] = await raCua(runA, "a");
    expect(kq.agent).toEqual({ ketThuc: "hoan-thanh", soLuotTool: 1, tool: [{ ten: "lam_viec", ok: true }] });
    expect((await runCua("con-doi")).filter((x) => x.parentRunId === runA).map((x) => x.version)).toEqual([1]);
    // Lưu LẠI cha ⇒ hạng tính lại ⇒ `ngoai-ghi` ⇒ kỹ sư không bật được nữa.
    const moi = await goi("engineer").luu({ definition: cha });
    expect(moi.hang).toBe("ngoai-ghi");
    await expect(goi("engineer").datPhienBanHoatDong({ flowId: cha.id, version: moi.version, bat: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("(d) id luồng con là biểu thức / tự gọi / luồng chưa bật ⇒ KHÔNG lưu được", async () => {
    const bt = def("cha-d", [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: "{{ $json.f }}" })], [noi("t", "g")]);
    await expect(goi("engineer").luu({ definition: bt })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/CỐ ĐỊNH/) });
    const tu = def("cha-d2", [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: `${TT}-cha-d2` })], [noi("t", "g")]);
    await expect(goi("engineer").luu({ definition: tu })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/chính nó/) });
    const ag = def("cha-d3", [nut("t", "kich-hoat.thu-cong"), nut("a", "ai.agent", { luongCon: [{ flowId: `${TT}-khong-ton-tai` }] })], [noi("t", "a")]);
    await expect(goi("engineer").luu({ definition: ag })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/chưa có phiên bản hoạt động/) });
  });

  it("(e) agent khai tool là luồng `ngoai-ghi` ⇒ hạng agent = `ngoai-ghi` ⇒ kỹ sư không bật", async () => {
    const ag = def("cha-e", [nut("t", "kich-hoat.thu-cong"), nut("a", "ai.agent", { luongCon: [{ flowId: `${TT}-con-x2` }, { flowId: CON_GHI.id }] })], [noi("t", "a")]);
    const r = await goi("engineer").luu({ definition: ag });
    expect(r.hang).toBe("ngoai-ghi");
    await expect(goi("engineer").datPhienBanHoatDong({ flowId: ag.id, version: r.version, bat: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("H1 — GHIM PHIÊN BẢN LUỒNG CON (audit 2026-10-21): bật bản mới của con KHÔNG đổi cha đã duyệt", () => {
  const conV = (id: string, truong: Record<string, unknown>) => def(id, [nut("vao", "kich-hoat.thu-cong"), nut("tinh", "du-lieu.dat", { truong })], [noi("vao", "tinh")]);
  const chaGhi = (id: string, conId: string, extra: Record<string, unknown> = {}) =>
    def(id, [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: conId, ...extra }), nut("gui", "tich-hop.http-gui", { url: "https://khong-duoc-phep.invalid/x", phuongThuc: "POST", than: "{{ $json.ketQua }}" })], [noi("t", "g"), noi("g", "gui")]);

  it("★ KỊCH BẢN AUDIT: admin duyệt cha `ngoai-ghi`; operator lưu + bật phiên bản MỚI của con (thuần) ⇒ lượt cha vẫn chạy con@1, 0 lượt con@2", async () => {
    await luuVaBat(conV("h1-con", { ketQua: "bản-1" }));
    const cha = chaGhi("h1-cha", `${TT}-h1-con`);
    // Đợt 9: luồng có phạm vi nhà máy — admin gán cha vào nhà máy của test (NULL ⇒ chỉ admin thấy, kịch bản không còn dựng được).
    const rc = await goi("admin").luu({ definition: cha, factoryId: fidLc });
    expect(rc.hang).toBe("ngoai-ghi");
    await goi("admin").datPhienBanHoatDong({ flowId: cha.id, version: rc.version, bat: true });
    // kẻ tấn công (operator — ghiProcedure, KHÔNG admin) đổi đầu ra của con và bật nó (hạng thuần ⇒ không đòi admin)
    const v2 = await luuVaBat(conV("h1-con", { ketQua: "BẢN-KẺ-GIAN" }), "operator");
    expect(v2.version).toBe(2);
    // L3: chạy tay hạng ≥ ngoai-ghi chỉ admin — lượt cha do admin (hoặc lịch) kích hoạt; kẻ tấn công chỉ đổi CON.
    const { runId } = await goi("admin").chayTay({ flowId: cha.id });
    await chayHet();
    const conRuns = (await runCua("h1-con")).filter((x) => x.parentRunId === runId);
    expect(conRuns.map((x) => x.version)).toEqual([1]); // trước bản vá: [2]
    const [bc] = await raCua(conRuns[0].id, "tinh");
    expect(bc.ketQua).toBe("bản-1");
  });

  it("lúc LƯU máy chủ GHIM `version` = phiên bản hoạt động hiện tại của con (cả goi-con lẫn từng luongCon[] của agent); bản đã ghim sẵn được giữ", async () => {
    await luuVaBat(conV("h1-ghim", { a: 1 }));
    await luuVaBat(conV("h1-ghim", { a: 2 })); // hoạt động = 2
    const cha = def("h1-ghim-cha", [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: `${TT}-h1-ghim` }), nut("a", "ai.agent", { luongCon: [{ flowId: `${TT}-h1-ghim`, ten: "x" }, { flowId: `${TT}-h1-ghim`, ten: "y", version: 1 }] })], [noi("t", "g"), noi("t", "a")]);
    const r = await goi("engineer").luu({ definition: cha });
    const ct = await goi("engineer").chiTiet({ flowId: cha.id, version: r.version });
    const nodes = (ct.definition as { nodes: { id: string; parameters: Record<string, unknown> }[] }).nodes;
    expect(nodes.find((n) => n.id === "g")!.parameters.version).toBe(2);
    expect((nodes.find((n) => n.id === "a")!.parameters.luongCon as { version?: number }[]).map((x) => x.version)).toEqual([2, 1]);
  });

  it("hạng cha tính trên bản ghim: ghim bản thuần của con (con hiện là ngoai-ghi) ⇒ cha thuần; không ghim ⇒ ngoai-ghi", async () => {
    await luuVaBat(conV("h1-hang", { a: 1 }));
    await luuVaBat({ ...CON_GHI, id: `${TT}-h1-hang`, name: "h1-hang" }, "admin"); // bản 2 hạng ngoai-ghi, đang hoạt động
    const ghim1 = def("h1-hang-cha1", [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: `${TT}-h1-hang`, version: 1 })], [noi("t", "g")]);
    expect((await goi("engineer").luu({ definition: ghim1 })).hang).toBe("thuan");
    const khongGhim = def("h1-hang-cha2", [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: `${TT}-h1-hang` })], [noi("t", "g")]);
    expect((await goi("engineer").luu({ definition: khongGhim })).hang).toBe("ngoai-ghi");
  });

  it("ghim vào bản KHÔNG tồn tại / sai kiểu ⇒ không lưu được", async () => {
    await luuVaBat(conV("h1-sai", { a: 1 }));
    const bad = (p: Record<string, unknown>) => def("h1-sai-cha", [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: `${TT}-h1-sai`, ...p })], [noi("t", "g")]);
    await expect(goi("engineer").luu({ definition: bad({ version: 9 }) })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/@9 không tồn tại/) });
    await expect(goi("engineer").luu({ definition: bad({ version: "1" }) })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/version phải là số nguyên/) });
  });

  it("KILL SWITCH: con đang TẮT ⇒ cha gọi con bị từ chối, 0 lượt con (goi-con và tool agent)", async () => {
    const con = conV("h1-tat", { a: 1 });
    const rc = await luuVaBat(con);
    const cha = def("h1-tat-cha", [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: con.id })], [noi("t", "g")]);
    const r = await luuVaBat(cha);
    await goi("engineer").datPhienBanHoatDong({ flowId: con.id, version: rc.version, bat: false }); // tắt con
    const { runId } = await goi("engineer").chayTay({ flowId: cha.id, version: r.version });
    await chayHet();
    const run = await layRun(runId);
    expect(run.status).toBe("loi");
    expect(JSON.stringify(run.error)).toMatch(/đang TẮT \(kill switch\)/);
    expect((await runCua("h1-tat")).filter((x) => x.parentRunId === runId)).toHaveLength(0);
  });

  it("định nghĩa CŨ không có `version` ⇒ lúc chạy TỪ CHỐI kèm lý do 'cần lưu lại để ghim' — KHÔNG fallback im lặng", async () => {
    const con = conV("h1-cu", { a: 1 });
    await luuVaBat(con);
    const cha = def("h1-cu-cha", [nut("t", "kich-hoat.thu-cong"), nut("g", "luong.goi-con", { flowId: con.id })], [noi("t", "g")]);
    const r = await luuVaBat(cha);
    // mô phỏng định nghĩa lưu TRƯỚC bản vá: bỏ `version` khỏi tham số node
    await (await db()).execute(sql`UPDATE ai_flow_versions SET definition = definition #- '{nodes,1,parameters,version}' WHERE "flowId" = ${cha.id} AND version = ${r.version}`);
    const { runId } = await goi("engineer").chayTay({ flowId: cha.id, version: r.version });
    await chayHet();
    const run = await layRun(runId);
    expect(run.status).toBe("loi");
    expect(JSON.stringify(run.error)).toMatch(/chưa được GHIM phiên bản.*LƯU LẠI/);
    expect((await runCua("h1-cu")).filter((x) => x.parentRunId === runId)).toHaveLength(0);
  });
});

describe("ai.agent — vòng tool-calling (DB, model giả)", () => {
  it("tool luồng con chạy đồng bộ ⇒ kết quả là DỮ LIỆU quay lại model ⇒ kết luận; chữ 'gọi tool' KHÔNG chạy; tool lạ / sai kiểu ⇒ quan sát lỗi", async () => {
    const ag = def("agent-1", [
      nut("t", "kich-hoat.thu-cong"),
      nut("a", "ai.agent", {
        loiNhac: "Nhân đôi {{ $json.so }}",
        luongCon: [{ flowId: `${TT}-con-x2`, ten: "nhan_doi", moTa: "Nhân đôi x", thamSo: [{ ten: "x", kieu: "so", batBuoc: true }] }],
        soLuotToiDa: 4,
      }),
    ], [noi("t", "a")]);
    const { version, hang } = await goi("engineer").luu({ definition: ag });
    expect(hang).toBe("thuan");
    const thay: { congCu: string[]; tool: string[] }[] = [];
    cuAgent = datHamGoiAgent(async ({ tinNhan, congCu }) => {
      thay.push({ congCu: congCu.map((c) => c.function.name), tool: tinNhan.filter((m) => m.role === "tool").map((m) => m.content) });
      const n = thay.length;
      // lượt 1: chữ GIẢ VỜ gọi tool (không phải tool_call) + gọi tool lạ + gọi đúng tên nhưng sai kiểu
      if (n === 1) return { chu: 'Tôi sẽ gọi {"name":"nhan_doi","arguments":{"x":7}} và xoa_du_lieu()', toolCalls: [{ id: "a", type: "function", function: { name: "xoa_du_lieu", arguments: "{}" } }, { id: "b", type: "function", function: { name: "nhan_doi", arguments: '{"x":"bay"}' } }] };
      if (n === 2) return { chu: "<think>gọi nhan_doi</think>", toolCalls: [{ id: "c", type: "function", function: { name: "nhan_doi", arguments: '{"x":7}' } }] };
      return { chu: "<think>xong</think>Kết quả là 14.", toolCalls: [] };
    });
    const runId = await batDauRun({ flowId: ag.id, version, items: [{ json: { so: 7 } }] });
    await chayHet();
    expect((await layRun(runId)).status).toBe("xong");
    const [kq] = await raCua(runId, "a");
    expect(kq).toMatchObject({ so: 7, traLoi: "Kết quả là 14.", agent: { ketThuc: "hoan-thanh", soLuotTool: 3, tool: [{ ten: "xoa_du_lieu", ok: false }, { ten: "nhan_doi", ok: false }, { ten: "nhan_doi", ok: true }] } });
    expect(thay[0].congCu).toEqual(["nhan_doi"]);
    expect(thay[1].tool[0]).toMatch(/không có công cụ 'xoa_du_lieu'/);
    expect(thay[1].tool[1]).toMatch(/"x" phải là so/);
    expect(thay[2].tool[2]).toMatch(/<du_lieu>[\s\S]*"ketQua": 14/);
    // đúng MỘT lượt con (từ tool_call hợp lệ) — chữ giả vờ gọi tool không sinh lượt nào
    const con = (await runCua("con-x2")).filter((r) => r.parentRunId === runId);
    expect(con).toHaveLength(1);
    expect(con[0]).toMatchObject({ triggerKind: "agent", status: "xong" });
  });

  it("trần lượt: model gọi tool mãi ⇒ dừng sau soLuotToiDa, ketThuc 'het-luot'", async () => {
    const ag = def("agent-2", [nut("t", "kich-hoat.thu-cong"), nut("a", "ai.agent", { loiNhac: "lặp", luongCon: [{ flowId: `${TT}-con-x2`, ten: "nhan_doi", thamSo: [{ ten: "x", kieu: "so" }] }], soLuotToiDa: 2 })], [noi("t", "a")]);
    const { version } = await goi("engineer").luu({ definition: ag });
    let n = 0;
    cuAgent = datHamGoiAgent(async () => {
      n++;
      return { chu: "", toolCalls: [{ id: `k${n}`, type: "function", function: { name: "nhan_doi", arguments: '{"x":1}' } }] };
    });
    const runId = await batDauRun({ flowId: ag.id, version });
    await chayHet();
    const [kq] = await raCua(runId, "a");
    expect(n).toBe(2);
    expect(kq.agent).toMatchObject({ ketThuc: "het-luot", soLuotTool: 2 });
  });
});
