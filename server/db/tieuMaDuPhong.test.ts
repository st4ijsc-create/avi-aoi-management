/**
 * ★★★ Pha 9 nhóm A · **A5 — MÃ DỰ PHÒNG LÀ DÙNG-MỘT-LẦN. LƯỚI HÀNH VI, TRÊN DB THẬT.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 *   ***∀ mã dự phòng: lượt tiêu thứ NHẤT thành công; lượt tiêu thứ HAI của CÙNG mã thất bại.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI — LƯỢT ĐỘT BIẾN CỦA A5 ĐÃ CHỈ RA MỘT VÙNG MÙ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * A5 gộp **ba** bản sao của thủ tục *"tìm mã khớp → ĐÁNH DẤU ĐÃ DÙNG"* về một chủ. Đột biến bắt
 * buộc của A5 — **bỏ đúng lượt `UPDATE isUsed = true`, giữ nguyên `return true`** — làm
 * `hoTuyenSongSong.test.ts` đỏ **3 ca**… nhưng cả ba đều đỏ vì **HÌNH DẠNG** (chữ ký ghi biến mất
 * khỏi bộ suy), **không** vì hành vi. Đo được: **0** ca hành vi đỏ; `twoFactor.test.ts` xanh.
 *
 * Nghĩa là trước file này, bất biến *"dùng một lần"* — thứ **duy nhất** phân biệt một mã dự phòng
 * với một **mật khẩu vĩnh viễn** — chỉ được canh bằng một lưới đọc mã. Một bản vá giữ đúng hình
 * dạng mà sai hiệu lực (ví dụ `UPDATE` lọc nhầm `where`, hoặc chạy trong một transaction bị cuộn
 * lại) sẽ **ship được**. Đây đúng bài học *"lưới HÌNH DẠNG ≠ lưới HÀNH VI"*.
 *
 * ⚠ Lưới chạy trên **DB test THẬT** (`aoi_management_test`): bất biến nói về **một hàng đổi trạng
 *   thái**, nên một bảng giả trong bộ nhớ sẽ giả định đúng thứ nó phải chứng minh. File tự dựng tài
 *   khoản của mình và **chỉ dọn đúng hàng ấy** (kỷ luật Pha 8 Task 3).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, and } from "drizzle-orm";
import * as db from "./index";
import { backupCodes } from "../../drizzle/schema";

const DAU = "pha9-a5-tieu-ma";

let uid = 0;

/** Đếm mã CHƯA dùng — đọc thẳng bảng, không qua hàm nào của đường vá. */
async function conLai(): Promise<number> {
  const d = await db.getDb();
  const hang = await d!
    .select()
    .from(backupCodes)
    .where(and(eq(backupCodes.userId, uid), eq(backupCodes.isUsed, false)));
  return hang.length;
}

beforeAll(async () => {
  const r = await db.createLocalUser({
    username: `${DAU}-${Date.now()}`,
    passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
    name: "Pha 9 A5 — tiêu mã dự phòng",
    role: "user",
  });
  uid = r.id;
});

afterAll(async () => {
  const d = await db.getDb();
  if (d && uid) await d.delete(backupCodes).where(eq(backupCodes.userId, uid));
  if (uid) await db.deleteUser(uid);
});

describe("★★★ Pha 9 A5 §1 — CẦU CHÌ: người CẤP thật sự cấp", () => {
  it("★★★ `quayVongMaDuPhong` đẻ đúng `SO_MA_DU_PHONG` mã dùng được", async () => {
    expect(uid, "không dựng được tài khoản ⇒ mọi ô dưới rỗng nghĩa").toBeGreaterThan(0);
    const ma = await db.quayVongMaDuPhong(uid);
    expect(ma.length).toBe(db.SO_MA_DU_PHONG);
    expect(new Set(ma).size, "có hai mã TRÙNG NHAU trong cùng một bộ").toBe(ma.length);
    expect(await conLai(), "số hàng chưa dùng phải khớp số mã vừa trả về").toBe(db.SO_MA_DU_PHONG);
  });
});

