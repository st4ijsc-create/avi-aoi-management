/**
 * ★★★ Pha 8 — **LỖI GHI SỔ PHIÊN KHÔNG CÒN IM LẶNG · TRẦN `varchar(255)` ĐƯỢC GHIM SỐ.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 *   ***∀ lượt ghi sổ phiên HỎNG ⇒ phải ĐẾM ĐƯỢC và ghi log; im lặng là vi phạm.***
 *   ***∀ thay đổi làm JWT DÀI THÊM ⇒ phải làm ô §2 ĐỎ trước khi nó vỡ INSERT ở sản xuất.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ NỬA "NONCE" CỦA NHIỆM VỤ **BỊ CHẶN BỞI PHÉP ĐO** — ĐỌC TRƯỚC KHI SỬA FILE NÀY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nhiệm vụ Pha 8 giao **hai nửa**: (1) thêm nonce vào payload JWT, (2) bỏ `.catch(() => {})`.
 * **Nửa (2) đã làm.** **Nửa (1) KHÔNG ship được**, và đây là số đo:
 *
 *   · `user_sessions.sessionToken` là **`varchar(255)`** (đo từ `information_schema`).
 *   · `createLocalUser` sinh `openId` = `local_<13 số>_<11 ký tự>` = **31 ký tự** cho **MỌI** tài
 *     khoản cục bộ mới (`server/db/auth.ts`). Một người dùng thật đã mang đúng độ dài ấy.
 *   · Với `openId` 31 ký tự, ngân sách còn lại cho `users.name` là:
 *         **KHÔNG nonce**: 30 ký tự ASCII · **10** ký tự tiếng Việt có dấu
 *         **CÓ nonce 6 ký tự**: 15 ký tự ASCII · **5** ký tự tiếng Việt có dấu
 *     (dấu tiếng Việt là **2 byte UTF-8**, mà base64 đếm **BYTE** — đây là sản phẩm tiếng Việt.)
 *   · Đo trên tên thật: `"Trần Văn Bảo"` (12 ký tự) ⇒ JWT **257** ký tự khi có nonce ⇒ **VỠ**.
 *     `"Nguyễn Thị Minh Khai"` ⇒ **267**. `"Chị Hương (Quản đốc)"` ⇒ **273**.
 *   · Chạy thật với nonce: `auth.logoutThuHoi.test.ts` **ĐỎ 6/6 ca** với
 *     `PostgresError 22001: value too long for type character varying(255)`.
 *
 * ⇒ **KHÔNG kích thước nonce nào vừa**: tên `"Nguyễn Thị Minh Khai"` chỉ còn **8 ký tự** biên, mà
 *   nonce rẻ nhất có thể (1 ký tự) đã tốn ~11. Thêm nonce = **mọi người dùng mới tên tiếng Việt
 *   mất hàng phiên**. Đó đúng lớp lỗi đã deploy ra **nhà tù 4/4 tài khoản** ở Pha 7.
 * ⇒ Phải **nới trần TRƯỚC**, rồi mới thêm nonce. Ba đường, **cả ba cần chủ dự án duyệt**:
 *     (a) DDL nới `sessionToken` (bị cấm ở pha này) ·
 *     (b) lưu **băm** JWT (dài cố định 64; hết hẳn lớp lỗi, và khoá phiên không còn nằm nguyên ở
 *         tầng nghỉ) — chạm ~6 điểm: `getSessionByToken` · `thuHoiPhienTheoToken` ·
 *         `publicSession.ts` (`isCurrent`) · `sdk.ts` · khoá của `authSessionCache` ·
 *     (c) bỏ `name`/`appId` khỏi payload (đổi hợp đồng `verifySession`).
 *
 * ⚠ **VÌ SAO §1 KHẲNG ĐỊNH ĐÚNG CÁI LỖI:** vì lỗi ấy **vẫn còn**, và một lưới im lặng về nó sẽ để
 *   nó trôi. §1 là **cầu dao**: ai thêm nonce sẽ thấy nó ĐỎ **kèm hướng dẫn phải nới trần trước** —
 *   thay vì phát hiện bằng một lượt deploy hỏng. Nó **không** khẳng định lỗi là đúng đắn.
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

import { sdk } from "./sdk";
import { ghiSoPhien, demLoiGhiSoPhien, datLaiDemLoiGhiSoPhien } from "./authService";
import * as db from "../db";

/** Đúng hình dạng `openId` mà `createLocalUser` sinh ra cho MỌI tài khoản cục bộ mới. */
const OPEN_ID_THAT = "local_1783673235595_3unhqnawq79";
/** Trần cột, đo từ `information_schema.columns` — không chép từ trí nhớ. */
const TRAN_COT = 255;

