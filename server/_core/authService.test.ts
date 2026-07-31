/**
 * F9 (Sprint 5, doc71 task 11) — chốt side-channel đăng nhập ở
 * server/_core/authService.ts::verifyCredentials.
 *
 * Lỗi tiền tồn tại: kiểm isActive/lockedUntil chạy TRƯỚC bcrypt.compare, và
 * nhánh "user không tồn tại" bỏ qua bcrypt.compare HOÀN TOÀN. Hệ quả: (1)
 * nhánh không-tồn-tại trả lời nhanh hơn hẳn ⇒ side-channel thời gian dò được
 * username có thật; (2) chỉ cần bcrypt không chạy là mất phần "tốn thời
 * gian tương đương" cho MỌI nhánh sớm khác (không active / không có
 * passwordHash).
 *
 * Test dưới đây phủ 4 việc, đúng thứ tự nêu trong task-11-brief.md:
 *  A. CẤU TRÚC — bcrypt.compare() phải được GỌI ở cả hai nhánh (user tồn
 *     tại và không tồn tại), với hash giả CÙNG cost factor (10) như hash
 *     thật. Đây là bằng chứng chính — không phụ thuộc đồng hồ máy.
 *  B. HÀNH VI — mật khẩu ĐÚNG nhưng tài khoản bị khoá/vô hiệu vẫn bị từ
 *     chối (không được để việc đổi thứ tự làm mất tác dụng chặn).
 *  C. HÀNH VI — bộ đếm loginAttempts / lockedUntil vẫn tăng & khoá đúng
 *     sau khi đổi thứ tự.
 *  D. THỜI GIAN (bổ sung, không phải nguồn sự thật duy nhất — xem ghi chú
 *     bập bênh ngay tại test) — median qua nhiều lần lặp, ngưỡng rộng.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { Request } from "express";

const dbm = vi.hoisted(() => ({
  getUserByUsername: vi.fn(async (): Promise<any> => undefined),
  updateUserLoginAttempts: vi.fn(async (): Promise<void> => {}),
  createAuditLog: vi.fn(async (): Promise<any> => ({})),
}));
vi.mock("../db", () => dbm);

// `vi.spyOn(bcryptModule, "compare")` không dùng được ở đây: vitest trả về
// một namespace object cho `await import("bcryptjs")` với property descriptor
// non-configurable ("Cannot redefine property: compare"), khác hành vi Node
// thuần. Thay vào đó mock hẳn module "bcryptjs", giữ NGUYÊN hành vi thật
// (bọc actual.compare qua một vi.fn) — vừa quan sát được lời gọi, vừa không
// đổi kết quả so-khớp mật khẩu thật.
const bcryptCompareSpy = vi.hoisted(() => vi.fn());
vi.mock("bcryptjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bcryptjs")>();
  bcryptCompareSpy.mockImplementation(actual.compare);
  return { ...actual, compare: bcryptCompareSpy };
});

import { verifyCredentials, MAX_LOGIN_ATTEMPTS } from "./authService";

const REAL_PASSWORD = "Correct-Horse-Battery-Staple-9";
let REAL_HASH: string;

beforeAll(async () => {
  const bcrypt = await import("bcryptjs");
  // Cost factor 10 — khớp MỌI bcrypt.hash(..., 10) thật trong repo (đo bằng
  // grep, xem task-11-report.md): server/db/auth.ts:228,
  // server/routers/userRouters.ts:59/128/206,
  // server/routers/twoFactorRouter.ts:20, server/services/mqttService.ts:337.
  REAL_HASH = await bcrypt.hash(REAL_PASSWORD, 10);
});

function fakeReq(): Request {
  return {
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    headers: {},
  } as unknown as Request;
}

function makeUser(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    name: "Nguyen Van A",
    username: "user1",
    openId: "user1",
    isActive: true,
    lockedUntil: null,
    passwordHash: REAL_HASH,
    loginAttempts: 0,
    ...overrides,
  };
}

beforeEach(() => {
  dbm.getUserByUsername.mockReset();
  dbm.updateUserLoginAttempts.mockReset().mockResolvedValue(undefined);
  dbm.createAuditLog.mockReset().mockResolvedValue({});
  bcryptCompareSpy.mockClear();
});

describe("F9 — verifyCredentials: bcrypt.compare luôn chạy trước khi kiểm isActive/lockedUntil", () => {
  it("A1. nhánh user KHÔNG tồn tại vẫn gọi bcrypt.compare (với hash giả cost factor 10)", async () => {
    dbm.getUserByUsername.mockResolvedValueOnce(undefined);
    await expect(
      verifyCredentials("khong-ton-tai", "bat-ky-mat-khau", fakeReq()),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    expect(bcryptCompareSpy).toHaveBeenCalledTimes(1);
    const [suppliedPassword, hashArg] = bcryptCompareSpy.mock.calls[0];
    expect(suppliedPassword).toBe("bat-ky-mat-khau");
    // Hash giả PHẢI đúng định dạng bcrypt cost=10 ($2a$/$2b$ + "10$") — nếu
    // cost thấp hơn hash thật thì side-channel chỉ nhỏ đi, không đóng hẳn.
    expect(hashArg).toMatch(/^\$2[aby]\$10\$/);
  });

  it("A2. nhánh user tồn tại + sai mật khẩu gọi bcrypt.compare với hash THẬT của user đó", async () => {
    dbm.getUserByUsername.mockResolvedValueOnce(makeUser());
    await expect(
      verifyCredentials("user1", "sai-mat-khau", fakeReq()),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    expect(bcryptCompareSpy).toHaveBeenCalledTimes(1);
    expect(bcryptCompareSpy).toHaveBeenCalledWith("sai-mat-khau", REAL_HASH);
  });

  it("A3. nhánh user tồn tại nhưng KHÔNG có passwordHash (SSO-only) vẫn gọi bcrypt.compare với hash giả", async () => {
    dbm.getUserByUsername.mockResolvedValueOnce(makeUser({ passwordHash: null }));
    await expect(
      verifyCredentials("sso-user", "bat-ky-mat-khau", fakeReq()),
    ).rejects.toMatchObject({ code: "PASSWORD_UNSUPPORTED" });

    expect(bcryptCompareSpy).toHaveBeenCalledTimes(1);
    const [, hashArg] = bcryptCompareSpy.mock.calls[0];
    expect(hashArg).toMatch(/^\$2[aby]\$10\$/);
  });

  it("A4. hash giả được nhớ lại (memo hoá) — không tính lại bcrypt.hash mỗi lần user không tồn tại", async () => {
    dbm.getUserByUsername.mockResolvedValue(undefined);
    await verifyCredentials("khong-ton-tai-1", "x", fakeReq()).catch(() => {});
    await verifyCredentials("khong-ton-tai-2", "x", fakeReq()).catch(() => {});

    const hash1 = bcryptCompareSpy.mock.calls[0][1];
    const hash2 = bcryptCompareSpy.mock.calls[1][1];
    expect(hash1).toBe(hash2);
  });
});

describe("F9-B — mật khẩu ĐÚNG nhưng tài khoản bị khoá/vô hiệu vẫn phải bị từ chối", () => {
  it("B1. isActive=false + mật khẩu ĐÚNG ⇒ vẫn ACCOUNT_DISABLED (không đăng nhập được)", async () => {
    dbm.getUserByUsername.mockResolvedValueOnce(makeUser({ isActive: false }));
    await expect(
      verifyCredentials("disabled-user", REAL_PASSWORD, fakeReq()),
    ).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
  });

  it("B2. lockedUntil ở tương lai + mật khẩu ĐÚNG ⇒ vẫn ACCOUNT_LOCKED (không đăng nhập được)", async () => {
    const future = new Date(Date.now() + 5 * 60_000);
    dbm.getUserByUsername.mockResolvedValueOnce(makeUser({ lockedUntil: future }));
    await expect(
      verifyCredentials("locked-user", REAL_PASSWORD, fakeReq()),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });

  it("B3. lockedUntil ở QUÁ KHỨ (đã hết hạn khoá) + mật khẩu ĐÚNG ⇒ đăng nhập được bình thường", async () => {
    const past = new Date(Date.now() - 60_000);
    dbm.getUserByUsername.mockResolvedValueOnce(makeUser({ lockedUntil: past, loginAttempts: 5 }));
    const user = await verifyCredentials("expired-lock-user", REAL_PASSWORD, fakeReq());
    expect(user.id).toBe(1);
  });
});

describe("F9-C — bộ đếm loginAttempts / khoá tài khoản vẫn chạy đúng sau khi đổi thứ tự", () => {
  it("C1. sai mật khẩu dưới ngưỡng ⇒ chỉ tăng loginAttempts, KHÔNG khoá", async () => {
    dbm.getUserByUsername.mockResolvedValueOnce(makeUser({ loginAttempts: 1 }));
    await expect(
      verifyCredentials("user1", "sai-mat-khau", fakeReq()),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    expect(dbm.updateUserLoginAttempts).toHaveBeenCalledTimes(1);
    const [userId, attempts, lockedUntil] = dbm.updateUserLoginAttempts.mock.calls[0];
    expect(userId).toBe(1);
    expect(attempts).toBe(2);
    expect(lockedUntil).toBeNull();
  });

  it(`C2. sai mật khẩu chạm MAX_LOGIN_ATTEMPTS (${MAX_LOGIN_ATTEMPTS}) ⇒ khoá tài khoản (lockedUntil trong tương lai)`, async () => {
    dbm.getUserByUsername.mockResolvedValueOnce(
      makeUser({ loginAttempts: MAX_LOGIN_ATTEMPTS - 1 }),
    );
    await expect(
      verifyCredentials("user1", "sai-mat-khau", fakeReq()),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });

    expect(dbm.updateUserLoginAttempts).toHaveBeenCalledTimes(1);
    const [, attempts, lockedUntil] = dbm.updateUserLoginAttempts.mock.calls[0];
    expect(attempts).toBe(MAX_LOGIN_ATTEMPTS);
    expect(lockedUntil).toBeInstanceOf(Date);
    expect((lockedUntil as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("C3. tài khoản ĐANG bị khoá ⇒ sai mật khẩu KHÔNG được tăng thêm loginAttempts (đã bị chặn ở bước isActive/lockedUntil, trước khi tới nhánh !passwordMatches)", async () => {
    const future = new Date(Date.now() + 5 * 60_000);
    dbm.getUserByUsername.mockResolvedValueOnce(
      makeUser({ lockedUntil: future, loginAttempts: MAX_LOGIN_ATTEMPTS }),
    );
    await expect(
      verifyCredentials("locked-user", "sai-mat-khau", fakeReq()),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });

    // Không có lần tăng bộ đếm nào thêm — hành vi giống hệt trước khi sửa.
    expect(dbm.updateUserLoginAttempts).not.toHaveBeenCalled();
  });

  it("C4. đăng nhập ĐÚNG mật khẩu reset bộ đếm về 0 khi trước đó có sai lần nào", async () => {
    dbm.getUserByUsername.mockResolvedValueOnce(makeUser({ loginAttempts: 3 }));
    const user = await verifyCredentials("user1", REAL_PASSWORD, fakeReq());
    expect(user.id).toBe(1);
    expect(dbm.updateUserLoginAttempts).toHaveBeenCalledWith(1, 0, null);
  });

  it("C5. đăng nhập ĐÚNG mật khẩu khi bộ đếm đã ở 0 ⇒ không gọi updateUserLoginAttempts thừa", async () => {
    dbm.getUserByUsername.mockResolvedValueOnce(makeUser({ loginAttempts: 0, lockedUntil: null }));
    await verifyCredentials("user1", REAL_PASSWORD, fakeReq());
    expect(dbm.updateUserLoginAttempts).not.toHaveBeenCalled();
  });
});

describe("F9-D — thời gian phản hồi (bổ sung, không phải bằng chứng chính)", () => {
  // GHI CHÚ QUAN TRỌNG (task-11-brief §5): đo thời gian rất dễ bập bênh (máy
  // CI chậm/GC/máy đang bận). Test này lặp N=21 lần và lấy TRUNG VỊ (median),
  // KHÔNG dùng một mẫu đơn lẻ, và đặt ngưỡng RỘNG (xem lời giải trong
  // task-11-report.md). Bằng chứng chính là nhóm test "A" ở trên (bcrypt.compare
  // được GỌI ở cả hai nhánh) — nhóm test cấu trúc không phụ thuộc đồng hồ máy.
  // DB đã được mock (không có I/O mạng thật) nên phần thời gian đo được ở đây
  // chủ yếu phản ánh đúng chi phí CPU của bcrypt — đúng thứ side-channel này
  // muốn đo.
  it("median độ trễ nhánh 'không tồn tại' và nhánh 'tồn tại + sai mật khẩu' lệch trong ngưỡng rộng", async () => {
    const N = 21;
    const notFoundTimes: number[] = [];
    const foundTimes: number[] = [];

    for (let i = 0; i < N; i++) {
      dbm.getUserByUsername.mockResolvedValueOnce(undefined);
      const t0 = performance.now();
      await verifyCredentials(`khong-ton-tai-${i}`, "mat-khau-bat-ky", fakeReq()).catch(() => {});
      notFoundTimes.push(performance.now() - t0);

      dbm.getUserByUsername.mockResolvedValueOnce(makeUser());
      const t1 = performance.now();
      await verifyCredentials(`ton-tai-${i}`, "mat-khau-sai", fakeReq()).catch(() => {});
      foundTimes.push(performance.now() - t1);
    }

    const median = (arr: number[]): number => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    const medNotFound = median(notFoundTimes);
    const medFound = median(foundTimes);
    const diffMs = Math.abs(medNotFound - medFound);
    const slower = Math.max(medNotFound, medFound);

    // eslint-disable-next-line no-console
    console.log(
      `[F9 timing] median not-found=${medNotFound.toFixed(2)}ms found=${medFound.toFixed(2)}ms diff=${diffMs.toFixed(2)}ms`,
    );

    // Ngưỡng CÓ CHỦ Ý rộng nhưng vẫn phân biệt được lỗi cũ: đo thật trên máy
    // dev (task-11-report.md mục D) cho thấy TRƯỚC khi sửa nhánh not-found
    // gần như 0ms (bỏ qua bcrypt hoàn toàn) trong khi nhánh found ~51ms
    // (chạy 1 lượt bcrypt cost=10) ⇒ diff/slower ≈ 98%. SAU khi sửa cả hai
    // nhánh đều chạy đúng 1 lượt bcrypt cost=10 nên diff chỉ còn phần
    // overhead nhỏ (tra DB mock + ghi audit mock). Ngưỡng 35% giá trị chậm
    // hơn (sàn 15ms) đủ RỘNG để không đỏ ngẫu nhiên vì GC/máy bận, nhưng vẫn
    // đủ CHẶT để bắt lại khoảng lệch ~98% của lỗi cũ.
    expect(diffMs).toBeLessThan(Math.max(15, slower * 0.35));
  }, 30_000);
});
