/**
 * ★★ Luồng AI Đợt 8.4 — LUỒNG THÀNH TOOL MCP (spec §4.10) trên CSDL `_test`, qua ĐÚNG khung JSON-RPC của `mcpServer.ts`:
 *   • luồng BẬT, có `kich-hoat.mcp`, hạng `thuan` ⇒ có trong `tools/list` (tên = id luồng, mô tả + lược đồ từ tham số node);
 *     `tools/call` ⇒ chạy đồng bộ ⇒ JSON đầu ra node cuối; tham số sai kiểu ⇒ lỗi, KHÔNG có lượt nào;
 *   • hạng `ngoai-ghi` (admin đã bật) / luồng TẮT / node MCP tắt ⇒ KHÔNG công bố, gọi theo tên ⇒ "Không có tool";
 *   • không danh tính ⇒ `tools/list` chỉ sổ tĩnh, `tools/call` luồng ⇒ từ chối (fail-closed như mọi tool MCP).
 * Danh tính MCP được GIẢ ở `xacThucCli` (bcrypt/khoá tài khoản thật có lưới riêng ở aiCodingCli).
 */
import { vi } from "vitest";
const dtGia = vi.hoisted(() => ({ ok: true }));
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
vi.mock("../../aiCodingCli/danhTinhCli", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../aiCodingCli/danhTinhCli")>();
  return {
    ...goc,
    xacThucCli: async () => (dtGia.ok ? { ok: true, danhTinh: { userId: 1, role: "engineer", ten: "mcp-thu" } } : { ok: false, ma: "THIEU_BIEN", loi: "thiếu biến" }),
  };
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiFlowRuns, aiFlows } from "../../../../drizzle/schema";
import { flowRouter } from "../../../routers/flowRouter";
import { SO_TOOL_MCP, xoaDanhTinhNho, xuLyGoi } from "../../aiCodingCli/mcpServer";
import { toolCuaPhienBan } from "./mcp";

const TT = "t84mcp";
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0], parameters, ...extra });
const noi = (a: string, b: string) => ({ from: { node: a, port: "main" }, to: { node: b, port: "main" } });
let uid = 0;
const goi = (role: string) => flowRouter.createCaller({ user: { id: uid, role } } as never);

const MCP_THAM_SO = { moTa: "Tra số lỗi của một máy AOI theo mã máy", thamSo: [{ ten: "maMay", kieu: "chuoi", batBuoc: true, moTa: "mã máy" }, { ten: "soGio", kieu: "so" }] };
const THUAN = { id: `${TT}-tra-loi`, name: "Tra lỗi", version: 1, nodes: [nut("vao", "kich-hoat.mcp", MCP_THAM_SO), nut("kq", "du-lieu.dat", { truong: { traLoi: "{{ 'Máy ' + $json.maMay + ': 0 lỗi' }}" } })], connections: [noi("vao", "kq")] };
const GHI = { id: `${TT}-ghi`, name: "Ghi", version: 1, nodes: [nut("vao", "kich-hoat.mcp", MCP_THAM_SO), nut("gui", "tich-hop.http-gui", { url: "https://khong-duoc-phep.invalid/", phuongThuc: "POST" })], connections: [noi("vao", "gui")] };
const TAT = { ...THUAN, id: `${TT}-tat` };
const NUT_TAT = { ...THUAN, id: `${TT}-nut-tat`, nodes: [nut("vao", "kich-hoat.mcp", MCP_THAM_SO, { disabled: true }), nut("tc", "kich-hoat.thu-cong")], connections: [] };

beforeAll(async () => {
  const [u] = (await (await getDb())!.execute(sql`SELECT id FROM users ORDER BY id LIMIT 1`)) as unknown as { id: number }[];
  uid = u.id;
  for (const [d, role, bat] of [[THUAN, "engineer", true], [GHI, "admin", true], [TAT, "engineer", false], [NUT_TAT, "engineer", true]] as const) {
    const r = await goi(role).luu({ definition: d });
    await goi(role).datPhienBanHoatDong({ flowId: d.id, version: r.version, bat });
  }
});
afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

