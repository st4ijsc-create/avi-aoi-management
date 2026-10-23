/**
 * R1a Task 7 (K8 + D5) — XÁC THỰC THEO MỨC TÁC ĐỘNG + SÀN VAI.
 *
 * Ma trận: mức × (đăng ký 2FA / chưa) × (cache phiên còn / không) × (mã đúng / sai / thiếu).
 * Chạy trên đường THẬT: `users` + `user_secrets` của DB test (qua `taoNguoiDungTest`),
 * `speakeasy.totp.verify` nguyên bản, sổ mã đã tiêu `totp_consumed` thật — không giả sổ, vì
 * "dùng một lần" là đúng thứ đang được đo.
 *
 * Đối chứng dương ở mọi khối: luôn có một ô "mã MỚI ⇒ QUA" để một cài đặt CHẶN HẾT không xanh.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import speakeasy from "speakeasy";
import { z } from "zod";

vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

import { getDb } from "../db/connection";
import { userSecrets } from "../../drizzle/schema";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { __resetSoTotpChoTest, __soTotpSize } from "./totpOnce";
import {
  ACTUATION_ROLES,
  deployProcedure,
  router,
  ghiStepUpPhien,
  khoaPhienStepUp,
  stepUpPhienConHan,
} from "./trpc";
import { kiemXacThucTheoMuc, vaiTroDuocGhi } from "./xacThucTheoMuc";

const SECRET_2FA = "K52U24CYJRNTQSKMG47FKUSHKFKUQW2D";
const otp = (): string => speakeasy.totp({ secret: SECRET_2FA, encoding: "base32" });
/** Một mã 6 số chắc chắn SAI ở nhịp hiện tại (lệch xa khỏi cửa sổ ±1). */
const maSai = (): string =>
  speakeasy.totp({ secret: SECRET_2FA, encoding: "base32", time: Math.floor(Date.now() / 1000) - 3600 });

const TS = `xttm${Date.now().toString(36)}`;
let coDb = false;
let idEng2fa = 0; // engineer ĐÃ đăng ký 2FA (cờ + secret thật)
let idSup2fa = 0; // supervisor ĐÃ đăng ký
let idEngKhong = 0; // engineer CHƯA đăng ký
let idOper2fa = 0; // operator ĐÃ đăng ký (secret thật) — dưới sàn 4|5
let idViewer = 0;
let idEngNull = 0; // engineer ĐÃ đăng ký — RIÊNG cho ca §6 sessionToken:null (khoá `user:{id}` sạch)

let demPhien = 0;
const phienMoi = (): string => `${TS}-sess-${++demPhien}`;

type Ctx = { user: { id: number; role: string; twoFactorEnabled: boolean } | null; sessionToken?: string | null };
const ctxCua = (id: number, role: string, twoFa: boolean, sessionToken: string | null = phienMoi()): Ctx => ({
  user: { id, role, twoFactorEnabled: twoFa },
  sessionToken,
});

const ENV_GIU = ["AUTH_2FA_BAT_BUOC", "ACTUATION_STEPUP_2FA"] as const;
const envTruoc: Record<string, string | undefined> = {};

beforeAll(async () => {
  const db = await getDb();
  if (!db) return;
  coDb = true;
  for (const k of ENV_GIU) envTruoc[k] = process.env[k];
  const mk = async (tag: string, role: "engineer" | "supervisor" | "operator" | "viewer", twoFa: boolean) =>
    (await taoNguoiDungTest(tag, role, { tienTo: "xttm", ts: TS, extra: { twoFactorEnabled: twoFa } })).id;
  idEng2fa = await mk("eng2fa", "engineer", true);
  idSup2fa = await mk("sup2fa", "supervisor", true);
  idEngKhong = await mk("engkhong", "engineer", false);
  idOper2fa = await mk("oper2fa", "operator", true);
  idViewer = await mk("viewer", "viewer", false);
  idEngNull = await mk("engnull", "engineer", true);
  await db.insert(userSecrets).values([
    { userId: idEng2fa, twoFactorSecret: SECRET_2FA },
    { userId: idSup2fa, twoFactorSecret: SECRET_2FA },
    { userId: idOper2fa, twoFactorSecret: SECRET_2FA },
    { userId: idEngNull, twoFactorSecret: SECRET_2FA },
  ]);
});

