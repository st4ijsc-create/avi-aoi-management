/**
 * SCADA R1b-1 Task 8 — MÃ DỰ PHÒNG KHÔNG TIÊU ĐƯỢC HAI LẦN BẰNG YÊU CẦU ĐỒNG THỜI (double-spend), trên DB `_test` THẬT.
 *
 *   ∀ mã dự phòng: 10 lượt tiêu SONG SONG cùng một mã ⇒ đúng 1 thắng, 9 thua; sau đó mã đã `is_used = true`.
 *
 * Lưu trữ thật: bảng `backup_codes` (băm bcrypt, `is_used`/`used_at`). Bản cũ: SELECT → bcrypt → `UPDATE … WHERE id` không kiểm `is_used`
 * ⇒ cả 10 lượt cùng đọc hàng còn chưa dùng, cùng khớp, cùng "thành công".
 *
 * ⚠ Song song THẬT: pool của client test phải > 1 (pool 1 xếp hàng các lượt ⇒ test xanh mà chẳng chứng minh gì). Ca đầu khẳng định pool
 *   (đo được 4 trong vitest). Đột biến (bỏ `is_used = false` khỏi UPDATE) làm ca 2 đỏ — xem báo cáo task-8.
 * ⚠ Hai ca: (1) hàm tiêu nguyên tử trần — 10 lượt (bộ đếm T16 chỉ cho 10 lượt/giờ nên đưa 10 lượt qua nó sẽ lẫn việc "khoá" vào phép
 *   đo tiêu mã); (2) qua `verifyBackupCode` đầy đủ (có bộ đếm) — 5 lượt, dưới trần.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import * as db from "./index";
import { resolvePoolMax } from "./connection";
import { backupCodes } from "../../drizzle/schema";
import { __resetSoTotpChoTest } from "../_core/totpOnce";

const DAU = "r1b-t8-song-song";
let uid = 0;

async function conLai(): Promise<number> {
  const d = await db.getDb();
  const hang = await d!.select().from(backupCodes).where(and(eq(backupCodes.userId, uid), eq(backupCodes.isUsed, false)));
  return hang.length;
}

beforeAll(async () => {
  const r = await db.createLocalUser({
    username: `${DAU}-${Date.now()}`,
    passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
    name: "R1b T8 — mã dự phòng song song",
    role: "user",
  });
  uid = r.id;
});

afterAll(async () => {
  const d = await db.getDb();
  if (d && uid) {
    await d.delete(backupCodes).where(eq(backupCodes.userId, uid));
    await __resetSoTotpChoTest([uid]);
  }
  if (uid) await db.deleteUser(uid);
});

describe("R1b-1 T8 — mã dự phòng dùng-một-lần dưới yêu cầu ĐỒNG THỜI", () => {
  it("pool của client test > 1 (không thì mọi phép đo song song dưới đây là xếp hàng giả)", () => {
    // vitest.setup đặt DB_POOL_MAX nhỏ (đo được: 4) — đủ > 1 để các UPDATE chạy trên các kết nối riêng
    expect(resolvePoolMax()).toBeGreaterThanOrEqual(2);
  });

  it("10 lượt SONG SONG cùng một mã (hàm tiêu nguyên tử) ⇒ đúng 1 thành công, 9 thất bại, mã hết", async () => {
    const ma = await db.quayVongMaDuPhong(uid);
    const mot = ma[0]!;
    expect(await conLai()).toBe(db.SO_MA_DU_PHONG);

    const kq = await Promise.all(Array.from({ length: 10 }, () => db.tieuMaDuPhongNguyenTu(uid, mot)));

    const thanhCong = kq.filter((x) => x === true).length;
    expect(thanhCong, `kết quả: ${JSON.stringify(kq)}`).toBe(1);
    expect(kq.filter((x) => x === false).length).toBe(9);
    expect(await conLai(), "đúng một mã bị tiêu").toBe(db.SO_MA_DU_PHONG - 1);

    const d2 = (await db.getDb())!;
    const hangDaTieu = await d2.select().from(backupCodes).where(and(eq(backupCodes.userId, uid), eq(backupCodes.isUsed, true)));
    expect(hangDaTieu.length).toBe(1);
    expect(hangDaTieu[0]!.usedAt, "used_at phải được ghi").toBeTruthy();
    expect(await db.tieuMaDuPhongNguyenTu(uid, mot), "dùng lại SAU đó vẫn thất bại").toBe(false);
  }, 60_000);

  it("5 lượt SONG SONG qua verifyBackupCode đầy đủ (có bộ đếm T16) ⇒ đúng 1 true, còn lại false; mã khác vẫn dùng được", async () => {
    await __resetSoTotpChoTest([uid]);
    const ma = await db.quayVongMaDuPhong(uid);
    const kq = await Promise.allSettled(Array.from({ length: 5 }, () => db.verifyBackupCode(uid, ma[0]!)));
    const duoc = kq.filter((x) => x.status === "fulfilled" && x.value === true).length;
    expect(duoc, JSON.stringify(kq)).toBe(1);
    expect(kq.filter((x) => x.status === "fulfilled" && x.value === false).length).toBe(4);
    expect(await conLai()).toBe(db.SO_MA_DU_PHONG - 1);
    // chuỗi (mã sai không được tính là tiêu): mã thứ hai còn nguyên
    expect(await db.verifyBackupCode(uid, ma[1]!), "mã khác của bộ vẫn tiêu được").toBe(true);
    expect(await conLai()).toBe(db.SO_MA_DU_PHONG - 2);
  }, 60_000);
});
