/**
 * ★★ Đợt 9 (M2 của kiem-dinh) — HOST CHO PHÉP của từng BÍ MẬT (mig 0412) trên `_test`, động cơ thật + router:
 *   • bí mật chỉ được gắn vào yêu cầu tới host NÓ KHAI (ngoài danh sách trắng chung); khác host ⇒ lỗi, KHÔNG gọi mạng, không gửi tiêu đề;
 *   • bí mật CŨ chưa khai host (mặc định `{}`) ⇒ chưa dùng được cho tới khi admin khai (`flow.biMatDatHost`);
 *   • tạo mới qua API BẮT BUỘC `hostChoPhep`; host sai dạng (scheme, cổng, đường dẫn, ký tự đại diện, khoảng trắng…) ⇒ từ chối.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowCredentials, aiFlowRuns, aiFlowSteps, aiFlows } from "../../../drizzle/schema";
import { flowRouter } from "../../routers/flowRouter";
import { BO_KIEM_CHO_QUA, __datBoKiemChuLuongChoTest } from "./boKiemPhamVi";
import { chuanHoaHost, taoBiMat } from "./biMat";
import { batDauRun, chayMotMuc, luuPhienBan } from "./dongCo";
import { datFetchLuong } from "./nut/tichHop";

const TT = `t9bh${Math.floor(Math.random() * 1e5)}`;
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}, them: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters, ...them });
const noi = (a: string, b: string) => ({ from: { node: a, port: "main" }, to: { node: b, port: "main" } });
const giu = { k: process.env.AI_FLOW_KHOA_BI_MAT, h: process.env.AI_FLOW_HTTP_HOST_CHO_PHEP };
let fetchCu: typeof fetch;
const mang: { url: string; headers: Record<string, string> }[] = [];
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
let uid = 0;

beforeAll(async () => {
  db = (await getDb())!;
  process.env.AI_FLOW_KHOA_BI_MAT = randomBytes(32).toString("base64");
  process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = "dich.gia,khac.gia";
  __datBoKiemChuLuongChoTest(async () => BO_KIEM_CHO_QUA); // lưới này kiểm HOST của bí mật, không phải phạm vi
  fetchCu = datFetchLuong((async (url: URL, init: RequestInit) => {
    mang.push({ url: String(url), headers: { ...(init.headers as Record<string, string>) } });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch);
  const [u] = (await db.execute(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
    VALUES (${TT + "-u"}, ${TT + "_u"}, ${"admin host"}, ${"password"}, ${"admin"}, true, true, now()) RETURNING id`)) as unknown as { id: number }[];
  uid = u.id;
});
afterEach(() => void mang.splice(0));
afterAll(async () => {
  datFetchLuong(fetchCu);
  __datBoKiemChuLuongChoTest(null);
  for (const [k, v] of [["AI_FLOW_KHOA_BI_MAT", giu.k], ["AI_FLOW_HTTP_HOST_CHO_PHEP", giu.h]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await db.delete(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`));
  await db.execute(sql`DELETE FROM users WHERE id = ${uid}`);
});

describe("chuanHoaHost", () => {
  it("hostname hợp lệ: hạ chữ thường, bỏ trùng; dạng lạ ⇒ KHONG_HOP_LE", () => {
    expect(chuanHoaHost(["ERP.Nha-May.vn", "erp.nha-may.vn", "10.0.0.5", "localhost"])).toEqual(["erp.nha-may.vn", "10.0.0.5", "localhost"]);
    for (const xau of ["a/b", "a:80", "*.a.vn", "https://a.vn", "a b", "", " ", "a..b", "-a.vn", "a-.vn", "a.vn/", "a.vn?x", "a@b", "a\nb", "a".repeat(64) + ".vn", 5, null, {}]) {
      expect(() => chuanHoaHost([xau]), JSON.stringify(xau)).toThrow(expect.objectContaining({ code: "KHONG_HOP_LE" }));
    }
    expect(() => chuanHoaHost([])).toThrow();
    expect(() => chuanHoaHost("a.vn")).toThrow();
    expect(() => chuanHoaHost(Array.from({ length: 21 }, (_, i) => `h${i}.vn`))).toThrow();
  });
});

describe("động cơ: bí mật chỉ tới host nó khai", () => {
  const chay = async (ten: string, ref: string, url: string) => {
    const def = { id: `${TT}-${ten}`, name: ten, version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nut("h", "tich-hop.http-doc", { url, kieuXacThuc: "bearer" }, { credentialRef: ref })], connections: [noi("t", "h")] };
    const { version } = await luuPhienBan(def, null);
    const runId = await batDauRun({ flowId: def.id, version, chuLuong: uid, items: [{ json: {} }] });
    for (let i = 0; i < 50 && (await chayMotMuc("w-bh", undefined, TT)); i++);
    const [r] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, runId));
    const [b] = await db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, runId), eq(aiFlowSteps.nodeId, "h")));
    return { status: r.status, loi: JSON.stringify(b?.error ?? null) };
  };

  it("host khớp ⇒ chạy + tiêu đề gửi đi; host KHÁC (dù nằm trong danh sách trắng chung) ⇒ lỗi, không gọi mạng; chưa khai (mặc định) ⇒ không dùng được", async () => {
    await taoBiMat({ id: `${TT}-dung`, ten: "d", loai: "token", giaTri: "gia-tri-bi-mat-12345", hostChoPhep: ["dich.gia"] }, null);
    await taoBiMat({ id: `${TT}-cu`, ten: "cũ", loai: "token", giaTri: "gia-tri-bi-mat-67890" }, null); // KHÔNG khai host (bí mật cũ)
    const ok = await chay("ok", `${TT}-dung`, "https://dich.gia/x");
    expect(ok.status).toBe("xong");
    expect(mang).toHaveLength(1);
    expect(mang[0].headers.Authorization).toBe("Bearer gia-tri-bi-mat-12345");
    mang.splice(0);

    const sai = await chay("sai", `${TT}-dung`, "https://khac.gia/x"); // khac.gia có trong danh sách trắng chung nhưng KHÔNG trong host của bí mật
    expect(sai.status).toBe("loi");
    expect(sai.loi).toContain("không nằm trong danh sách host của bí mật");
    expect(sai.loi).not.toContain("gia-tri-bi-mat");
    const cu = await chay("cu", `${TT}-cu`, "https://dich.gia/x");
    expect(cu.status).toBe("loi");
    expect(cu.loi).toContain("chưa khai host");
    expect(mang, "KHÔNG được gọi mạng khi host không khớp / chưa khai").toHaveLength(0);
  });

  it("host so khớp theo hostname CHỮ THƯỜNG, chính xác (không hậu tố, không tiền tố)", async () => {
    await taoBiMat({ id: `${TT}-ct`, ten: "ct", loai: "token", giaTri: "gia-tri-bi-mat-11111", hostChoPhep: ["dich.gia"] }, null);
    process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = "dich.gia,khac.gia,sub.dich.gia,dich.gia.evil";
    for (const [ten, url] of [["sub", "https://sub.dich.gia/x"], ["evil", "https://dich.gia.evil/x"]] as const) {
      const r = await chay(ten, `${TT}-ct`, url);
      expect(r.status, url).toBe("loi");
    }
    expect((await chay("hoa", `${TT}-ct`, "https://DICH.gia/x")).status).toBe("xong"); // hostname được URL hạ chữ thường
    expect(mang).toHaveLength(1);
    process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = "dich.gia,khac.gia";
  });
});

describe("router: hostChoPhep bắt buộc + biMatDatHost", () => {
  const admin = () => flowRouter.createCaller({ user: { id: uid, role: "admin", twoFactorEnabled: true }, sessionToken: `phien-${TT}` } as never);

  it("tạo KHÔNG khai host / host sai dạng ⇒ BAD_REQUEST; khai đúng ⇒ danh sách trả host; ghiDe vắng host ⇒ giữ host cũ", async () => {
    const a = admin();
    await expect(a.biMatTao({ id: `${TT}-r1`, ten: "r", loai: "token", giaTri: "gia-tri-bi-mat" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.biMatTao({ id: `${TT}-r1`, ten: "r", loai: "token", giaTri: "gia-tri-bi-mat", hostChoPhep: ["https://x.vn"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await a.biMatTao({ id: `${TT}-r1`, ten: "r", loai: "token", giaTri: "gia-tri-bi-mat", hostChoPhep: ["A.vn", "b.vn"] });
    const ds = (await a.biMatDanhSach()).find((b) => b.id === `${TT}-r1`);
    expect(ds?.hostChoPhep).toEqual(["a.vn", "b.vn"]);
    await a.biMatTao({ id: `${TT}-r1`, ten: "r2", loai: "token", giaTri: "gia-tri-moi-1234", ghiDe: true });
    expect((await a.biMatDanhSach()).find((b) => b.id === `${TT}-r1`)?.hostChoPhep).toEqual(["a.vn", "b.vn"]);
  });

  it("biMatDatHost: bí mật cũ chưa khai ⇒ khai xong dùng được; id không có ⇒ NOT_FOUND; host sai ⇒ BAD_REQUEST; không đụng giá trị", async () => {
    const a = admin();
    await taoBiMat({ id: `${TT}-r2`, ten: "cũ", loai: "token", giaTri: "gia-tri-bi-mat-22222" }, null);
    const truoc = (await db.select().from(aiFlowCredentials).where(eq(aiFlowCredentials.id, `${TT}-r2`)))[0];
    expect(truoc.hostChoPhep).toEqual([]);
    await expect(a.biMatDatHost({ id: `${TT}-khong-co`, hostChoPhep: ["dich.gia"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.biMatDatHost({ id: `${TT}-r2`, hostChoPhep: ["dich.gia:8080"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await a.biMatDatHost({ id: `${TT}-r2`, hostChoPhep: ["Dich.gia"] })).toEqual({ id: `${TT}-r2`, hostChoPhep: ["dich.gia"] });
    const sau = (await db.select().from(aiFlowCredentials).where(eq(aiFlowCredentials.id, `${TT}-r2`)))[0];
    expect(Buffer.from(sau.banMa).equals(Buffer.from(truoc.banMa))).toBe(true);
    const def = { id: `${TT}-r2f`, name: "r2f", version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), nut("h", "tich-hop.http-doc", { url: "https://dich.gia/x", kieuXacThuc: "bearer" }, { credentialRef: `${TT}-r2` })], connections: [noi("t", "h")] };
    const { version } = await luuPhienBan(def, null);
    const runId = await batDauRun({ flowId: def.id, version, chuLuong: uid, items: [{ json: {} }] });
    for (let i = 0; i < 50 && (await chayMotMuc("w-bh", undefined, TT)); i++);
    expect((await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, runId)))[0].status).toBe("xong");
  });
});
