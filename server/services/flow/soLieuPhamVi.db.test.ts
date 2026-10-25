/**
 * ★★★ Lô Luồng-1 (2026-10-25) — node `du-lieu.so-lieu` + `tich-hop.thong-bao` trên CSDL `_test` với ĐỘNG CƠ THẬT:
 *   (a) số trong kết quả khớp truy vấn trực tiếp; (b) phạm vi = CHỦ LƯỢT lúc chạy ∩ nhà máy của luồng — 0 hàng nhà máy B lọt vào luồng của A;
 *   chủ bị khoá / mất gán nhà máy / không có chủ ⇒ lượt LỖI (không chạy với quyền cũ); danh mục có tên: truy vấn lạ / biểu thức / tham số ngoài khoảng ⇒ lỗi, không ghi gì;
 *   thông báo: người nhận phải thấy nhà máy của luồng, MỘT người sai ⇒ không gửi cho ai.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { createProductModel } from "../../db";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import { qChuTest } from "../../testing/__haiNhaMayDoLuong";
import { dangKyModelSanPhamTest } from "../../testing/modelSanPhamTest";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../drizzle/schema";
import { batDauRun, chayMotMuc, luuPhienBan } from "./dongCo";
import { __datHamGuiThongBaoChoTest } from "./nut/thongBao";
import { datHamGoiAi, type HamGoiAi } from "./nut/ai";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RUN = `sl_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const TT = `t1sl${Math.floor(Math.random() * 1e5)}`;
const FAC_A = `SLA_${RUN}`.slice(0, 50);
const FAC_B = `SLB_${RUN}`.slice(0, 50);
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const noi = (a: string, b: string) => ({ from: { node: a, port: "main" }, to: { node: b, port: "main" } });

const ids = { facA: 0, facB: 0, machA: 0, machB: 0, pm: 0 };
const cay: { ws: number[]; ln: number[]; st: number[] } = { ws: [], ln: [], st: [] };
const u = { A: 0, B: 0, nhieu: 0, admin: 0, khoa: 0, mat: 0, nhanA: 0, nhanB: 0, nhanAdmin: 0, nhanKhoa: 0 };
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
const gui: number[] = [];
const FL = { A: `${TT}-A`, B: `${TT}-B`, G: `${TT}-G`, TB_A: `${TT}-tbA`, TB_G: `${TT}-tbG` };

async function mkUser(suffix: string, role: string, factories: string[]): Promise<number> {
  const r = await taoNguoiDungTest(suffix, role as "admin", { tienTo: "sl", ten: `SL ${suffix}`, ts: RUN });
  for (const f of factories) await db.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${r.id}, ${f})`);
  return r.id;
}

const luongSo = (id: string, truyVan: string, extra: Record<string, unknown> = {}) => ({
  id, name: "so lieu", version: 1, settings: { maxConcurrentRuns: 100 },
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("s", "du-lieu.so-lieu", { truyVan, gio: 24, ...extra })],
  connections: [noi("t", "s")],
});
const luongThongBao = (id: string) => ({
  id, name: "thong bao", version: 1, settings: { maxConcurrentRuns: 100 },
  nodes: [
    nut("t", "kich-hoat.thu-cong"),
    nut("s", "du-lieu.so-lieu", { truyVan: "san-luong.tong-quan", gio: 24 }),
    nut("n", "tich-hop.thong-bao", { nguoiNhan: "{{ $json.nguoiNhan }}", tieuDe: "Báo cáo ca", noiDung: "NG = {{ $json.soLieu.tong.ng }}" }),
  ],
  connections: [noi("t", "s"), noi("s", "n")],
});

beforeAll(async () => {
  db = (await getDb())!;
  const one = async (q: Promise<unknown>) => Number(((await q) as { id: number }[])[0].id);
  ids.pm = dangKyModelSanPhamTest(await createProductModel({ code: `${RUN}-PM`, name: RUN } as never));
  ids.facA = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_A}, ${"SL " + FAC_A}, true) RETURNING id`));
  ids.facB = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_B}, ${"SL " + FAC_B}, true) RETURNING id`));
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
    // A: 3 lần kiểm (2 NG, 1 OK); B: 5 lần (4 NG, 1 OK)
    const kq = k === "A" ? ["NG", "NG", "OK"] : ["NG", "NG", "NG", "NG", "OK"];
    for (let i = 0; i < kq.length; i++) {
      await db.execute(sql`INSERT INTO product_inspections ("machineId", "productModelId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "factoryCode")
        VALUES (${m}, ${ids.pm}, ${`${RUN}-${k}-${i}`}, ${kq[i]}::overallresultenum, ${kq[i] === "NG" ? "NG" : "OK"}::originalresultenum, now(), ${code})`);
    }
    await db.execute(sql`INSERT INTO oee_metrics ("machineId", "machineCode", "timestamp", availability, performance, quality, oee, "plannedTime", "runTime", "idealCycleTime", "totalCount", "goodCount", "rejectCount")
      VALUES (${m}, ${code + "_M1"}, now(), 9000, 9000, 9000, ${k === "A" ? 7290 : 4000}, 480, 400, 10, 100, 90, 10)`);
    const nAl = k === "A" ? 1 : 2;
    for (let i = 0; i < nAl; i++) {
      await db.execute(sql`INSERT INTO predictive_alerts ("alertType", title, description, "machineId", "machineCode") VALUES ('PATTERN_ANOMALY', ${`${RUN}-pa-${k}-${i}`}, 'x', ${m}, ${code + "_M1"})`);
    }
  }
  await db.execute(sql`UPDATE machines SET "operationStatus" = 'error' WHERE id = ${ids.machB}`);
  u.A = await mkUser("a", "engineer", [FAC_A]);
  u.B = await mkUser("b", "engineer", [FAC_B]);
  u.nhieu = await mkUser("nhieu", "engineer", [FAC_A, FAC_B]);
  u.admin = await mkUser("admin", "admin", []);
  u.khoa = await mkUser("khoa", "engineer", [FAC_A]);
  u.mat = await mkUser("mat", "engineer", [FAC_A]);
  u.nhanA = await mkUser("nhana", "supervisor", [FAC_A]);
  u.nhanB = await mkUser("nhanb", "supervisor", [FAC_B]);
  u.nhanAdmin = await mkUser("nhanadmin", "admin", []);
  u.nhanKhoa = await mkUser("nhankhoa", "supervisor", [FAC_A]);
  await db.execute(sql`UPDATE users SET "isActive" = false WHERE id = ${u.nhanKhoa}`);
  // luồng: A (nhà máy A) · B (nhà máy B) · G (toàn hệ thống) — mỗi luồng một truy vấn khác nhau ở các ca; ở đây dựng nhiều luồng theo (luồng × truy vấn) khi cần
  await luuPhienBan(luongSo(FL.A, "san-luong.tong-quan"), u.admin, ids.facA);
  await luuPhienBan(luongSo(FL.B, "san-luong.tong-quan"), u.admin, ids.facB);
  await luuPhienBan(luongSo(FL.G, "san-luong.tong-quan"), u.admin, null);
  await luuPhienBan(luongThongBao(FL.TB_A), u.admin, ids.facA);
  await luuPhienBan(luongThongBao(FL.TB_G), u.admin, null);
}, 180_000);

afterEach(() => {
  __datHamGuiThongBaoChoTest(null);
});

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await db.execute(sql`DELETE FROM predictive_alerts WHERE title LIKE ${`${RUN}-pa-%`}`);
  await db.execute(sql`DELETE FROM oee_metrics WHERE "machineId" IN (${ids.machA}, ${ids.machB})`);
  await qChuTest(`DELETE FROM product_inspections WHERE "serialNumber" LIKE '${RUN}-%'`).catch(() => undefined);
  await db.execute(sql`DELETE FROM machines WHERE id IN (${ids.machA}, ${ids.machB})`);
  await db.execute(sql`DELETE FROM stations WHERE id IN ${sql.raw(`(${cay.st.join(",")})`)}`);
  await db.execute(sql`DELETE FROM production_lines WHERE id IN ${sql.raw(`(${cay.ln.join(",")})`)}`);
  await db.execute(sql`DELETE FROM workshops WHERE id IN ${sql.raw(`(${cay.ws.join(",")})`)}`);
  await db.execute(sql`DELETE FROM factories WHERE id IN (${ids.facA}, ${ids.facB})`);
});

const chayHet = async () => {
  for (let i = 0; i < 200 && (await chayMotMuc("w-sl", undefined, TT)); i++);
};
const trangThai = async (id: string) => (await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, id)))[0];
const buoc = async (id: string, nodeId: string) => (await db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, id), eq(aiFlowSteps.nodeId, nodeId))))[0];
/** Chạy một luồng với chủ `chu` và trả `{ status, soLieu, loi }`. */
async function chay(flowId: string, chu: number | null, items: Array<{ json: Record<string, unknown> }> = [{ json: {} }]) {
  const v = (await db.execute(sql`SELECT max(version)::int AS v FROM ai_flow_versions WHERE "flowId" = ${flowId}`)) as unknown as { v: number }[];
  const r = await batDauRun({ flowId, version: v[0].v, chuLuong: chu, items });
  await chayHet();
  const st = await trangThai(r);
  const s = await buoc(r, "s");
  const out = (s?.output as { main?: Array<{ json: { soLieu?: { tong: Record<string, number>; dong: Array<Record<string, unknown>>; soMay: number } } }> } | null)?.main?.[0]?.json?.soLieu;
  return { id: r, status: st.status, soLieu: out, loi: s?.error as { ma?: string; message?: string } | null | undefined, buocN: await buoc(r, "n") };
}
const taoVaChay = async (ten: string, truyVan: string, chu: number | null, extra: Record<string, unknown> = {}, nhaMay: number | null = ids.facA) => {
  const id = `${TT}-${ten}`;
  await luuPhienBan(luongSo(id, truyVan, extra), u.admin, nhaMay);
  return chay(id, chu);
};

