/**
 * ★★★ Pha 8 — **MỖI LƯỢT ĐĂNG NHẬP LÀ MỘT PHIÊN RIÊNG, KỂ CẢ TRONG CÙNG MỘT GIÂY.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 *   ***∀ hai lượt đăng nhập liên tiếp của cùng một người — kể cả khi đồng hồ ĐỨNG YÊN — sinh ra
 *   HAI hàng `user_sessions` PHÂN BIỆT, và mỗi hàng thu hồi được ĐỘC LẬP.***
 *   ***∀ lượt ghi sổ phiên HỎNG ⇒ phải ĐẾM ĐƯỢC và ghi log; im lặng là vi phạm.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ FILE NÀY TỪNG LÀ MỘT **CẦU DAO**, VÀ CẦU DAO ẤY ĐÃ ĐƯỢC GỠ — ĐỌC TRƯỚC KHI SỬA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản trước khẳng định điều **ngược lại**: *"hai lượt ký trong cùng một giây cho ra JWT GIỐNG
 * HỆT"*, kèm hướng dẫn *"nới trần TRƯỚC rồi mới thêm nonce"*. Nó **không** nói lỗi ấy là đúng đắn;
 * nó là một cái phanh, vì điều kiện đủ để vá **chưa có**:
 *   · `user_sessions.sessionToken` là `varchar(255)`, dài nhất trên 276 hàng thật là **233**;
 *   · thêm nonce ⇒ `auth.logoutThuHoi.test.ts` **ĐỎ 6/6** với `22001 value too long`.
 *
 * **Điều kiện đủ nay ĐÃ CÓ** — mig `0317` đổi cột sang **`text`**, áp lên cả hai DB (đo lại ở ô
 * *"cầu chì"* dưới, **không** chép từ trí nhớ). Nên cầu dao được **thay bằng lưới khẳng định đúng
 * bất biến mà nó vẫn canh từ phía sau**: hai vé phải KHÁC NHAU.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO PHẢI ÉP **CÙNG MỘT GIÂY**, KHÔNG PHẢI "gọi hai lần rồi so"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `exp` của JWT tính theo **GIÂY**. Hai lượt gọi cách nhau ≥1 giây cho hai `exp` khác nhau ⇒ hai
 * token khác nhau **dù không có nonce nào**. Một ca như thế xanh vì **MAY**, không vì đúng — và nó
 * sẽ xanh y hệt sau khi ai đó gỡ nonce. Nên §1 **đóng băng `Date.now`**: mọi ô của payload bằng
 * nhau tuyệt đối, và thứ **duy nhất** còn có thể làm hai vé khác nhau là `jti`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ HAI VẾ, HAI Ô KHÁC NHAU — CÓ CHỦ Ý
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * §1/§2 canh **nonce**; §3 canh **lượt nuốt lỗi**. Gỡ nonce ⇒ §1/§2 đỏ, §3 **vẫn xanh**. Trả lại
 * `.catch(() => {})` ⇒ §3 đỏ, §1/§2 **vẫn xanh**. Hai hỏng khác nhau ⇒ hai ô khác nhau; nếu cùng
 * một ô đỏ cho cả hai thì lưới đang canh một nửa và **ăn may** nửa kia (đã ship đúng lỗi ấy ở Pha 5).
 *
 * ⚠ Lưới chạy trên **DB test THẬT** và **KHÔNG dùng `vi.mock`**: cả hai vế nói về *một hàng trong
 *   sổ* và *một lỗi thật của PostgreSQL*. File tự dựng tài khoản của mình và **chỉ dọn đúng hàng
 *   ấy** (kỷ luật Pha 8 Task 3).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/**
 * ⚠⚠ **PHẢI ĐẶT TRƯỚC MỌI `import`** — `server/_core/env.ts` đọc `process.env` **đúng một lần** lúc
 * nạp module, và `vitest.setup.ts` cố ý **KHÔNG** nạp `.env`. Thiếu hai biến này thì
 * `sdk.signSession` ném `DataError: Zero-length key is not supported` ⇒ các ô dưới **ĐỎ VÌ HẠ
 * TẦNG**, một màu đỏ **nói dối** về bất biến đang canh (đã đo đúng ở lượt chạy đầu của lưới này).
 * `vi.hoisted` là thứ duy nhất chạy trước `import` trong ESM.
 */
