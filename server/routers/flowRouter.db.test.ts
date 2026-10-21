/**
 * Đợt 8.1 Task 5 — router `flow` trên CSDL `_test` qua `createCaller` (sàn quyền THẬT của tRPC, giấy phép tắt):
 * vai chỉ-đọc không ghi · lưu luồng sai ⇒ BAD_REQUEST kèm danh sách lỗi · bật luồng hạng `ngoai-ghi` chỉ admin (chạy tay
 * phiên bản hạng ấy chưa bật cũng vậy) · webhook ⇒ token đúng một lần · chạy tay ⇒ chờ duyệt ⇒ `duyet` ⇒ xong; duyệt lần
 * hai ⇒ CONFLICT · dòng thời gian cắt dữ liệu dài · danh mục node.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, like, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiFlowCredentials, aiFlowRuns, aiFlows } from "../../drizzle/schema";
import { chayMotMuc } from "../services/flow/dongCo";
import { flowRouter, TRAN_CHU_BUOC } from "./flowRouter";

const TT = "t8rt";
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0], parameters });
const noi = (a: string, pa: string, b: string) => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });

let uid = 0;
const goi = (role: string) => flowRouter.createCaller({ user: { id: uid, role } } as never);

let fid = 0;
const MA_NM = `${TT}F`;
beforeAll(async () => {
  const db0 = (await getDb())!;
  const [uMoi] = (await db0.execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
    VALUES (${TT + "-nd-" + Date.now().toString(36)}, ${TT + "_nd_" + Date.now().toString(36)}, ${"người gọi"}, ${"password"}, ${"engineer"}, true, false, now()) RETURNING id`)) as unknown as { id: number }[];
  uid = uMoi.id;
  // Đợt 9 — luồng có phạm vi nhà máy: người gọi (vai engineer) thuộc ĐÚNG MỘT nhà máy của test ⇒ luồng mới tự gán nhà máy ấy.
  const [f] = (await db0.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${MA_NM}, ${"T8 " + MA_NM}, true) RETURNING id`)) as unknown as { id: number }[];
  fid = f.id;
  await db0.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid}, ${MA_NM})`);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await db.delete(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`));
  await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" = ${uid} AND "factoryCode" = ${MA_NM}`);
  await db.execute(sql`DELETE FROM factories WHERE id = ${fid}`);
  await db.execute(sql`DELETE FROM users WHERE id = ${uid}`);
});

async function chayHet() {
  for (let i = 0; i < 100 && (await chayMotMuc("w-rt", undefined, TT)); i++);
}

const luongDuyet = {
  id: `${TT}-duyet`, name: "duyệt", version: 1,
  nodes: [
    nut("t", "kich-hoat.thu-cong"),
    nut("dai", "du-lieu.dat", { truong: { dai: "{{ $json.x }}" } }),
    nut("d", "nguoi.duyet", { tieuDe: "Duyệt {{ $json.ma }}" }),
    nut("ok", "du-lieu.dat", { truong: { kq: "ok" } }),
    nut("ko", "du-lieu.dat", { truong: { kq: "ko" } }),
  ],
  connections: [noi("t", "main", "dai"), noi("dai", "main", "d"), noi("d", "dong-y", "ok"), noi("d", "tu-choi", "ko")],
};

describe("flowRouter (Đợt 8.1, DB)", () => {
  it("vai chỉ-đọc (viewer) KHÔNG lưu được; vẫn xem được danh mục", async () => {
    await expect(goi("viewer").luu({ definition: luongDuyet })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const dm = await goi("viewer").danhMucNode();
    const loai = dm.map((n) => n.type);
    for (const t of ["kich-hoat.thu-cong", "kich-hoat.lich", "kich-hoat.webhook", "nguoi.duyet", "ai.llm", "tich-hop.http-gui"]) expect(loai).toContain(t);
    expect(dm.find((n) => n.type === "nguoi.duyet")).toMatchObject({ congRa: ["dong-y", "tu-choi", "het-han"], tacDungPhu: "thuan" });
  });

  it("luồng sai ⇒ BAD_REQUEST kèm danh sách lỗi; cron sai ⇒ BAD_REQUEST", async () => {
    const sai = { ...luongDuyet, id: `${TT}-sai`, nodes: [nut("x", "khong.co")], connections: [] };
    const e = await goi("engineer").luu({ definition: sai }).catch((x) => x);
    expect(e.code).toBe("BAD_REQUEST");
    expect(e.message).toMatch(/chưa đăng ký/);
    expect(e.message).toMatch(/ít nhất một node kích hoạt/);
    const cronSai = { ...luongDuyet, id: `${TT}-cron`, nodes: [nut("l", "kich-hoat.lich", { cron: "0 0 6 * * *" })], connections: [] };
    await expect(goi("engineer").luu({ definition: cronSai })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/5 trường/) });
  });

  it("chạy tay ⇒ chờ duyệt ⇒ danhSachCho ⇒ duyet ⇒ xong; duyệt lần hai ⇒ CONFLICT; dòng thời gian cắt dữ liệu dài", async () => {
    const { version, hang } = await goi("engineer").luu({ definition: luongDuyet });
    expect(hang).toBe("thuan");
    const ds = await goi("viewer").danhSach();
    expect(ds.find((f) => f.id === `${TT}-duyet`)).toMatchObject({ enabled: false, phienBanMoiNhat: version });
    const ct = await goi("viewer").chiTiet({ flowId: `${TT}-duyet` });
    expect(ct.version).toBe(version);
    expect(ct.definition?.nodes).toHaveLength(5);

    const { runId } = await goi("engineer").chayTay({ flowId: `${TT}-duyet`, items: [{ json: { ma: "RCA-1", x: "z".repeat(TRAN_CHU_BUOC * 2) } }] });
    await chayHet();
    const cho = (await goi("viewer").danhSachCho()).filter((c) => c.runId === runId);
    expect(cho).toHaveLength(1);
    expect(cho[0]).toMatchObject({ nodeId: "d", tieuDe: "Duyệt RCA-1", flowId: `${TT}-duyet`, soItem: 1 });

    await expect(goi("viewer").duyet({ runId, nodeId: "d", dongY: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await goi("supervisor").duyet({ runId, nodeId: "d", dongY: true, lyDo: "đủ" })).toEqual({ ok: true, cong: "dong-y" });
    await expect(goi("supervisor").duyet({ runId, nodeId: "d", dongY: false })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(goi("supervisor").duyet({ runId, nodeId: "khong-co", dongY: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await chayHet();

    const dt = await goi("viewer").dongThoiGian({ runId });
    expect(dt.run.status).toBe("xong");
    const ok = dt.buoc.find((b) => b.nodeId === "ok")!;
    expect(ok.output).toMatchObject({ __catBot: true });
    // CSDL giữ bản ĐẦY ĐỦ (chỉ API cắt): item ra của bước duyệt mang người duyệt = người gọi.
    const [dDb] = (await (await getDb())!.execute(sql`SELECT output FROM ai_flow_steps WHERE "runId" = ${runId} AND "nodeId" = 'd'`)) as unknown as { output: { "dong-y": { json: { duyet: unknown } }[] } }[];
    expect(dDb.output["dong-y"][0].json.duyet).toEqual({ dongY: true, nguoi: uid, lyDo: "đủ" });
    expect(dt.suKien.map((e) => e.kind)).toContain("cho.tra-loi");
    const ls = await goi("viewer").lichSuChay({ flowId: `${TT}-duyet`, gioiHan: 5 });
    expect(ls[0]).toMatchObject({ id: runId, status: "xong", triggerKind: "thu-cong" });
  });

  it("hai người duyệt đồng thời ⇒ đúng một thành công, người kia CONFLICT", async () => {
    const { runId } = await goi("engineer").chayTay({ flowId: `${TT}-duyet`, items: [{ json: { ma: "RCA-2", x: 1 } }] });
    await chayHet();
    const kq = await Promise.allSettled([
      goi("supervisor").duyet({ runId, nodeId: "d", dongY: true }),
      goi("admin").duyet({ runId, nodeId: "d", dongY: false }),
    ]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const bai = kq.find((k) => k.status === "rejected") as PromiseRejectedResult;
    expect(bai.reason.code).toBe("CONFLICT");
  });

  it("luồng hạng `ngoai-ghi`: engineer KHÔNG bật / KHÔNG chạy thử được, admin được", async () => {
    const def = {
      id: `${TT}-ngoai`, name: "gửi ra ngoài", version: 1,
      nodes: [nut("t", "kich-hoat.thu-cong"), nut("g", "tich-hop.http-gui", { url: "http://khong-co.invalid/x", phuongThuc: "POST" })],
      connections: [noi("t", "main", "g")],
    };
    const { version, hang } = await goi("engineer").luu({ definition: def });
    expect(hang).toBe("ngoai-ghi");
    await expect(goi("engineer").datPhienBanHoatDong({ flowId: def.id, version, bat: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(goi("engineer").chayTay({ flowId: def.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // tắt (bat=false) thì engineer vẫn làm được — cổng chỉ chặn chiều BẬT
    expect(await goi("engineer").datPhienBanHoatDong({ flowId: def.id, version, bat: false })).toMatchObject({ bat: false });
    expect(await goi("admin").datPhienBanHoatDong({ flowId: def.id, version, bat: true })).toMatchObject({ bat: true, hang: "ngoai-ghi" });
    await goi("admin").datPhienBanHoatDong({ flowId: def.id, version, bat: false });
  });

  it("luồng webhook: bật lần đầu ⇒ token THÔ một lần; bật lại ⇒ null; xoay ⇒ token mới", async () => {
    const def = { id: `${TT}-wh`, name: "wh", version: 1, nodes: [nut("w", "kich-hoat.webhook"), nut("d", "du-lieu.dat")], connections: [noi("w", "main", "d")] };
    const { version } = await goi("engineer").luu({ definition: def });
    const a = await goi("engineer").datPhienBanHoatDong({ flowId: def.id, version, bat: true });
    expect(a.tokenWebhook).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await goi("engineer").datPhienBanHoatDong({ flowId: def.id, version, bat: true })).tokenWebhook).toBeNull();
    const c = await goi("engineer").datPhienBanHoatDong({ flowId: def.id, version, bat: true, xoayToken: true });
    expect(c.tokenWebhook).toBeTruthy();
    expect(c.tokenWebhook).not.toBe(a.tokenWebhook);
    expect((await goi("viewer").chiTiet({ flowId: def.id })).coTokenWebhook).toBe(true);
  });

  it("★ Đợt 8.2 bí mật: tạo/xoá = admin; danh sách = quyền sửa, KHÔNG giá trị; thiếu khoá ⇒ SERVICE_UNAVAILABLE", async () => {
    const giu = process.env.AI_FLOW_KHOA_BI_MAT;
    process.env.AI_FLOW_KHOA_BI_MAT = Buffer.alloc(32, 9).toString("base64");
    const admin2fa = flowRouter.createCaller({ user: { id: uid, role: "admin", twoFactorEnabled: true } } as never);
    const GIA_TRI = "gia-tri-bi-mat-router-8-2";
    try {
      await expect(goi("engineer").biMatTao({ id: `${TT}-bm`, ten: "x", loai: "token", giaTri: GIA_TRI, hostChoPhep: ["dich.gia"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const tao = await admin2fa.biMatTao({ id: `${TT}-bm`, ten: "Token ERP", loai: "token", giaTri: GIA_TRI, hostChoPhep: ["dich.gia"], factoryId: fid });
      expect(tao).toEqual({ id: `${TT}-bm`, ten: "Token ERP", loai: "token", phienBanKhoa: 1 });
      await expect(admin2fa.biMatTao({ id: `${TT}-bm`, ten: "x", loai: "token", giaTri: GIA_TRI, hostChoPhep: ["dich.gia"] })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(admin2fa.biMatTao({ id: `${TT}-bm2`, ten: "x", loai: "tai-khoan", giaTri: "khongcohaicham", hostChoPhep: ["dich.gia"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(goi("viewer").biMatDanhSach()).rejects.toMatchObject({ code: "FORBIDDEN" });
      const ds = (await goi("engineer").biMatDanhSach()).filter((b) => b.id.startsWith(TT));
      expect(ds).toHaveLength(1);
      expect(JSON.stringify(ds)).not.toContain(GIA_TRI);
      expect(Object.keys(ds[0]).sort()).toEqual(["createdAt", "createdBy", "factoryId", "hostChoPhep", "id", "loai", "phienBanKhoa", "ten"]);
      const dm = await goi("viewer").danhMucNode();
      expect(dm.find((n) => n.type === "tich-hop.http-doc")?.nhanBiMat).toBe(true);
      expect(dm.find((n) => n.type === "du-lieu.ma")).toMatchObject({ tacDungPhu: "thuan", nhanBiMat: false });
      await expect(goi("engineer").biMatXoa({ id: `${TT}-bm` })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await admin2fa.biMatXoa({ id: `${TT}-bm` })).toEqual({ id: `${TT}-bm`, daXoa: true });
      await expect(admin2fa.biMatXoa({ id: `${TT}-bm` })).rejects.toMatchObject({ code: "NOT_FOUND" });
      delete process.env.AI_FLOW_KHOA_BI_MAT;
      await expect(admin2fa.biMatTao({ id: `${TT}-bm3`, ten: "x", loai: "token", giaTri: GIA_TRI, hostChoPhep: ["dich.gia"] })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    } finally {
      if (giu === undefined) delete process.env.AI_FLOW_KHOA_BI_MAT;
      else process.env.AI_FLOW_KHOA_BI_MAT = giu;
    }
  });
});
