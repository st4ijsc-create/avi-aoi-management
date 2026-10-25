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
import { eq, and, sql } from "drizzle-orm";
import * as db from "./index";
import { resolvePoolMax } from "./connection";
import { backupCodes } from "../../drizzle/schema";
import { __resetSoTotpChoTest } from "../_core/totpOnce";
import { docKhoa, MA_DU_PHONG_SO_LAN_TOI_DA } from "../_core/totpKhoaSai";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

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

/**
 * SCADA R1b-2a Task 10 (+ điều phối Q8, phán quyết K16) — LƯỢT THUA ĐUA ĐƯỢC HOÀN, NGƯỜI THẮNG KHÔNG BỊ KHOÁ, MÃ SAI VẪN ĐẾM.
 *
 * Trước T10 (đo: 10 lượt song song cùng mã đúng qua `verifyBackupCode` ⇒ true 0 / false 8 / ném 2): lượt thứ 10 tính lượt đặt khoá
 * (trần 10/giờ), các lượt thua đua bị tính như đoán sai, và người THẮNG — đã tiêu mã — gặp khoá do lượt khác đặt ⇒ NÉM: mã của người
 * dùng bị đốt mà họ không vào được.
 * ⚠ K16: 20 lượt phát lại là TUẦN TỰ (song song > 10 vượt trần trước khi kịp hoàn — đúng thiết kế tính-trước-kiểm-sau); "không ghi" =
 *   không có hàng khoá nào được tạo VÀ bộ đếm ròng không đổi — khẳng định CẢ HAI.
 * ⚠ Ca có đồng hồ thật (cửa sổ 10 s) dùng bộ 2 mã (ít bcrypt) và tự kiểm thời gian chạy < `CUA_SO_THUA_DUA_MS`; ca "sau 11 s" làm
 *   GIÀ `usedAt` trong DB (một đồng hồ: `now()` của Postgres), không chờ (K15).
 */