describe("(a)(b) số liệu khớp truy vấn trực tiếp · phạm vi = chủ lượt ∩ nhà máy luồng", () => {
  it("san-luong.tong-quan: luồng A / chủ A thấy 3 lần kiểm (2 NG); luồng B / chủ B thấy 5 (4 NG) — khớp COUNT trực tiếp", async () => {
    const [ta] = (await db.execute(sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE "overallResult"='NG')::int AS ng FROM product_inspections WHERE "machineId" = ${ids.machA}`)) as unknown as { n: number; ng: number }[];
    const a = await chay(FL.A, u.A);
    expect(a.status).toBe("xong");
    expect(a.soLieu?.tong).toMatchObject({ tong: ta.n, ng: ta.ng, ok: 1 });
    expect(a.soLieu?.tong.tong).toBe(3);
    const b = await chay(FL.B, u.B);
    expect(b.soLieu?.tong).toMatchObject({ tong: 5, ng: 4 });
  });

  it("★ 0 hàng nhà máy B lọt vào luồng của A: chủ NHIỀU nhà máy (A+B) chạy luồng A ⇒ chỉ A; luồng B ⇒ chỉ B; luồng toàn hệ thống ⇒ phạm vi của chủ (8)", async () => {
    expect((await chay(FL.A, u.nhieu)).soLieu?.tong.tong).toBe(3);
    expect((await chay(FL.B, u.nhieu)).soLieu?.tong.tong).toBe(5);
    expect((await chay(FL.G, u.nhieu)).soLieu?.tong.tong).toBe(8);
    expect((await chay(FL.G, u.A)).soLieu?.tong.tong).toBe(3); // luồng toàn hệ thống nhưng chủ chỉ thuộc A
  });

  it("chủ A chạy luồng gắn nhà máy B ⇒ LỖI phạm vi rỗng (không có máy nào của B trong phạm vi A)", async () => {
    const r = await chay(FL.B, u.A);
    expect(r.status).toBe("loi");
    expect(r.loi?.ma).toBe("PHAM_VI_RONG");
    expect(r.soLieu).toBeUndefined();
  });

  it("admin: luồng A ⇒ chỉ nhà máy A (3); luồng toàn hệ thống ⇒ thấy cả hai (≥ 8)", async () => {
    expect((await chay(FL.A, u.admin)).soLieu?.tong.tong).toBe(3);
    expect((await chay(FL.G, u.admin)).soLieu?.tong.tong).toBeGreaterThanOrEqual(8);
  });

  it("các truy vấn khác trong danh mục cũng chỉ trong phạm vi: oee (chỉ máy A), máy (1 máy, không lỗi), cảnh báo (1)", async () => {
    const oee = await taoVaChay("oee", "oee.trung-binh", u.A);
    expect(JSON.stringify(oee.soLieu)).toContain(`${FAC_A}_M1`);
    expect(JSON.stringify(oee.soLieu)).not.toContain(`${FAC_B}_M1`);
    expect(oee.soLieu?.dong[0]).toMatchObject({ oee: 72.9 });
    const may = await taoVaChay("may", "may.trang-thai", u.nhieu);
    expect(may.soLieu?.tong.tongSoMay).toBe(1);
    expect(may.soLieu?.dong).toEqual([]); // máy lỗi duy nhất là máy B
    const mayB = await taoVaChay("mayb", "may.trang-thai", u.nhieu, {}, ids.facB);
    expect(mayB.soLieu?.dong).toEqual([{ ma: `${FAC_B}_M1`, ten: "machB" }].map((x) => ({ ma: x.ma, ten: "machB" })));
    const al = await taoVaChay("al", "canh-bao.dang-mo", u.nhieu);
    expect(al.soLieu?.tong.tongMo).toBe(1);
    const alB = await taoVaChay("alb", "canh-bao.dang-mo", u.nhieu, {}, ids.facB);
    expect(alB.soLieu?.tong.tongMo).toBe(2);
  });
});

describe("(c) chủ mất quyền LÚC CHẠY ⇒ lượt lỗi, không chạy với quyền cũ", () => {
  it("chủ bị khoá sau khi tạo lượt ⇒ CHU_LUOT_KHONG_XAC_DINH; chủ mất gán nhà máy ⇒ PHAM_VI_RONG; không chủ ⇒ lỗi", async () => {
    const v = (await db.execute(sql`SELECT max(version)::int AS v FROM ai_flow_versions WHERE "flowId" = ${FL.A}`)) as unknown as { v: number }[];
    const rKhoa = await batDauRun({ flowId: FL.A, version: v[0].v, chuLuong: u.khoa, items: [{ json: {} }] });
    const rMat = await batDauRun({ flowId: FL.A, version: v[0].v, chuLuong: u.mat, items: [{ json: {} }] });
    const rDoiChung = await batDauRun({ flowId: FL.A, version: v[0].v, chuLuong: u.A, items: [{ json: {} }] });
    await db.execute(sql`UPDATE users SET "isActive" = false WHERE id = ${u.khoa}`);
    await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" = ${u.mat}`);
    await chayHet();
    expect((await trangThai(rDoiChung)).status).toBe("xong");
    expect((await trangThai(rKhoa)).status).toBe("loi");
    expect(((await buoc(rKhoa, "s")).error as { ma?: string }).ma).toBe("CHU_LUOT_KHONG_XAC_DINH");
    expect((await trangThai(rMat)).status).toBe("loi");
    expect(((await buoc(rMat, "s")).error as { ma?: string }).ma).toBe("PHAM_VI_RONG");
    const khongChu = await chay(FL.A, null);
    expect(khongChu.status).toBe("loi");
    expect(khongChu.loi?.ma).toBe("CHU_LUOT_KHONG_XAC_DINH");
  });
});