type KqList = { result: { tools: { name: string; description: string; inputSchema: { type: string; properties: Record<string, { type: string }>; required: string[] } }[] } };
type KqCall = { result: { content: { text: string }[]; isError: boolean } };
const list = async () => ((await xuLyGoi({ id: 1, method: "tools/list" })) as unknown as KqList).result.tools;
const call = async (name: string, args: Record<string, unknown>) => ((await xuLyGoi({ id: 2, method: "tools/call", params: { name, arguments: args } })) as unknown as KqCall).result;
const soLuot = async (flowId: string) => (await (await getDb())!.select().from(aiFlowRuns).where(eq(aiFlowRuns.flowId, flowId))).length;

describe("MCP — luồng thành tool (DB)", () => {
  it("tools/list: sổ tĩnh + luồng thuần đang bật; KHÔNG có hạng ngoai-ghi / luồng tắt / node MCP tắt", async () => {
    dtGia.ok = true;
    xoaDanhTinhNho();
    const ds = await list();
    const ten = ds.map((t) => t.name);
    for (const m of SO_TOOL_MCP) expect(ten).toContain(m.ten);
    const t = ds.find((x) => x.name === THUAN.id)!;
    expect(t.description).toMatch(/^Tra số lỗi của một máy AOI/);
    expect(t.inputSchema).toMatchObject({ type: "object", properties: { maMay: { type: "string" }, soGio: { type: "number" } }, required: ["maMay"] });
    expect(ten).not.toContain(GHI.id);
    expect(ten).not.toContain(TAT.id);
    expect(ten).not.toContain(NUT_TAT.id);
  });

  it("tools/call: chạy luồng ⇒ đầu ra node cuối; tham số sai kiểu ⇒ lỗi, 0 lượt; luồng ngoai-ghi ⇒ 'Không có tool', 0 lượt", async () => {
    dtGia.ok = true;
    xoaDanhTinhNho();
    const r = await call(THUAN.id, { maMay: "AOI-07" });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content[0].text).items).toEqual([{ maMay: "AOI-07", traLoi: "Máy AOI-07: 0 lỗi" }]);
    const truoc = await soLuot(THUAN.id);
    const sai = await call(THUAN.id, { maMay: 7 });
    expect(sai.isError).toBe(true);
    expect(sai.content[0].text).toMatch(/"maMay" phải là chuoi/);
    expect(await soLuot(THUAN.id)).toBe(truoc);
    const ghi = await call(GHI.id, { maMay: "AOI-07" });
    expect(ghi).toMatchObject({ isError: true, content: [{ text: `Không có tool "${GHI.id}".` }] });
    expect(await soLuot(GHI.id)).toBe(0);
  });

  it("không danh tính ⇒ chỉ sổ tĩnh; gọi luồng ⇒ từ chối, 0 lượt", async () => {
    dtGia.ok = false;
    xoaDanhTinhNho();
    const ds = await list();
    expect(ds.map((t) => t.name)).toEqual(SO_TOOL_MCP.map((m) => m.ten));
    const truoc = await soLuot(THUAN.id);
    const r = await call(THUAN.id, { maMay: "AOI-07" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Chưa xác định được danh tính/);
    expect(await soLuot(THUAN.id)).toBe(truoc);
    dtGia.ok = true;
    xoaDanhTinhNho();
  });

  it("toolCuaPhienBan (thuần): hạng ot/ngoai-ghi, tắt, id `avi_*` ⇒ null; doc ⇒ công bố", () => {
    const d = THUAN as never;
    expect(toolCuaPhienBan(d, 1, "thuan", true)?.name).toBe(THUAN.id);
    expect(toolCuaPhienBan(d, 1, "doc", true)).not.toBeNull();
    expect(toolCuaPhienBan(d, 1, "ngoai-ghi", true)).toBeNull();
    expect(toolCuaPhienBan(d, 1, "ot", true)).toBeNull();
    expect(toolCuaPhienBan(d, 1, "thuan", false)).toBeNull();
    expect(toolCuaPhienBan({ ...THUAN, id: "avi_read_file" } as never, 1, "thuan", true)).toBeNull();
  });
});
