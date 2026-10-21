/**
 * ★★★ Đợt 9 (IDOR, đường CHẠY THẬT) — phạm vi dữ liệu của LƯỢT CHẠY theo CHỦ LƯỢT, trên CSDL `_test` với động cơ thật:
 *   • chạy tay ⇒ chủ = người bấm; lượt tự kích hoạt (lịch/webhook/MCP) ⇒ chủ = NGƯỜI BẬT phiên bản (`approvedBy`; dữ liệu cũ ⇒ `createdBy`);
 *     luồng con kế thừa chủ của cha;
 *   • phạm vi tính lại LÚC CHẠY: chủ bị khoá / hạ xuống vai chỉ-đọc / bị xoá sau khi tạo lượt ⇒ node tham chiếu máy TỪ CHỐI;
 *   • không có chủ ⇒ TỪ CHỐI (đóng theo mặc định); ngoài phạm vi và không tồn tại ⇒ cùng một lỗi, nguồn telemetry KHÔNG được gọi;
 *   • `ot.de-xuat-luong`: FOE workflow có bước nhắm máy ngoài phạm vi ⇒ coi như không có;
 *   • BẬT luồng: `may` viết thẳng (số hoặc chuỗi số) ngoài phạm vi người bật ⇒ NOT_FOUND, không bật; biểu thức ⇒ để lúc chạy.
 * Hai nhà máy A/B thật + người dùng thật (FK `chuLuong`).
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlowVersions, aiFlows } from "../../../drizzle/schema";
import { flowRouter } from "../../routers/flowRouter";
import { batDauRun, chayMotMuc, luuPhienBan } from "./dongCo";
import { __datNguonDocTagChoTest } from "./nut/ot";
import { __datPhuThuocCongOtChoTest } from "./ot/congOtLuong";

const RUN = `p9_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const TT = `t9pv${Math.floor(Math.random() * 1e5)}`;
const FAC_A = `P9A_${RUN}`.slice(0, 50);
const FAC_B = `P9B_${RUN}`.slice(0, 50);
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const noi = (a: string, b: string) => ({ from: { node: a, port: "main" }, to: { node: b, port: "main" } });

const ids = { facA: 0, facB: 0, machA: 0, machB: 0 };
const cay: { ws: number[]; ln: number[]; st: number[] } = { ws: [], ln: [], st: [] };
const u = { A: 0, B: 0, khoa: 0, chiDoc: 0, xoa: 0, admin: 0 };
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
let goiNguon: number[] = [];

const luongDoc = (id: string) => ({
  id, name: "đọc tag", version: 1,
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "ot.doc-tag", { may: "{{ $json.may }}", tag: "t1" })],
  connections: [noi("t", "d")],
});

async function mkUser(suffix: string, role: string, active: boolean, factory: string | null): Promise<number> {
  const [r] = (await db.execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
    VALUES (${`${RUN}-${suffix}`}, ${`${RUN}_${suffix}`}, ${`P9 ${suffix}`}, ${"password"}, ${role}, ${active}, false, now()) RETURNING id`)) as unknown as { id: number }[];
  if (factory) await db.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${r.id}, ${factory})`);
  return r.id;
}

beforeAll(async () => {
  db = (await getDb())!;
  const one = async (q: Promise<unknown>) => Number(((await q) as { id: number }[])[0].id);
  ids.facA = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_A}, ${"P9 " + FAC_A}, true) RETURNING id`));
  ids.facB = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_B}, ${"P9 " + FAC_B}, true) RETURNING id`));
  for (const [k, fac, code] of [["A", ids.facA, FAC_A], ["B", ids.facB, FAC_B]] as const) {
    const ws = await one(db.execute(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${fac}, ${code + "_WS"}, ${"ws" + k}) RETURNING id`));
    const ln = await one(db.execute(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ws}, ${code + "_L1"}, ${"line" + k}) RETURNING id`));
    const st = await one(db.execute(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ln}, ${code + "_S1"}, ${"st" + k}) RETURNING id`));
    cay.ws.push(ws);
    cay.ln.push(ln);
    cay.st.push(st);
    const m = await one(db.execute(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${st}, ${code + "_M1"}, ${"mach" + k}, ${"AOI"}, true) RETURNING id`));
    if (k === "A") ids.machA = m;
    else ids.machB = m;
  }
  u.A = await mkUser("a", "engineer", true, FAC_A);
  u.B = await mkUser("b", "engineer", true, FAC_B);
  u.khoa = await mkUser("khoa", "engineer", true, FAC_A);
  u.chiDoc = await mkUser("chidoc", "engineer", true, FAC_A);
  u.xoa = await mkUser("xoa", "engineer", true, FAC_A);
  u.admin = await mkUser("admin", "admin", true, null);
}, 120_000);

afterEach(() => {
  __datNguonDocTagChoTest(null);
  __datPhuThuocCongOtChoTest(null);
});

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  const tat = Object.values(u).filter((x) => x > 0);
  await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql.raw(`(${tat.join(",")})`)}`);
  await db.execute(sql`DELETE FROM users WHERE id IN ${sql.raw(`(${tat.join(",")})`)}`);
  await db.execute(sql`DELETE FROM machines WHERE id IN (${ids.machA}, ${ids.machB})`);
  await db.execute(sql`DELETE FROM stations WHERE id IN ${sql.raw(`(${cay.st.join(",")})`)}`);
  await db.execute(sql`DELETE FROM production_lines WHERE id IN ${sql.raw(`(${cay.ln.join(",")})`)}`);
  await db.execute(sql`DELETE FROM workshops WHERE id IN ${sql.raw(`(${cay.ws.join(",")})`)}`);
  await db.execute(sql`DELETE FROM factories WHERE id IN (${ids.facA}, ${ids.facB})`);
});

const chayHet = async () => {
  for (let i = 0; i < 200 && (await chayMotMuc("w-p9", undefined, TT)); i++);
};
const dungNguon = () => {
  goiNguon = [];
  __datNguonDocTagChoTest(async (y) => {
    goiNguon.push(y.machineId);
    return [{ tagKey: "t1", valueNumeric: 1, valueText: null, quality: "good", timestamp: "2026-01-01T00:00:00Z", unit: null }];
  });
};
const trangThai = async (id: string) => (await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, id)))[0];
const buocD = async (id: string) => (await db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, id), eq(aiFlowSteps.nodeId, "d"))))[0];
const taoLuong = async (ten: string, nguoiLuu: number | null) => {
  const def = luongDoc(`${TT}-${ten}`);
  const { version } = await luuPhienBan(def, nguoiLuu);
  return { def, version };
};

describe("chạy THẬT — phạm vi theo CHỦ LƯỢT (động cơ thật, DB)", () => {
  it("chạy tay: chủ = người bấm — A đọc máy A; máy B và máy không tồn tại ⇒ lượt lỗi CÙNG thông điệp, nguồn telemetry KHÔNG được gọi", async () => {
    dungNguon();
    const { def, version } = await taoLuong("tay", u.admin);
    const ok = await batDauRun({ flowId: def.id, version, chuLuong: u.A, items: [{ json: { may: ids.machA } }] });
    const b = await batDauRun({ flowId: def.id, version, chuLuong: u.A, items: [{ json: { may: ids.machB } }] });
    const mat = await batDauRun({ flowId: def.id, version, chuLuong: u.A, items: [{ json: { may: 2_000_700_001 } }] });
    await chayHet();
    expect((await trangThai(ok)).status).toBe("xong");
    expect((await trangThai(b)).status).toBe("loi");
    expect((await trangThai(mat)).status).toBe("loi");
    expect(JSON.stringify((await buocD(b)).error)).toBe(JSON.stringify((await buocD(mat)).error)); // không lộ tồn tại
    expect(goiNguon).toEqual([ids.machA]);
  });

  it("★ lách bằng kiểu ở đường thật: máy B dạng CHUỖI ⇒ bị từ chối như số; chuỗi dạng lạ ⇒ lỗi hình dạng, không đọc", async () => {
    dungNguon();
    const { def, version } = await taoLuong("kieu", u.admin);
    const chay = (may: unknown) => batDauRun({ flowId: def.id, version, chuLuong: u.A, items: [{ json: { may } }] });
    const runs = [await chay(String(ids.machB)), await chay(` ${ids.machB}`), await chay(`${ids.machB}e0`), await chay([ids.machB]), await chay(null)];
    await chayHet();
    for (const r of runs) expect((await trangThai(r)).status).toBe("loi");
    expect(goiNguon).toEqual([]);
  });

  it("lượt tự kích hoạt: chủ = NGƯỜI BẬT (approvedBy) — thắng createdBy; dữ liệu cũ (không approvedBy) ⇒ createdBy", async () => {
    dungNguon();
    const { def, version } = await taoLuong("bat", u.B); // soạn bởi B
    await db.update(aiFlowVersions).set({ approvedBy: u.A }).where(and(eq(aiFlowVersions.flowId, def.id), eq(aiFlowVersions.version, version))); // bật bởi A
    const a = await batDauRun({ flowId: def.id, version, items: [{ json: { may: ids.machA } }], triggerKind: "lich" });
    const b = await batDauRun({ flowId: def.id, version, items: [{ json: { may: ids.machB } }], triggerKind: "lich" });
    expect((await trangThai(a)).chuLuong).toBe(u.A);
    await chayHet();
    expect((await trangThai(a)).status).toBe("xong");
    expect((await trangThai(b)).status).toBe("loi"); // B soạn nhưng A bật ⇒ phạm vi A
    // dữ liệu cũ: chưa lưu người bật ⇒ createdBy (dự phòng)
    const cu = await taoLuong("cu", u.B);
    const r = await batDauRun({ flowId: cu.def.id, version: cu.version, items: [{ json: { may: ids.machB } }], triggerKind: "webhook" });
    expect((await trangThai(r)).chuLuong).toBe(u.B);
    await chayHet();
    expect((await trangThai(r)).status).toBe("xong");
  });

  it("KHÔNG có chủ (không người bật, không người soạn) ⇒ TỪ CHỐI cả máy hợp lệ — đóng theo mặc định", async () => {
    dungNguon();
    const { def, version } = await taoLuong("khongchu", null);
    const r = await batDauRun({ flowId: def.id, version, items: [{ json: { may: ids.machA } }] });
    expect((await trangThai(r)).chuLuong).toBeNull();
    await chayHet();
    expect((await trangThai(r)).status).toBe("loi");
    expect(JSON.stringify((await buocD(r)).error)).toMatch(/Không xác định được người chạy/);
    expect((await buocD(r)).error).toMatchObject({ ma: "CHU_LUOT_KHONG_XAC_DINH" }); // mã ỔN ĐỊNH cho chú giải UI
    expect(goiNguon).toEqual([]);
  });

  it("phạm vi tính lại LÚC CHẠY: chủ bị khoá / hạ xuống chỉ-đọc / bị xoá SAU khi tạo lượt ⇒ từ chối", async () => {
    dungNguon();
    const { def, version } = await taoLuong("luc", u.admin);
    const mk = (chu: number) => batDauRun({ flowId: def.id, version, chuLuong: chu, items: [{ json: { may: ids.machA } }] });
    const rKhoa = await mk(u.khoa);
    const rChiDoc = await mk(u.chiDoc);
    const rXoa = await mk(u.xoa);
    const rDoiChung = await mk(u.A); // đối chứng: không đụng ⇒ vẫn chạy được
    await db.execute(sql`UPDATE users SET "isActive" = false WHERE id = ${u.khoa}`);
    await db.execute(sql`UPDATE users SET role = 'viewer' WHERE id = ${u.chiDoc}`);
    await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" = ${u.xoa}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${u.xoa}`);
    u.xoa = 0;
    await chayHet();
    expect((await trangThai(rKhoa)).status).toBe("loi");
    expect((await trangThai(rChiDoc)).status).toBe("loi");
    expect((await trangThai(rXoa)).status).toBe("loi"); // FK ON DELETE SET NULL ⇒ chuLuong NULL
    expect((await trangThai(rXoa)).chuLuong).toBeNull();
    expect((await trangThai(rDoiChung)).status).toBe("xong");
    expect(goiNguon).toEqual([ids.machA]);
  });

  it("luồng con kế thừa CHỦ của lượt cha", async () => {
    const { def, version } = await taoLuong("con", u.admin);
    const cha = await batDauRun({ flowId: def.id, version, chuLuong: u.A, items: [{ json: { may: ids.machA } }] });
    const con = await batDauRun({ flowId: def.id, version, parentRunId: cha, items: [{ json: { may: ids.machA } }] });
    expect((await trangThai(con)).chuLuong).toBe(u.A);
  });

  it("ot.de-xuat-luong ở đường thật: FOE workflow có bước nhắm máy NGOÀI phạm vi ⇒ như không có; trong phạm vi ⇒ đề xuất mô phỏng", async () => {
    const wf = (maySt: number) => ({
      ref: "wf", ten: "wf", trangThai: "active",
      definition: { steps: [{ id: "s1", type: "command", command: "pause", machineId: maySt, args: {} }] },
    });
    const def = {
      id: `${TT}-foe`, name: "đề xuất FOE", version: 1,
      nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "ot.de-xuat-luong", { workflowId: "{{ $json.w }}", version: 1 })],
      connections: [noi("t", "d")],
    };
    const { version } = await luuPhienBan(def, u.admin);
    __datPhuThuocCongOtChoTest({ docLuongFoe: async (w) => ({ ref: "wf", ten: "wf", trangThai: wf(0).trangThai, definition: wf(w === 1 ? ids.machA : ids.machB).definition }) });
    const trong = await batDauRun({ flowId: def.id, version, chuLuong: u.A, items: [{ json: { w: 1 } }] });
    const ngoai = await batDauRun({ flowId: def.id, version, chuLuong: u.A, items: [{ json: { w: 2 } }] });
    await chayHet();
    expect((await trangThai(trong)).status).toBe("cho-duyet");
    const b = (await db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, ngoai), eq(aiFlowSteps.nodeId, "d"))))[0];
    expect((await trangThai(ngoai)).status).toBe("loi");
    expect(JSON.stringify(b.error)).toMatch(/không có FOE workflow/);
  });
});

describe("BẬT luồng — kiểm tham chiếu TĨNH so với phạm vi người bật", () => {
  const goi = (id: number, role = "engineer") => flowRouter.createCaller({ user: { id, role } } as never);
  const luongTinh = (id: string, may: unknown) => ({
    id, name: "tĩnh", version: 1,
    nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "ot.doc-tag", { may, tag: "t1" })],
    connections: [noi("t", "d")],
  });

  it("may viết thẳng ngoài phạm vi (số HOẶC chuỗi số) ⇒ NOT_FOUND, luồng KHÔNG bật; trong phạm vi ⇒ bật + ghi người bật", async () => {
    const a = goi(u.A);
    const luu = async (ten: string, may: unknown) => {
      const def = luongTinh(`${TT}-${ten}`, may);
      return { def, ...(await a.luu({ definition: def })) };
    };
    for (const [ten, may] of [["b-so", ids.machB], ["b-chuoi", String(ids.machB)], ["mat", 2_000_700_002]] as const) {
      const { def, version } = await luu(ten, may);
      await expect(a.datPhienBanHoatDong({ flowId: def.id, version, bat: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await db.select().from(aiFlows).where(eq(aiFlows.id, def.id)))[0].enabled).toBe(false);
    }
    const ok = await luu("a-ok", ids.machA);
    await a.datPhienBanHoatDong({ flowId: ok.def.id, version: ok.version, bat: true });
    expect((await db.select().from(aiFlows).where(eq(aiFlows.id, ok.def.id)))[0].enabled).toBe(true);
    const [v] = await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, ok.def.id), eq(aiFlowVersions.version, ok.version)));
    expect(v.approvedBy).toBe(u.A);
    // biểu thức động ⇒ để kiểm lúc chạy (bật được)
    const dong = await luu("dong", "{{ $json.may }}");
    await a.datPhienBanHoatDong({ flowId: dong.def.id, version: dong.version, bat: true });
    expect((await db.select().from(aiFlows).where(eq(aiFlows.id, dong.def.id)))[0].enabled).toBe(true);
  });

  it("admin bật máy của B (toàn quyền) ⇒ được, nhưng máy không tồn tại ⇒ vẫn NOT_FOUND", async () => {
    const ad = goi(u.admin, "admin");
    const b = luongTinh(`${TT}-ad-b`, ids.machB);
    const rb = await ad.luu({ definition: b });
    await ad.datPhienBanHoatDong({ flowId: b.id, version: rb.version, bat: true });
    const mat = luongTinh(`${TT}-ad-mat`, 2_000_700_003);
    const rm = await ad.luu({ definition: mat });
    await expect(ad.datPhienBanHoatDong({ flowId: mat.id, version: rm.version, bat: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
