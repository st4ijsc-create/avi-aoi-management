import { describe, it, expect } from "vitest";
/**
 * ★★★ ĐỢT 6 VÁ CHẶN-2 — TEST IMPORT MÃ SẢN PHẨM, KHÔNG CHÉP LẠI NÓ.
 *
 * ⚠ VÙNG MÙ ĐÃ CÓ Ở ĐÂY (QA đo 2026-09-07): bản trước của chính tệp này
 * `import { describe, it, expect }` từ vitest và KHÔNG import gì từ `socket.ts`,
 * rồi **tự khai lại** hàm quyết định `duocNhan` ở dòng 31. QA tiêm đột biến —
 * xoá SẠCH `resolveTenantFactoryScope` khỏi broadcaster thật — và **5/5 test
 * VẪN XANH**. Nó ghim bản sao chép tay; mã sản phẩm muốn trôi đi đâu cũng được.
 *
 * ⇒ Câu hỏi kiểm cho MỌI test: *"nếu xoá sạch mã sản phẩm, test này có đỏ
 *   không?"* Nếu không, nó không đo cái nó khai là đang đo.
 *
 * ⇒ Nay import ĐÚNG `duocNhanNhaMay` / `coDanhTinhNguoiDung` / `nguoiXemDuocNhan`
 *   từ `twinPhamViQuyen.ts`, là ĐÚNG các hàm mà cả BA kênh (`twin:trangThai`,
 *   `twin:update`, `twin:device`) và handler `subscribe` đều gọi.
 */
import {
  duocNhanNhaMay,
  coDanhTinhNguoiDung,
  nguoiXemDuocNhan,
} from "./twinPhamViQuyen";

/**
 * Ảnh chụp phạm vi THẬT (đo bằng `resolveTenantFactoryScope`, DB dev 2026-09-07):
 *
 *   engineer1  (51, engineer)     factoryIds=[1]    -> NHẬN factory 1
 *   operator1  (48, operator)     factoryIds=[]     -> BỊ CHẶN
 *   supervisor1(49, supervisor)   factoryIds=[]     -> BỊ CHẶN
 *   maint1     (50, maintenance)  factoryIds=[]     -> BỊ CHẶN
 *   admin      (1,  admin)        factoryIds=null   -> NHẬN (bypass)
 *
 * ★ Đo bằng vai NON-ADMIN: admin bypass mọi cổng, nên một suite chỉ chạy admin
 *   chứng minh SỐ 0 về phân quyền.
 */
const PHAM_VI_DO_DUOC: Record<string, number[] | null> = {
  engineer1: [1],
  operator1: [],
  supervisor1: [],
  maint1: [],
  admin: null,
};

/** Danh tính người dùng như `socket.data.user` mang. */
const NGUOI = {
  engineer1: { id: 51, role: "engineer" },
  operator1: { id: 48, role: "operator" },
  supervisor1: { id: 49, role: "supervisor" },
  maint1: { id: 50, role: "maintenance" },
  admin: { id: 1, role: "admin" },
};