vi.hoisted(() => {
  process.env.JWT_SECRET ||= "pha8-phien-trung-trong-mot-giay-secret";
  process.env.VITE_APP_ID ||= "avi-aoi-management";
});

import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { sdk } from "./sdk";
import {
  establishSession,
  ghiSoPhien,
  demLoiGhiSoPhien,
  datLaiDemLoiGhiSoPhien,
} from "./authService";
import * as db from "../db";
import { userSessions, type User } from "../../drizzle/schema";

/** Dấu riêng của file này — mọi hàng nó tạo mang tiền tố này, và lượt dọn khoá đúng vào đó. */
const DAU = "pha8-trungphien";
const MOT_GIO_MS = 60 * 60 * 1000;

/** Đúng hình dạng `openId` mà `createLocalUser` sinh ra cho MỌI tài khoản cục bộ mới (31 ký tự). */
const OPEN_ID_THAT = "local_1783673235595_3unhqnawq79";

/**
 * Tên **DÀI NHẤT theo BYTE** đang có thật trong `users` của DB sản xuất (đo 2026-08-10:
 * `"Chị Hương (Quản đốc)"` — 20 ký tự / **29 byte**). Dùng để đo biên độ token thật, vì base64
 * đếm **BYTE** chứ không đếm ký tự — và đây là sản phẩm tiếng Việt.
 */
const TEN_DAI_NHAT_THAT = "Chị Hương (Quản đốc)";

let uid = 0;
let nguoi: User;

beforeAll(async () => {
  const r = await db.createLocalUser({
    username: `${DAU}-${Date.now()}`,
    passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
    name: "Pha 8 — sổ phiên",
    role: "user",
  });
  uid = r.id;
  nguoi = (await db.getUserById(uid)) as unknown as User;
});

afterAll(async () => {
  const d = await db.getDb();
  if (d && uid) await d.delete(userSessions).where(eq(userSessions.userId, uid));
  if (uid) await db.deleteUser(uid);
});

/** `Request` đúng hình dạng `establishSession` đọc (ip · socket · user-agent · protocol/hostname). */
function reqGia(): Request {
  return {
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    headers: { "user-agent": `${DAU}-ua` },
    protocol: "http",
    hostname: "localhost",
  } as unknown as Request;
}

/** `Response` chỉ giữ lại giá trị cookie đã cấp — đó là **vé thật** người dùng cầm về. */
function resGia(): { res: Response; ve: string[] } {
  const ve: string[] = [];
  const res = {
    cookie: (_ten: string, gt: string) => {
      ve.push(gt);
    },
  } as unknown as Response;
  return { res, ve };
}

/** Mọi hàng sổ của tài khoản này, đọc THẲNG — không qua cache, không qua hàm của đường vá. */
async function hangCuaToi() {
  const d = await db.getDb();
  return d!.select().from(userSessions).where(eq(userSessions.userId, uid));
}

