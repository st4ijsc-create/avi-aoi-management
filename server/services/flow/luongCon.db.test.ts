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
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../drizzle/schema";
import { flowRouter } from "../../routers/flowRouter";
import { batDauBuoc, batDauRun, chayMotMuc, nhatMuc, thucThi, ketThucBuoc, traLoiCho } from "./dongCo";
import { datHamGoiAgent, type HamGoiAgent } from "./nut/agent";

const TT = "t84lc";
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0], parameters });
const noi = (a: string, b: string, pa = "main") => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
const def = (id: string, nodes: unknown[], connections: unknown[]) => ({ id: `${TT}-${id}`, name: id, version: 1, nodes, connections });

let uid = 0;
const goi = (role: string) => flowRouter.createCaller({ user: { id: uid, role } } as never);
const db = async () => (await getDb())!;

beforeAll(async () => {
  const [u] = (await (await db()).execute(sql`SELECT id FROM users ORDER BY id LIMIT 1`)) as unknown as { id: number }[];
  uid = u.id;
});
afterAll(async () => {
  const d = await getDb();
  if (!d) return;
  const runs = await d.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await d.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await d.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
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
  const r = await goi(role).luu({ definition: d });
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

  it("(b) cha `thuan` ĐÃ BẬT; con đổi phiên bản hoạt động sang `ngoai-ghi` ⇒ lượt cha bị TỪ CHỐI lúc chạy, 0 lượt con", async () => {
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
    // Lượt cha (chạy tay của kỹ sư — phiên bản cha đã bật, hạng ghi trên phiên bản vẫn `thuan`).
    const { runId } = await goi("engineer").chayTay({ flowId: cha.id });
    await chayHet();
    const r = await layRun(runId);
    expect(r.status).toBe("loi");
    expect(JSON.stringify(r.error)).toMatch(/từ chối: luồng con .*hạng 'ngoai-ghi' cao hơn hạng 'thuan'/);
    // (c) cùng tấn công qua TOOL agent: model gọi tool ⇒ tool trả TỪ CHỐI, không lượt con nào.
    cuAgent = datHamGoiAgent(async ({ tinNhan }) => {
      const daCoKq = tinNhan.some((m) => m.role === "tool");
      return daCoKq ? { chu: "Không làm được.", toolCalls: [] } : { chu: "", toolCalls: [{ id: "c1", type: "function", function: { name: "lam_viec", arguments: "{}" } }] };
    });
    const { runId: runA } = await goi("engineer").chayTay({ flowId: agent.id });
    await chayHet();
    expect((await layRun(runA)).status).toBe("xong");
    const [kq] = await raCua(runA, "a");
    expect(kq.agent).toEqual({ ketThuc: "hoan-thanh", soLuotTool: 1, tool: [{ ten: "lam_viec", ok: false }] });
    expect(await runCua("con-doi")).toHaveLength(0);
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