describe("duocNhanNhaMay — phép quyết định phân quyền twin (HÀM THẬT)", () => {
  it("★★★ engineer1 (ĐƯỢC gán SIM-FAC) NHẬN factory 1 — chiều DƯƠNG", () => {
    // Thiếu ô này thì một bản vá "chặn tất" cũng xanh mọi test chặn bên dưới.
    expect(duocNhanNhaMay(PHAM_VI_DO_DUOC.engineer1, 1)).toBe(true);
  });

  it("★★★ ba vai KHÔNG được gán nhà máy đều BỊ CHẶN khỏi factory 1", () => {
    // Đây chính là rò rỉ xuyên tenant đã đo được ở CẢ BA kênh.
    expect(duocNhanNhaMay(PHAM_VI_DO_DUOC.operator1, 1)).toBe(false);
    expect(duocNhanNhaMay(PHAM_VI_DO_DUOC.supervisor1, 1)).toBe(false);
    expect(duocNhanNhaMay(PHAM_VI_DO_DUOC.maint1, 1)).toBe(false);
  });

  it("★★★ ĐỐI CHỨNG — engineer1 BỊ CHẶN khỏi nhà máy KHÁC (18)", () => {
    // Chứng minh bộ lọc lọc theo NHÀ MÁY, không phải theo vai. Nếu nó chỉ hỏi
    // "có phải engineer không" thì ô này đỏ.
    expect(duocNhanNhaMay(PHAM_VI_DO_DUOC.engineer1, 18)).toBe(false);
  });

  it("admin (`factoryIds === null`) không bị lọc — hành vi ĐÃ BIẾT, ghim để khỏi trôi", () => {
    expect(duocNhanNhaMay(PHAM_VI_DO_DUOC.admin, 1)).toBe(true);
    expect(duocNhanNhaMay(PHAM_VI_DO_DUOC.admin, 18)).toBe(true);
  });

  it("phạm vi RỖNG `[]` khác phạm vi `null` — hai câu khác hẳn nhau", () => {
    // `[]` = "đã phân giải, và người này không được gán nhà máy nào"
    // `null` = "không áp phạm vi" (vai toàn quyền).
    // Gộp hai cái làm một là biến người chưa được gán thành admin.
    expect(duocNhanNhaMay([], 1)).toBe(false);
    expect(duocNhanNhaMay(null, 1)).toBe(true);
  });
});

describe("coDanhTinhNguoiDung — không danh tính ⇒ KHÔNG nhận", () => {
  it("★★★ client `machine`/vô danh (không có `socket.data.user`) BỊ CHẶN", () => {
    // "Không phân giải được phạm vi" phải rơi về phía CHẶN, không phải cho qua.
    expect(coDanhTinhNguoiDung(undefined)).toBe(false);
    expect(coDanhTinhNguoiDung(null)).toBe(false);
    expect(coDanhTinhNguoiDung({})).toBe(false);
    expect(coDanhTinhNguoiDung({ id: null })).toBe(false);
  });

  it("người dùng thật CÓ danh tính — chiều DƯƠNG", () => {
    expect(coDanhTinhNguoiDung(NGUOI.operator1)).toBe(true);
    expect(coDanhTinhNguoiDung(NGUOI.engineer1)).toBe(true);
  });
});

describe("nguoiXemDuocNhan — CỔNG ĐẦY ĐỦ dùng ở CẢ BA kênh + handler `subscribe`", () => {
  it("★★★ operator1 gửi `{twinFactoryId:1}` (TỰ KHAI) vẫn BỊ CHẶN", () => {
    // Đúng phép đo của QA: operator1 KHÔNG được gán nhà máy nào mà nhận 11 gói
    // `twin:update` mang `stationId:29 wipCount:86`. Ô này ghim nó về 0.
    expect(nguoiXemDuocNhan(NGUOI.operator1, PHAM_VI_DO_DUOC.operator1, 1)).toBe(false);
  });

  it("★★★ engineer1 vẫn NHẬN factory 1 — vá KHÔNG được làm chết tính năng", () => {
    expect(nguoiXemDuocNhan(NGUOI.engineer1, PHAM_VI_DO_DUOC.engineer1, 1)).toBe(true);
  });

  it("★★★ engineer1 BỊ CHẶN khỏi factory 18 (ngoài phạm vi)", () => {
    expect(nguoiXemDuocNhan(NGUOI.engineer1, PHAM_VI_DO_DUOC.engineer1, 18)).toBe(false);
  });

  it("★★★ socket KHÔNG danh tính bị chặn NGAY CẢ khi phạm vi là `null`", () => {
    // Hai luật phải cùng áp: nếu chỉ hỏi phạm vi, một socket vô danh (mà
    // `resolveTenantFactoryScope` không có userId nên trả `null`) sẽ thành admin.
    expect(nguoiXemDuocNhan(undefined, null, 1)).toBe(false);
    expect(nguoiXemDuocNhan({}, null, 1)).toBe(false);
  });

  it("admin có danh tính + phạm vi null ⇒ nhận (bypass ĐÃ BIẾT)", () => {
    expect(nguoiXemDuocNhan(NGUOI.admin, PHAM_VI_DO_DUOC.admin, 1)).toBe(true);
  });
});