describe("danh mục có tên: không SQL tự do, không ghép chuỗi", () => {
  it("truy vấn lạ / mồi tiêm / __proto__ / biểu thức / tham số ngoài khoảng ⇒ lượt lỗi, 0 dữ liệu, CSDL nguyên vẹn", async () => {
    const truoc = Number(((await db.execute(sql`SELECT count(*)::int AS n FROM machines WHERE id IN (${ids.machA}, ${ids.machB})`)) as unknown as { n: number }[])[0].n);
    const caSai: Array<[string, string, Record<string, unknown>, string]> = [
      ["la", "khong-co-trong-danh-muc", {}, "TRUY_VAN_LA"],
      ["tiem", "san-luong.tong-quan'; DROP TABLE machines; --", {}, "TRUY_VAN_LA"],
      ["proto", "__proto__", {}, "TRUY_VAN_LA"],
      ["bieuthuc", "{{ $json.q }}", {}, "THAM_SO_SAI"],
      ["gio", "san-luong.tong-quan", { gio: 9999 }, "THAM_SO_SAI"],
      ["gioChuoi", "san-luong.tong-quan", { gio: "1; DROP TABLE machines" }, "THAM_SO_SAI"],
      ["gioiHan", "ng.diem-do-hang-dau", { gioiHan: 500 }, "THAM_SO_SAI"],
    ];
    for (const [ten, tv, extra, ma] of caSai) {
      const r = await taoVaChay(`sai-${ten}`, tv, u.A, extra);
      expect(r.status, ten).toBe("loi");
      expect(r.loi?.ma, ten).toBe(ma);
      expect(r.soLieu, ten).toBeUndefined();
    }
    const sau = Number(((await db.execute(sql`SELECT count(*)::int AS n FROM machines WHERE id IN (${ids.machA}, ${ids.machB})`)) as unknown as { n: number }[])[0].n);
    expect(sau).toBe(truoc);
  });
});

