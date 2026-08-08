/**
 * ★★★ Pha 7 Task 7 / Net 1 — **LƯỢNG TỪ TRÊN TRỤC "CỘT": ∀ cột của `users` phải được PHÂN LOẠI.**
 * (Tự khai `Pha 5` để `vramPha5Gate.test.ts` kéo file này vào lượng từ *"mọi lưới tự khai một pha
 *  phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÂY LÀ PHÉP THỬ CỦA **LUẬT**, KHÔNG PHẢI CỦA **DANH SÁCH**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nếu lưới chỉ khẳng định *"`passwordHash` và `twoFactorSecret` không ra"* thì nó **là một danh
 * sách hai phần tử** — và lớp lỗi *"cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"* đã tái diễn **MƯỜI
 * SÁU** lần. Ô §1 dưới đây thay vào đó hỏi:
 *
 *   ***∀ cột c ∈ getTableColumns(users): c phải có mặt trong `USER_FIELD_VISIBILITY`***  (∀-A)
 *   ***∀ mục m ∈ `USER_FIELD_VISIBILITY`: m phải là một cột THẬT của `users`***           (∀-B)
 *
 * ⇒ Thêm một cột bí mật **MỚI** (bất kể tên gì) vào `drizzle/schema/auth.ts` ⇒ **ĐỎ ngay**, buộc
 *   một người **quyết** nó công khai hay chỉ ở máy chủ. Đó là phép thử mà một danh sách **không
 *   bao giờ** vượt qua được.
 *
 * ⚠ Và vì `toPublicUser()` **CHỌN** theo danh sách cho phép, cột mới ấy **không ra được** ngay cả
 *   trong khoảng thời gian ô này còn đỏ — an toàn **không** là hệ quả của một lưới đang xanh.
 */
import { describe, it, expect } from "vitest";
import {
  USER_FIELD_VISIBILITY,
  PUBLIC_USER_FIELDS,
  SERVER_ONLY_USER_FIELDS,
  toPublicUser,
  toPublicUsers,
  redactServerOnlyUserFields,
  moiCotCuaBangUsers,
} from "./publicUser";

/** Một hàng `users` **đầy đủ** — mọi cột có giá trị KHÁC NHAU để phép chiếu không thể "đúng nhờ may". */
function hangDay(): Record<string, unknown> {
  const h: Record<string, unknown> = {};
  for (const c of moiCotCuaBangUsers()) h[c] = `giá-trị-của-${c}`;
  h.id = 49;
  h.passwordHash = "$2b$10$xY5zPa9lTNrb/YC3ELd/vuFf./ffNN1F8qC3p50oXGsBsulALWlra";
  h.twoFactorSecret = "IA2DCZK5LBKTSOTYGMUXCM2UHZ2G4ULQ";
  h.twoFactorEnabled = true;
  h.isActive = true;
  h.role = "supervisor";
  return h;
}

