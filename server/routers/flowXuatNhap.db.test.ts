/**
 * ★★★ Lô nhập/xuất luồng giữa nhà máy (2026-10-25) trên `_test`, hai nhà máy A/B, "gieo dấu vết":
 *   (a) gói xuất KHÔNG chứa id/bí mật/luồng con/dữ liệu ghim/id luồng nào của A; văn bản tự do còn nhắc A ⇒ CẢNH BÁO có vị trí (không tự xoá, không nằm trong gói);
 *   (b) nhập vào B ⇒ luồng thuộc B, TẮT, hạng tính lại, 0 tham chiếu A; kỹ sư chỉ-A không nhập vào B được; (c) gói độc hại / định dạng lạ / quá lớn ⇒ 400, 0 hàng ghi;
 *   băm thiếu/lệch ⇒ chỉ cảnh báo; (d) vòng khứ hồi: xuất A → nhập A → điền người nhận → chạy ⇒ cùng thông báo.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiFlowRuns, aiFlowVersions, aiFlows } from "../../drizzle/schema";
import { qChuTest } from "../testing/__haiNhaMayDoLuong";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { batDauRun, chayMotMuc, luuPhienBan } from "../services/flow/dongCo";
import { __datHamGuiThongBaoChoTest } from "../services/flow/nut/thongBao";
import { bamLuong } from "../services/flow/xuatNhap";
import { flowRouter } from "./flowRouter";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RUN = `xn${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const TT = `t6xn${Math.floor(Math.random() * 1e5)}`;
const FAC_A = `XNA_${RUN}`.slice(0, 50);
const FAC_B = `XNB_${RUN}`.slice(0, 50);
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}, them: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters, ...them });
const noi = (a: string, b: string) => ({ from: { node: a, port: "main" }, to: { node: b, port: "main" } });

const ids = { facA: 0, facB: 0, machA: 0, machB: 0 };
const cay: { ws: number[]; ln: number[]; st: number[] } = { ws: [], ln: [], st: [] };
const u: Record<string, number> = {};
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
const goi = (id: number, role: string) => flowRouter.createCaller({ user: { id, role, twoFactorEnabled: true }, sessionToken: `phien-${id}` } as never);
const CRED = `cred-${RUN}`;
const CON = `${TT}-con`;
const LUONG_A = `${TT}-nguon`;
const TEN_NGUOI_A = `Nguyen ${RUN} Alpha`;

async function mkUser(ten: string, role: "engineer" | "admin", nhaMay: string[], hienThi?: string) {
  const r = await taoNguoiDungTest(ten, role, { tienTo: "xn", ten: hienThi ?? `XN ${ten}`, ts: RUN });
  for (const c of nhaMay) await db.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${r.id}, ${c})`);
  return r.id;
}
const PROMPT = (maMay: string) => `Phân tích máy ${maMay} của nhà máy ${FAC_A}; báo cho ${TEN_NGUOI_A}.`;

beforeAll(async () => {
  db = (await getDb())!;
  const one = async (q: Promise<unknown>) => Number(((await q) as { id: number }[])[0].id);
  ids.facA = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_A}, ${"XN " + FAC_A}, true) RETURNING id`));
  ids.facB = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_B}, ${"XN " + FAC_B}, true) RETURNING id`));
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
  u.A = await mkUser("a", "engineer", [FAC_A], TEN_NGUOI_A);
  u.B = await mkUser("b", "engineer", [FAC_B]);
  u.AB = await mkUser("ab", "engineer", [FAC_A, FAC_B]);
  u.admin = await mkUser("admin", "admin", []);
  // luồng nguồn của A với MỌI loại tham chiếu theo nhà máy + dữ liệu ghim + văn bản tự do nhắc A
  await luuPhienBan({ id: CON, name: "con", version: 1, nodes: [nut("t", "kich-hoat.thu-cong")], connections: [], settings: { uuTien: "background", luuDuLieu: "day-du" } } as never, u.admin, ids.facA);
  await db.execute(sql`UPDATE ai_flows SET enabled = true, "activeVersion" = 1 WHERE id = ${CON}`); // luồng con phải có phiên bản hoạt động
  await luuPhienBan(
    {
      id: LUONG_A, name: `Luồng của ${FAC_A}`, version: 1,
      settings: { uuTien: "background", luuDuLieu: "day-du", maxConcurrentRuns: 3, errorFlowId: CON },
      pinData: { ai: [{ json: { bi_mat: `DU-LIEU-THAT-${RUN}` } }] },
      nodes: [
        nut("t", "kich-hoat.thu-cong"),
        nut("ai", "ai.llm", { vaiTro: "chat", loiNhac: PROMPT(`${FAC_A}_M1`), truongRa: "traLoi" }),
        nut("h", "tich-hop.http-doc", { url: "https://example.test/api", kieuXacThuc: "bearer" }, { credentialRef: CRED }),
        nut("sk", "kich-hoat.su-kien", { suKien: "ng.alert", bat: true, cuaSoPhut: 10, tranMoiGio: 10 }),
        nut("tp", "bao-tri.tao-phieu", { may: ids.machA, tieuDe: "Phiếu", nhom: "dien", uuTien: 3 }),
        nut("tb", "tich-hop.thong-bao", { nguoiNhan: [u.A, u.AB], tieuDe: "Báo cáo", noiDung: "xin chào" }),
        nut("gc", "luong.goi-con", { flowId: CON }),
        nut("ag", "ai.agent", { loiNhac: "{{ $json.q }}", luongCon: [{ flowId: CON, moTa: "chạy con" }], traTaiLieu: false }),
        nut("ot", "ot.de-xuat-luong", { workflowId: 777, version: 3, thamSo: {}, hetHanGio: 24 }),
        nut("bt", "bao-tri.tao-phieu", { may: "{{ $json.idMay }}", tieuDe: "{{ $json.lyDo }}", nhom: "{{ $json.nhan }}" }),
      ],
      connections: [noi("t", "ai")],
    } as never,
    u.admin,
    ids.facA,
  );
}, 180_000);

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `%${RUN.slice(0, 6)}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(sql`${aiFlows.id} LIKE ${TT + "%"} OR ${aiFlows.name} LIKE ${"%" + RUN + "%"}`);
  const hang = await db.execute(sql`SELECT id FROM ai_flows WHERE "factoryId" IN (${ids.facA}, ${ids.facB})`);
  for (const r of hang as unknown as { id: string }[]) await db.execute(sql`DELETE FROM ai_flow_runs WHERE "flowId" = ${r.id}`);
  await db.execute(sql`DELETE FROM ai_flows WHERE "factoryId" IN (${ids.facA}, ${ids.facB})`);
  await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql.raw(`(${Object.values(u).join(",")})`)}`);
  await qChuTest(`DELETE FROM maintenance_work_orders WHERE "machineId" IN (${ids.machA}, ${ids.machB})`).catch(() => undefined);
  await db.execute(sql`DELETE FROM machines WHERE id IN (${ids.machA}, ${ids.machB})`);
  await db.execute(sql`DELETE FROM stations WHERE id IN ${sql.raw(`(${cay.st.join(",")})`)}`);
  await db.execute(sql`DELETE FROM production_lines WHERE id IN ${sql.raw(`(${cay.ln.join(",")})`)}`);
  await db.execute(sql`DELETE FROM workshops WHERE id IN ${sql.raw(`(${cay.ws.join(",")})`)}`);
  await db.execute(sql`DELETE FROM factories WHERE id IN (${ids.facA}, ${ids.facB})`);
});

describe("XUẤT — gói sạch", () => {
  it("★ gói KHÔNG chứa bí mật / luồng con / id luồng / dữ liệu ghim / id máy / người nhận; mọi tham chiếu theo nhà máy về trống; sự kiện về TẮT", async () => {
    const r = await goi(u.A, "engineer").xuat({ flowId: LUONG_A });
    const chu = JSON.stringify(r.goi);
    for (const dau of [CRED, CON, LUONG_A, `DU-LIEU-THAT-${RUN}`, "pinData", "kieuXacThuc"]) expect(chu, dau).not.toContain(dau);
    expect(JSON.stringify(r.goi.luong)).not.toContain("credentialRef");
    expect(JSON.stringify(r.goi.luong)).not.toContain("errorFlowId");
    const n = Object.fromEntries(r.goi.luong.nodes.map((x) => [x.id, x]));
    expect(n.tp.parameters.may).toBe("");
    expect(n.tb.parameters.nguoiNhan).toEqual([]);
    expect(n.gc.type).toBe("du-lieu.dat"); // node luồng con ⇒ giữ chỗ (người nhập chọn lại)
    expect(n.gc.name).toContain("[Chọn lại luồng con]");
    expect(n.ag.parameters.luongCon).toEqual([]);
    expect(n.ot.parameters).not.toHaveProperty("workflowId");
    expect(n.sk.parameters.bat).toBe(false);
    expect(n.bt.parameters.may).toBe("{{ $json.idMay }}"); // biểu thức giữ nguyên
    expect(n.h.credentialRef).toBeUndefined();
    expect(r.goi.luong.id).not.toBe(LUONG_A);
    expect(r.goi.luong.settings).not.toHaveProperty("errorFlowId");
    expect(r.goi.dinhDang).toBe("luong-ai/1");
    expect(r.goi.bam).toBe(bamLuong(r.goi.luong));
    const loai = new Set(r.viec.map((v) => v.viec));
    for (const k of ["may", "nguoi-nhan", "luong-con", "workflow-ot", "bi-mat", "luong-loi", "bat-su-kien"]) expect(loai.has(k as never), k).toBe(true);
  });

  it("★ (A) văn bản tự do nhắc mã máy / tên nhà máy / tên người của A ⇒ CẢNH BÁO có vị trí (node + trường); prompt KHÔNG bị xoá; cảnh báo KHÔNG nằm trong gói", async () => {
    const r = await goi(u.A, "engineer").xuat({ flowId: LUONG_A });
    const ai = r.canhBao.filter((c) => c.nodeId === "ai");
    expect(ai.map((c) => c.loai).sort()).toEqual(["ma-may", "nguoi-dung", "nha-may"]);
    for (const c of ai) expect(c.truong).toBe("parameters.loiNhac");
    expect(ai.find((c) => c.loai === "ma-may")?.khop).toBe(`${FAC_A}_M1`);
    expect(r.canhBao.some((c) => c.nodeId === "(luồng)" && c.truong === "name" && c.loai === "nha-may")).toBe(true); // tên luồng nhắc nhà máy
    expect(String(r.goi.luong.nodes.find((x) => x.id === "ai")?.parameters.loiNhac)).toBe(PROMPT(`${FAC_A}_M1`)); // không tự xoá
    expect(JSON.stringify(r.goi)).not.toContain("canhBao");
    // chuỗi không nhắc A ⇒ không cảnh báo
    expect(r.canhBao.some((c) => c.nodeId === "tb")).toBe(false);
  });

  it("xuất luồng ngoài phạm vi ≡ NOT_FOUND (kỹ sư chỉ B xuất luồng A)", async () => {
    await expect(goi(u.B, "engineer").xuat({ flowId: LUONG_A })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("NHẬP — vào B", () => {
  let gA: Awaited<ReturnType<ReturnType<typeof goi>["xuat"]>>["goi"];
  beforeAll(async () => {
    gA = (await goi(u.A, "engineer").xuat({ flowId: LUONG_A })).goi;
  });

  it("★ kỹ sư B nhập: luồng thuộc B, TẮT, phiên bản 1, id mới (không phải id nguồn), 0 tham chiếu A, hạng tính lại; trả danh sách việc phải điền", async () => {
    const kq = await goi(u.B, "engineer").nhap({ goi: gA, ten: `Bản nhập ${RUN}` });
    const [f] = await db.select().from(aiFlows).where(eq(aiFlows.id, kq.flowId));
    expect(f.factoryId).toBe(ids.facB);
    expect(f.enabled).toBe(false);
    expect(f.id).not.toBe(LUONG_A);
    const [v] = await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, kq.flowId), eq(aiFlowVersions.version, 1)));
    const chu = JSON.stringify(v.definition);
    for (const dau of [CRED, CON, LUONG_A, FAC_A, `DU-LIEU-THAT-${RUN}`, "pinData", "credentialRef"]) expect(chu.includes(dau) && dau !== FAC_A, dau).toBe(false);
    expect(["ngoai-ghi", "ot"]).toContain(v.riskClass); // node thông báo / phiếu / OT ⇒ hạng ≥ ngoài-ghi, tính ở máy chủ
    expect(kq.viec.length).toBeGreaterThan(0);
  });

  it("kỹ sư chỉ-A nhập vào nhà máy B ⇒ từ chối, 0 hàng ghi", async () => {
    const truoc = Number(((await db.execute(sql`SELECT count(*)::int AS n FROM ai_flows WHERE "factoryId" = ${ids.facB}`)) as unknown as { n: number }[])[0].n);
    await expect(goi(u.A, "engineer").nhap({ goi: gA, ten: `Sang B ${RUN}`, factoryId: ids.facB })).rejects.toBeTruthy();
    expect(Number(((await db.execute(sql`SELECT count(*)::int AS n FROM ai_flows WHERE "factoryId" = ${ids.facB}`)) as unknown as { n: number }[])[0].n)).toBe(truoc);
  });

  it("kỹ sư NHIỀU nhà máy phải chọn nhà máy; chọn B ⇒ luồng thuộc B", async () => {
    await expect(goi(u.AB, "engineer").nhap({ goi: gA, ten: `Nhiều ${RUN}` })).rejects.toBeTruthy();
    const kq = await goi(u.AB, "engineer").nhap({ goi: gA, ten: `Nhiều B ${RUN}`, factoryId: ids.facB });
    const [f] = await db.select().from(aiFlows).where(eq(aiFlows.id, kq.flowId));
    expect(f.factoryId).toBe(ids.facB);
  });

  it("★ gói ĐỘC HẠI: gói cố tình MANG bí mật + id máy nhà máy khác + dữ liệu ghim + hạng giả ⇒ nhập vẫn làm sạch lại, hạng do máy chủ tính", async () => {
    const doc = JSON.parse(JSON.stringify(gA)) as typeof gA & { hang?: string };
    doc.hang = "thuan";
    const tb = doc.luong.nodes.find((n) => n.id === "tb")!;
    tb.parameters.nguoiNhan = [u.A];
    const tp = doc.luong.nodes.find((n) => n.id === "tp")!;
    tp.parameters.may = ids.machA;
    doc.luong.nodes.find((n) => n.id === "h")!.credentialRef = CRED;
    (doc.luong as unknown as { pinData: unknown }).pinData = { tb: [{ json: { x: `DU-LIEU-THAT-${RUN}` } }] };
    const xt = await goi(u.B, "engineer").nhapXemTruoc({ goi: doc });
    expect(xt.canhBao).toEqual(expect.arrayContaining(["bam-lech", "co-du-lieu-ghim", "co-bi-mat", "co-id-nha-may"]));
    const kq = await goi(u.B, "engineer").nhap({ goi: doc, ten: `Độc hại ${RUN}` });
    const [v] = await db.select().from(aiFlowVersions).where(eq(aiFlowVersions.flowId, kq.flowId));
    const d = v.definition as { nodes: { id: string; parameters: Record<string, unknown>; credentialRef?: string }[]; pinData?: unknown };
    expect(d.nodes.find((n) => n.id === "tb")!.parameters.nguoiNhan).toEqual([]);
    expect(d.nodes.find((n) => n.id === "tp")!.parameters.may).toBe("");
    expect(d.nodes.some((n) => n.credentialRef !== undefined)).toBe(false);
    expect(d.pinData).toBeUndefined();
    expect(v.riskClass).not.toBe("thuan");
  });

  it("(B) định dạng lạ ⇒ từ chối rõ; quá lớn ⇒ từ chối; sai schema ⇒ từ chối; node lạ ⇒ từ chối lúc lưu; 0 hàng ghi", async () => {
    const dem = async () => Number(((await db.execute(sql`SELECT count(*)::int AS n FROM ai_flows WHERE name LIKE ${"%" + RUN + "%"} AND "factoryId" = ${ids.facB}`)) as unknown as { n: number }[])[0].n);
    const truoc = await dem();
    const B = goi(u.B, "engineer");
    await expect(B.nhap({ goi: { ...gA, dinhDang: "luong-ai/2" }, ten: `Lạ ${RUN}` })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(B.nhap({ goi: { dinhDang: "luong-ai/1" }, ten: `Thiếu ${RUN}` })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(B.nhap({ goi: null, ten: `Rỗng ${RUN}` })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const lon = JSON.parse(JSON.stringify(gA));
    lon.luong.nodes[0].parameters = { rac: "x".repeat(300 * 1024) };
    await expect(B.nhap({ goi: lon, ten: `Lớn ${RUN}` })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const la = JSON.parse(JSON.stringify(gA));
    la.luong.nodes.push({ id: "la", type: "khong.co-loai-nay", typeVersion: 1, name: "la", position: [0, 0], parameters: {} });
    await expect(B.nhap({ goi: la, ten: `Node lạ ${RUN}` })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const nhieu = JSON.parse(JSON.stringify(gA));
    nhieu.luong.nodes = Array.from({ length: 101 }, (_, i) => ({ id: `n${i}`, type: "kich-hoat.thu-cong", typeVersion: 1, name: `n${i}`, position: [0, 0], parameters: {} }));
    await expect(B.nhap({ goi: nhieu, ten: `101 node ${RUN}` })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await dem()).toBe(truoc);
  });

  it("(B) băm thiếu / lệch ⇒ CHỈ cảnh báo ở xem trước (vẫn nhập được); gói nguyên vẹn ⇒ không cảnh báo băm", async () => {
    const B = goi(u.B, "engineer");
    expect((await B.nhapXemTruoc({ goi: gA })).canhBao.filter((c) => c.startsWith("bam"))).toEqual([]);
    const thieu = { ...gA } as Record<string, unknown>;
    delete thieu.bam;
    expect((await B.nhapXemTruoc({ goi: thieu })).canhBao).toContain("bam-thieu");
    const lech = { ...gA, bam: "0".repeat(64) };
    expect((await B.nhapXemTruoc({ goi: lech })).canhBao).toContain("bam-lech");
    const kq = await B.nhap({ goi: lech, ten: `Băm lệch ${RUN}` });
    expect(kq.canhBao).toContain("bam-lech");
    await expect(B.nhapXemTruoc({ goi: { ...gA, dinhDang: "x" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("(d) vòng khứ hồi: xuất → nhập cùng nhà máy → điền người nhận → chạy ⇒ cùng thông báo", () => {
  it("mẫu 'số liệu thuần' của A xuất ra, nhập lại A, điền người nhận, chạy ⇒ thông báo có đúng số của A", async () => {
    const mau = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "services", "flow", "mau", "bao-cao-ca-so-lieu-thuan.json"), "utf8"));
    const idMau = `${TT}-mau`;
    mau.id = idMau;
    mau.settings = { ...mau.settings, maxConcurrentRuns: 100 };
    mau.nodes.find((n: { id: string }) => n.id === "thong-bao").parameters.nguoiNhan = [u.A];
    await luuPhienBan(mau, u.admin, ids.facA);
    const xuat = await goi(u.A, "engineer").xuat({ flowId: idMau });
    expect(xuat.goi.luong.nodes.find((n) => n.id === "thong-bao")!.parameters.nguoiNhan).toEqual([]);
    const kq = await goi(u.A, "engineer").nhap({ goi: xuat.goi, ten: `Khứ hồi ${RUN}` });
    const [f] = await db.select().from(aiFlows).where(eq(aiFlows.id, kq.flowId));
    expect(f.factoryId).toBe(ids.facA);
    // điền người nhận (việc phải điền) ⇒ phiên bản 2 do admin lưu thẳng (đường luu sẵn có) rồi chạy
    const [v1] = await db.select().from(aiFlowVersions).where(eq(aiFlowVersions.flowId, kq.flowId));
    const def2 = JSON.parse(JSON.stringify(v1.definition));
    def2.settings.maxConcurrentRuns = 100;
    def2.nodes.find((n: { id: string }) => n.id === "thong-bao").parameters.nguoiNhan = [u.A];
    await luuPhienBan({ ...def2, version: 2 }, u.admin, ids.facA);
    const noiDung: string[] = [];
    __datHamGuiThongBaoChoTest(async (_id, p) => {
      noiDung.push(String(p.message));
      return { id: 1 };
    });
    try {
      const r = await batDauRun({ flowId: kq.flowId, version: 2, chuLuong: u.A, items: [{ json: {} }] });
      for (let i = 0; i < 300 && (await chayMotMuc("w-xn", undefined, `khu-hoi-${RUN}`)); i++); // id luồng nhập sinh từ TÊN (không mang tiền tố TT)
      const [run] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, r));
      expect(run.status).toBe("xong");
      expect(noiDung).toEqual(["Sản lượng 12 giờ: 0 lần kiểm, NG 0 (0 %). Máy trong phạm vi: 1. Dừng máy: 0 lần, 0 phút."]);
    } finally {
      __datHamGuiThongBaoChoTest(null);
    }
  });
});