describe("tich-hop.thong-bao — chỉ kênh nội bộ, người nhận trong phạm vi nhà máy của luồng", () => {
  const dung = () => {
    gui.length = 0;
    __datHamGuiThongBaoChoTest(async (userId) => {
      gui.push(userId);
      return { id: 1 };
    });
  };

  it("luồng A: người nhận thuộc A (và admin toàn quyền) ⇒ gửi; nội dung mang đúng số của A", async () => {
    dung();
    const r = await chay(FL.TB_A, u.A, [{ json: { nguoiNhan: [u.nhanA, u.nhanAdmin] } }]);
    expect(r.status).toBe("xong");
    expect(gui.sort()).toEqual([u.nhanA, u.nhanAdmin].sort());
    expect(((r.buocN.output as { main: Array<{ json: { thongBao: { daGui: number } } }> }).main[0].json.thongBao.daGui)).toBe(2);
  });

  it("★ MỘT người nhận chỉ thuộc nhà máy B ⇒ lượt LỖI và KHÔNG gửi cho ai (kể cả người hợp lệ đứng trước)", async () => {
    dung();
    const r = await chay(FL.TB_A, u.A, [{ json: { nguoiNhan: [u.nhanA, u.nhanB] } }]);
    expect(r.status).toBe("loi");
    expect((r.buocN.error as { ma?: string }).ma).toBe("NGUOI_NHAN_NGOAI_PHAM_VI");
    expect(gui).toEqual([]);
  });

  it("người nhận bị khoá / không tồn tại ⇒ lỗi, không gửi; luồng toàn hệ thống: chỉ người nhận TOÀN QUYỀN", async () => {
    dung();
    expect((await chay(FL.TB_A, u.A, [{ json: { nguoiNhan: [u.nhanKhoa] } }])).status).toBe("loi");
    expect((await chay(FL.TB_A, u.A, [{ json: { nguoiNhan: [2_000_000_001] } }])).status).toBe("loi");
    expect((await chay(FL.TB_G, u.admin, [{ json: { nguoiNhan: [u.nhanA] } }])).status).toBe("loi"); // A không toàn quyền, luồng toàn hệ thống
    expect(gui).toEqual([]);
    const ok = await chay(FL.TB_G, u.admin, [{ json: { nguoiNhan: [u.nhanAdmin] } }]);
    expect(ok.status).toBe("xong");
    expect(gui).toEqual([u.nhanAdmin]);
  });

  it("tham số sai (mảng rỗng, quá 20, kiểu lạ) ⇒ lỗi; atMostOnce: bước thông báo không bao giờ chạy hai lần", async () => {
    dung();
    for (const nguoiNhan of [[], Array.from({ length: 21 }, (_, i) => i + 1), ["abc"], "1"]) {
      expect((await chay(FL.TB_A, u.A, [{ json: { nguoiNhan } }])).status).toBe("loi");
    }
    expect(gui).toEqual([]);
    const r = await chay(FL.TB_A, u.A, [{ json: { nguoiNhan: [u.nhanA] } }]);
    expect(gui).toEqual([u.nhanA]);
    const buocs = await db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, r.id), eq(aiFlowSteps.nodeId, "n")));
    expect(buocs.length).toBe(1);
  });
});