describe("★★★ Task 7 §1 — ∀ CỘT của `users` phải được phân loại (hai chiều)", () => {
  it("★ cầu chì — đọc được tập cột thật, và nó không rỗng (0 cột ⇒ mọi ô dưới là chân lý rỗng)", () => {
    const cot = moiCotCuaBangUsers();
    expect(cot.length, "getTableColumns(users) trả rỗng — drizzle đã đổi hình dạng?").toBeGreaterThanOrEqual(15);
    expect(cot, "cột `twoFactorSecret` phải tồn tại — nếu không, cả lưới này đang canh một bảng khác").toContain(
      "twoFactorSecret",
    );
  });

  it("★★★ ∀-A — MỌI cột của `users` có mặt trong USER_FIELD_VISIBILITY (cột MỚI ⇒ ĐỎ)", () => {
    const chuaPhanLoai = moiCotCuaBangUsers().filter((c) => !(c in USER_FIELD_VISIBILITY));
    expect(
      chuaPhanLoai.join(" · "),
      "cột của `users` CHƯA ĐƯỢC PHÂN LOẠI trong server/_core/publicUser.ts.\n" +
        "⚠ Mặc định phải là \"server-only\" — mở một cột là một quyết định về AN NINH; đóng thì không.",
    ).toBe("");
  });

  it("★★★ ∀-B — MỌI mục trong USER_FIELD_VISIBILITY là cột THẬT (mục ma ⇒ ĐỎ)", () => {
    const cot = new Set(moiCotCuaBangUsers());
    const mucMa = Object.keys(USER_FIELD_VISIBILITY).filter((k) => !cot.has(k));
    expect(
      mucMa.join(" · "),
      "mục phân loại KHÔNG có cột thật tương ứng ⇒ danh sách đã trôi khỏi schema " +
        "(và một mục 'server-only' ma tạo cảm giác an toàn GIẢ)",
    ).toBe("");
  });

  it("★★★ hai bí mật ĐO ĐƯỢC ở Bước 1 phải nằm phía `server-only` — neo vào bằng chứng, không vào khẩu vị", () => {
    expect(USER_FIELD_VISIBILITY.passwordHash).toBe("server-only");
    expect(USER_FIELD_VISIBILITY.twoFactorSecret).toBe("server-only");
    expect(SERVER_ONLY_USER_FIELDS).toContain("passwordHash");
    expect(SERVER_ONLY_USER_FIELDS).toContain("twoFactorSecret");
  });

  it("★ hai tập RỜI NHAU và HỢP LẠI đúng bằng tập cột (không cột nào ở cả hai / không cột nào rơi ra)", () => {
    const giao = PUBLIC_USER_FIELDS.filter((f) => (SERVER_ONLY_USER_FIELDS as readonly string[]).includes(f));
    expect(giao.join(" · "), "một cột không thể vừa công khai vừa chỉ-ở-máy-chủ").toBe("");
    const hop = [...PUBLIC_USER_FIELDS, ...SERVER_ONLY_USER_FIELDS].sort();
    expect(hop).toEqual(moiCotCuaBangUsers());
  });
});

describe("★★★ Task 7 §2 — phép CHIẾU: mặc định ĐÓNG", () => {
  it("★★★ toPublicUser() phát ra ĐÚNG tập cho phép — không thừa MỘT khoá nào", () => {
    const ra = toPublicUser(hangDay());
    expect(Object.keys(ra).sort()).toEqual([...PUBLIC_USER_FIELDS].sort());
  });

  it("★★★ toPublicUser() KHÔNG phát ra bí mật, kể cả khi đầu vào có đủ", () => {
    const ra = toPublicUser(hangDay()) as Record<string, unknown>;
    for (const k of SERVER_ONLY_USER_FIELDS) {
      expect(k in ra, `khoá bí mật \`${k}\` LỌT qua phép chiếu`).toBe(false);
    }
  });

  it("★★★ MẶC ĐỊNH ĐÓNG — một cột LẠ (chưa phân loại) KHÔNG ra được qua phép chiếu", () => {
    // ⚠ Đây là phần khiến bản vá không phụ thuộc vào việc ai đó nhớ cập nhật danh sách:
    //   giữa lúc cột mới xuất hiện và lúc nó được phân loại, nó vẫn KHÔNG rời máy chủ.
    // ⚠ Tên cột ở đây CỐ Ý mang tiền tố `__ĐỘTBIẾN_` — một tên "nghe hợp lý" như `avatarUrl` sẽ
    //   làm ô này ĐỎ NHẦM vào ngày ai đó thêm thật cột ấy và phân loại nó là `"public"` (đã đo:
    //   đột biến M7 lần đầu đỏ đúng vì lý do này, và đó là lỗi của LƯỚI, không của luật).
    const co: Record<string, unknown> = {
      ...hangDay(),
      __DOTBIEN_recoveryTokenSecret: "bí-mật-thứ-BA",
      __DOTBIEN_avatarUrl: "/a.png",
    };
    const ra = toPublicUser(co) as Record<string, unknown>;
    expect("__DOTBIEN_recoveryTokenSecret" in ra, "cột lạ LỌT ra ⇒ đây là danh sách cấm, không phải cho phép").toBe(false);
    expect("__DOTBIEN_avatarUrl" in ra).toBe(false);
  });

  it("★ toPublicUsers() giữ đúng thứ tự và số lượng", () => {
    const ra = toPublicUsers([{ ...hangDay(), id: 1 }, { ...hangDay(), id: 2 }]);
    expect(ra.map((u) => u.id)).toEqual([1, 2]);
    expect(Object.keys(ra[0]!).sort()).toEqual([...PUBLIC_USER_FIELDS].sort());
  });

  it("★★ ĐỐI CHỨNG DƯƠNG — client VẪN NHẬN ĐỦ thứ nó thật sự dùng", () => {
    // ⚠ Không có ô này thì một bản vá **cắt hết** cũng "đạt" — đúng bài học `215/215` xanh suốt
    //   thời gian một tool chết. Danh sách dưới đây **đo được** từ mã client, không phải đoán:
    //   `git grep` trên `client/src/**` cho `user?.role`(70) `user.id`(25+15) `user.email`(13+4)
    //   `user.name`(11+8) `user.username`(9) `user.isActive`(8) `user.position`(6)
    //   `user.department`(6) `user.phone`(1) `user.loginMethod`(1) `user.lastSignedIn`(1);
    //   `twoFactorEnabled` ⇐ `client/src/hooks/useActuationReadiness.ts:43`;
    //   `openId` ⇐ `DashboardTemplatePrompt.tsx:30` / `FirstRunTour.tsx:118` / `NotificationCenter.tsx:81`;
    //   `createdAt`/`updatedAt` ⇐ `client/src/pages/Users.tsx` (kiểu `UserType`).
    const CLIENT_CAN = [
      "id", "openId", "username", "name", "email", "phone", "department", "position",
      "loginMethod", "role", "isActive", "twoFactorEnabled", "createdAt", "updatedAt", "lastSignedIn",
    ] as const;
    const ra = toPublicUser(hangDay()) as Record<string, unknown>;
    const thieu = CLIENT_CAN.filter((k) => !(k in ra));
    expect(thieu.join(" · "), "bản vá đã CẮT thứ client đang dùng ⇒ hỏng giao diện, không phải 'an toàn hơn'").toBe("");
    expect(ra.role).toBe("supervisor");
    expect(ra.twoFactorEnabled).toBe(true);
    expect(ra.id).toBe(49);
  });
});