describe("R1b-2a T10 — lượt THUA ĐUA được hoàn, người thắng không bị khoá; mã sai vẫn đếm (Q8 + K16)", () => {
  const RUN = `t10${process.pid}${Date.now().toString(36)}`;
  const moi: number[] = [];
  const nguoi = async (tag: string): Promise<number> => {
    const u = await taoNguoiDungTest(tag, "operator", { tienTo: "t10dp", ts: RUN, ten: `R1b-2a T10 ${tag}` });
    moi.push(u.id);
    return u.id;
  };
  const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await (await db.getDb())!.execute(q)) as unknown as any[];
  const soMaDaTieu = async (u: number) =>
    Number((await dung(sql`SELECT count(*)::int AS n FROM backup_codes WHERE "userId" = ${u} AND "isUsed" = true`))[0].n);
  const hangDem = async (u: number) =>
    (await dung(sql`SELECT so_lan_sai AS n, (khoa_den IS NOT NULL) AS khoa, (khoa_den IS NOT NULL AND khoa_den > now()) AS dang_khoa
      FROM totp_khoa_sai WHERE user_id = ${u} AND loai = 'backup'`))[0] as { n: number; khoa: boolean; dang_khoa: boolean } | undefined;
  const soAudit = async (u: number, action: string) =>
    Number((await dung(sql`SELECT count(*)::int AS n FROM control_audit_log WHERE "entityType" = 'user' AND "entityId" = ${String(u)} AND action = ${action}`))[0].n);
  const appCode = (r: PromiseSettledResult<unknown>) =>
    r.status === "rejected" ? (r.reason as { cause?: { appCode?: string } })?.cause?.appCode ?? String((r.reason as Error)?.message) : undefined;
  const loiCua = async (p: Promise<unknown>) => {
    try {
      return { ok: await p, appCode: undefined as string | undefined };
    } catch (e) {
      return { ok: undefined, appCode: (e as { cause?: { appCode?: string } })?.cause?.appCode ?? String((e as Error)?.message) };
    }
  };
  const saiDp = (i: number) => `SAI${String(i).padStart(4, "0")}X`; // 8 ký tự, không phải 6 số, không khớp mã nào

  afterAll(async () => {
    if (!moi.length) return;
    // dọn TRƯỚC helper người dùng (FK backup_codes → users)
    await dung(sql`DELETE FROM backup_codes WHERE "userId" IN (${sql.join(moi.map((i) => sql`${i}`), sql`, `)})`);
    await __resetSoTotpChoTest(moi); // totp_consumed + totp_khoa_sai của người test
  });

  // fix round 1: 3 → 8 vòng — lượt chạy lưới đã bắt một khe đọc-hai-câu (1 vòng / ~3 lượt chạy); thêm vòng để khe kiểu ấy lộ ra.
  it("10 lượt SONG SONG verifyBackupCode ĐẦY ĐỦ cùng mã đúng ⇒ 1 true, 9 false, 0 ném, không khoá (×8 vòng, mã ở vị trí khác nhau)", async () => {
    expect(resolvePoolMax(), "pool > 1 — không thì song song là xếp hàng giả").toBeGreaterThanOrEqual(2);
    for (let vong = 1; vong <= 8; vong++) {
      const uid = await nguoi(`thang${vong}`);
      const bo = await db.quayVongMaDuPhong(uid);
      const MA = bo[(vong * 3) % bo.length]!;
      const kq = await Promise.allSettled(Array.from({ length: 10 }, () => db.verifyBackupCode(uid, MA)));
      const tomTat = `vòng ${vong}: ${JSON.stringify(kq.map((r) => (r.status === "fulfilled" ? r.value : appCode(r))))}`;
      expect(kq.filter((r) => r.status === "fulfilled" && r.value === true), tomTat).toHaveLength(1);
      expect(kq.filter((r) => r.status === "fulfilled" && r.value === false), tomTat).toHaveLength(9);
      expect(kq.filter((r) => r.status === "rejected"), tomTat).toHaveLength(0);
      expect((await docKhoa(uid, "backup")).conLaiMs, tomTat).toBe(0);
      expect(await soMaDaTieu(uid), "đúng một mã bị tiêu").toBe(1);
      expect((await hangDem(uid))?.n ?? 0, "chỉ lượt THẮNG còn có thể được tính; 9 lượt thua đã hoàn").toBeLessThanOrEqual(1);
      expect(await soAudit(uid, "ma_du_phong.tam_khoa"), "không có khoá nào để audit").toBe(0);
      expect(await db.verifyBackupCode(uid, bo[0]!), "mã khác của bộ dùng được ngay").toBe(true);
    }
  }, 120_000);

  it("10 lượt SONG SONG mã SAI ⇒ vẫn khoá (MA_DU_PHONG_TAM_KHOA), đúng 1 audit, mã đúng sau đó bị từ chối và không bị tiêu", async () => {
    const uid = await nguoi("saiSongSong");
    const bo = await db.quayVongMaDuPhong(uid);
    const kq = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => db.verifyBackupCode(uid, saiDp(i))));
    const tomTat = JSON.stringify(kq.map((r) => (r.status === "fulfilled" ? r.value : appCode(r))));
    expect(kq.filter((r) => appCode(r) === "MA_DU_PHONG_TAM_KHOA").length, tomTat).toBeGreaterThanOrEqual(1);
    expect(kq.filter((r) => r.status === "rejected" && appCode(r) !== "MA_DU_PHONG_TAM_KHOA"), tomTat).toHaveLength(0);
    expect(kq.filter((r) => r.status === "fulfilled" && r.value === true), tomTat).toHaveLength(0);
    expect((await docKhoa(uid, "backup")).conLaiMs).toBeGreaterThan(0);
    expect(await hangDem(uid)).toMatchObject({ n: MA_DU_PHONG_SO_LAN_TOI_DA, dang_khoa: true });
    expect(await soAudit(uid, "ma_du_phong.tam_khoa")).toBe(1);
    expect(await loiCua(db.verifyBackupCode(uid, bo[0]!))).toMatchObject({ appCode: "MA_DU_PHONG_TAM_KHOA" });
    expect(await soMaDaTieu(uid), "mã đúng lúc đang khoá KHÔNG bị tiêu").toBe(0);
  }, 120_000);

  it("10 lượt SONG SONG tieuMaDuPhongPhanLoai cùng mã ⇒ đúng 1 'tieu', 9 'thua_dua', 0 'khong_khop'", async () => {
    const uid = await nguoi("phanLoai");
    const bo = await db.quayVongMaDuPhong(uid);
    const kq = await Promise.all(Array.from({ length: 10 }, () => db.tieuMaDuPhongPhanLoai(uid, bo[5]!)));
    expect(kq.filter((x) => x === "tieu"), JSON.stringify(kq)).toHaveLength(1);
    expect(kq.filter((x) => x === "thua_dua"), JSON.stringify(kq)).toHaveLength(9);
    expect(await soMaDaTieu(uid)).toBe(1);
  }, 60_000);

  it("Q8 — phát lại mã đã tiêu 20 lần (TUẦN TỰ, K16) ⇒ không khoá, không ghi: không hàng khoá nào được tạo, bộ đếm ròng không đổi", async () => {
    const uid = await nguoi("phatLai20");
    const bo = await db.quayVongMaDuPhong(uid, 2);
    expect(await db.verifyBackupCode(uid, bo[0]!)).toBe(true);
    const t0 = Date.now();
    expect(await hangDem(uid), "trước: lượt đúng đã xoá hàng đếm").toBeUndefined();
    for (let i = 1; i <= 20; i++) expect(await db.verifyBackupCode(uid, bo[0]!), `phát lại ${i}`).toBe(false);
    expect(await hangDem(uid), "sau 20 lần phát lại: KHÔNG có hàng đếm/khoá nào (= trước)").toBeUndefined();
    expect((await docKhoa(uid, "backup")).conLaiMs).toBe(0);
    // nền KHÁC 0: 2 mã sai ⇒ đếm 2; thêm 20 lần phát lại ⇒ vẫn ĐÚNG 2, không khoá (hoàn đúng phần của mình, không ăn vào lượt sai)
    for (const i of [1, 2]) expect(await db.verifyBackupCode(uid, saiDp(i))).toBe(false);
    expect(await hangDem(uid)).toMatchObject({ n: 2, khoa: false });
    for (let i = 21; i <= 40; i++) expect(await db.verifyBackupCode(uid, bo[0]!), `phát lại ${i}`).toBe(false);
    expect(await hangDem(uid), "bộ đếm ròng không đổi qua 20 lần phát lại").toMatchObject({ n: 2, khoa: false });
    expect(Date.now() - t0, "ca phải chạy trong cửa sổ hoàn lượt, không thì nó không đo điều nó nói").toBeLessThan(db.CUA_SO_THUA_DUA_MS);
    expect(await soAudit(uid, "ma_du_phong.tam_khoa")).toBe(0);
    expect(await soAudit(uid, "ma_du_phong.tu_choi_dang_khoa")).toBe(0);
    expect(await soMaDaTieu(uid)).toBe(1);
    expect(await db.verifyBackupCode(uid, bo[1]!), "mã còn lại vẫn dùng được").toBe(true);
  }, 60_000);

  it("Q8 — mã sai XEN KẼ lượt phát lại vẫn khoá: khoá ĐÚNG ở mã sai thứ 10 (phát lại không đếm, mã sai đếm đủ)", async () => {
    const uid = await nguoi("xenKe");
    const bo = await db.quayVongMaDuPhong(uid, 2);
    expect(await db.verifyBackupCode(uid, bo[0]!)).toBe(true);
    const t0 = Date.now();
    for (let i = 1; i < MA_DU_PHONG_SO_LAN_TOI_DA; i++) {
      expect(await db.verifyBackupCode(uid, bo[0]!), `phát lại trước mã sai ${i}`).toBe(false);
      expect(await db.verifyBackupCode(uid, saiDp(i)), `mã sai ${i}`).toBe(false);
      expect(await db.verifyBackupCode(uid, bo[0]!), `phát lại sau mã sai ${i}`).toBe(false);
    }
    expect(await hangDem(uid), "9 mã sai = 9 lượt; 18 lần phát lại = 0").toMatchObject({ n: MA_DU_PHONG_SO_LAN_TOI_DA - 1, khoa: false });
    expect(await loiCua(db.verifyBackupCode(uid, saiDp(MA_DU_PHONG_SO_LAN_TOI_DA))), "mã sai thứ 10 ⇒ khoá").toMatchObject({ appCode: "MA_DU_PHONG_TAM_KHOA" });
    expect(Date.now() - t0, "ca phải chạy trong cửa sổ hoàn lượt").toBeLessThan(db.CUA_SO_THUA_DUA_MS);
    expect((await docKhoa(uid, "backup")).conLaiMs).toBeGreaterThan(0);
    expect(await soAudit(uid, "ma_du_phong.tam_khoa")).toBe(1);
    // đang khoá: phát lại cũng bị từ chối TRƯỚC đối chiếu (không có gì để hoàn), và mã đúng còn lại không bị tiêu
    expect(await loiCua(db.verifyBackupCode(uid, bo[0]!))).toMatchObject({ appCode: "MA_DU_PHONG_TAM_KHOA" });
    expect(await loiCua(db.verifyBackupCode(uid, bo[1]!))).toMatchObject({ appCode: "MA_DU_PHONG_TAM_KHOA" });
    expect((await hangDem(uid))?.dang_khoa).toBe(true);
    expect(await soMaDaTieu(uid)).toBe(1);
  }, 60_000);

  it("cửa sổ 10 s theo đồng hồ DB: 9 s ⇒ 'thua_dua'; 11 s ⇒ 'khong_khop' và BỊ ĐẾM", async () => {
    const uid = await nguoi("cuaSo10s");
    const bo = await db.quayVongMaDuPhong(uid, 2);
    expect(await db.tieuMaDuPhongPhanLoai(uid, bo[0]!)).toBe("tieu");
    expect(await db.tieuMaDuPhongPhanLoai(uid, bo[0]!)).toBe("thua_dua");
    // tuổi TUYỆT ĐỐI đặt ngay trước mỗi lượt kiểm (đồng hồ DB, cùng biểu thức với đường ghi) — không cộng dồn thời gian chạy của ca
    const datTuoi = (giay: number) =>
      dung(sql`UPDATE backup_codes SET "usedAt" = (now() AT TIME ZONE 'UTC') - make_interval(secs => ${giay}) WHERE "userId" = ${uid} AND "isUsed" = true`);
    await datTuoi(9);
    expect(await db.tieuMaDuPhongPhanLoai(uid, bo[0]!), "9 s: vẫn trong cửa sổ").toBe("thua_dua");
    await datTuoi(11);
    expect(await db.tieuMaDuPhongPhanLoai(uid, bo[0]!), "11 s: ngoài cửa sổ").toBe("khong_khop");
    expect(await db.tieuMaDuPhongNguyenTu(uid, bo[0]!)).toBe(false);
    expect(await db.verifyBackupCode(uid, bo[0]!)).toBe(false);
    expect(await hangDem(uid), "phát lại sau 11 s là một lượt thử bị đếm").toMatchObject({ n: 1, khoa: false });
    expect(await db.tieuMaDuPhongPhanLoai(uid, saiDp(1))).toBe("khong_khop");
  }, 60_000);

  it("Q8 — CÙNG mã nhưng KHÁC userId ⇒ 'khong_khop', bị đếm cho người gửi", async () => {
    const a = await nguoi("chuMa");
    const b = await nguoi("nguoiKhac");
    const maA = await db.quayVongMaDuPhong(a, 2);
    await db.quayVongMaDuPhong(b, 2);
    expect(await db.verifyBackupCode(a, maA[0]!)).toBe(true);
    expect(await db.tieuMaDuPhongPhanLoai(b, maA[0]!)).toBe("khong_khop");
    expect(await db.verifyBackupCode(b, maA[0]!)).toBe(false);
    expect(await hangDem(b)).toMatchObject({ n: 1, khoa: false });
  }, 60_000);
});