describe("lô Luồng-2 (N1/N2 của kiem-dinh) — phạm vi MÁY của người nhận · trần tổng thông báo mỗi lượt", () => {
  const dung = () => {
    gui.length = 0;
    __datHamGuiThongBaoChoTest(async (userId) => {
      gui.push(userId);
      return { id: 1 };
    });
  };

  it("★ N1: số liệu của lượt có MÁY ngoài phạm vi máy của người nhận ⇒ cả lô bị từ chối; người nhận thấy đủ máy (toàn quyền) vẫn nhận. (Phạm vi hiện chỉ mịn tới nhà máy ⇒ giả lập máy B vào nhật ký lượt của luồng A)", async () => {
    dung();
    const id = TT + "-n1";
    await luuPhienBan(luongThongBao(id), u.admin, ids.facA);
    const v = (await db.execute(sql`SELECT max(version)::int AS v FROM ai_flow_versions WHERE "flowId" = ${id}`)) as unknown as { v: number }[];
    const mk = async (nguoiNhan: number[]) => {
      const r = await batDauRun({ flowId: id, version: v[0].v, chuLuong: u.A, items: [{ json: { nguoiNhan } }] });
      await db.execute(sql`INSERT INTO ai_flow_events ("runId", kind, payload) VALUES (${r}, ${"so-lieu.may-doc"}, ${JSON.stringify({ nodeId: "gia", may: [ids.machB] })}::jsonb)`);
      await chayHet();
      return { st: (await trangThai(r)).status, loi: (await buoc(r, "n"))?.error as { ma?: string } | null };
    };
    const sai = await mk([u.nhanA]);
    expect(sai.st).toBe("loi");
    expect(sai.loi?.ma).toBe("NGUOI_NHAN_NGOAI_PHAM_VI");
    expect(gui).toEqual([]);
    expect((await mk([u.nhanA, u.nhanAdmin])).st).toBe("loi"); // một người thiếu máy ⇒ không ai nhận
    expect(gui).toEqual([]);
    // đối chứng: không có máy lạ trong nhật ký ⇒ người nhận thuộc A nhận bình thường
    const ok = await chay(id, u.A, [{ json: { nguoiNhan: [u.nhanA] } }]);
    expect(ok.status).toBe("xong");
    expect(gui).toEqual([u.nhanA]);
  });

  it("★ N2: trần 50 thông báo mỗi lượt-node — 25 item × 2 người = 50 gửi đủ; 26 item × 2 = 52 ⇒ LỖI QUA_TRAN_THONG_BAO, không gửi gì", async () => {
    dung();
    const item = { json: { nguoiNhan: [u.nhanA, u.nhanAdmin] } };
    const du = await chay(FL.TB_A, u.A, Array.from({ length: 25 }, () => item));
    expect(du.status).toBe("xong");
    expect(gui.length).toBe(50);
    dung();
    const vuot = await chay(FL.TB_A, u.A, Array.from({ length: 26 }, () => item));
    expect(vuot.status).toBe("loi");
    expect((vuot.buocN.error as { ma?: string }).ma).toBe("QUA_TRAN_THONG_BAO");
    expect(gui).toEqual([]);
  });
});

