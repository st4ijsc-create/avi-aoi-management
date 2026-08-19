/**
 * ★★★ doc 79 · DANH SÁCH PHIÊN — LƯỚI CHO **HAI LỜI KHAI CỦA TẦNG DỮ LIỆU**.
 *
 * `aiCodingSessionScope.test.ts` đo hàng rào chủ-sở-hữu trên CSDL THẬT. File này đo hai thứ mà
 * lưới ấy **không thể** đo, vì cả hai đều là "khi CSDL KHÔNG ở trạng thái bình thường":
 *
 *   §1 **CHẶN TRƯỚC KHI CHẠM CSDL.** Danh tính méo / id dự án là đường dẫn / id phiên không phải
 *      UUID ⇒ trả về ngay, `getDb` **không được gọi một lần nào**. Đây không phải tối ưu: một
 *      lượt gọi lọt xuống tầng dữ liệu với `userId = NaN` là một câu SQL không ai đọc trước.
 *   §2 **FAIL-SAFE.** DB vắng, hoặc migration 0333 chưa chạy (`42P01` bọc trong `cause` của
 *      `DrizzleQueryError`) ⇒ degrade về rỗng/`ok:false`, **KHÔNG ném**. Trang không gian làm
 *      việc phải mở được trên một máy chưa áp migration; một danh sách phiên vắng là suy giảm
 *      nhìn thấy được, một trang trắng thì không.
 *
 * ⚠ Hình dạng lỗi ở §2 sao chép từ `aiSpecialistFeedback.test.ts`: `code` ở **tầng ngoài là
 *   undefined**, mã thật `42P01` nằm trên `.cause`. Một phép kiểm ngây thơ `(err as any).code`
 *   sẽ mù với đúng hình dạng này — đó là lý do `isMissingTable` phải đi xuống chuỗi `cause`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getDb = vi.fn();
vi.mock("./connection", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));

import {
  danhSachPhien,
  moPhien,
  luuPhien,
  xoaPhien,
} from "./aiCodingSessions";

const UUID = "11111111-1111-4111-8111-111111111111";
const LUOT = [{ role: "user", content: "xin chào" }];

/**
 * Chuỗi gọi drizzle giả — mọi mắt xích trả chính nó, lượt `await` cuối cùng thì NÉM.
 *
 * ⚠ GỐC (`db`) **KHÔNG được là thenable**, chỉ chuỗi con mới. Bản nháp đầu trả thẳng proxy làm
 *   `db` ⇒ `await getDb()` tự cố resolve nó và NÉM **ngoài** khối `try` của hàm đang đo — lưới đỏ
 *   trong khi mã hoàn toàn đúng. Đúng lớp "thiết bị đo hỏng, không phải vật được đo".
 */
function dbNem(loi: unknown) {
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (res: unknown, rej: (e: unknown) => unknown) => Promise.reject(loi).then(res as never, rej);
        }
        return () => chain;
      },
    },
  );
  return { select: () => chain, insert: () => chain, update: () => chain, delete: () => chain };
}

/** Hình dạng THẬT của một truy vấn drizzle vào bảng chưa migrate (xem khối ⚠ đầu file). */
function loi42P01(): Error {
  const driver = Object.assign(new Error('relation "ai_coding_sessions" does not exist'), { code: "42P01" });
  const boc = new Error("Failed query: select ... from ai_coding_sessions");
  (boc as Error & { cause: unknown }).cause = driver;
  return boc;
}

beforeEach(() => {
  getDb.mockReset();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — ĐẦU VÀO XẤU BỊ CHẶN **TRƯỚC** KHI CHẠM CSDL", () => {
  it("★★ danh tính méo ⇒ rỗng, `getDb` KHÔNG được gọi", async () => {
    for (const uid of [0, -1, Number.NaN, 1.5]) {
      expect(await danhSachPhien(uid, "repo")).toEqual([]);
      expect(await moPhien(uid, UUID)).toBeNull();
      expect(await xoaPhien(uid, UUID)).toEqual({ ok: false });
      expect((await luuPhien(uid, { projectId: "repo", turns: LUOT })).ok).toBe(false);
    }
    expect(getDb).not.toHaveBeenCalled();
  });

  it("★★★ `projectId` là ĐƯỜNG DẪN ⇒ rỗng, `getDb` KHÔNG được gọi", async () => {
    for (const d of ["D:\\SOURCES\\avi-aoi-management", "/etc/passwd", "../..", "a/b"]) {
      expect(await danhSachPhien(7, d)).toEqual([]);
      expect((await luuPhien(7, { projectId: d, turns: LUOT })).ok).toBe(false);
    }
    expect(getDb).not.toHaveBeenCalled();
  });

  it("★★ `sessionId` không phải UUID ⇒ rỗng, `getDb` KHÔNG được gọi", async () => {
    for (const s of ["phien-cua-toi", "1", "' OR 1=1 --", ""]) {
      expect(await moPhien(7, s)).toBeNull();
      expect(await xoaPhien(7, s)).toEqual({ ok: false });
    }
    expect(getDb).not.toHaveBeenCalled();
  });

  it("★★ mạch RỖNG (sau khi chiếu) ⇒ KHÔNG đẻ hàng, `getDb` KHÔNG được gọi", async () => {
    // Nút "Phiên mới" không được tạo một hàng; và một mạch toàn lượt méo cũng vậy.
    expect((await luuPhien(7, { projectId: "repo", turns: [] })).ok).toBe(false);
    expect((await luuPhien(7, { projectId: "repo", turns: [{ role: "system", content: "x" }] })).ok).toBe(false);
    expect(getDb).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — FAIL-SAFE: DB VẮNG / MIGRATION CHƯA CHẠY ⇒ SUY GIẢM, KHÔNG NÉM", () => {
  it("DB vắng (`getDb` → null) ⇒ rỗng/ok:false", async () => {
    getDb.mockResolvedValue(null);
    expect(await danhSachPhien(7, "repo")).toEqual([]);
    expect(await moPhien(7, UUID)).toBeNull();
    expect(await xoaPhien(7, UUID)).toEqual({ ok: false });
    expect((await luuPhien(7, { projectId: "repo", turns: LUOT })).ok).toBe(false);
  });

  it("★★★ bảng chưa tồn tại (42P01 trên `.cause`) ⇒ KHÔNG ném ở cả bốn cửa", async () => {
    getDb.mockResolvedValue(dbNem(loi42P01()));
    await expect(danhSachPhien(7, "repo")).resolves.toEqual([]);
    await expect(moPhien(7, UUID)).resolves.toBeNull();
    await expect(xoaPhien(7, UUID)).resolves.toEqual({ ok: false });
    await expect(luuPhien(7, { projectId: "repo", turns: LUOT })).resolves.toEqual({
      ok: false, id: null, title: "", turnCount: 0,
    });
  });

  it("★★ một hỏng KHÁC (không phải 42P01) cũng không ném ra UI — nhưng CÓ ghi cảnh báo", async () => {
    const canhBao = vi.spyOn(console, "warn").mockImplementation(() => {});
    getDb.mockResolvedValue(dbNem(new Error("connection terminated unexpectedly")));
    await expect(danhSachPhien(7, "repo")).resolves.toEqual([]);
    // Im lặng nuốt một hỏng THẬT là cách nó sống mãi — 42P01 thì im (đã biết), cái khác thì nói.
    expect(canhBao).toHaveBeenCalled();
    canhBao.mockRestore();
  });
});
