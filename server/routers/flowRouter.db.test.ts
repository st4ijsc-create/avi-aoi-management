/**
 * Đợt 8.1 Task 5 — router `flow` trên CSDL `_test` qua `createCaller` (sàn quyền THẬT của tRPC, giấy phép tắt):
 * vai chỉ-đọc không ghi · lưu luồng sai ⇒ BAD_REQUEST kèm danh sách lỗi · bật luồng hạng `ngoai-ghi` chỉ admin (chạy tay
 * phiên bản hạng ấy chưa bật cũng vậy) · webhook ⇒ token đúng một lần · chạy tay ⇒ chờ duyệt ⇒ `duyet` ⇒ xong; duyệt lần
 * hai ⇒ CONFLICT · dòng thời gian cắt dữ liệu dài · danh mục node.
 */
import { vi } from "vitest";
import { donLuongTheoTienTo, donNhaMayVaNguoiTheoMa } from "../services/flow/__donDuLieuTest";
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
beforeAll(async () => {
  // Dọn dữ liệu SÓT của lượt trước bị ngắt (afterAll không chạy) — xem services/flow/__donDuLieuTest.ts
  await donLuongTheoTienTo(TT);
  await donNhaMayVaNguoiTheoMa(MA_NM, TT + "-");
});
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0], parameters });
const noi = (a: string, pa: string, b: string) => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });

let uid = 0;
// H2 (2026-10-21): người duyệt phải KHÁC người bật / người chạy tay lượt ⇒ các ca duyệt dùng người THỨ HAI / THỨ BA.
let uid2 = 0;
let uid3 = 0;
const goi = (role: string) => flowRouter.createCaller({ user: { id: uid, role } } as never);
const goiAs = (role: string, id: number) => flowRouter.createCaller({ user: { id, role } } as never);

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
  // H2: người duyệt phải KHÁC người bật / chủ lượt ⇒ hai người duyệt riêng (cùng nhà máy của test để qua phạm vi nhà máy).
  const [uid2Moi] = (await db0.execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
    VALUES (${TT + "-d2-" + Date.now().toString(36)}, ${TT + "_d2_" + Date.now().toString(36)}, ${"người duyệt d2"}, ${"password"}, ${"supervisor"}, true, false, now()) RETURNING id`)) as unknown as { id: number }[];
  uid2 = uid2Moi.id;
  await db0.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid2}, ${MA_NM})`);
  const [uid3Moi] = (await db0.execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
    VALUES (${TT + "-d3-" + Date.now().toString(36)}, ${TT + "_d3_" + Date.now().toString(36)}, ${"người duyệt d3"}, ${"password"}, ${"supervisor"}, true, false, now()) RETURNING id`)) as unknown as { id: number }[];
  uid3 = uid3Moi.id;
  await db0.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid3}, ${MA_NM})`);
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
    expect(await goiAs("supervisor", uid2).duyet({ runId, nodeId: "d", dongY: true, lyDo: "đủ" })).toEqual({ ok: true, cong: "dong-y" });
    await expect(goiAs("supervisor", uid2).duyet({ runId, nodeId: "d", dongY: false })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(goiAs("supervisor", uid2).duyet({ runId, nodeId: "khong-co", dongY: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await chayHet();

    const dt = await goi("viewer").dongThoiGian({ runId });
    expect(dt.run.status).toBe("xong");
    const ok = dt.buoc.find((b) => b.nodeId === "ok")!;
    expect(ok.output).toMatchObject({ __catBot: true });
    // CSDL giữ bản ĐẦY ĐỦ (chỉ API cắt): item ra của bước duyệt mang người duyệt = người gọi.
    const [dDb] = (await (await getDb())!.execute(sql`SELECT output FROM ai_flow_steps WHERE "runId" = ${runId} AND "nodeId" = 'd'`)) as unknown as { output: { "dong-y": { json: { duyet: unknown } }[] } }[];
    expect(dDb.output["dong-y"][0].json.duyet).toEqual({ dongY: true, nguoi: uid2, lyDo: "đủ" });
    expect(dt.suKien.map((e) => e.kind)).toContain("cho.tra-loi");
    const ls = await goi("viewer").lichSuChay({ flowId: `${TT}-duyet`, gioiHan: 5 });
    expect(ls[0]).toMatchObject({ id: runId, status: "xong", triggerKind: "thu-cong" });
  });

  it("hai người duyệt đồng thời ⇒ đúng một thành công, người kia CONFLICT", async () => {
    const { runId } = await goi("engineer").chayTay({ flowId: `${TT}-duyet`, items: [{ json: { ma: "RCA-2", x: 1 } }] });
    await chayHet();
    const kq = await Promise.allSettled([
      goiAs("supervisor", uid2).duyet({ runId, nodeId: "d", dongY: true }),
      goiAs("admin", uid3).duyet({ runId, nodeId: "d", dongY: false }),
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
    // ★ Đợt 9 (L3): luồng ĐÃ BẬT hạng ngoai-ghi — engineer vẫn KHÔNG chạy tay được; admin được
    await expect(goi("engineer").chayTay({ flowId: def.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(goi("engineer").chayTay({ flowId: def.id, version })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await goi("admin").chayTay({ flowId: def.id })).runId).toBeTruthy();
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

const luongBieuMau = {
  id: `${TT}-bm`, name: "biểu mẫu", version: 1,
  nodes: [
    nut("t", "kich-hoat.thu-cong"),
    nut("b", "nguoi.bieu-mau", {
      tieuDe: "Nhập nguyên nhân {{ $json.ma }}",
      truong: [
        { ten: "nguyenNhan", nhan: "Nguyên nhân", kieu: "chon", luaChon: ["dien", "co-khi"], batBuoc: true },
        { ten: "soLan", nhan: "Số lần", kieu: "so" },
        { ten: "daXuLy", nhan: "Đã xử lý", kieu: "boolean" },
        { ten: "ghiChu", nhan: "Ghi chú", kieu: "chuoi" },
      ],
      truongRa: "bieuMau",
    }),
    nut("ok", "du-lieu.dat", { truong: { kq: "da-dien" } }),
    nut("ko", "du-lieu.dat", { truong: { kq: "bo-qua" } }),
  ],
  connections: [noi("t", "main", "b"), noi("b", "dong-y", "ok"), noi("b", "tu-choi", "ko")],
};

describe("nguoi.bieu-mau qua flow.duyet (DB)", () => {
  const dauVao = async (runId: string, nodeId: string) => {
    const db = (await getDb())!;
    const [b] = (await db.execute(sql`SELECT input FROM ai_flow_steps WHERE "runId" = ${runId} AND "nodeId" = ${nodeId} ORDER BY id DESC LIMIT 1`)) as unknown as { input: { main?: { json: Record<string, unknown> }[] } }[];
    return b?.input.main?.map((i) => i.json) ?? null;
  };
  const moLuot = async (ma: string) => {
    const { runId } = await goi("engineer").chayTay({ flowId: `${TT}-bm`, items: [{ json: { ma } }] });
    await chayHet();
    return runId;
  };

  it("★ thẻ mang định nghĩa trường; giá trị KIỂM LẠI phía máy chủ: thiếu bắt buộc / sai kiểu / ngoài lựa chọn / chuỗi số cho trường số ⇒ BAD_REQUEST, thẻ GIỮ NGUYÊN; hợp lệ ⇒ dong-y, item mang bieuMau (khoá lạ bị loại)", async () => {
    await goi("engineer").luu({ definition: luongBieuMau });
    const runId = await moLuot("RCA-9");
    const the = (await goi("viewer").danhSachCho()).find((c) => c.runId === runId)!;
    expect(the.tieuDe).toBe("Nhập nguyên nhân RCA-9");
    expect(the.bieuMau?.map((f) => f.ten)).toEqual(["nguyenNhan", "soLan", "daXuLy", "ghiChu"]);
    const duyet = (bieuMau: Record<string, string | number | boolean | null>) => goiAs("supervisor", uid2).duyet({ runId, nodeId: "b", dongY: true, bieuMau });
    await expect(duyet({})).rejects.toMatchObject({ code: "BAD_REQUEST" }); // thiếu nguyenNhan
    await expect(duyet({ nguyenNhan: "linh-tinh" })).rejects.toMatchObject({ code: "BAD_REQUEST" }); // ngoài lựa chọn
    await expect(duyet({ nguyenNhan: "dien", soLan: "3" })).rejects.toMatchObject({ code: "BAD_REQUEST" }); // chuỗi số, không ép kiểu
    await expect(duyet({ nguyenNhan: "dien", daXuLy: "true" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(duyet({ nguyenNhan: "dien", ghiChu: "x".repeat(2001) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await goi("viewer").danhSachCho()).some((c) => c.runId === runId)).toBe(true); // thẻ còn nguyên
    expect(await duyet({ nguyenNhan: "co-khi", soLan: 3, daXuLy: true, ghiChu: "đã thay vòng bi", khoaLa: "bi-loai" })).toEqual({ ok: true, cong: "dong-y" });
    await chayHet();
    expect(await dauVao(runId, "ok")).toEqual([
      { ma: "RCA-9", duyet: { dongY: true, nguoi: uid2, lyDo: null }, bieuMau: { nguyenNhan: "co-khi", soLan: 3, daXuLy: true, ghiChu: "đã thay vòng bi" } },
    ]);
    expect(await dauVao(runId, "ko")).toBeNull();
  });

  it("trường không bắt buộc để trống ⇒ null; bỏ qua (tu-choi) ⇒ đi cổng tu-choi, giá trị gửi kèm bị BỎ (không vào item)", async () => {
    const r1 = await moLuot("RCA-10");
    await goiAs("supervisor", uid2).duyet({ runId: r1, nodeId: "b", dongY: true, bieuMau: { nguyenNhan: "dien", ghiChu: "" } });
    await chayHet();
    expect((await dauVao(r1, "ok"))![0].bieuMau).toEqual({ nguyenNhan: "dien", soLan: null, daXuLy: null, ghiChu: null });
    const r2 = await moLuot("RCA-11");
    await goiAs("supervisor", uid2).duyet({ runId: r2, nodeId: "b", dongY: false, bieuMau: { nguyenNhan: "linh-tinh" } });
    await chayHet();
    expect(await dauVao(r2, "ok")).toBeNull();
    expect(JSON.stringify(await dauVao(r2, "ko"))).not.toContain("linh-tinh");
  });

  it("quyền như nguoi.duyet: vai thấp ⇒ FORBIDDEN (không lộ lỗi giá trị); gửi bieuMau cho thẻ KHÔNG phải biểu mẫu ⇒ BAD_REQUEST", async () => {
    const runId = await moLuot("RCA-12");
    await expect(goi("viewer").duyet({ runId, nodeId: "b", dongY: true, bieuMau: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await goi("engineer").luu({ definition: luongDuyet });
    const { runId: rd } = await goi("engineer").chayTay({ flowId: `${TT}-duyet`, items: [{ json: { ma: "R" } }] });
    await chayHet();
    await expect(goiAs("supervisor", uid2).duyet({ runId: rd, nodeId: "d", dongY: true, bieuMau: { a: 1 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await goiAs("supervisor", uid2).duyet({ runId: rd, nodeId: "d", dongY: true })).toEqual({ ok: true, cong: "dong-y" });
  });

  it("định nghĩa trường SAI bị chặn lúc lưu (flow.luu ⇒ BAD_REQUEST): trùng tên, thiếu lựa chọn, 21 trường", async () => {
    const dinh = (truong: unknown) => ({ ...luongBieuMau, id: `${TT}-bm-sai`, nodes: luongBieuMau.nodes.map((n) => (n.id === "b" ? { ...n, parameters: { ...n.parameters, truong } } : n)) });
    await expect(goi("engineer").luu({ definition: dinh([{ ten: "a", nhan: "A", kieu: "chuoi" }, { ten: "a", nhan: "B", kieu: "so" }]) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(goi("engineer").luu({ definition: dinh([{ ten: "a", nhan: "A", kieu: "chon", luaChon: [] }]) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(goi("engineer").luu({ definition: dinh(Array.from({ length: 21 }, (_, i) => ({ ten: `t${i}`, nhan: "x", kieu: "chuoi" }))) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("chonModel của node AI (Đợt 10.2) qua flow.luu / nhapXemTruoc", () => {
  const luongCm = (cm: unknown, id = `${TT}-cm`) => ({
    id, name: "cm", version: 1,
    nodes: [nut("t", "kich-hoat.thu-cong"), nut("a", "ai.llm", { loiNhac: "x", vaiTro: "chat", chonModel: cm }), nut("b", "du-lieu.dat", { truong: { k: 1 } })],
    connections: [noi("t", "main", "a"), noi("a", "main", "b")],
  });

  it("★ lưu chonModel hợp lệ ⇒ được; biểu thức / sai dạng ⇒ BAD_REQUEST nêu node 'a' (không nêu node khác)", async () => {
    await expect(goi("engineer").luu({ definition: luongCm("vai-tro:chat") })).resolves.toMatchObject({ flowId: `${TT}-cm` });
    for (const cm of ["{{ $json.model }}", "tep.gguf"]) {
      const e = await goi("engineer").luu({ definition: luongCm(cm, `${TT}-cm2`) }).catch((x) => x);
      expect(e).toMatchObject({ code: "BAD_REQUEST" });
      expect(String(e.message)).toContain("node 'a'");
      expect(String(e.message)).not.toContain("node 'b'");
    }
  });

  it("★ nhapXemTruoc gói thật: chonModel ho-so:<không có ở máy này> ⇒ canhBao nêu node 'a'; vai-tro:* ⇒ không cảnh báo", async () => {
    const { taoGoi } = await import("../services/flow/xuatNhap");
    const goiLa = taoGoi(luongCm("ho-so:khong-co-o-may-nay", "x-nhap") as never).goi;
    const ra = await goi("engineer").nhapXemTruoc({ goi: goiLa });
    expect(ra.canhBao.join("\n")).toContain("node 'a'");
    expect(ra.canhBao.join("\n")).toContain("khong-co-o-may-nay");
    const goiVai = taoGoi(luongCm("vai-tro:chat", "x-nhap2") as never).goi;
    expect((await goi("engineer").nhapXemTruoc({ goi: goiVai })).canhBao.join("\n")).not.toContain("hồ sơ model");
  });
});
