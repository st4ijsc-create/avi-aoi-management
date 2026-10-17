/**
 * ★★★ Đợt 4A — tầng dữ liệu token theo người dùng (mig 0392) trên CSDL `_test` THẬT.
 *
 * Canh: (1) bản rõ KHÔNG BAO GIỜ nằm trong CSDL (chỉ băm); (2) token sai/hết hạn/thu hồi/tài khoản tắt ⇒ mã riêng;
 * (3) phạm vi chủ sở hữu (thu hồi token người khác = không có gì xảy ra); (4) device flow: mã 10 phút, dùng MỘT lần,
 * từ chối/hết hạn/hỏi quá nhanh có mã riêng, đổi lần hai ⇒ không ra token thứ hai.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { createLocalUser } from "./auth";
import { users, userSecrets } from "../../drizzle/schema/auth";
import { aiGatewayTokens, aiGatewayDeviceCodes } from "../../drizzle/schema";
import {
  taoTokenNguoiDung,
  xacThucTokenNguoiDung,
  danhSachTokenCuaToi,
  thuHoiToken,
  batDauThietBi,
  xemThietBi,
  quyetThietBi,
  doiMaThietBi,
} from "./aiGatewayTokens";
import { bamToken, TRAN_TOKEN_HIEU_LUC } from "../services/ai/gatewayToken/maToken";

let uidA = 0;
let uidB = 0;

async function taoNguoi(ten: string): Promise<number> {
  const bcrypt = await import("bcryptjs");
  const kq = await createLocalUser({
    username: `gw-token-${ten}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    passwordHash: await bcrypt.hash("Mk-gw-token!1", 4),
    name: `GW ${ten}`,
    role: "engineer",
  });
  return kq.id;
}

beforeAll(async () => {
  uidA = await taoNguoi("a");
  uidB = await taoNguoi("b");
}, 60_000);

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  for (const id of [uidA, uidB]) {
    if (id <= 0) continue;
    await db.delete(aiGatewayDeviceCodes).where(eq(aiGatewayDeviceCodes.userId, id));
    await db.delete(aiGatewayTokens).where(eq(aiGatewayTokens.userId, id));
    await db.delete(userSecrets).where(eq(userSecrets.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  await db.delete(aiGatewayDeviceCodes).where(sql`ten LIKE 'luoi-tb-%'`);
});

describe("token theo người dùng — chỉ lưu BĂM", () => {
  it("tạo ⇒ bản rõ trả MỘT lần; CSDL chỉ có băm sha256 + tiền tố, không cột nào chứa bản rõ", async () => {
    const kq = await taoTokenNguoiDung({ userId: uidA, ten: "VSCode máy A" });
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.token).toMatch(/^avgw_[A-Za-z0-9_-]{43}$/);
    expect(kq.phamVi).toEqual(["chat", "fim"]);
    const db = (await getDb())!;
    const [h] = await db.select().from(aiGatewayTokens).where(eq(aiGatewayTokens.id, kq.id));
    expect(h.tokenHash).toBe(bamToken(kq.token));
    expect(h.tienTo).toBe(kq.token.slice(0, 12));
    // ∀ cột: bản rõ không xuất hiện ở đâu cả (kể cả cắt đuôi).
    const toanHang = JSON.stringify(h);
    expect(toanHang.includes(kq.token)).toBe(false);
    expect(toanHang.includes(kq.token.slice(12))).toBe(false);
    // Hạn mặc định 90 ngày (đo trong SQL — không so giờ JS với cột).
    const [d] = (await db.execute(
      sql`SELECT round(extract(epoch FROM ("hetHanLuc" - "createdAt")) / 86400)::int AS n FROM ai_gateway_tokens WHERE id = ${kq.id}`,
    )) as unknown as Array<{ n: number }>;
    expect(Number(d.n)).toBe(90);
  });

  it("xác thực: đúng ⇒ userId + phạm vi; sai/thiếu ⇒ khong-hop-le; hết hạn ⇒ het-han; thu hồi ⇒ thu-hoi", async () => {
    const kq = await taoTokenNguoiDung({ userId: uidA, ten: "xac thuc", phamVi: ["chat", "embed"], soNgay: 7 });
    if (!kq.ok) throw new Error("tạo hỏng");
    const ok = await xacThucTokenNguoiDung(kq.token);
    expect(ok).toMatchObject({ ok: true, userId: uidA, tokenId: kq.id, phamVi: ["chat", "embed"], role: "engineer" });

    expect(await xacThucTokenNguoiDung("avgw_" + "x".repeat(43))).toEqual({ ok: false, ma: "khong-hop-le" });
    expect(await xacThucTokenNguoiDung("sk-not-ours")).toEqual({ ok: false, ma: "khong-hop-le" });

    const db = (await getDb())!;
    await db.execute(
      sql`UPDATE ai_gateway_tokens SET "createdAt" = now() - interval '10 days', "hetHanLuc" = now() - interval '1 second' WHERE id = ${kq.id}`,
    );
    expect(await xacThucTokenNguoiDung(kq.token)).toEqual({ ok: false, ma: "het-han" });

    const kq2 = await taoTokenNguoiDung({ userId: uidA, ten: "thu hoi" });
    if (!kq2.ok) throw new Error("tạo hỏng");
    expect(await thuHoiToken(uidA, kq2.id)).toBe(true);
    expect(await xacThucTokenNguoiDung(kq2.token)).toEqual({ ok: false, ma: "thu-hoi" });
    // Thu hồi lần hai: không có gì để thu hồi.
    expect(await thuHoiToken(uidA, kq2.id)).toBe(false);
  });

  it("tài khoản bị vô hiệu hoá ⇒ tai-khoan-tat (token vẫn còn hạn nhưng không mở được cổng)", async () => {
    const uidC = await taoNguoi("c");
    try {
      const kq = await taoTokenNguoiDung({ userId: uidC, ten: "tat" });
      if (!kq.ok) throw new Error("tạo hỏng");
      const db = (await getDb())!;
      await db.update(users).set({ isActive: false }).where(eq(users.id, uidC));
      expect(await xacThucTokenNguoiDung(kq.token)).toEqual({ ok: false, ma: "tai-khoan-tat" });
    } finally {
      const db = (await getDb())!;
      await db.delete(aiGatewayTokens).where(eq(aiGatewayTokens.userId, uidC));
      await db.delete(userSecrets).where(eq(userSecrets.userId, uidC));
      await db.delete(users).where(eq(users.id, uidC));
    }
  });

  it("phạm vi CHỦ: B không thu hồi được token của A, và danh sách của B không thấy token của A", async () => {
    const kq = await taoTokenNguoiDung({ userId: uidA, ten: "cua A" });
    if (!kq.ok) throw new Error("tạo hỏng");
    expect(await thuHoiToken(uidB, kq.id)).toBe(false);
    expect((await xacThucTokenNguoiDung(kq.token)).ok).toBe(true);
    const dsB = await danhSachTokenCuaToi(uidB);
    expect(dsB.some((t) => t.id === kq.id)).toBe(false);
    const dsA = await danhSachTokenCuaToi(uidA);
    const muc = dsA.find((t) => t.id === kq.id)!;
    expect(muc).toMatchObject({ ten: "cua A", trangThai: "hieu-luc", tienTo: kq.token.slice(0, 12) });
    // Danh sách KHÔNG BAO GIỜ mang băm hay bản rõ.
    expect(JSON.stringify(dsA)).not.toContain(bamToken(kq.token));
    expect(Object.keys(muc)).not.toContain("tokenHash");
  });

  it("trần token còn hiệu lực mỗi người ⇒ qua-tran", async () => {
    const uidD = await taoNguoi("d");
    try {
      for (let i = 0; i < TRAN_TOKEN_HIEU_LUC; i++) {
        expect((await taoTokenNguoiDung({ userId: uidD, ten: `t${i}` })).ok).toBe(true);
      }
      expect(await taoTokenNguoiDung({ userId: uidD, ten: "thua" })).toEqual({ ok: false, ma: "qua-tran" });
    } finally {
      const db = (await getDb())!;
      await db.delete(aiGatewayTokens).where(eq(aiGatewayTokens.userId, uidD));
      await db.delete(userSecrets).where(eq(userSecrets.userId, uidD));
      await db.delete(users).where(eq(users.id, uidD));
    }
  }, 30_000);
});

describe("device flow — mã 10 phút, dùng một lần", () => {
  it("bắt đầu ⇒ duyệt ⇒ đổi ra token của người duyệt; đổi lần hai ⇒ KHÔNG ra token thứ hai", async () => {
    const bd = await batDauThietBi({ ten: "luoi-tb-1 VSCode", phamVi: ["chat", "fim"] });
    if (!bd.ok) throw new Error("bắt đầu hỏng");
    expect(bd.maThietBi).toMatch(/^avgd_/);
    expect(bd.maNguoiDung).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(bd.hetHanGiay).toBe(600);

    // CSDL chỉ có băm của mã thiết bị.
    const db = (await getDb())!;
    const [h] = await db.select().from(aiGatewayDeviceCodes).where(eq(aiGatewayDeviceCodes.maNguoiDung, bd.maNguoiDung));
    expect(h.maThietBiHash).toBe(bamToken(bd.maThietBi));
    expect(JSON.stringify(h)).not.toContain(bd.maThietBi);

    expect(await doiMaThietBi(bd.maThietBi)).toEqual({ trangThai: "cho" });
    // Hỏi lại ngay ⇒ chậm lại (chu kỳ tối thiểu).
    expect(await doiMaThietBi(bd.maThietBi)).toEqual({ trangThai: "cham-lai" });

    expect(await xemThietBi(bd.maNguoiDung.toLowerCase().replace("-", " "))).toMatchObject({
      ok: true,
      ten: "luoi-tb-1 VSCode",
      phamVi: ["chat", "fim"],
    });
    expect(await quyetThietBi(uidA, bd.maNguoiDung, true)).toMatchObject({ ok: true, trangThai: "da-duyet" });
    // Duyệt lần hai (kể cả người khác) ⇒ đã xử lý, không đổi chủ.
    expect(await quyetThietBi(uidB, bd.maNguoiDung, true)).toEqual({ ok: false, ma: "da-xu-ly" });

    await db.execute(sql`UPDATE ai_gateway_device_codes SET "hoiLanCuoiLuc" = NULL WHERE "maNguoiDung" = ${bd.maNguoiDung}`);
    const doi = await doiMaThietBi(bd.maThietBi);
    expect(doi.trangThai).toBe("xong");
    if (doi.trangThai !== "xong") return;
    expect(doi.userId).toBe(uidA);
    const xt = await xacThucTokenNguoiDung(doi.token);
    expect(xt).toMatchObject({ ok: true, userId: uidA, phamVi: ["chat", "fim"] });
    const [tk] = await db.select().from(aiGatewayTokens).where(eq(aiGatewayTokens.id, doi.tokenId));
    expect(tk.nguon).toBe("thiet-bi");
    expect(tk.ten).toBe("luoi-tb-1 VSCode");

    await db.execute(sql`UPDATE ai_gateway_device_codes SET "hoiLanCuoiLuc" = NULL WHERE "maNguoiDung" = ${bd.maNguoiDung}`);
    expect(await doiMaThietBi(bd.maThietBi)).toEqual({ trangThai: "khong-hop-le" });
  });

  it("từ chối ⇒ tu-choi; hết hạn ⇒ het-han (xem lẫn duyệt lẫn đổi); mã sai ⇒ khong-hop-le", async () => {
    const bd = await batDauThietBi({ ten: "luoi-tb-2", phamVi: ["chat"] });
    if (!bd.ok) throw new Error("bắt đầu hỏng");
    expect(await quyetThietBi(uidA, bd.maNguoiDung, false)).toMatchObject({ ok: true, trangThai: "tu-choi" });
    expect(await doiMaThietBi(bd.maThietBi)).toEqual({ trangThai: "tu-choi" });

    const bd2 = await batDauThietBi({ ten: "luoi-tb-3", phamVi: ["fim"] });
    if (!bd2.ok) throw new Error("bắt đầu hỏng");
    const db = (await getDb())!;
    await db.execute(
      sql`UPDATE ai_gateway_device_codes SET "createdAt" = now() - interval '11 minutes', "hetHanLuc" = now() - interval '1 minute' WHERE "maNguoiDung" = ${bd2.maNguoiDung}`,
    );
    expect(await xemThietBi(bd2.maNguoiDung)).toEqual({ ok: false, ma: "het-han" });
    expect(await quyetThietBi(uidA, bd2.maNguoiDung, true)).toEqual({ ok: false, ma: "het-han" });
    expect(await doiMaThietBi(bd2.maThietBi)).toEqual({ trangThai: "het-han" });

    expect(await xemThietBi("BCDF-0000")).toEqual({ ok: false, ma: "khong-ton-tai" });
    expect(await doiMaThietBi("avgd_" + "y".repeat(43))).toEqual({ trangThai: "khong-hop-le" });
    expect(await doiMaThietBi("rac")).toEqual({ trangThai: "khong-hop-le" });
  });
});
