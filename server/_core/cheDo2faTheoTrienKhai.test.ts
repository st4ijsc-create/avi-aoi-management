/**
 * ★★★ CHẾ ĐỘ 2FA THEO TRIỂN KHAI (2026-08-24) — lưới A/B HAI CHIỀU cho `AUTH_2FA_BAT_BUOC`,
 * TỪNG TẦNG một chính sách riêng, đúng quyết định chủ dự án (nguyên văn ở docblock
 * `PRIVILEGED_ROLES`, `_core/trpc.ts`):
 *   §0 hàm thuần `batBuoc2FA()` — CHỈ chuỗi `"0"` tắt; vắng biến = bắt buộc (mặc định an toàn);
 *   §1 `adminProcedure`         — cờ `0` thôi đòi BẬT 2FA, kiểm VAI giữ NGUYÊN;
 *   §2 `require2FA` (qua `actuationProcedure` sản xuất) — tương tự, sàn vai giữ NGUYÊN;
 *   §3 step-up OTP (qua một thủ tục chain ĐÚNG `deployProcedure` sản xuất — phép thử M3, đã
 *      NÓI RA ở pin `deployStepUpFreshness.test.ts`): người ĐÃ bật 2FA vẫn bị hỏi OTP; người
 *      CHƯA bật đi qua nhưng ĐỂ LẠI DẤU trong bảng `audit_logs` THẬT.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CHẠM CSDL THẬT — cùng lý lẽ `quanLyDuAnRepo.test.ts`: mệnh đề ăn tiền của §3 là *"lượt
 * bỏ-qua ĐỂ LẠI ĐÚNG MỘT hàng audit đọc lại được"* — một `db` giả trả mảng do lưới nạp thì mệnh
 * đề ấy không được đo ở đâu cả. `verifyFreshTotp` đọc `users`+`user_secrets` thật, sổ chống phát
 * lại là bảng `totp_consumed` thật (dọn bằng `__resetSoTotpChoTest` GIỚI HẠN user của file này).
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * BỐN ĐỘT BIẾN lưới này phải bắt (đã chạy tay từng cái, xem báo cáo đợt sửa):
 *   (a) nhánh cờ-`0` lỡ bỏ luôn kiểm VAI          ⇒ §1.3 / §2.3 ĐỎ;
 *   (b) mặc định lật thành `0` khi biến vắng       ⇒ §0 + §1.4 / §2.4 / §3.4 ĐỎ;
 *   (c) step-up cờ-`0` bỏ hỏi OTP cả người ĐÃ bật  ⇒ §3.2 ĐỎ;
 *   (d) bỏ lượt ghi audit bỏ-qua                   ⇒ §3.1 ĐỎ.
 *
 * ⚠ Mỗi ca TỰ đặt `process.env.AUTH_2FA_BAT_BUOC` qua `voiCo(...)` rồi KHÔI PHỤC trong `finally`
 *   — lưới KHÔNG nạp `.env` (bài học đã trả giá), và một ca để cờ rớt lại làm ca sau xanh/đỏ vì
 *   lý do sai.
 * ⚠ Dọn dẹp GIỚI HẠN đúng hàng CHÍNH FILE NÀY tạo (users theo TAG · audit theo userId · sổ TOTP
 *   theo userId) — vitest chạy song song trên MỘT CSDL test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import speakeasy from "speakeasy";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";

/**
 * ⚠ `AUDIT_ALL_MUTATIONS` được `_core/trpc.ts` đọc LÚC NẠP MODULE (hằng `auditAllMutations`) —
 *   phải tắt TRƯỚC import, nếu không mỗi mutation đẻ thêm một hàng audit nền và phép đếm
 *   "đúng MỘT hàng bỏ-qua" của §3.1 nhiễu. Lượt ghi audit BỎ-QUA (thứ §3 canh) là lượt ghi
 *   TƯỜNG MINH trong `stepUpTotpMiddleware`, KHÔNG qua cờ này — đó chính là điều §3.1 chứng minh.
 * `LICENSE_MODULE_GATE_ENABLED=false`: giữ khuôn chung — không để một ca "bị chặn" xanh vì
 *   license thay vì vì cái nó canh.
 */
vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

import { getDb } from "../db/connection";
import { users, userSecrets, auditLogs } from "../../drizzle/schema";
import { __resetSoTotpChoTest } from "./totpOnce";
import { router, adminProcedure, actuationProcedure, deployProcedure, batBuoc2FA } from "./trpc";
import { readAppErrorMeta } from "./appError";