describe("mẫu 'Báo cáo ca có số liệu thật' — đầu-cuối ×3 với AI giả", () => {
  it("lịch ⇒ 3 truy vấn số liệu ⇒ tóm tắt ⇒ thông báo nội bộ: tóm tắt nhận ĐÚNG số của nhà máy A (3 lần kiểm, 2 NG), không có dấu B; mỗi lượt gửi đúng 1 thông báo", async () => {
    const mau = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "mau", "bao-cao-ca-so-lieu.json"), "utf8"));
    mau.id = `${TT}-mau`;
    mau.settings = { ...mau.settings, maxConcurrentRuns: 100 };
    mau.nodes.find((n: { id: string }) => n.id === "thong-bao").parameters.nguoiNhan = [u.nhanA];
    await luuPhienBan(mau, u.admin, ids.facA);
    const thay: string[] = [];
    const cu: HamGoiAi = datHamGoiAi(async ({ nguoiDung, loai }) => {
      if (loai === "tom-tat") thay.push(nguoiDung);
      return "Ca vừa rồi: có số liệu.";
    });
    try {
      gui.length = 0;
      __datHamGuiThongBaoChoTest(async (userId) => {
        gui.push(userId);
        return { id: 1 };
      });
      for (let i = 0; i < 3; i++) {
        const r = await chay(mau.id, u.nhieu); // chủ nhiều nhà máy nhưng luồng gắn A ⇒ chỉ A
        expect(r.status).toBe("xong");
      }
      expect(gui).toEqual([u.nhanA, u.nhanA, u.nhanA]);
      expect(thay.length).toBe(3);
      for (const t of thay) {
        expect(t).toMatch(/"tong":\s*3/);
        expect(t).toMatch(/"ng":\s*2/);
        expect(t).toContain(`${FAC_A}_M1`);
        expect(t).not.toContain(`${FAC_B}_M1`);
      }
    } finally {
      datHamGoiAi(cu);
    }
  });
});

