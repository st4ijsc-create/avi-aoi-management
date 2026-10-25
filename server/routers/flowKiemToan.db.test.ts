/**
 * ★★★ Lô kiểm toán Luồng AI (dieu-phoi duyệt A, 2026-10-26) trên `_test`: mọi hành động đáng ghi của Luồng vào `audit_logs` (WORM) — KHÔNG chứa dữ liệu item / giá trị biểu mẫu / giá trị bí mật.
 *   lưu · bật/tắt · chạy tay hạng ngoai-ghi · duyệt THÀNH CÔNG (cùng giao dịch với việc trả lời) · duyệt tự động hết hạn · MỖI bước node ngoai-ghi (xong/lỗi) · bí mật tạo/xoá/host.
 * (audit_logs là WORM nên hàng test KHÔNG xoá được — lọc theo id luồng/lượt duy nhất của lượt chạy.)
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiFlowCredentials, aiFlowRuns, aiFlows } from "../../drizzle/schema";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { batDauRun, chayMotMuc, luuPhienBan, nhatMuc, traLoiCho, xuLyKiemHetHan } from "../services/flow/dongCo";
import { datFetchLuong } from "../services/flow/nut/tichHop";
import { banGhiKiemToan } from "../services/flow/kiemToan";
import { flowRouter } from "./flowRouter";

const TT = `t9kt${Math.floor(Math.random() * 1e5)}`;
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const noi = (a: string, b: string, pa = "main") => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
let ad1 = 0;
let ad2 = 0;
const goi = (id: number) => flowRouter.createCaller({ user: { id, role: "admin", twoFactorEnabled: true } } as never);
const chayHet = async () => {
  for (let i = 0; i < 100 && (await chayMotMuc("w-kt", undefined, TT)); i++);
};
type Hang = { id: number; userId: number | null; action: string; entityType: string | null; entityName: string | null; details: string | null; status: string };
const kiemToan = async (thucThe: string, action?: string): Promise<Hang[]> =>
  (await db.execute(sql`SELECT id, "userId", action, "entityType", "entityName", details, status FROM audit_logs WHERE "entityName" = ${thucThe} ${action ? sql`AND action = ${action}` : sql``} ORDER BY id`)) as unknown as Hang[];
const chiTiet = (h: Hang) => JSON.parse(h.details ?? "{}") as Record<string, unknown>;

const luongDuyet = (id: string) => ({
  id, name: "duyệt", version: 1, settings: { maxConcurrentRuns: 50 },
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("d", "nguoi.duyet", { tieuDe: "Duyệt", hetHanGio: 1 }), nut("ok", "du-lieu.dat", { truong: { kq: "ok" } }), nut("hh", "du-lieu.dat", { truong: { kq: "het-han" } })],
  connections: [noi("t", "d"), noi("d", "ok", "dong-y"), noi("d", "hh", "het-han")],
});
const luongHttp = (id: string, url: string) => ({
  id, name: "http", version: 1, settings: { maxConcurrentRuns: 50 },
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("g", "tich-hop.http-gui", { url, phuongThuc: "POST", than: { a: 1 } })],
  connections: [noi("t", "g")],
});

const envGiu = { host: process.env.AI_FLOW_HTTP_HOST_CHO_PHEP, khoa: process.env.AI_FLOW_KHOA_BI_MAT };
let cuFetch: ReturnType<typeof datFetchLuong>;
beforeAll(async () => {
  db = (await getDb())!;
  ad1 = (await taoNguoiDungTest("admin", "admin", { tienTo: "kt1", ts: TT })).id;
  ad2 = (await taoNguoiDungTest("admin", "admin", { tienTo: "kt2", ts: TT })).id;
  process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = "dich.kiemtoan.test";
  process.env.AI_FLOW_KHOA_BI_MAT = Buffer.alloc(32, 7).toString("base64");
  cuFetch = datFetchLuong((async (_u: URL, init: RequestInit) => new Response("{}", { status: String(init.body).includes('"loi":1') ? 500 : 200 })) as never);
}, 120_000);

afterAll(async () => {
  datFetchLuong(cuFetch as never);
  if (envGiu.host === undefined) delete process.env.AI_FLOW_HTTP_HOST_CHO_PHEP;
  else process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = envGiu.host;
  if (envGiu.khoa === undefined) delete process.env.AI_FLOW_KHOA_BI_MAT;
  else process.env.AI_FLOW_KHOA_BI_MAT = envGiu.khoa;
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await db.delete(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`));
});

describe("kiểm toán Luồng AI", () => {
  it("★ lưu phiên bản + bật + tắt ⇒ FLOW_LUU / FLOW_KICH_HOAT / FLOW_TAT đúng người, đúng luồng, không dữ liệu thừa", async () => {
    const id = `${TT}-luu`;
    const kq = await goi(ad1).luu({ definition: luongDuyet(id) });
    const luu = await kiemToan(id, "FLOW_LUU");
    expect(luu).toHaveLength(1);
    expect(luu[0]).toMatchObject({ userId: ad1, entityType: "ai_flow", status: "success" });
    expect(chiTiet(luu[0])).toEqual({ version: kq.version, hang: "thuan", nguon: "luu", soNode: 4 });
    await goi(ad1).datPhienBanHoatDong({ flowId: id, version: kq.version, bat: true });
    await goi(ad1).datPhienBanHoatDong({ flowId: id, version: kq.version, bat: false });
    expect((await kiemToan(id, "FLOW_KICH_HOAT")).map((h) => [h.userId, chiTiet(h).version])).toEqual([[ad1, kq.version]]);
    expect((await kiemToan(id, "FLOW_TAT")).map((h) => h.userId)).toEqual([ad1]);
  });

  it("★ duyệt THÀNH CÔNG ⇒ FLOW_DUYET (người duyệt, nodeId, dongY, vai) CÙNG giao dịch; thuần hạng ⇒ KHÔNG FLOW_CHAY_TAY; duyệt bị từ chối (quyền) ⇒ KHÔNG FLOW_DUYET", async () => {
    const id = `${TT}-duyet`;
    await goi(ad1).luu({ definition: luongDuyet(id) });
    const { runId } = await goi(ad1).chayTay({ flowId: id, items: [{ json: { bi: "mat-item" } }] });
    await chayHet();
    expect(await kiemToan(runId, "FLOW_CHAY_TAY")).toHaveLength(0); // hạng thuần: không ghi
    // người bật/chủ lượt KHÁC người duyệt (H2): ad1 chạy ⇒ ad1 bị từ chối, kiểm toán KHÔNG có FLOW_DUYET
    await expect(goi(ad1).duyet({ runId, nodeId: "d", dongY: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await kiemToan(runId, "FLOW_DUYET")).toHaveLength(0);
    expect(await goi(ad2).duyet({ runId, nodeId: "d", dongY: true, lyDo: "nội dung lý do KHÔNG vào kiểm toán" })).toEqual({ ok: true, cong: "dong-y" });
    const h = await kiemToan(runId, "FLOW_DUYET");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ userId: ad2, entityType: "ai_flow_run", status: "success" });
    expect(chiTiet(h[0])).toEqual({ nodeId: "d", dongY: true, vaiTroNguoiDuyet: "admin", laBieuMau: false, coLyDo: true, cong: "dong-y" });
    expect(h[0].details).not.toContain("mat-item");
    expect(h[0].details).not.toContain("KHÔNG vào kiểm toán");
    await expect(goi(ad2).duyet({ runId, nodeId: "d", dongY: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await kiemToan(runId, "FLOW_DUYET")).toHaveLength(1); // trả lời lần hai ⇒ không thêm hàng
  });

  it("★ NGUYÊN TỬ: ghi kiểm toán lỗi ⇒ việc trả lời bị HOÀN TÁC (hàng chờ còn, lượt chưa đi tiếp)", async () => {
    const id = `${TT}-nt`;
    await goi(ad1).luu({ definition: luongDuyet(id) });
    const { runId } = await goi(ad1).chayTay({ flowId: id });
    await chayHet();
    const hong = { ...banGhiKiemToan({ nguoi: ad2, hanhDong: "FLOW_DUYET", loaiThucThe: "ai_flow_run", thucThe: runId, chiTiet: {} }), status: "khong-hop-le" as never };
    await expect(traLoiCho({ runId, nodeId: "d", cong: "dong-y", kiemToan: hong })).rejects.toThrow();
    const [w] = (await db.execute(sql`SELECT count(*)::int AS n FROM ai_flow_waits WHERE "runId" = ${runId}`)) as unknown as { n: number }[];
    expect(w.n).toBe(1);
    expect((await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, runId)))[0].status).toBe("cho-duyet");
    expect((await traLoiCho({ runId, nodeId: "d", cong: "dong-y" })).ok).toBe(true); // không có kiểm toán ⇒ vẫn trả lời được (đường nội bộ khác)
  });

  it("★ duyệt TỰ ĐỘNG khi hết hạn ⇒ FLOW_DUYET {tuDong:true, hetHan:true} userId null, đúng một hàng", async () => {
    const id = `${TT}-hh`;
    await luuPhienBan(luongDuyet(id), ad1, null);
    const runId = await batDauRun({ flowId: id, version: 1, chuLuong: ad1 });
    await chayHet();
    await db.execute(sql`UPDATE ai_flow_waits SET "expiresAt" = now() - interval '1 second' WHERE "runId" = ${runId}`);
    await db.execute(sql`UPDATE ai_flow_queue SET "availableAt" = now() - interval '1 second' WHERE "runId" = ${runId}`);
    const muc = await nhatMuc("w-kt2", 60_000, TT, runId);
    await xuLyKiemHetHan(muc!);
    const h = await kiemToan(runId, "FLOW_DUYET");
    expect(h).toHaveLength(1);
    expect(h[0].userId).toBeNull();
    expect(chiTiet(h[0])).toMatchObject({ nodeId: "d", hetHan: true, tuDong: true, cong: "het-han" });
  });

  it("★ node NGOAI-GHI: chạy tay (admin) ⇒ FLOW_CHAY_TAY; MỖI bước ⇒ một FLOW_BUOC_NGOAI_GHI (xong → success, lỗi → failure), không ghi lần thử lại, người = chủ lượt", async () => {
    const ok = `${TT}-httpok`;
    const loi = `${TT}-httploi`;
    await goi(ad1).luu({ definition: luongHttp(ok, "https://dich.kiemtoan.test/a") });
    await goi(ad1).luu({ definition: { ...luongHttp(loi, "https://dich.kiemtoan.test/b"), nodes: luongHttp(loi, "x").nodes.map((n) => (n.id === "g" ? nut("g", "tich-hop.http-gui", { url: "https://dich.kiemtoan.test/b", phuongThuc: "POST", than: { loi: 1 } }) : n)) } });
    const r1 = (await goi(ad1).chayTay({ flowId: ok, items: [{ json: {} }, { json: {} }] })).runId;
    const r2 = (await goi(ad1).chayTay({ flowId: loi })).runId;
    await chayHet();
    const ct = await kiemToan(r1, "FLOW_CHAY_TAY");
    expect(ct).toHaveLength(1);
    expect(chiTiet(ct[0])).toMatchObject({ flowId: ok, hang: "ngoai-ghi", soItem: 2, daBat: false });
    const b1 = await kiemToan(r1, "FLOW_BUOC_NGOAI_GHI");
    expect(b1).toHaveLength(1);
    expect(b1[0]).toMatchObject({ userId: ad1, status: "success" });
    expect(chiTiet(b1[0])).toMatchObject({ flowId: ok, nodeId: "g", loaiNode: "tich-hop.http-gui", hang: "ngoai-ghi", ketQua: "xong" });
    const b2 = await kiemToan(r2, "FLOW_BUOC_NGOAI_GHI");
    expect(b2).toHaveLength(1);
    expect(b2[0].status).toBe("failure");
    expect(chiTiet(b2[0])).toMatchObject({ ketQua: "loi" });
    expect(JSON.stringify(chiTiet(b2[0]))).not.toContain("dich.kiemtoan.test"); // không URL / thân
  });

  it("node thuần / doc KHÔNG sinh FLOW_BUOC_NGOAI_GHI", async () => {
    const id = `${TT}-thuan`;
    await goi(ad1).luu({ definition: luongDuyet(id) });
    const { runId } = await goi(ad1).chayTay({ flowId: id });
    await chayHet();
    expect(await kiemToan(runId, "FLOW_BUOC_NGOAI_GHI")).toHaveLength(0);
  });

  it("★ bí mật: tạo / host / xoá ⇒ FLOW_BI_MAT_* chỉ id + loại + số host — KHÔNG giá trị", async () => {
    const GIA_TRI = "gia-tri-bi-mat-kiem-toan-12345";
    const id = `${TT}-bm`;
    await goi(ad1).biMatTao({ id, ten: "Token", loai: "token", giaTri: GIA_TRI, hostChoPhep: ["dich.kiemtoan.test"], factoryId: undefined });
    await goi(ad1).biMatDatHost({ id, hostChoPhep: ["a.kiemtoan.test", "b.kiemtoan.test"] });
    await goi(ad1).biMatXoa({ id });
    const tao = await kiemToan(id, "FLOW_BI_MAT_TAO");
    const host = await kiemToan(id, "FLOW_BI_MAT_HOST");
    const xoa = await kiemToan(id, "FLOW_BI_MAT_XOA");
    expect([tao.length, host.length, xoa.length]).toEqual([1, 1, 1]);
    expect(chiTiet(tao[0])).toEqual({ loai: "token", ghiDe: false, soHost: 1 });
    expect(chiTiet(host[0])).toEqual({ hostChoPhep: ["a.kiemtoan.test", "b.kiemtoan.test"] });
    for (const h of [...tao, ...host, ...xoa]) expect(h.details).not.toContain(GIA_TRI);
  });
});