const TAG = `cheDo2fa${Date.now().toString(36)}`;

/** Secret 2FA THẬT — `verifyFreshTotp` chạy `speakeasy.totp.verify` nguyên bản trên nó (khuôn
 *  `deployStepUpFreshness.test.ts`). */
const SECRET_2FA = "K52U24CYJRNTQSKMG47FKUSHKFKUQW2D";
const otp = (): string => speakeasy.totp({ secret: SECRET_2FA, encoding: "base32" });

let coDb = false;
let idAdmin = 0; // admin, DB twoFactorEnabled=false
let idEng = 0; // engineer, CHƯA bật 2FA (không hàng user_secrets)
let idEng2fa = 0; // engineer, ĐÃ bật 2FA (users.twoFactorEnabled=true + secret thật)
let idOper = 0; // operator — vai NGOÀI sàn actuation/deploy

/**
 * Thủ tục thử đứng trên ĐÚNG các sàn sản xuất — không cổng tự chế:
 *  · `lenhChamMay` chain `deployProcedure` (phép thử M3 — nó chia sẻ đúng middleware và đúng
 *    chuỗi step-up của mã sản xuất; đã khai ở pin `deployStepUpFreshness.test.ts` vì bộ suy
 *    `deployProcedureScan` tách `thuTucTest` và GHIM danh sách — một mục mới phải NÓI RA).
 *    ⚠ I-4: `totpCode` BẮT BUỘC ở zod, y hình dạng sản xuất — cầu chì fixture M3 đòi thế.
 */
const luoi = router({
  viecAdmin: adminProcedure.query(() => ({ ok: true as const })),
  viecActuation: actuationProcedure.mutation(() => ({ ok: true as const })),
  lenhChamMay: deployProcedure
    .input(z.object({ totpCode: z.string().max(16) }))
    .mutation(() => ({ ok: true as const })),
});

/** ⚠ MỖI lượt caller một `sessionToken` RIÊNG — cache step-up là Map cấp module theo phiên. */
let demPhien = 0;
const phienMoi = (): string => `${TAG}-sess-${++demPhien}`;
const goi = (id: number, role: string, twoFa: boolean) =>
  luoi.createCaller({
    user: { id, role, twoFactorEnabled: twoFa },
    req: { ip: "127.0.0.1", headers: {} },
    res: {},
    sessionToken: phienMoi(),
  } as never);

/** Ghim cờ TRONG ca rồi khôi phục — `undefined` = XOÁ biến (đo mặc định-khi-vắng). */
async function voiCo(co: string | undefined, fn: () => Promise<void>): Promise<void> {
  const truoc = process.env.AUTH_2FA_BAT_BUOC;
  if (co === undefined) delete process.env.AUTH_2FA_BAT_BUOC;
  else process.env.AUTH_2FA_BAT_BUOC = co;
  try {
    await fn();
  } finally {
    if (truoc === undefined) delete process.env.AUTH_2FA_BAT_BUOC;
    else process.env.AUTH_2FA_BAT_BUOC = truoc;
  }
}

async function mkUser(tag: string, role: "admin" | "engineer" | "operator", twoFa: boolean): Promise<number> {
  const db = await getDb();
  const [u] = await db!
    .insert(users)
    .values({
      openId: `${TAG}_${tag}`,
      username: `${TAG}_${tag}`,
      name: `cheDo2fa ${tag}`,
      role,
      loginMethod: "local",
      twoFactorEnabled: twoFa,
    })
    .returning({ id: users.id });
  return u!.id;
}