beforeEach(async () => {
  if (!coDb) return;
  // Sổ là bảng DÙNG CHUNG + speakeasy trả CÙNG mã suốt nhịp 30 s ⇒ dọn ĐÚNG người của tệp này.
  await __resetSoTotpChoTest([idEng2fa, idSup2fa, idOper2fa, idEngNull]);
  // Mặc định của ca: cờ step-up cũ TẮT, chế độ nội bộ BẬT — tư thế "lỏng nhất" của hai cờ mà
  // helper phải BỎ QUA. Ca nào cần khác thì tự đặt.
  delete process.env.ACTUATION_STEPUP_2FA;
  process.env.AUTH_2FA_BAT_BUOC = "0";
});

afterAll(async () => {
  for (const k of ENV_GIU) {
    if (envTruoc[k] === undefined) delete process.env[k];
    else process.env[k] = envTruoc[k];
  }
  if (coDb) await __resetSoTotpChoTest([idEng2fa, idSup2fa, idOper2fa, idEngNull]);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§0 — sàn vai `vaiTroDuocGhi`", () => {
  it("mức 1|3 ⇒ operator, engineer, supervisor, admin", () => {
    for (const m of [1, 3] as const) {
      expect([...vaiTroDuocGhi(m)].sort()).toEqual(["admin", "engineer", "operator", "supervisor"]);
    }
  });

  it("★★ mức 4|5 ⇒ ĐÚNG ACTUATION_ROLES, KHÔNG chứa operator", () => {
    for (const m of [4, 5] as const) {
      expect([...vaiTroDuocGhi(m)].sort()).toEqual([...ACTUATION_ROLES].sort());
      expect(vaiTroDuocGhi(m)).not.toContain("operator");
    }
  });
});

describe("§1 — mức 1|3: không cần 2FA, chỉ sàn vai", () => {
  it("operator / engineer CHƯA đăng ký ⇒ khong_can (kể cả không mã)", async () => {
    for (const m of [1, 3] as const) {
      expect(await kiemXacThucTheoMuc(ctxCua(idOper2fa, "operator", false), m)).toEqual({ ok: true, cach: "khong_can" });
      expect(await kiemXacThucTheoMuc(ctxCua(idEngKhong, "engineer", false), m)).toEqual({ ok: true, cach: "khong_can" });
    }
  });

  it("viewer / không đăng nhập ⇒ ROLE_FLOOR", async () => {
    for (const m of [1, 3] as const) {
      expect(await kiemXacThucTheoMuc(ctxCua(idViewer, "viewer", false), m)).toEqual({ ok: false, ma: "ROLE_FLOOR" });
      expect(await kiemXacThucTheoMuc({ user: null }, m)).toEqual({ ok: false, ma: "ROLE_FLOOR" });
    }
  });

  it("mức 1|3 KHÔNG tiêu mã kể cả khi mã được gửi kèm", async () => {
    if (!coDb) return;
    expect(await kiemXacThucTheoMuc(ctxCua(idEng2fa, "engineer", true), 3, otp())).toEqual({ ok: true, cach: "khong_can" });
    expect(await __soTotpSize([idEng2fa])).toBe(0);
  });
});