describe("★★★ Task 7 §3 — redactServerOnlyUserFields(): giữ KIỂU `User`, rỗng GIÁ TRỊ bí mật", () => {
  it("★★★ mọi cột server-only thành null, mọi cột public GIỮ NGUYÊN", () => {
    const goc = hangDay();
    const ra = redactServerOnlyUserFields(goc) as Record<string, unknown>;
    for (const k of SERVER_ONLY_USER_FIELDS) {
      expect(k in ra, "phải GIỮ khoá (để còn đúng kiểu `User`)").toBe(true);
      expect(ra[k], `\`${k}\` chưa bị làm rỗng`).toBeNull();
    }
    for (const k of PUBLIC_USER_FIELDS) {
      expect(ra[k], `cột công khai \`${k}\` bị đổi giá trị — đây KHÔNG phải thu hẹp`).toEqual(goc[k]);
    }
  });

  it("★★ KHÔNG SỬA đối tượng gốc (đường xác thực vẫn cần hàng thô ở tầng dưới)", () => {
    const goc = hangDay();
    redactServerOnlyUserFields(goc);
    expect(goc.twoFactorSecret, "hàm đã sửa TẠI CHỖ ⇒ nó sẽ làm hỏng người gọi khác").toBe(
      "IA2DCZK5LBKTSOTYGMUXCM2UHZ2G4ULQ",
    );
  });

  it("★★★ CÙNG HÌNH DẠNG với đường cache — cache-hit và cache-miss thôi khác nhau", () => {
    // ⚠ Đo được ở Bước 2 §2.1 TRƯỚC bản vá: 6 lượt `auth.me` liên tiếp ⇒ lượt #1 RÒ, #2..#6 sạch,
    //   vì `authSessionCache` che còn đường DB thì không. Rò NGẮT QUÃNG là rò khó thấy nhất.
    const quaCache = { ...hangDay(), passwordHash: null, twoFactorSecret: null };
    const quaDb = redactServerOnlyUserFields(hangDay());
    expect(Object.keys(quaDb).sort()).toEqual(Object.keys(quaCache).sort());
    expect(quaDb).toEqual(quaCache);
  });
});