/** Lỗi của một lượt gọi, hoặc `null` nếu nó KHÔNG ném (khuôn `deployStepUpFreshness.test.ts`). */
async function loiCua(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

function metaCua(e: unknown): { appCode?: string; appParams?: Record<string, unknown> } | null {
  return readAppErrorMeta(e) as { appCode?: string; appParams?: Record<string, unknown> } | null;
}

/** Lượt gọi bị chặn ở ĐÚNG cổng OTP (không phải vai/zod/license)? */
function chanBoiCongOtp(e: unknown): boolean {
  const m = metaCua(e);
  return m?.appCode === "INVALID_VALUE" && (m?.appParams as { field?: string } | undefined)?.field === "twoFactorCode";
}

/** Các hàng audit BỎ-QUA của một user — đọc từ bảng THẬT, không từ lời khai. */
async function hangBoQua(userId: number): Promise<Array<{ action: string; status: string; details: string }>> {
  const db = await getDb();
  const rows = await db!
    .select({ action: auditLogs.action, status: auditLogs.status, details: auditLogs.details })
    .from(auditLogs)
    .where(eq(auditLogs.userId, userId));
  return rows
    .filter((r) => String(r.details ?? "").includes("bo_qua_che_do_noi_bo"))
    .map((r) => ({ action: r.action, status: String(r.status), details: String(r.details ?? "") }));
}

const STEPUP_TRUOC = process.env.ACTUATION_STEPUP_2FA;

beforeAll(async () => {
  const db = await getDb();
  if (!db) return;
  coDb = true;
  idAdmin = await mkUser("admin", "admin", false);
  idEng = await mkUser("eng", "engineer", false);
  idEng2fa = await mkUser("eng2fa", "engineer", true);
  idOper = await mkUser("oper", "operator", true);
  // Hạt giống TOTP của người ĐÃ bật — `verifyFreshTotp` đọc `users LEFT JOIN user_secrets` THẬT.
  await db.insert(userSecrets).values({ userId: idEng2fa, twoFactorSecret: SECRET_2FA });
});

beforeEach(async () => {
  if (!coDb) return;
  // Sổ mã đã tiêu là bảng DÙNG CHUNG + speakeasy trả CÙNG một mã suốt nhịp 30s ⇒ dọn theo
  // ĐÚNG user của file này để ca sau không đỏ vì "ca trước đã tiêu mã" (khuôn có sẵn).
  await __resetSoTotpChoTest([idEng2fa]);
  process.env.ACTUATION_STEPUP_2FA = "true";
});

afterAll(async () => {
  if (STEPUP_TRUOC === undefined) delete process.env.ACTUATION_STEPUP_2FA;
  else process.env.ACTUATION_STEPUP_2FA = STEPUP_TRUOC;
  const db = await getDb();
  if (!db) return;
  const ids = [idAdmin, idEng, idEng2fa, idOper].filter((x) => x > 0);
  if (ids.length > 0) {
    await __resetSoTotpChoTest(ids);
    // ⚠ KHÔNG xoá hàng `audit_logs` file này đẻ ra — ĐÃ THỬ và bảng trả 42501: sổ audit là WORM
    //   với vai app (doc 35, cố ý — dấu vết không xoá được chính là điều bảng này hứa). Không
    //   ô nhiễm phép đo: mọi phép đếm ở trên SCOPE theo userId, mà mỗi lượt chạy đẻ user MỚI
    //   (TAG theo thời gian) nên hàng mồ côi của lượt trước không bao giờ lọt vào phép đếm sau.
    await db.delete(users).where(inArray(users.id, ids)); // user_secrets cascade theo FK
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§0 — hàm thuần `batBuoc2FA()`: CHỈ \"0\" tắt, vắng biến = bắt buộc", () => {
  it("★★★ vắng biến ⇒ true (mặc định AN TOÀN — đột biến (b) lật mặc định phải ĐỎ ngay đây)", async () => {
    await voiCo(undefined, async () => expect(batBuoc2FA()).toBe(true));
  });

  it("★★ \"0\" ⇒ false · \"1\" ⇒ true · giá trị lạ (\"false\", \"off\") ⇒ VẪN true — một giá trị tắt DUY NHẤT", async () => {
    await voiCo("0", async () => expect(batBuoc2FA()).toBe(false));
    await voiCo("1", async () => expect(batBuoc2FA()).toBe(true));
    // "false"/"off" KHÔNG tắt: gõ nhầm không được im lặng hạ tư thế an ninh (chiều hỏng an toàn).
    await voiCo("false", async () => expect(batBuoc2FA()).toBe(true));
    await voiCo("off", async () => expect(batBuoc2FA()).toBe(true));
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — TẦNG 1 `adminProcedure`: cờ nới đúng khối 2FA, KHÔNG nới vai", () => {
  it("★★★ cờ \"1\" + admin CHƯA 2FA ⇒ FORBIDDEN TWO_FACTOR_NOT_SET_UP (hành vi cũ — chống hồi quy)", async () => {
    if (!coDb) return;
    await voiCo("1", async () => {
      const e = await loiCua(goi(idAdmin, "admin", false).viecAdmin());
      expect((e as { code?: string } | null)?.code).toBe("FORBIDDEN");
      expect(metaCua(e)?.appCode).toBe("TWO_FACTOR_NOT_SET_UP");
    });
  });

  it("★★★ cờ \"0\" + admin CHƯA 2FA ⇒ QUA (hết lỗi console TWO_FACTOR_NOT_SET_UP từ license.systemState)", async () => {
    if (!coDb) return;
    await voiCo("0", async () => {
      await expect(goi(idAdmin, "admin", false).viecAdmin()).resolves.toEqual({ ok: true });
    });
  });

  it("★★★ cờ \"0\" + engineer (CÓ 2FA) gọi adminProcedure ⇒ VẪN FORBIDDEN vai — đột biến (a) nới-nhầm-vai phải ĐỎ đây", async () => {
    if (!coDb) return;
    await voiCo("0", async () => {
      const e = await loiCua(goi(idEng2fa, "engineer", true).viecAdmin());
      expect((e as { code?: string } | null)?.code).toBe("FORBIDDEN");
      const m = metaCua(e);
      expect(m?.appCode).toBe("PERMISSION_DENIED");
      expect((m?.appParams as { action?: string } | undefined)?.action).toBe("adminAccess");
    });
  });

  it("★★★ cờ VẮNG + admin CHƯA 2FA ⇒ như \"1\": FORBIDDEN TWO_FACTOR_NOT_SET_UP (mặc định an toàn)", async () => {
    if (!coDb) return;
    await voiCo(undefined, async () => {
      const e = await loiCua(goi(idAdmin, "admin", false).viecAdmin());
      expect(metaCua(e)?.appCode).toBe("TWO_FACTOR_NOT_SET_UP");
    });
  });

  it("★★ đối chứng dương: cờ \"1\" + admin CÓ 2FA ⇒ QUA (không có nó, một bản vá 'chặn hết' cũng xanh)", async () => {
    if (!coDb) return;
    await voiCo("1", async () => {
      await expect(goi(idAdmin, "admin", true).viecAdmin()).resolves.toEqual({ ok: true });
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — TẦNG 2 `require2FA` (qua `actuationProcedure` sản xuất): nới đòi-bật, giữ sàn vai", () => {
  it("★★★ cờ \"1\" + engineer CHƯA 2FA ⇒ FORBIDDEN TWO_FACTOR_NOT_SET_UP (chống hồi quy)", async () => {
    if (!coDb) return;
    await voiCo("1", async () => {
      const e = await loiCua(goi(idEng, "engineer", false).viecActuation());
      expect((e as { code?: string } | null)?.code).toBe("FORBIDDEN");
      expect(metaCua(e)?.appCode).toBe("TWO_FACTOR_NOT_SET_UP");
    });
  });

  it("★★★ cờ \"0\" + engineer CHƯA 2FA ⇒ QUA (nhánh !ctx.user UNAUTHORIZED không bị chạm — vẫn đăng nhập mới gọi được)", async () => {
    if (!coDb) return;
    await voiCo("0", async () => {
      await expect(goi(idEng, "engineer", false).viecActuation()).resolves.toEqual({ ok: true });
    });
  });

  it("★★★ cờ \"0\" + operator (CÓ 2FA, vai NGOÀI sàn) ⇒ VẪN FORBIDDEN vai — đột biến (a) phải ĐỎ đây", async () => {
    if (!coDb) return;
    await voiCo("0", async () => {
      const e = await loiCua(goi(idOper, "operator", true).viecActuation());
      expect((e as { code?: string } | null)?.code).toBe("FORBIDDEN");
      const m = metaCua(e);
      expect(m?.appCode).toBe("PERMISSION_DENIED");
      expect((m?.appParams as { action?: string } | undefined)?.action).toBe("insufficientRole");
    });
  });

  it("★★★ cờ VẮNG + engineer CHƯA 2FA ⇒ như \"1\": FORBIDDEN TWO_FACTOR_NOT_SET_UP", async () => {
    if (!coDb) return;
    await voiCo(undefined, async () => {
      const e = await loiCua(goi(idEng, "engineer", false).viecActuation());
      expect(metaCua(e)?.appCode).toBe("TWO_FACTOR_NOT_SET_UP");
    });
  });

  it("★★ đối chứng dương: cờ \"1\" + engineer CÓ 2FA ⇒ QUA", async () => {
    if (!coDb) return;
    await voiCo("1", async () => {
      await expect(goi(idEng2fa, "engineer", true).viecActuation()).resolves.toEqual({ ok: true });
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — TẦNG 3 step-up OTP (`deployProcedure` thật, `ACTUATION_STEPUP_2FA=true`)", () => {
  it("★★★ cờ \"0\" + CHƯA bật 2FA ⇒ QUA, và để lại ĐÚNG MỘT hàng audit `bo_qua_che_do_noi_bo` — đột biến (d) phải ĐỎ đây", async () => {
    if (!coDb) return;
    await voiCo("0", async () => {
      const truoc = (await hangBoQua(idEng)).length;
      // ⚠ `totpCode: ""` — zod sản xuất (I-4) đòi TRƯỜNG có mặt; chế độ nội bộ không verify nó.
      await expect(goi(idEng, "engineer", false).lenhChamMay({ totpCode: "" })).resolves.toEqual({ ok: true });
      const sau = await hangBoQua(idEng);
      // ĐÚNG MỘT hàng cho MỘT lượt bấm nút — `deployProcedure` chạy step-up middleware HAI lần,
      // dấu `__boQua2faDaGhiSo` phải khử bản sao (2 hàng = dấu hỏng; 0 hàng = đột biến (d)).
      expect(sau.length - truoc, "một lượt bỏ-qua = MỘT hàng audit, không 0 không 2").toBe(1);
      const hang = sau[sau.length - 1]!;
      expect(hang.action).toBe("lenhChamMay");
      expect(hang.status).toBe("success");
      const chiTiet = JSON.parse(hang.details) as { stepUp?: string; source?: string };
      expect(chiTiet.stepUp).toBe("bo_qua_che_do_noi_bo");
      expect(chiTiet.source).toBe("trpc");
    });
  });

  it("★★★ cờ \"0\" + ĐÃ bật 2FA, KHÔNG OTP ⇒ VẪN bị đòi OTP (FORBIDDEN twoFactorCode) — đột biến (c) phải ĐỎ đây", async () => {
    if (!coDb) return;
    await voiCo("0", async () => {
      const e = await loiCua(goi(idEng2fa, "engineer", true).lenhChamMay({ totpCode: "" }));
      expect(chanBoiCongOtp(e), "người ĐÃ có thiết bị thì lệnh chạm máy vẫn phải hỏi OTP").toBe(true);
      // …và KHÔNG có hàng bỏ-qua nào cho người ĐÃ bật.
      expect((await hangBoQua(idEng2fa)).length).toBe(0);
    });
  });

  it("★★★ đối chứng dương: cờ \"0\" + ĐÃ bật + OTP đúng của CHÍNH lượt ấy ⇒ QUA (chống 'chặn hết')", async () => {
    if (!coDb) return;
    await voiCo("0", async () => {
      await expect(goi(idEng2fa, "engineer", true).lenhChamMay({ totpCode: otp() })).resolves.toEqual({ ok: true });
      expect((await hangBoQua(idEng2fa)).length, "lượt CÓ OTP không được ghi thành lượt bỏ-qua").toBe(0);
    });
  });

  it("★★★ cờ \"1\" và cờ VẮNG + CHƯA bật ⇒ nguyên trạng: chặn từ require2FA (TRƯỚC step-up), 0 hàng bỏ-qua", async () => {
    if (!coDb) return;
    for (const co of ["1", undefined] as const) {
      await voiCo(co, async () => {
        const truoc = (await hangBoQua(idEng)).length;
        const e = await loiCua(goi(idEng, "engineer", false).lenhChamMay({ totpCode: "" }));
        expect(metaCua(e)?.appCode, `cờ=${co ?? "(vắng)"}`).toBe("TWO_FACTOR_NOT_SET_UP");
        expect((await hangBoQua(idEng)).length - truoc, "bị chặn thì KHÔNG có dấu bỏ-qua").toBe(0);
      });
    }
  });

  it("★★ cờ \"0\" + step-up TẮT (`ACTUATION_STEPUP_2FA=false`) ⇒ pass-through NGUYÊN BẢN của cờ step-up, KHÔNG ghi sổ", async () => {
    if (!coDb) return;
    // Khai rõ ranh giới: hàng audit bỏ-qua CHỈ sinh khi step-up ĐANG BẬT mà bị nới — step-up tắt
    // thì tầng 3 vốn pass-through cho mọi người từ trước lượt sửa này, không có gì để ghi.
    process.env.ACTUATION_STEPUP_2FA = "false";
    try {
      await voiCo("0", async () => {
        const truoc = (await hangBoQua(idEng)).length;
        await expect(goi(idEng, "engineer", false).lenhChamMay({ totpCode: "" })).resolves.toEqual({ ok: true });
        expect((await hangBoQua(idEng)).length - truoc).toBe(0);
      });
    } finally {
      process.env.ACTUATION_STEPUP_2FA = "true";
    }
  });
});