describe("§2 — sàn vai đứng TRƯỚC mọi kiểm TOTP (mức 4|5)", () => {
  it("★★★ operator ĐÃ đăng ký + mã ĐÚNG ⇒ ROLE_FLOOR, và mã KHÔNG bị tiêu", async () => {
    if (!coDb) return;
    for (const m of [4, 5] as const) {
      expect(await kiemXacThucTheoMuc(ctxCua(idOper2fa, "operator", true), m, otp())).toEqual({ ok: false, ma: "ROLE_FLOOR" });
    }
    expect(await __soTotpSize([idOper2fa])).toBe(0);
  });

  it("operator với cache phiên còn hạn ⇒ vẫn ROLE_FLOOR", async () => {
    const ctx = ctxCua(idOper2fa, "operator", true);
    ghiStepUpPhien(khoaPhienStepUp({ user: ctx.user!, sessionToken: ctx.sessionToken }));
    expect(await kiemXacThucTheoMuc(ctx, 4)).toEqual({ ok: false, ma: "ROLE_FLOOR" });
  });

  it("viewer chưa đăng ký ⇒ ROLE_FLOOR (không phải TOTP_CHUA_DANG_KY) · không đăng nhập ⇒ ROLE_FLOOR", async () => {
    for (const m of [4, 5] as const) {
      expect(await kiemXacThucTheoMuc(ctxCua(idViewer, "viewer", false), m)).toEqual({ ok: false, ma: "ROLE_FLOOR" });
      expect(await kiemXacThucTheoMuc({ user: null }, m, "123456")).toEqual({ ok: false, ma: "ROLE_FLOOR" });
    }
  });
});