const OPEN_ID = `pha8_trungphien_${Date.now()}`;
let uid = 0;

beforeAll(async () => {
  const r = await db.createLocalUser({
    username: OPEN_ID,
    passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
    name: "Pha 8 — sổ phiên",
    role: "user",
  });
  uid = r.id;
});

afterAll(async () => {
  if (uid) await db.deleteUser(uid);
});

/** Ngân sách tên còn lại cho một tài khoản cục bộ MỚI, đo bằng cách ký thật rồi đếm. */
async function tenToiDa(ky: string): Promise<number> {
  let n = -1;
  for (let i = 0; i <= 120; i++) {
    const t = await sdk.createSessionToken(OPEN_ID_THAT, { name: ky.repeat(i), expiresInMs: 31_536_000_000 });
    if (t.length <= TRAN_COT) n = i;
    else break;
  }
  return n;
}

describe("★★★ Pha 5/8 — sổ phiên: lỗi phải ĐẾM ĐƯỢC, và trần cột phải được GHIM", () => {
  it("★★★ cầu chì — dựng được người dùng, và trần cột đúng như đã đo", async () => {
    expect(uid, "không dựng được người dùng ⇒ mọi ô dưới là chân lý rỗng").toBeGreaterThan(0);
    const conn = await db.getDb();
    expect(conn, "cầu chì: phải có DB thật — lưới này KHÔNG dùng `vi.mock`").toBeTruthy();
    const [cot] = await conn!.execute(
      `SELECT character_maximum_length AS len FROM information_schema.columns
       WHERE table_name = 'user_sessions' AND column_name = 'sessionToken'` as never,
    ) as unknown as Array<{ len: number }>;
    expect(
      Number(cot!.len),
      "trần cột đã đổi so với lúc đo. Nếu nó vừa được NỚI thì nợ này đã trả — hãy cập nhật\n" +
        "`TRAN_COT`, gỡ ô §1, và thêm nonce vào `sdk.signSession` (xem khối đầu file).",
    ).toBe(TRAN_COT);
  }, 25_000);

  it("★★★★ §1 CẦU DAO — NỢ MỞ: hai lượt ký trong CÙNG MỘT GIÂY cho ra JWT GIỐNG HỆT", async () => {
    const DONG_BANG = 1_777_000_000_000; // đóng băng ⇒ `exp` hai lượt bằng nhau tuyệt đối
    const spy = vi.spyOn(Date, "now").mockReturnValue(DONG_BANG);
    try {
      const a = await sdk.createSessionToken(OPEN_ID_THAT, { name: "Trùng Giây", expiresInMs: 3_600_000 });
      const b = await sdk.createSessionToken(OPEN_ID_THAT, { name: "Trùng Giây", expiresInMs: 3_600_000 });
      expect(
        a,
        "⚠ Ô NÀY ĐỎ = BẠN VỪA THÊM NONCE VÀO PAYLOAD JWT.\n" +
          "Đó là hướng ĐÚNG, nhưng **chưa đủ điều kiện**: `user_sessions.sessionToken` là\n" +
          "`varchar(255)` và ngân sách tên cho một tài khoản MỚI chỉ còn 10 ký tự tiếng Việt.\n" +
          "Thêm nonce khi CHƯA nới trần ⇒ `22001 value too long` cho mọi người dùng tên tiếng\n" +
          "Việt (đo được: \"Trần Văn Bảo\" ⇒ 257 ký tự). NỚI TRẦN TRƯỚC — xem khối đầu file.",
      ).toBe(b);
    } finally {
      spy.mockRestore();
    }
  }, 20_000);

  it("★★★★ §2 — GHIM ngân sách tên: một thay đổi làm JWT dài thêm phải ĐỎ Ở ĐÂY trước", async () => {
    const ascii = await tenToiDa("N");
    const viet = await tenToiDa("ữ");
    expect(
      { ascii, viet },
      "NGÂN SÁCH TÊN ĐÃ ĐỔI.\n" +
        "· Nhỏ đi ⇒ một thay đổi vừa làm JWT DÀI THÊM. Ở sản xuất điều đó nghĩa là người dùng\n" +
        "  tên dài mất hàng `user_sessions` (nay kêu thành tiếng qua `demLoiGhiSoPhien`).\n" +
        "· Lớn lên ⇒ trần vừa được nới hoặc payload vừa được rút gọn: nợ đã trả, cập nhật số\n" +
        "  này và đọc lại khối đầu file để gỡ §1 + thêm nonce.",
    ).toEqual({ ascii: 30, viet: 10 });
  }, 30_000);

  it("★★★★ §3 — lỗi ghi sổ phiên phải ĐẾM ĐƯỢC, không được nuốt im lặng", async () => {
    datLaiDemLoiGhiSoPhien();
    expect(demLoiGhiSoPhien(), "cầu chì: bộ đếm phải bắt đầu từ 0").toBe(0);

    // Lỗi THẬT từ PostgreSQL (`22001`) — ⚠ KHÔNG `vi.mock`: lưới xanh trên mã đã bị thay là một
    // lớp lỗi riêng của dự án này. 300 ký tự > `varchar(255)`.
    const quaDai = "x".repeat(300);
    const im = vi.spyOn(console, "error").mockImplementation(() => {});
    let id: number | null = null;
    try {
      id = await ghiSoPhien({
        userId: uid,
        sessionToken: quaDai,
        deviceName: "vitest-qua-dai",
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      expect(
        demLoiGhiSoPhien(),
        "LƯỢT GHI SỔ PHIÊN HỎNG MÀ KHÔNG ĐỂ LẠI DẤU VẾT NÀO.\n" +
          "⚠ `.catch(() => {})` làm lỗi này VÔ HÌNH: lượt đăng nhập vẫn nhận cookie hợp lệ nhưng\n" +
          "  KHÔNG có hàng phiên nào đại diện ⇒ vô hình với `session.list`, NGOÀI TẦM\n" +
          "  `session.revoke`. Task 2 vừa biến `user_sessions` thành đường thu hồi CHÍNH.",
      ).toBe(1);
      expect(im, "hỏng thì phải ghi một dòng `error` có ngữ cảnh").toHaveBeenCalled();
    } finally {
      im.mockRestore();
    }
    expect(id, "lượt hỏng phải trả `null` — người gọi cần phân biệt 'ghi được' với 'hỏng'").toBeNull();
  }, 25_000);

  it("★★★★ §4 — ĐỐI CHỨNG DƯƠNG: lượt ghi HỢP LỆ ghi được hàng và KHÔNG làm bộ đếm nhích", async () => {
    datLaiDemLoiGhiSoPhien();
    const t = await sdk.createSessionToken(OPEN_ID, { name: "Hợp Lệ", expiresInMs: 3_600_000 });
    const id = await ghiSoPhien({
      userId: uid,
      sessionToken: t,
      deviceName: "vitest-hop-le",
      expiresAt: new Date(Date.now() + 3_600_000),
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
