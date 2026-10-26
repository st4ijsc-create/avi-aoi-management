/**
 * ★★★ Lô Luồng-form (2026-10-25) — `flow.nguoiNhanChoLuong` (chọn người nhận cho node thông báo) + kiểm tham số tĩnh lúc LƯU, trên `_test` với hai nhà máy A/B:
 *   chỉ người ĐANG HOẠT ĐỘNG có phạm vi chứa nhà máy luồng (cùng hàm node dùng lúc chạy) · luồng toàn-hệ-thống ⇒ chỉ người toàn quyền · luồng ngoài phạm vi ≡ NOT_FOUND ·
 * bắt buộc tìm theo tên (≥ 2 ký tự, `%`/`_` không phải ký tự đại diện) · trần kết quả · chỉ id + tên + vai trò · `luu` chặn tham số sai (form hay JSON thô như nhau).
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiFlows } from "../../drizzle/schema";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { nguoiNhanHopLeTheoNhaMay } from "../services/flow/nut/thongBao";
import { flowRouter } from "./flowRouter";

const RUN = `nn${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const TT = `t4nn${Math.floor(Math.random() * 1e5)}`;
const FA = `NNA_${RUN}`.slice(0, 50);
const FB = `NNB_${RUN}`.slice(0, 50);
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const luongDef = (id: string, them: unknown[] = []) => ({ id, name: id, version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), ...them], connections: [] });

const f: Record<string, number> = {};
const u: Record<string, number> = {};
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
const goi = (id: number, role: string) => flowRouter.createCaller({ user: { id, role, twoFactorEnabled: true }, sessionToken: `phien-${id}` } as never);
const luongA = `${TT}-a`;
const luongG = `${TT}-g`;

async function mkUser(ten: string, role: "engineer" | "supervisor" | "admin", nhaMay: string[], hoatDong = true): Promise<number> {
  const r = await taoNguoiDungTest(ten, role, { tienTo: RUN, ten: `${RUN} ${ten}`, ts: 1, extra: { isActive: hoatDong, email: `${RUN}-${ten}@example.test` } });
  for (const c of nhaMay) await db.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${r.id}, ${c})`);
  return r.id;
}

beforeAll(async () => {
  db = (await getDb())!;
  for (const [k, c] of [["a", FA], ["b", FB]] as const) {
    const [r] = (await db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${c}, ${"NN " + c}, true) RETURNING id`)) as unknown as { id: number }[];
    f[k] = r.id;
  }
  u.A = await mkUser("a", "engineer", [FA]);
  u.sup = await mkUser("sup", "supervisor", [FA]);
  u.B = await mkUser("b", "engineer", [FB]);
  u.AB = await mkUser("ab", "engineer", [FA, FB]);
  u.admin = await mkUser("admin", "admin", []);
  u.khoa = await mkUser("khoa", "engineer", [FA], false);
  u.khong = await mkUser("khong", "engineer", []);
  await goi(u.A, "engineer").luu({ definition: luongDef(luongA) });
  await goi(u.admin, "admin").luu({ definition: luongDef(luongG) });
}, 120_000);

afterAll(async () => {
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql.raw(`(${Object.values(u).join(",")})`)}`);
  await db.execute(sql`DELETE FROM factories WHERE id IN (${f.a}, ${f.b})`);
});

describe("flow.nguoiNhanChoLuong", () => {
  it("★ luồng nhà máy A: chỉ người ĐANG HOẠT ĐỘNG thấy A (A, giám sát A, A+B, admin toàn quyền); KHÔNG có người chỉ B, người bị khoá, người chưa gán", async () => {
    const r = await goi(u.A, "engineer").nguoiNhanChoLuong({ flowId: luongA, tim: RUN });
    expect(r.map((x) => x.id).sort()).toEqual([u.A, u.sup, u.AB, u.admin].sort());
    expect(r.some((x) => x.id === u.B || x.id === u.khoa || x.id === u.khong)).toBe(false);
  });

  it("chỉ id + tên + vai trò (KHÔNG email / điện thoại / tên đăng nhập)", async () => {
    const r = await goi(u.A, "engineer").nguoiNhanChoLuong({ flowId: luongA, tim: RUN });
    for (const x of r) expect(Object.keys(x).sort()).toEqual(["id", "ten", "vaiTro"]);
    expect(JSON.stringify(r)).not.toContain("@example.test");
  });

  it("★ khớp với luật của node lúc chạy: mọi người được trả đều qua nguoiNhanHopLeTheoNhaMay(nhà máy luồng); người bị loại thì không", async () => {
    const r = await goi(u.A, "engineer").nguoiNhanChoLuong({ flowId: luongA, tim: RUN });
    for (const x of r) expect(await nguoiNhanHopLeTheoNhaMay({ id: x.id, role: x.vaiTro, isActive: true }, f.a)).toBe(true);
    expect(await nguoiNhanHopLeTheoNhaMay({ id: u.B, role: "engineer", isActive: true }, f.a)).toBe(false);
  });

  it("★ luồng TOÀN HỆ THỐNG: chỉ người toàn quyền (admin) — kỹ sư A không có trong danh sách", async () => {
    const r = await goi(u.admin, "admin").nguoiNhanChoLuong({ flowId: luongG, tim: RUN });
    expect(r.map((x) => x.id)).toEqual([u.admin]);
  });

  it("★ luồng ngoài phạm vi người gọi ≡ NOT_FOUND (kỹ sư chỉ B hỏi luồng A; kỹ sư A hỏi luồng toàn-hệ-thống); luồng không tồn tại cùng mã", async () => {
    await expect(goi(u.B, "engineer").nguoiNhanChoLuong({ flowId: luongA, tim: RUN })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(goi(u.A, "engineer").nguoiNhanChoLuong({ flowId: luongG, tim: RUN })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(goi(u.A, "engineer").nguoiNhanChoLuong({ flowId: `${TT}-khong-co`, tim: RUN })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("bắt buộc tìm theo tên: 1 ký tự bị từ chối; `%%` và `__` KHÔNG là ký tự đại diện (không liệt kê hết); trần kết quả theo gioiHan", async () => {
    const A = goi(u.A, "engineer");
    await expect(A.nguoiNhanChoLuong({ flowId: luongA, tim: "a" })).rejects.toBeTruthy();
    // `%`/`_` là ký tự THƯỜNG: chuỗi "%%" / "__" không khớp tên người dùng của lưới này (nếu là ký tự đại diện thì khớp tất cả)
    for (const tim of ["%%", "__"]) {
      const kq = await A.nguoiNhanChoLuong({ flowId: luongA, tim });
      expect(kq.some((x) => Object.values(u).includes(x.id)), tim).toBe(false);
    }
    expect((await A.nguoiNhanChoLuong({ flowId: luongA, tim: RUN, gioiHan: 2 })).length).toBe(2);
  });
});

describe("luu: kiểm tham số tĩnh của 4 node (cùng luật cho form và JSON thô)", () => {
  const A = () => goi(u.A, "engineer");
  const sai = (id: string, node: ReturnType<typeof nut>) => expect(A().luu({ definition: luongDef(`${TT}-${id}`, [node]) })).rejects.toMatchObject({ code: "BAD_REQUEST" });

  it("so-lieu: truy vấn ngoài danh mục / giờ ngoài khoảng ⇒ từ chối; hợp lệ ⇒ lưu được", async () => {
    await sai("s1", nut("s", "du-lieu.so-lieu", { truyVan: "drop-table", gio: 8 }));
    await sai("s2", nut("s", "du-lieu.so-lieu", { truyVan: "san-luong.tong-quan", gio: 9999 }));
    await sai("s3", nut("s", "du-lieu.so-lieu", { truyVan: "{{ $json.q }}" }));
    await A().luu({ definition: luongDef(`${TT}-s-ok`, [nut("s", "du-lieu.so-lieu", { truyVan: "san-luong.tong-quan", gio: 12, gioiHan: 5 })]) });
  });

  it("thong-bao: > 20 người nhận / loai / uuTien lạ ⇒ từ chối; mảng rỗng (mẫu chờ điền) và biểu thức vẫn lưu được", async () => {
    await sai("t1", nut("n", "tich-hop.thong-bao", { nguoiNhan: Array.from({ length: 21 }, (_, i) => i + 1), tieuDe: "x" }));
    await sai("t2", nut("n", "tich-hop.thong-bao", { nguoiNhan: [1], tieuDe: "x", loai: "EMAIL" }));
    await sai("t3", nut("n", "tich-hop.thong-bao", { nguoiNhan: [1], tieuDe: "x", uuTien: "URGENT" }));
    await sai("t4", nut("n", "tich-hop.thong-bao", { nguoiNhan: ["abc"], tieuDe: "x" }));
    await A().luu({ definition: luongDef(`${TT}-t-ok1`, [nut("n", "tich-hop.thong-bao", { nguoiNhan: [], tieuDe: "x" })]) });
    await A().luu({ definition: luongDef(`${TT}-t-ok2`, [nut("n", "tich-hop.thong-bao", { nguoiNhan: "{{ $json.ds }}", tieuDe: "x", loai: "{{ $json.l }}" })]) });
  });

  it("★ thong-bao.duongDan: URL ngoài / '//' / javascript: / dấu gạch ngược ⇒ 400 (CÙNG safeInternalPath với chuông); '/flow/123' và để trống ⇒ lưu được", async () => {
    for (const [i, duongDan] of ["https://evil", "//evil", "javascript:alert(1)", "\\\\evil", "/\\\\evil", "evil", "/a\tb"].entries()) {
      await sai(`dd${i}`, nut("n", "tich-hop.thong-bao", { nguoiNhan: [], tieuDe: "x", duongDan }));
    }
    await A().luu({ definition: luongDef(`${TT}-dd-ok1`, [nut("n", "tich-hop.thong-bao", { nguoiNhan: [], tieuDe: "x", duongDan: "/flow/123" })]) });
    await A().luu({ definition: luongDef(`${TT}-dd-ok2`, [nut("n", "tich-hop.thong-bao", { nguoiNhan: [], tieuDe: "x", duongDan: "" })]) });
    await A().luu({ definition: luongDef(`${TT}-dd-ok3`, [nut("n", "tich-hop.thong-bao", { nguoiNhan: [], tieuDe: "x", duongDan: "{{ $json.url }}" })]) });
  });

  it("su-kien / tao-phieu: sự kiện lạ, nhóm lạ, ưu tiên ngoài 1..5 ⇒ từ chối", async () => {
    await sai("e1", nut("e", "kich-hoat.su-kien", { suKien: "order.created", bat: true }));
    await sai("p1", nut("p", "bao-tri.tao-phieu", { may: 1, tieuDe: "abc", nhom: "ma-thuat" }));
    await sai("p2", nut("p", "bao-tri.tao-phieu", { may: 1, tieuDe: "abc", uuTien: 9 }));
    await A().luu({ definition: luongDef(`${TT}-p-ok`, [nut("p", "bao-tri.tao-phieu", { may: "{{ $json.idMay }}", tieuDe: "abc", nhom: "dien", uuTien: 2 })]) });
  });
});