describe("§3 — mức 4: bước 2FA của phiên, cache 10 phút", () => {
  it("chưa đăng ký ⇒ TOTP_CHUA_DANG_KY (thiếu mã, có mã, và cả khi cache phiên còn)", async () => {
    const ctx = ctxCua(idEngKhong, "engineer", false);
    expect(await kiemXacThucTheoMuc(ctx, 4)).toEqual({ ok: false, ma: "TOTP_CHUA_DANG_KY" });
    expect(await kiemXacThucTheoMuc(ctx, 4, "123456")).toEqual({ ok: false, ma: "TOTP_CHUA_DANG_KY" });
    ghiStepUpPhien(khoaPhienStepUp({ user: ctx.user!, sessionToken: ctx.sessionToken }));
    expect(await kiemXacThucTheoMuc(ctx, 4)).toEqual({ ok: false, ma: "TOTP_CHUA_DANG_KY" });
  });

  it("đăng ký, không cache, thiếu mã ⇒ TOTP_CAN", async () => {
    expect(await kiemXacThucTheoMuc(ctxCua(idEng2fa, "engineer", true), 4)).toEqual({ ok: false, ma: "TOTP_CAN" });
    expect(await kiemXacThucTheoMuc(ctxCua(idEng2fa, "engineer", true), 4, "")).toEqual({ ok: false, ma: "TOTP_CAN" });
  });

  it("đăng ký, không cache, mã sai / sai định dạng ⇒ TOTP_SAI, và không đặt cache", async () => {
    if (!coDb) return;
    const ctx = ctxCua(idEng2fa, "engineer", true);
    expect(await kiemXacThucTheoMuc(ctx, 4, maSai())).toEqual({ ok: false, ma: "TOTP_SAI" });
    expect(await kiemXacThucTheoMuc(ctx, 4, "12ab56")).toEqual({ ok: false, ma: "TOTP_SAI" });
    expect(stepUpPhienConHan(khoaPhienStepUp({ user: ctx.user!, sessionToken: ctx.sessionToken }))).toBe(false);
    expect(await kiemXacThucTheoMuc(ctx, 4)).toEqual({ ok: false, ma: "TOTP_CAN" });
  });

  it("★★ đối chứng dương: mã đúng ⇒ moi_lan, đặt cache; lượt sau CÙNG phiên không mã ⇒ phien", async () => {
    if (!coDb) return;
    const ctx = ctxCua(idEng2fa, "engineer", true);
    expect(await kiemXacThucTheoMuc(ctx, 4, otp())).toEqual({ ok: true, cach: "moi_lan" });
    expect(stepUpPhienConHan(khoaPhienStepUp({ user: ctx.user!, sessionToken: ctx.sessionToken }))).toBe(true);
    expect(await kiemXacThucTheoMuc(ctx, 4)).toEqual({ ok: true, cach: "phien" });
    expect(await __soTotpSize([idEng2fa])).toBe(1);
  });

  it("cache là theo PHIÊN: phiên khác của cùng người ⇒ TOTP_CAN", async () => {
    if (!coDb) return;
    expect(await kiemXacThucTheoMuc(ctxCua(idEng2fa, "engineer", true), 4, otp())).toEqual({ ok: true, cach: "moi_lan" });
    expect(await kiemXacThucTheoMuc(ctxCua(idEng2fa, "engineer", true), 4)).toEqual({ ok: false, ma: "TOTP_CAN" });
  });

  it("cache hết hạn (ghi lúc 11 phút trước) ⇒ TOTP_CAN", async () => {
    const ctx = ctxCua(idEng2fa, "engineer", true);
    const khoa = khoaPhienStepUp({ user: ctx.user!, sessionToken: ctx.sessionToken });
    ghiStepUpPhien(khoa, Date.now() - 11 * 60_000);
    expect(stepUpPhienConHan(khoa)).toBe(false);
    expect(await kiemXacThucTheoMuc(ctx, 4)).toEqual({ ok: false, ma: "TOTP_CAN" });
    // còn hạn (ghi 9 phút trước) ⇒ phien
    ghiStepUpPhien(khoa, Date.now() - 9 * 60_000);
    expect(await kiemXacThucTheoMuc(ctx, 4)).toEqual({ ok: true, cach: "phien" });
  });

  it("mức 4 cũng dùng sổ một lần: CÙNG mã ở phiên khác ⇒ TOTP_SAI", async () => {
    if (!coDb) return;
    const ma = otp();
    expect(await kiemXacThucTheoMuc(ctxCua(idEng2fa, "engineer", true), 4, ma)).toEqual({ ok: true, cach: "moi_lan" });
    expect(await kiemXacThucTheoMuc(ctxCua(idEng2fa, "engineer", true), 4, ma)).toEqual({ ok: false, ma: "TOTP_SAI" });
  });

  it("phiên không có sessionToken ⇒ khoá `user:{id}` (đúng công thức middleware cũ)", () => {
    expect(khoaPhienStepUp({ user: { id: 77 }, sessionToken: null })).toBe("user:77");
    expect(khoaPhienStepUp({ user: { id: 77 }, sessionToken: "abc" })).toBe("abc");
  });
});

describe("§3b — Fix round 1: KHÔNG có sessionToken ⇒ mức 4 không đọc, không ghi cache (như mức 5)", () => {
  it("cache khoá `user:{id}` đang còn hạn ⇒ mức 4 không token, không mã ⇒ TOTP_CAN (null và \"\")", async () => {
    ghiStepUpPhien(khoaPhienStepUp({ user: { id: idEng2fa }, sessionToken: null }));
    expect(stepUpPhienConHan(`user:${idEng2fa}`)).toBe(true); // cache THẬT sự còn
    expect(await kiemXacThucTheoMuc(ctxCua(idEng2fa, "engineer", true, null), 4)).toEqual({ ok: false, ma: "TOTP_CAN" });
    expect(await kiemXacThucTheoMuc(ctxCua(idEng2fa, "engineer", true, ""), 4)).toEqual({ ok: false, ma: "TOTP_CAN" });
  });

  it("mã đúng ở mức 4 / 5 không token ⇒ moi_lan nhưng KHÔNG ghi `user:{id}`; lượt sau không mã ⇒ TOTP_CAN", async () => {
    if (!coDb) return;
    const ctx = ctxCua(idSup2fa, "supervisor", true, null);
    expect(await kiemXacThucTheoMuc(ctx, 4, otp())).toEqual({ ok: true, cach: "moi_lan" });
    expect(stepUpPhienConHan(`user:${idSup2fa}`)).toBe(false);
    expect(await kiemXacThucTheoMuc(ctx, 4)).toEqual({ ok: false, ma: "TOTP_CAN" });
    await __resetSoTotpChoTest([idSup2fa]);
    expect(await kiemXacThucTheoMuc(ctx, 5, otp())).toEqual({ ok: true, cach: "moi_lan" });
    expect(stepUpPhienConHan(`user:${idSup2fa}`)).toBe(false);
  });
});