// (d) ĐO SỐNG — chỉ chạy khi LUONG_LIVE=1 (cần khe :8091 do do-model cấp). Model THẬT, không AI giả: mẫu báo cáo ca ×3, đo thời gian + nội dung.
const tokenLlama = async (): Promise<number | null> => {
  try {
    const t = await (await fetch(`${process.env.LLAMA_SERVER_URL ?? "http://127.0.0.1:8091"}/metrics`)).text();
    const m = /^llamacpp:prompt_tokens_total\s+([0-9.e+]+)/m.exec(t);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
};

describe.skipIf(process.env.LUONG_LIVE !== "1")("(d) đo sống :8091 — mẫu báo cáo ca với model thật", () => {
  it("×3: tóm tắt nhắc đúng số nhà máy A (tổng 3, NG 2), không lộ máy/số nhà máy B; mỗi lượt đúng 1 thông báo", async () => {
    const mau = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "mau", "bao-cao-ca-so-lieu.json"), "utf8"));
    mau.id = `${TT}-live`;
    mau.settings = { ...mau.settings, maxConcurrentRuns: 100 };
    mau.nodes.find((n: { id: string }) => n.id === "thong-bao").parameters.nguoiNhan = [u.nhanA];
    await luuPhienBan(mau, u.admin, ids.facA);
    gui.length = 0;
    __datHamGuiThongBaoChoTest(async (userId, p) => {
      gui.push(userId);
      console.log("[LIVE] thông báo:", String(p.message).slice(0, 600));
      return { id: 1 };
    });
    for (let i = 0; i < Number(process.env.LUONG_LIVE_N ?? 3); i++) {
      const t0 = Date.now();
      const tok0 = await tokenLlama();
      const r = await chay(mau.id, u.nhieu);
      console.log(`[LIVE] :8091 prompt_tokens_total tăng ${tok0 === null ? "?" : (await tokenLlama())! - tok0} (0 ⇒ lượt KHÔNG đi qua llama-server)`);
      const bc = (await buoc(r.id, "tom-tat")).output as { main: Array<{ json: { baoCao?: string } }> } | null;
      const chu = String(bc?.main?.[0]?.json?.baoCao ?? "");
      console.log(`[LIVE] lượt ${i + 1}: ${r.status} ${Date.now() - t0} ms · ${chu.length} ký tự`);
      if (r.status !== "xong") console.log("[LIVE] lỗi các bước:", JSON.stringify((await db.select({ n: aiFlowSteps.nodeId, e: aiFlowSteps.error }).from(aiFlowSteps).where(eq(aiFlowSteps.runId, r.id))).filter((x) => x.e)).slice(0, 800));
      expect(r.status).toBe("xong");
      console.log("[LIVE] báo cáo:", chu);
      expect(chu).not.toContain(`${FAC_B}_M1`);
      expect(chu.includes("3"), "có tổng 3").toBe(true);
      expect(chu.includes("2"), "có NG 2").toBe(true);
    }
    expect(gui.length).toBe(Number(process.env.LUONG_LIVE_N ?? 3));
  }, 900_000);
});
