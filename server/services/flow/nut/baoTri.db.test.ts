/**
 * ★★★ Lô Luồng-A (2026-10-25) — node `bao-tri.tao-phieu` + mẫu #5 (sự kiện downtime.start → ai.phan-loai → tạo phiếu) trên CSDL `_test` với ĐỘNG CƠ + BUS THẬT, hai nhà máy A/B, AI giả:
 *   phiếu đúng máy/nhóm/tiêu đề · máy nhà máy B không tạo phiếu cho luồng A (kể cả chủ thấy cả hai) · chủ thiếu quyền / bị khoá ⇒ không tạo · tất-cả-hoặc-không ·
 *   trần item · sự kiện nhà máy B không kích luồng của chủ chỉ thuộc A · mỗi sự kiện đúng MỘT phiếu.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../../drizzle/schema";
import { qChuTest } from "../../../testing/__haiNhaMayDoLuong";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { batDauRun, chayMotMuc, luuPhienBan, traLoiCho } from "../dongCo";
import { datHamGoiAi } from "./ai";
import { napLaiSuKien, xuLySuKien } from "../kichHoat/suKien";

const RUN = `bt_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const TT = `t3bt${Math.floor(Math.random() * 1e5)}`;
const FAC_A = `BTA_${RUN}`.slice(0, 50);
const FAC_B = `BTB_${RUN}`.slice(0, 50);
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const noi = (a: string, b: string) => ({ from: { node: a, port: "main" }, to: { node: b, port: "main" } });

const ids = { facA: 0, facB: 0, machA: 0, machB: 0 };
const cay: { ws: number[]; ln: number[]; st: number[] } = { ws: [], ln: [], st: [] };
const u = { A: 0, nhieu: 0, khongQuyen: 0, khoa: 0, admin: 0 };
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
const FL = { A: `${TT}-A`, G: `${TT}-G`, SK: `${TT}-sk`, V2: `${TT}-v2` };
const THAM_SO_PHIEU = { may: "{{ $json.may }}", tieuDe: "{{ $json.tieuDe }}", moTa: "{{ $json.moTa }}", nhom: "{{ $json.nhom }}", uuTien: "{{ $json.uuTien }}" };

async function mkUser(tag: string, role: "engineer" | "admin", factories: string[], quyen: boolean) {
  const r = await taoNguoiDungTest(tag, role, { tienTo: "bt", ten: `BT ${tag}`, ts: RUN });
  for (const f of factories) await db.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${r.id}, ${f})`);
  if (quyen) await db.execute(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate") VALUES (${r.id}, 'machine_monitoring', 'machine_status', true, true)`);
  return r.id;
}
const luongPhieu = (id: string) => ({
  id, name: "tao phieu", version: 1, settings: { maxConcurrentRuns: 100 },
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("p", "bao-tri.tao-phieu", THAM_SO_PHIEU)],
  connections: [noi("t", "p")],
});
const demPhieu = async (machineIds: number[]) =>
  Number(((await db.execute(sql`SELECT count(*)::int AS n FROM maintenance_work_orders WHERE "machineId" IN (${sql.raw(machineIds.join(","))})`)) as unknown as { n: number }[])[0].n);
const phieuCua = (machineId: number) => db.execute(sql`SELECT * FROM maintenance_work_orders WHERE "machineId" = ${machineId} ORDER BY id`) as unknown as Promise<Array<Record<string, unknown>>>;
const chayHet = async () => {
  for (let i = 0; i < 500 && (await chayMotMuc("w-bt", undefined, TT)); i++);
};
async function chay(flowId: string, chu: number | null, items: Array<{ json: Record<string, unknown> }>) {
  const v = (await db.execute(sql`SELECT max(version)::int AS v FROM ai_flow_versions WHERE "flowId" = ${flowId}`)) as unknown as { v: number }[];
  const r = await batDauRun({ flowId, version: v[0].v, chuLuong: chu, items });
  await chayHet();
  const [run] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, r));
  const [b] = await db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, r), eq(aiFlowSteps.nodeId, "p")));
  return { status: run.status, loi: b?.error as { ma?: string } | null | undefined, out: (b?.output as { main?: Array<{ json: { phieu?: { id: number; soPhieu: string; may: number; nhom: string } } }> } | null)?.main };
}

beforeAll(async () => {
  db = (await getDb())!;
  const one = async (q: Promise<unknown>) => Number(((await q) as { id: number }[])[0].id);
  ids.facA = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_A}, ${"BT " + FAC_A}, true) RETURNING id`));
  ids.facB = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_B}, ${"BT " + FAC_B}, true) RETURNING id`));
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
  u.A = await mkUser("a", "engineer", [FAC_A], true);
  u.nhieu = await mkUser("nhieu", "engineer", [FAC_A, FAC_B], true);
  u.khongQuyen = await mkUser("kq", "engineer", [FAC_A], false);
  u.khoa = await mkUser("khoa", "engineer", [FAC_A], true);
  u.admin = await mkUser("admin", "admin", [], false);
  await db.execute(sql`UPDATE users SET "isActive" = false WHERE id = ${u.khoa}`);
  await luuPhienBan(luongPhieu(FL.A), u.admin, ids.facA);
  await luuPhienBan(luongPhieu(FL.G), u.admin, null); // luồng toàn hệ thống: chỉ phạm vi CHỦ chặn
  // mẫu #5: sự kiện downtime.start → phân loại → tạo phiếu
  const mau5 = {
    id: FL.SK, name: "mau 5", version: 1, settings: { maxConcurrentRuns: 100 },
    nodes: [
      nut("sk", "kich-hoat.su-kien", { suKien: "downtime.start", bat: true, tranMoiGio: 30 }),
      nut("pl", "ai.phan-loai", { vanBan: "{{ $json.lyDo }}", nhan: ["dien", "co-khi", "plc-phan-mem", "vat-tu-khac"], truongRa: "nhan" }),
      nut("p", "bao-tri.tao-phieu", { may: "{{ $json.idMay }}", tieuDe: "{{ $json.lyDo }}", nhom: "{{ $json.nhan }}", uuTien: 2 }),
    ],
    connections: [noi("sk", "pl"), noi("pl", "p")],
  };
  await luuPhienBan(mau5 as never, u.A, ids.facA);
  await db.execute(sql`UPDATE ai_flows SET enabled = true, "activeVersion" = 1 WHERE id = ${FL.SK}`);
  // mẫu #5 v2 THẬT (tệp mẫu): su-kien bật, nhãn lạ → người duyệt
  const v2 = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "mau", "phieu-bao-tri-phan-loai.json"), "utf8"));
  v2.id = FL.V2;
  v2.settings = { ...v2.settings, maxConcurrentRuns: 100 };
  v2.nodes.find((n: { id: string }) => n.id === "su-kien").parameters = { suKien: "downtime.start", bat: true, cuaSoPhut: 10, tranMoiGio: 30 };
  await luuPhienBan(v2, u.A, ids.facA); // chỉ BẬT trong describe của mẫu v2 (cùng sự kiện downtime.start với FL.SK ⇒ không để hai luồng nghe cùng lúc ở ca khác)
}, 180_000);

afterEach(() => undefined);

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await qChuTest(`DELETE FROM maintenance_work_orders WHERE "machineId" IN (${ids.machA}, ${ids.machB})`).catch(async () => {
    await db.execute(sql`DELETE FROM maintenance_work_orders WHERE "machineId" IN (${ids.machA}, ${ids.machB})`);
  });
  await db.execute(sql`DELETE FROM permissions WHERE "userId" IN (${u.A}, ${u.nhieu}, ${u.khongQuyen}, ${u.khoa})`);
  await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" IN (${u.A}, ${u.nhieu}, ${u.khongQuyen}, ${u.khoa})`);
  await db.execute(sql`DELETE FROM machines WHERE id IN (${ids.machA}, ${ids.machB})`);
  await db.execute(sql`DELETE FROM stations WHERE id IN ${sql.raw(`(${cay.st.join(",")})`)}`);
  await db.execute(sql`DELETE FROM production_lines WHERE id IN ${sql.raw(`(${cay.ln.join(",")})`)}`);
  await db.execute(sql`DELETE FROM workshops WHERE id IN ${sql.raw(`(${cay.ws.join(",")})`)}`);
  await db.execute(sql`DELETE FROM factories WHERE id IN (${ids.facA}, ${ids.facB})`);
});

describe("node bao-tri.tao-phieu", () => {
  it("tạo đúng MỘT phiếu: máy, tiêu đề mang nhóm, mô tả ghi nhóm + nguồn, OPEN, ưu tiên, chưa giao", async () => {
    const r = await chay(FL.A, u.A, [{ json: { may: ids.machA, tieuDe: "Cháy cầu chì nguồn 24V", moTa: "máy dừng đột ngột", nhom: "dien", uuTien: 2 } }]);
    expect(r.status).toBe("xong");
    expect(r.out?.[0].json.phieu).toMatchObject({ may: ids.machA, nhom: "dien" });
    const ph = await phieuCua(ids.machA);
    expect(ph.length).toBe(1);
    expect(ph[0]).toMatchObject({ title: "[Điện] Cháy cầu chì nguồn 24V", status: "OPEN", priority: 2, assignedTo: null, type: "CORRECTIVE", trigger: "MANUAL", machineCode: `${FAC_A}_M1` });
    expect(String(ph[0].description)).toMatch(new RegExp(`^Nhóm: Điện · nguồn: Luồng AI ${FL.A}/`));
    expect(String(ph[0].description)).toContain("máy dừng đột ngột");
  });

  it("nhóm lạ ⇒ vat-tu-khac; tham số sai (uuTien, tiêu đề ngắn, máy không phải số) ⇒ THAM_SO_SAI, không tạo", async () => {
    const truoc = await demPhieu([ids.machA]);
    const la = await chay(FL.A, u.A, [{ json: { may: ids.machA, tieuDe: "Thiếu ốc vít", nhom: "ma-thuat", uuTien: 3 } }]);
    expect(la.out?.[0].json.phieu?.nhom).toBe("vat-tu-khac");
    for (const item of [{ may: ids.machA, tieuDe: "ok ok", nhom: "dien", uuTien: 9 }, { may: ids.machA, tieuDe: "ab", nhom: "dien", uuTien: 3 }, { may: "abc", tieuDe: "xin chào", nhom: "dien", uuTien: 3 }]) {
      const r = await chay(FL.A, u.A, [{ json: item }]);
      expect(r.status).toBe("loi");
      expect(r.loi?.ma).toBe("THAM_SO_SAI");
    }
    expect(await demPhieu([ids.machA])).toBe(truoc + 1);
  });

  it("★ máy nhà máy B ⇒ MAY_NGOAI_PHAM_VI, 0 phiếu — kể cả chủ thấy CẢ HAI nhà máy (luồng gắn A) ; chủ chỉ A cũng bị chặn", async () => {
    for (const chu of [u.nhieu, u.A]) {
      const r = await chay(FL.A, chu, [{ json: { may: ids.machB, tieuDe: "Phiếu sang nhà máy khác", nhom: "co-khi", uuTien: 3 } }]);
      expect(r.status).toBe("loi");
      expect(r.loi?.ma).toBe("MAY_NGOAI_PHAM_VI");
    }
    expect(await demPhieu([ids.machB])).toBe(0);
  });

  it("★ luồng toàn-hệ-thống: chủ chỉ thuộc A tạo được phiếu cho máy A nhưng KHÔNG cho máy B (chỉ BoKiemPhamVi.may chặn)", async () => {
    const truoc = await demPhieu([ids.machB]);
    const ok = await chay(FL.G, u.A, [{ json: { may: ids.machA, tieuDe: "Máy A qua luồng hệ thống", nhom: "co-khi", uuTien: 3 } }]);
    expect(ok.status).toBe("xong");
    const sai = await chay(FL.G, u.A, [{ json: { may: ids.machB, tieuDe: "Máy B qua luồng hệ thống", nhom: "co-khi", uuTien: 3 } }]);
    expect(sai.status).toBe("loi");
    expect(sai.loi?.ma).toBe("MAY_NGOAI_PHAM_VI");
    expect(await demPhieu([ids.machB])).toBe(truoc);
  });

  it("★ chủ thiếu quyền canCreate / bị khoá / không chủ ⇒ không tạo", async () => {
    const truoc = await demPhieu([ids.machA]);
    const kq = await chay(FL.A, u.khongQuyen, [{ json: { may: ids.machA, tieuDe: "Không có quyền", nhom: "dien", uuTien: 3 } }]);
    expect(kq.status).toBe("loi");
    expect(kq.loi?.ma).toBe("THIEU_QUYEN");
    const khoa = await chay(FL.A, u.khoa, [{ json: { may: ids.machA, tieuDe: "Chủ bị khoá", nhom: "dien", uuTien: 3 } }]);
    expect(khoa.loi?.ma).toBe("CHU_LUOT_KHONG_XAC_DINH");
    const khong = await chay(FL.A, null, [{ json: { may: ids.machA, tieuDe: "Không chủ", nhom: "dien", uuTien: 3 } }]);
    expect(khong.loi?.ma).toBe("CHU_LUOT_KHONG_XAC_DINH");
    expect(await demPhieu([ids.machA])).toBe(truoc);
  });

  it("tất-cả-hoặc-không: item thứ hai sai máy ⇒ không phiếu nào được tạo; vượt trần 20 item ⇒ QUA_TRAN_PHIEU", async () => {
    const truoc = await demPhieu([ids.machA, ids.machB]);
    const r = await chay(FL.A, u.A, [
      { json: { may: ids.machA, tieuDe: "Hợp lệ đứng trước", nhom: "dien", uuTien: 3 } },
      { json: { may: ids.machB, tieuDe: "Sai nhà máy đứng sau", nhom: "dien", uuTien: 3 } },
    ]);
    expect(r.status).toBe("loi");
    expect(await demPhieu([ids.machA, ids.machB])).toBe(truoc);
    const nhieu = await chay(FL.A, u.A, Array.from({ length: 21 }, (_, i) => ({ json: { may: ids.machA, tieuDe: `Phiếu số ${i}`, nhom: "dien", uuTien: 3 } })));
    expect(nhieu.loi?.ma).toBe("QUA_TRAN_PHIEU");
    expect(await demPhieu([ids.machA, ids.machB])).toBe(truoc);
  });
});

describe("mẫu #5 đầu-cuối: downtime.start → ai.phan-loai (AI giả) → phiếu", () => {
  it("★ sự kiện máy A ⇒ MỘT phiếu đúng nhóm do AI chọn, tiêu đề lấy lý do vận hành viên gõ; sự kiện máy B ⇒ không phiếu (chủ chỉ thuộc A); cùng id sự kiện ⇒ không phiếu thứ hai", async () => {
    const cu = datHamGoiAi(async ({ nguoiDung }) => (/PLC|cảm biến|lập trình/i.test(nguoiDung) ? "plc-phan-mem" : "dien"));
    try {
      const truoc = { A: await demPhieu([ids.machA]), B: await demPhieu([ids.machB]) };
      napLaiSuKien();
      const ts = Date.UTC(2026, 9, 25, 3, 0, 0);
      const ev = (id: string, may: number, lyDo: string) => xuLySuKien("downtime.start", { id, machineId: may, machineCode: "x", category: "breakdown", reason: lyDo }, ts);
      const ka = (await ev("dt-a1", ids.machA, "PLC báo lỗi cảm biến vị trí")).filter((x) => x.flowId === FL.SK);
      expect(ka[0].ketQua).toBe("chay");
      const kb = (await ev("dt-b1", ids.machB, "Mất nguồn 24V")).filter((x) => x.flowId === FL.SK);
      expect(kb[0].ketQua).toBe("ngoai-pham-vi");
      const trung = (await ev("dt-a1", ids.machA, "PLC báo lỗi cảm biến vị trí")).filter((x) => x.flowId === FL.SK);
      expect(trung[0].ketQua).toBe("trung");
      await chayHet();
      expect(await demPhieu([ids.machA])).toBe(truoc.A + 1);
      expect(await demPhieu([ids.machB])).toBe(truoc.B);
      const ph = (await phieuCua(ids.machA)).pop()!;
      expect(ph.title).toBe("[PLC/Phần mềm] PLC báo lỗi cảm biến vị trí");
      expect(ph.priority).toBe(2);
    } finally {
      datHamGoiAi(cu);
    }
  });
});

describe("mẫu #5 v2 (tệp mẫu): nhãn hợp lệ ⇒ phiếu; nhãn lạ ⇒ NGƯỜI DUYỆT, không tạo phiếu sai", () => {
  const ev = (id: string, may: number, lyDo: string, ts: number) =>
    xuLySuKien("downtime.start", { id, machineId: may, machineCode: "x", category: "breakdown", reason: lyDo }, ts).then((k) => k.filter((x) => x.flowId === FL.V2));
  const runCua = async (flowId: string) => (await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.flowId, flowId))).sort((a, b) => +new Date(a.startedAt) - +new Date(b.startedAt));

  const bat = async (b: boolean) => {
    await db.execute(sql`UPDATE ai_flows SET enabled = ${b}, "activeVersion" = 1 WHERE id = ${FL.V2}`);
    await db.execute(sql`UPDATE ai_flows SET enabled = ${!b} WHERE id = ${FL.SK}`);
    napLaiSuKien();
  };
  it("★ nhãn hợp lệ VÀ chắc ⇒ 1 phiếu đúng nhóm, KHÔNG có yêu cầu duyệt; nhãn hợp lệ nhưng tinCay thấp / null ⇒ người duyệt; nhãn lạ ('khac') ⇒ lượt cho-duyet, 0 phiếu; đồng ý ⇒ ĐÚNG 1 phiếu nhóm Vật tư/Khác; bác ⇒ 0 phiếu", async () => {
    // AI giả: có logprobs chắc (0,95) cho nhãn PLC; lý do chứa "chap chon" ⇒ nhãn đúng nhưng KHÔNG chắc (0,4); chứa "khong logprob" ⇒ nhãn đúng nhưng đường không trả logprobs (null)
    const lpNhan = (nhan: string, p: number) => [{ token: nhan.slice(0, 3), logprob: Math.log(p), top: [{ token: nhan.slice(0, 3), logprob: Math.log(p) }] }];
    const cu = datHamGoiAi(async ({ nguoiDung, baoLogprobs }) => {
      const du = nguoiDung.split("<du_lieu>")[1] ?? ""; // chỉ nhìn phần DỮ LIỆU (hướng dẫn trong prompt cũng nhắc PLC)
      if (/chap chon/i.test(du)) { baoLogprobs?.(lpNhan("plc-phan-mem", 0.4)); return "plc-phan-mem"; }
      if (/khong logprob/i.test(du)) { baoLogprobs?.(undefined); return "plc-phan-mem"; }
      if (/PLC/i.test(du)) { baoLogprobs?.(lpNhan("plc-phan-mem", 0.95)); return "plc-phan-mem"; }
      baoLogprobs?.(lpNhan("plc-phan-mem", 0.9));
      return "khong-biet-la-gi";
    });
    try {
      await bat(true);
      const ts = Date.UTC(2026, 9, 26, 3, 0, 0);
      const truoc = await demPhieu([ids.machA]);
      const hop = await ev("v2-hop-le", ids.machA, "PLC báo lỗi giao tiếp", ts);
      expect(hop[0].ketQua).toBe("chay");
      await chayHet();
      expect(await demPhieu([ids.machA])).toBe(truoc + 1);
      expect((await phieuCua(ids.machA)).pop()!.title).toBe("[PLC/Phần mềm] PLC báo lỗi giao tiếp");
      // nhãn lạ ⇒ chờ duyệt, KHÔNG phiếu
      const la = await ev("v2-la-1", ids.machA, "Có tiếng kêu lạ không rõ", ts + 20 * 60_000);
      expect(la[0].ketQua).toBe("chay");
      await chayHet();
      const runLa = (await runCua(FL.V2)).find((r) => r.id === la[0].runId)!;
      expect(runLa.status).toBe("cho-duyet");
      expect(await demPhieu([ids.machA])).toBe(truoc + 1);
      // đồng ý ⇒ đúng 1 phiếu nhóm Vật tư/Khác (tiêu đề giữ lý do vận hành viên)
      expect((await traLoiCho({ runId: la[0].runId!, nodeId: "duyet", cong: "dong-y" })).ok).toBe(true);
      await chayHet();
      expect(await demPhieu([ids.machA])).toBe(truoc + 2);
      const moi = (await phieuCua(ids.machA)).pop()!;
      expect(moi.title).toBe("[Vật tư/Khác] Có tiếng kêu lạ không rõ");
      expect((await runCua(FL.V2)).find((r) => r.id === la[0].runId)!.status).toBe("xong");
      // trả lời LẦN HAI không tạo phiếu thứ hai
      expect((await traLoiCho({ runId: la[0].runId!, nodeId: "duyet", cong: "dong-y" })).ok).toBe(false);
      await chayHet();
      expect(await demPhieu([ids.machA])).toBe(truoc + 2);
      // ★ độ tin cậy: nhãn HỢP LỆ nhưng tinCay 0,4 < 0,7 ⇒ người duyệt, 0 phiếu; đường không trả logprobs (tinCay null) ⇒ cũng người duyệt
      const thap = await ev("v2-thap", ids.machA, "chap chon hay PLC khong ro", ts + 60 * 60_000);
      const khongLp = await ev("v2-khong-lp", ids.machA, "khong logprob duong in-process", ts + 80 * 60_000);
      await chayHet();
      const runs = await runCua(FL.V2);
      expect(runs.find((r) => r.id === thap[0].runId)!.status).toBe("cho-duyet");
      expect(runs.find((r) => r.id === khongLp[0].runId)!.status).toBe("cho-duyet");
      expect(await demPhieu([ids.machA])).toBe(truoc + 2);
      // chưa chắc ⇒ người TỪ CHỐI ⇒ vẫn 0 phiếu
      expect((await traLoiCho({ runId: thap[0].runId!, nodeId: "duyet", cong: "tu-choi" })).ok).toBe(true);
      expect((await traLoiCho({ runId: khongLp[0].runId!, nodeId: "duyet", cong: "tu-choi" })).ok).toBe(true);
      await chayHet();
      expect(await demPhieu([ids.machA])).toBe(truoc + 2);
      // bác ⇒ 0 phiếu mới
      const bac = await ev("v2-la-2", ids.machA, "Rung nhẹ khó tả", ts + 40 * 60_000);
      await chayHet();
      expect((await traLoiCho({ runId: bac[0].runId!, nodeId: "duyet", cong: "tu-choi" })).ok).toBe(true);
      await chayHet();
      expect(await demPhieu([ids.machA])).toBe(truoc + 2);
    } finally {
      await bat(false);
      datHamGoiAi(cu);
    }
  });

  it("sự kiện nhà máy B không kích mẫu v2 của chủ chỉ thuộc A (không yêu cầu duyệt, không phiếu)", async () => {
    await bat(true);
    const kb = await ev("v2-b", ids.machB, "Mất nguồn", Date.UTC(2026, 9, 26, 6, 0, 0));
    expect(kb[0].ketQua).toBe("ngoai-pham-vi");
    await bat(false);
  });
});