describe("§4 — mức 5: TOTP tươi MỖI lượt, mã dùng một lần", () => {
  it("chưa đăng ký ⇒ TOTP_CHUA_DANG_KY", async () => {
    expect(await kiemXacThucTheoMuc(ctxCua(idEngKhong, "engineer", false), 5, "123456")).toEqual({
      ok: false,
      ma: "TOTP_CHUA_DANG_KY",
    });
  });

  it("★★★ cache phiên còn hạn KHÔNG mở mức 5: thiếu mã ⇒ TOTP_CAN", async () => {
    const ctx = ctxCua(idEng2fa, "engineer", true);
    ghiStepUpPhien(khoaPhienStepUp({ user: ctx.user!, sessionToken: ctx.sessionToken }));
    expect(await kiemXacThucTheoMuc(ctx, 4)).toEqual({ ok: true, cach: "phien" }); // cache THẬT sự còn
    expect(await kiemXacThucTheoMuc(ctx, 5)).toEqual({ ok: false, ma: "TOTP_CAN" });
  });

  it("mã sai ⇒ TOTP_SAI", async () => {
    if (!coDb) return;
    expect(await kiemXacThucTheoMuc(ctxCua(idEng2fa, "engineer", true), 5, maSai())).toEqual({ ok: false, ma: "TOTP_SAI" });
  });

  it("★★★ mã đúng ⇒ moi_lan; DÙNG LẠI cùng mã (cùng phiên) ⇒ TOTP_SAI", async () => {
    if (!coDb) return;
    const ctx = ctxCua(idEng2fa, "engineer", true);
    const ma = otp();
    expect(await kiemXacThucTheoMuc(ctx, 5, ma)).toEqual({ ok: true, cach: "moi_lan" });
    expect(await kiemXacThucTheoMuc(ctx, 5, ma)).toEqual({ ok: false, ma: "TOTP_SAI" });
    expect(await kiemXacThucTheoMuc(ctx, 5)).toEqual({ ok: false, ma: "TOTP_CAN" });
  });

  it("supervisor ĐÃ đăng ký + mã đúng ⇒ qua (vai trong sàn)", async () => {
    if (!coDb) return;
    expect(await kiemXacThucTheoMuc(ctxCua(idSup2fa, "supervisor", true), 5, otp())).toEqual({ ok: true, cach: "moi_lan" });
  });

  it("quyết định: mã đúng ở mức 5 LÀM MỚI cache phiên của mức 4", async () => {
    if (!coDb) return;
    const ctx = ctxCua(idEng2fa, "engineer", true);
    expect(await kiemXacThucTheoMuc(ctx, 5, otp())).toEqual({ ok: true, cach: "moi_lan" });
    expect(await kiemXacThucTheoMuc(ctx, 4)).toEqual({ ok: true, cach: "phien" });
  });

  it("cờ phiên nói 'đã đăng ký' nhưng DB không có secret ⇒ TOTP_SAI (fail-closed ở verifyFreshTotp)", async () => {
    // idEngKhong không có hàng user_secrets — giả một phiên cũ còn cờ true.
    expect(await kiemXacThucTheoMuc(ctxCua(idEngKhong, "engineer", true), 5, otp())).toEqual({ ok: false, ma: "TOTP_SAI" });
  });
});