describe("★★★ Pha 9 A5 §2 — HÀNH VI: DÙNG-MỘT-LẦN", () => {
  let ma: string[] = [];

  beforeEach(async () => {
    ma = await db.quayVongMaDuPhong(uid); // bộ mới mỗi ca ⇒ các ca độc lập
  });

  it("★★★ mã ĐÚNG: lượt thứ nhất `true`, lượt thứ HAI của CÙNG mã `false`", async () => {
    const mot = ma[0]!;
    expect(await db.verifyBackupCode(uid, mot), "mã vừa cấp KHÔNG tiêu được ⇒ đường cấp/đối chiếu đã đứt").toBe(true);
    expect(
      await db.verifyBackupCode(uid, mot),
      "★ CÙNG một mã tiêu được LẦN THỨ HAI ⇒ mã dự phòng đã thành MẬT KHẨU VĨNH VIỄN",
    ).toBe(false);
  });

  it("★★★ lượt tiêu thành công làm GIẢM đúng MỘT mã trong sổ", async () => {
    expect(await conLai()).toBe(db.SO_MA_DU_PHONG);
    expect(await db.verifyBackupCode(uid, ma[1]!)).toBe(true);
    expect(
      await conLai(),
      "số mã chưa dùng KHÔNG giảm sau một lượt tiêu ⇒ lượt ĐÁNH DẤU ĐÃ DÙNG không có hiệu lực",
    ).toBe(db.SO_MA_DU_PHONG - 1);
  });

  it("★★ chuẩn hoá: gõ THƯỜNG / thừa khoảng trắng vẫn tiêu được (đúng MỘT lần)", async () => {
    const mot = ma[2]!;
    expect(await db.verifyBackupCode(uid, `  ${mot.toLowerCase()}  `)).toBe(true);
    expect(await db.verifyBackupCode(uid, mot), "vẫn tiêu lại được sau khi đã tiêu ở dạng thường").toBe(false);
  });
});

describe("★★★ Pha 9 A5 §3 — ĐỐI CHỨNG: từ chối đúng, và KHÔNG đốt nhầm mã", () => {
  /**
   * ⚠⚠ Không có §3, §2 xanh được bằng một bản vá *"trả `false` sau lượt đầu"* bất kể mã gì — kể cả
   *    một bản vá đốt sạch bộ mã ở mỗi lượt gọi. Đây là nửa còn lại của phép đo.
   */
  it("★★★ mã SAI ⇒ `false`, và KHÔNG hàng nào bị đánh dấu đã dùng", async () => {
    const ma = await db.quayVongMaDuPhong(uid);
    expect(await conLai()).toBe(db.SO_MA_DU_PHONG);

    expect(await db.verifyBackupCode(uid, "KHONGPHAI"), "một mã SAI vẫn tiêu được ⇒ phép đối chiếu đã chết").toBe(false);
    expect(
      await conLai(),
      "một lượt gõ SAI đã đốt mất mã ⇒ kẻ tấn công gõ bừa 10 lần là khoá được người dùng",
    ).toBe(db.SO_MA_DU_PHONG);
    expect(ma.length).toBe(db.SO_MA_DU_PHONG);
  });

  it("★★★ tiêu một mã KHÔNG làm hỏng các mã còn lại (đối chứng DƯƠNG)", async () => {
    const ma = await db.quayVongMaDuPhong(uid);
    expect(await db.verifyBackupCode(uid, ma[0]!)).toBe(true);
    expect(
      await db.verifyBackupCode(uid, ma[1]!),
      "mã thứ hai chết theo mã thứ nhất ⇒ lượt đánh dấu đang khoá quá rộng (thiếu `where` theo id)",
    ).toBe(true);
    expect(await conLai()).toBe(db.SO_MA_DU_PHONG - 2);
  });

  it("★★ mã của NGƯỜI KHÁC không tiêu được ở tài khoản này", async () => {
    const nguoiKhac = await db.createLocalUser({
      username: `${DAU}-khac-${Date.now()}`,
      passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
      name: "Pha 9 A5 — người khác",
      role: "user",
    });
    try {
      const maCuaHo = await db.quayVongMaDuPhong(nguoiKhac.id);
      await db.quayVongMaDuPhong(uid);
      expect(
        await db.verifyBackupCode(uid, maCuaHo[0]!),
        "mã của tài khoản KHÁC tiêu được ở đây ⇒ lượt tra thiếu điều kiện `userId`",
      ).toBe(false);
    } finally {
      const d = await db.getDb();
      if (d) await d.delete(backupCodes).where(eq(backupCodes.userId, nguoiKhac.id));
      await db.deleteUser(nguoiKhac.id);
    }
  });
});