describe("★★★ Pha 5/8 — mỗi lượt đăng nhập là MỘT phiên riêng, kể cả trong cùng một giây", () => {
  it("★★★ cầu chì — dựng được người dùng, và cột `sessionToken` KHÔNG còn trần", async () => {
    expect(uid, "không dựng được người dùng ⇒ mọi ô dưới là chân lý rỗng").toBeGreaterThan(0);
    const conn = await db.getDb();
    expect(conn, "cầu chì: phải có DB thật — lưới này KHÔNG dùng `vi.mock`").toBeTruthy();
    const [cot] = (await conn!.execute(
      `SELECT data_type AS kieu, character_maximum_length AS tran
         FROM information_schema.columns
        WHERE table_name = 'user_sessions' AND column_name = 'sessionToken'` as never,
    )) as unknown as Array<{ kieu: string; tran: number | null }>;
    expect(
      { kieu: cot!.kieu, tran: cot!.tran },
      "TRẦN CỘT ĐÃ QUAY LẠI.\n" +
        "⚠ `sessionToken` giữ NGUYÊN VĂN JWT, mà độ dài JWT do `users.name` lái — dữ liệu người\n" +
        "  dùng, ta không kiểm soát. Một trần bằng SỐ ở đây là một TRẦN ĐOÁN, và lượt vỡ nó KHÔNG\n" +
        "  làm đăng nhập hỏng: nó làm phiên MẤT HÀNG SỔ ⇒ vô hình với `session.list`, ngoài tầm\n" +
        "  `session.revoke`. Đó đúng là lỗ mà mig `0317` vừa đóng — xem `drizzle/0317_*.sql`.",
    ).toEqual({ kieu: "text", tran: null });
  }, 25_000);

  it("★★★★ §1 — HAI lượt `establishSession` trong CÙNG MỘT GIÂY ⇒ HAI hàng phiên PHÂN BIỆT", async () => {
    // Đóng băng đồng hồ: `exp` (tính theo GIÂY) của hai vé bằng nhau TUYỆT ĐỐI, nên thứ duy nhất
    // còn có thể làm hai vé khác nhau là `jti`. Không đóng băng thì ô này xanh vì MAY.
    const DONG_BANG = 1_777_000_000_000;
    const dongHo = vi.spyOn(Date, "now").mockReturnValue(DONG_BANG);
    const im = vi.spyOn(console, "error").mockImplementation(() => {});
    datLaiDemLoiGhiSoPhien();
    let ve: string[];
    try {
      const r1 = resGia();
      const r2 = resGia();
      await establishSession(nguoi, reqGia(), r1.res);
      await establishSession(nguoi, reqGia(), r2.res);
      ve = [...r1.ve, ...r2.ve];
    } finally {
      dongHo.mockRestore();
      im.mockRestore();
    }

    // Cầu chì: đồng hồ phải THẬT SỰ đứng yên, nếu không ô này không đo thứ nó khai.
    expect(ve.length, "cầu chì: hai lượt đăng nhập phải cấp đúng hai cookie").toBe(2);
    const [a, b] = ve as [string, string];
    expect(
      a === b,
      "HAI VÉ GIỐNG HỆT NHAU.\n" +
        "⚠ HS256 là hàm TẤT ĐỊNH: cùng `{openId, appId, name, exp}` ⇒ cùng byte. Thiếu `jti`,\n" +
        "  hai lượt đăng nhập trong cùng một giây dùng CHUNG một khoá phiên ⇒ (1) lượt ghi sổ thứ\n" +
        "  hai vỡ UNIQUE nên phiên ấy VÔ HÌNH với `session.list` và NGOÀI TẦM `session.revoke`,\n" +
        "  (2) thu hồi một thiết bị là thu hồi CẢ HAI. Sửa ở `sdk.signSession` (`.setJti`).",
    ).toBe(false);

    const hang = await hangCuaToi();
    expect(
      hang.length,
      "hai lượt đăng nhập KHÔNG cho hai hàng sổ — lượt thứ hai đã rơi vào `catch` (23505)",
    ).toBe(2);
    expect(
      new Set(hang.map((h) => h.sessionToken)).size,
      "hai hàng sổ dùng CHUNG một khoá phiên ⇒ chúng không phải hai phiên",
    ).toBe(2);
    expect(
      demLoiGhiSoPhien(),
      "hai lượt đăng nhập hợp lệ mà bộ đếm lỗi ghi sổ nhích ⇒ có lượt ghi đã vỡ trong im lặng",
    ).toBe(0);

    // …và mỗi hàng thu hồi được ĐỘC LẬP — vế thứ hai của bất biến.
    const [h1, h2] = hang as [typeof hang[number], typeof hang[number]];
    await db.revokeSession(h1.id, uid);
    const conLai = (await hangCuaToi()).filter((h) => h.isActive).map((h) => h.id);
    expect(conLai, "thu hồi phiên A đã kéo theo phiên B ⇒ hai phiên KHÔNG độc lập").toEqual([h2.id]);
  }, 30_000);

  it("★★★★ §2 — nonce nằm ở CỬA ĐÚC, và vé vẫn xác thực được (nonce là entropy, không phải điều kiện)", async () => {
    /**
     * ⚠⚠ **THIẾT BỊ ĐO NÓI DỐI — ĐÃ ĐO, GHI LẠI ĐỂ LƯỢT SAU KHÔNG MẤT THÌ GIỜ.** Bản đầu của ô này
     *    đóng băng ở một mốc **quá khứ** (`1_777_000_111_000`) rồi mới `verifySession`, và nó ĐỎ
     *    với `JWTExpired` — **không phải** vì nonce làm hỏng lượt xác thực.
     *    Hai điều học được:
     *      · `jose` kiểm `exp` bằng **`new Date()`**, **KHÔNG** bằng `Date.now()` ⇒
     *        `vi.spyOn(Date, "now")` **không chạm tới** lượt kiểm hạn của nó;
     *      · nên mốc đóng băng phải là **hiện tại thật**: hai lượt ký vẫn nhận **cùng một** `exp`
     *        (đó là toàn bộ điều ô này cần), mà vé thì vẫn còn hạn dưới đồng hồ thật.
     */
    const DONG_BANG = Date.now();
    const dongHo = vi.spyOn(Date, "now").mockReturnValue(DONG_BANG);
    try {
      const x = await sdk.createSessionToken(OPEN_ID_THAT, { name: "Trùng Giây", expiresInMs: MOT_GIO_MS });
      const y = await sdk.createSessionToken(OPEN_ID_THAT, { name: "Trùng Giây", expiresInMs: MOT_GIO_MS });
      expect(
        x === y,
        "CỬA ĐÚC vé (`sdk.signSession`) vẫn tất định ⇒ mọi đường cấp phiên đều thừa hưởng lỗ này,\n" +
          "kể cả những đường KHÔNG đi qua `establishSession`.",
      ).toBe(false);

      // ⚠ Nonce KHÔNG được làm hỏng lượt xác thực: nó là entropy, không phải một điều kiện mới.
      //   Một bản vá thêm phép kiểm `jti` ở `verifySession` sẽ giết mọi cookie đã cấp trước đó.
      for (const [ten, t] of [["vé 1", x], ["vé 2", y]] as const) {
        const p = await sdk.verifySession(t);
        expect(p, `${ten}: có nonce mà KHÔNG xác thực được ⇒ nonce đã thành một điều kiện`).not.toBeNull();
        expect(p!.openId).toBe(OPEN_ID_THAT);
        expect(p!.name).toBe("Trùng Giây");
      }
    } finally {
      dongHo.mockRestore();
    }
  }, 25_000);

  it("★★ §2b — BIÊN ĐỘ THẬT sau nonce: tên dài nhất trong DB + openId 31 ký tự vẫn thoải mái", async () => {
    // Đây là phép ĐO, không phải một trần đoán: cột là `text` nên không còn giới hạn để vượt. Ô này
    // giữ con số **nhìn thấy được** để lượt sau biết một thay đổi làm JWT dài thêm bao nhiêu.
    const t = await sdk.createSessionToken(OPEN_ID_THAT, {
      name: TEN_DAI_NHAT_THAT,
      expiresInMs: 31_536_000_000,
    });
    const cu = await sdk.createSessionToken(OPEN_ID_THAT, {
      name: "",
      expiresInMs: 31_536_000_000,
    });
    expect(t.length - cu.length, "chi phí của phần TÊN đã đổi bất ngờ").toBeGreaterThan(0);
    expect(
      t.length,
      `JWT cho tên dài nhất thật ("${TEN_DAI_NHAT_THAT}", 29 byte) + openId 31 ký tự + nonce.\n` +
        "Số này chỉ là MỐC ĐO — nó KHÔNG phải một trần. Lệch nhiều ⇒ payload vừa đổi hình dạng.",
    ).toBeLessThan(400);
  }, 25_000);

  it("★★★★ §3 — lỗi ghi sổ phiên phải ĐẾM ĐƯỢC, không được nuốt im lặng", async () => {
    datLaiDemLoiGhiSoPhien();
    expect(demLoiGhiSoPhien(), "cầu chì: bộ đếm phải bắt đầu từ 0").toBe(0);

    // Lỗi THẬT từ PostgreSQL — ⚠ KHÔNG `vi.mock`: lưới xanh trên mã đã bị thay là một lớp lỗi
    // riêng của dự án này. Va chạm ràng buộc UNIQUE trên `sessionToken` ⇒ `23505`.
    // ⚠ Trước mig `0317` ô này dùng một chuỗi 300 ký tự để ép `22001`. Cột nay là `text` nên lượt
    //   ghi ấy **THÀNH CÔNG** và ô này sẽ xanh vì một tập rỗng — đúng lớp "lưới đo thứ không còn
    //   tồn tại". Đường ép lỗi phải đi theo một ràng buộc CÒN SỐNG.
    const trung = await sdk.createSessionToken(OPEN_ID_THAT, {
      name: `${DAU}-trung`,
      expiresInMs: MOT_GIO_MS,
    });
    const dau = await ghiSoPhien({
      userId: uid,
      sessionToken: trung,
      deviceName: `${DAU}-lan-1`,
      expiresAt: new Date(Date.now() + MOT_GIO_MS),
    });
    expect(dau, "cầu chì: lượt ghi ĐẦU phải thành công, nếu không ô dưới đo nhầm nguyên nhân").toBeTruthy();
    expect(demLoiGhiSoPhien(), "cầu chì: lượt ghi hợp lệ không được làm bộ đếm nhích").toBe(0);

    const im = vi.spyOn(console, "error").mockImplementation(() => {});
    let lai: number | null = null;
    try {
      lai = await ghiSoPhien({
        userId: uid,
        sessionToken: trung, // ← va chạm UNIQUE
        deviceName: `${DAU}-lan-2`,
        expiresAt: new Date(Date.now() + MOT_GIO_MS),
      });
      expect(
        demLoiGhiSoPhien(),
        "LƯỢT GHI SỔ PHIÊN HỎNG MÀ KHÔNG ĐỂ LẠI DẤU VẾT NÀO.\n" +
          "⚠ `.catch(() => {})` làm lỗi này VÔ HÌNH: lượt đăng nhập vẫn nhận cookie hợp lệ nhưng\n" +
          "  KHÔNG có hàng phiên nào đại diện ⇒ vô hình với `session.list`, NGOÀI TẦM\n" +
          "  `session.revoke`. Task 2 đã biến `user_sessions` thành đường thu hồi CHÍNH.\n" +
          "⚠ Nay nonce làm va chạm UNIQUE gần như không còn, nên BẤT CỨ lỗi nào lọt tới `catch`\n" +
          "  ấy đều là dấu hiệu của một thứ KHÁC HẲN — đúng loại tín hiệu không được nuốt.",
      ).toBe(1);
      expect(im, "hỏng thì phải ghi một dòng `error` có ngữ cảnh").toHaveBeenCalled();
    } finally {
      im.mockRestore();
    }
    expect(lai, "lượt hỏng phải trả `null` — người gọi cần phân biệt 'ghi được' với 'hỏng'").toBeNull();
  }, 25_000);

  it("★★★★ §4 — ĐỐI CHỨNG DƯƠNG: lượt ghi HỢP LỆ ghi được hàng và KHÔNG làm bộ đếm nhích", async () => {
    datLaiDemLoiGhiSoPhien();
    const t = await sdk.createSessionToken(OPEN_ID_THAT, {
      name: `${DAU}-hop-le`,
      expiresInMs: MOT_GIO_MS,
    });
    const id = await ghiSoPhien({
      userId: uid,
      sessionToken: t,
      deviceName: `${DAU}-hop-le`,
      expiresAt: new Date(Date.now() + MOT_GIO_MS),
    });
    expect(id, "đường hợp lệ phải ghi được hàng phiên").toBeTruthy();
    expect(
      demLoiGhiSoPhien(),
      "bộ đếm nhích trên một lượt ĐÚNG ⇒ nó đang đếm thứ khác, và ô §3 xanh vì lý do sai",
    ).toBe(0);

    // …và hàng ấy thu hồi được ĐỘC LẬP (đường thu hồi CHÍNH của Task 2 vẫn thông).
    const truoc = (await db.getUserSessions(uid)).map((s) => s.id);
    expect(truoc, "cầu chì: hàng vừa ghi phải đang sống").toContain(id);
    await db.revokeSession(id!, uid);
    const sau = (await db.getUserSessions(uid)).map((s) => s.id);
    expect(sau, "hàng vừa thu hồi phải BIẾN MẤT khỏi danh sách phiên sống").not.toContain(id);
  }, 25_000);
});