describe("§4b — Fix round 1: `muc` NGOÀI MIỀN lúc chạy ⇒ FAIL-CLOSED về đường mức 5", () => {
  const NGOAI: Array<[string, unknown]> = [
    ['"5"', "5"],
    ["2", 2],
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ['"1"', "1"],
  ];

  it("★★★ sàn vai = ACTUATION_ROLES; operator ĐÃ đăng ký + mã đúng ⇒ ROLE_FLOOR", async () => {
    for (const [nhan, m] of NGOAI) {
      expect([...vaiTroDuocGhi(m as never)].sort(), nhan).toEqual([...ACTUATION_ROLES].sort());
      expect(await kiemXacThucTheoMuc(ctxCua(idOper2fa, "operator", true), m as never, otp()), nhan).toEqual({
        ok: false,
        ma: "ROLE_FLOOR",
      });
    }
  });

  it("★★★ chưa đăng ký ⇒ TOTP_CHUA_DANG_KY; cache phiên còn ⇒ vẫn TOTP_CAN (không đọc cache); mã đúng ⇒ moi_lan", async () => {
    if (!coDb) return;
    for (const [nhan, m] of NGOAI) {
      expect(await kiemXacThucTheoMuc(ctxCua(idEngKhong, "engineer", false), m as never), nhan).toEqual({
        ok: false,
        ma: "TOTP_CHUA_DANG_KY",
      });
      const ctx = ctxCua(idEng2fa, "engineer", true);
      ghiStepUpPhien(khoaPhienStepUp({ user: ctx.user!, sessionToken: ctx.sessionToken }));
      expect(await kiemXacThucTheoMuc(ctx, m as never), nhan).toEqual({ ok: false, ma: "TOTP_CAN" });
      await __resetSoTotpChoTest([idEng2fa]);
      expect(await kiemXacThucTheoMuc(ctx, m as never, otp()), nhan).toEqual({ ok: true, cach: "moi_lan" });
    }
  });

  it("totpCode không phải chuỗi lúc chạy (số 123456) ⇒ TOTP_SAI", async () => {
    expect(await kiemXacThucTheoMuc(ctxCua(idEng2fa, "engineer", true), 5, 123456 as never)).toEqual({
      ok: false,
      ma: "TOTP_SAI",
    });
  });
});

describe("§5 — BỎ QUA `AUTH_2FA_BAT_BUOC` và `ACTUATION_STEPUP_2FA`", () => {
  const TO_HOP: Array<[string | undefined, string | undefined]> = [
    ["0", undefined],
    ["0", "true"],
    ["1", undefined],
    [undefined, "1"],
  ];

  it("★★★ mọi tổ hợp cờ: chưa đăng ký ⇒ TOTP_CHUA_DANG_KY; đã đăng ký thiếu mã ⇒ TOTP_CAN (mức 4 và 5)", async () => {
    for (const [batBuoc, stepUp] of TO_HOP) {
      if (batBuoc === undefined) delete process.env.AUTH_2FA_BAT_BUOC;
      else process.env.AUTH_2FA_BAT_BUOC = batBuoc;
      if (stepUp === undefined) delete process.env.ACTUATION_STEPUP_2FA;
      else process.env.ACTUATION_STEPUP_2FA = stepUp;
      for (const m of [4, 5] as const) {
        expect(await kiemXacThucTheoMuc(ctxCua(idEngKhong, "engineer", false), m), `${batBuoc}/${stepUp}/m${m}`).toEqual({
          ok: false,
          ma: "TOTP_CHUA_DANG_KY",
        });
        expect(await kiemXacThucTheoMuc(ctxCua(idEng2fa, "engineer", true), m), `${batBuoc}/${stepUp}/m${m}`).toEqual({
          ok: false,
          ma: "TOTP_CAN",
        });
      }
    }
  });
});