describe("★★★ Pha 9 A5 §4 — quay vòng DỌN bộ cũ (một chủ, một luật)", () => {
  it("★★★ cấp bộ mới ⇒ bộ CŨ chết hẳn, và số hàng không cộng dồn", async () => {
    const cu = await db.quayVongMaDuPhong(uid);
    const moi = await db.quayVongMaDuPhong(uid);
    expect(
      await conLai(),
      "số mã chưa dùng CỘNG DỒN sau hai lượt quay vòng ⇒ lượt dọn bộ cũ không chạy",
    ).toBe(db.SO_MA_DU_PHONG);
    expect(await db.verifyBackupCode(uid, cu[0]!), "mã của bộ CŨ vẫn tiêu được sau khi cấp lại").toBe(false);
    expect(await db.verifyBackupCode(uid, moi[0]!), "mã của bộ MỚI phải tiêu được").toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ Pha 9 nhóm B · **B7c §5 — PHÉP ĐẾM TRẢ VỀ MỘT SỐ, KHÔNG PHẢI MỘT CHUỖI.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `getUnusedBackupCodesCount` khai `sql<number>\`COUNT(*)\`` nhưng `postgres` v3 trả `bigint` về
 * dạng **chuỗi**; tham số kiểu chỉ nói với trình biên dịch, không sinh phép chuyển đổi lúc chạy.
 * Đo được trước bản vá (probe trên DB test thật): `[{"count":"1"}]`, `typeof = "string"`.
 *
 * ⚠⚠ VÌ SAO CA NÀY PHẢI HỎI `typeof`, KHÔNG ĐƯỢC HỎI GIÁ TRỊ: `expect(await …).toBe(3)` **đỏ**
 *    với `"3"`, đúng — nhưng người đọc kế tiếp sẽ vá nó bằng `Number(await …)` (đúng cái đã xảy ra
 *    ở `tat2FaDoiMatKhau.test.ts:99,155`) và lỗi sản phẩm **sống tiếp dưới một lưới xanh**. Hỏi
 *    `typeof` thì lời vá duy nhất làm ô này xanh là **vá chính hàm ấy**.
 * ⚠ Ô `"0"` là ô nguy hiểm nhất và được canh riêng: `"0"` **truthy**, nên một phép kiểm
 *   *"đã dùng hết mã dự phòng"* viết bằng `if (!count)` sẽ không bao giờ bắn.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
describe("★★★ Pha 9 B7c §5 — `getUnusedBackupCodesCount` trả KIỂU SỐ", () => {
  it("★★★ còn mã: `typeof` phải là `number` (không phải chuỗi do `postgres` v3 trả `bigint`)", async () => {
    await db.quayVongMaDuPhong(uid);
    const n = await db.getUnusedBackupCodesCount(uid);
    expect(
      typeof n,
      "`sql<number>` chỉ là LỜI KHAI với trình biên dịch — nó không ép kiểu lúc chạy. Ép tại CHỦ\n" +
        "(`Number(...)` trong `server/db/auth.ts`), đừng bắt từng người gọi bọc `Number(...)`.",
    ).toBe("number");
    expect(n, "phép đếm phải bằng số mã vừa cấp").toBe(db.SO_MA_DU_PHONG);
  });

  it("★★★ HẾT mã: phải là số `0` — vì chuỗi `\"0\"` là TRUTHY nên `if (!count)` sẽ im lặng", async () => {
    const bo = await db.quayVongMaDuPhong(uid);
    for (const ma of bo) expect(await db.verifyBackupCode(uid, ma), "mỗi mã của bộ mới phải tiêu được").toBe(true);
    const n = await db.getUnusedBackupCodesCount(uid);
    expect(typeof n, "ô `0` là ô mà chuỗi và số KHÁC NHAU về tính chân trị").toBe("number");
    expect(n, "đã tiêu hết bộ mã ⇒ phép đếm phải là 0").toBe(0);
    expect(Boolean(n), "`\"0\"` truthy, `0` falsy — đây là ô mà cảnh báo 'hết mã dự phòng' sống hay chết").toBe(false);
  });
});