describe("§6 — chung cache + chung sổ với chuỗi step-up cũ trên `deployProcedure` sản xuất", () => {
  /**
   * Phép thử M3 trên ĐÚNG `deployProcedure` (`requireFreshTotp` → `requirePerCallFreshTotp`), đã
   * khai ở pin `deployStepUpFreshness.test.ts` (DEPLOY_TRONG_LUOI). `totpCode` BẮT BUỘC ở zod như
   * mã sản xuất (cầu chì I-4).
   */
  const luoi = router({
    lenhTheoMuc: deployProcedure
      .input(z.object({ totpCode: z.string().max(16), kiemMuc5: z.boolean().optional() }))
      .mutation(({ ctx, input }) =>
        input.kiemMuc5 ? kiemXacThucTheoMuc(ctx as never, 5, input.totpCode) : { ok: true as const },
      ),
  });
  const goi = (ctx: Ctx) => luoi.createCaller({ ...ctx, req: { ip: "127.0.0.1", headers: {} }, res: {} } as never);

  beforeEach(() => {
    process.env.ACTUATION_STEPUP_2FA = "true";
    process.env.AUTH_2FA_BAT_BUOC = "1";
  });

  it("middleware cũ ghi cache phiên ⇒ helper mức 4 thấy `phien` (cùng khoá); mức 5 vẫn đòi mã", async () => {
    if (!coDb) return;
    const ctx = ctxCua(idEng2fa, "engineer", true);
    await expect(goi(ctx).lenhTheoMuc({ totpCode: otp() })).resolves.toEqual({ ok: true });
    expect(await kiemXacThucTheoMuc(ctx, 4)).toEqual({ ok: true, cach: "phien" });
    expect(await kiemXacThucTheoMuc(ctx, 5)).toEqual({ ok: false, ma: "TOTP_CAN" });
  });

  it("sessionToken:null — middleware ghi khoá `user:{id}` (ĐÚNG công thức `khoaPhienStepUp`), nhưng helper mức 4 KHÔNG đọc nó (đã siết)", async () => {
    if (!coDb) return;
    const ctx = ctxCua(idEngNull, "engineer", true, null);
    expect(stepUpPhienConHan(khoaPhienStepUp({ user: ctx.user!, sessionToken: null }))).toBe(false); // trước: sạch
    await expect(goi(ctx).lenhTheoMuc({ totpCode: otp() })).resolves.toEqual({ ok: true });
    // phép kiểm chéo công thức: middleware (không đổi) đã ghi ĐÚNG khoá helper tính ra
    expect(stepUpPhienConHan(khoaPhienStepUp({ user: ctx.user!, sessionToken: null }))).toBe(true);
    expect(khoaPhienStepUp({ user: ctx.user!, sessionToken: null })).toBe(`user:${idEngNull}`);
    // hành vi đã siết: không token ⇒ không dùng cache
    expect(await kiemXacThucTheoMuc(ctx, 4)).toEqual({ ok: false, ma: "TOTP_CAN" });
  });

  it("CÙNG lượt gọi: chuỗi cũ verify mã rồi helper mức 5 verify LẠI cùng mã ⇒ qua (dùng lại dấu lượt)", async () => {
    if (!coDb) return;
    const ctx = ctxCua(idEng2fa, "engineer", true);
    const ma = otp();
    expect(await goi(ctx).lenhTheoMuc({ totpCode: ma, kiemMuc5: true })).toEqual({ ok: true, cach: "moi_lan" });
    // lượt gọi KHÁC với cùng mã ⇒ phát lại ⇒ chuỗi cũ chặn trước khi tới helper
    await expect(goi(ctx).lenhTheoMuc({ totpCode: ma, kiemMuc5: true })).rejects.toBeTruthy();
    // và helper gọi ngoài tRPC với cùng mã ⇒ TOTP_SAI
    expect(await kiemXacThucTheoMuc(ctx, 5, ma)).toEqual({ ok: false, ma: "TOTP_SAI" });
  });
});
