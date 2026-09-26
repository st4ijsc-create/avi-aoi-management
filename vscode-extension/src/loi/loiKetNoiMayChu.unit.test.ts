/**
 * LƯỚI cho vị từ B3 — "đây có phải lỗi KHÔNG NỐI ĐƯỢC MÁY CHỦ không?". Bất biến: lỗi mạng (địa chỉ
 * sai/máy chủ tắt/timeout) ⇒ true; một đáp ứng HTTP THẬT (401/403/500 — máy chủ CÓ trả lời) ⇒ false,
 * kể cả khi nó cũng "không cho vào" — gợi ý đổi địa chỉ cho ca đó là gợi ý SAI.
 */
import { describe, it, expect } from "vitest";
import { laLoiKhongNoiDuocMayChu, moTaLoiKhongNoiDuocMayChu } from "./loiKetNoiMayChu";
import { LoiHttp } from "./loiHttp";

/** Dựng lại ĐÚNG hình dạng lỗi thật của Node/undici — đo bằng `node -e "fetch(...).catch(...)"`
 *  (xem docblock nguồn), không bịa hình dạng. */
function loiUndici(maCause: string): Error {
  const loi = new TypeError("fetch failed");
  (loi as unknown as { cause: unknown }).cause = Object.assign(new Error("mô phỏng"), { code: maCause });
  return loi;
}

describe("laLoiKhongNoiDuocMayChu", () => {
  it("★★★ ECONNREFUSED (đo thật: node -e fetch tới cổng đóng) ⇒ true — kịch bản 'server đổi IP'", () => {
    expect(laLoiKhongNoiDuocMayChu(loiUndici("ECONNREFUSED"))).toBe(true);
  });

  it("★★★ ENOTFOUND (đo thật: node -e fetch tới host không tồn tại) ⇒ true", () => {
    expect(laLoiKhongNoiDuocMayChu(loiUndici("ENOTFOUND"))).toBe(true);
  });

  it("★★ ETIMEDOUT/ECONNRESET/EAI_AGAIN/EHOSTUNREACH/ENETUNREACH ⇒ true", () => {
    for (const ma of ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]) {
      expect(laLoiKhongNoiDuocMayChu(loiUndici(ma)), ma).toBe(true);
    }
  });

  it("★★ mã timeout riêng của undici đặt THẲNG lên error.code (không qua .cause) ⇒ true", () => {
    const loi = Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" });
    expect(laLoiKhongNoiDuocMayChu(loi)).toBe(true);
  });

  it("★★★ NHÁNH KIA — LoiHttp 401 (sai mật khẩu, máy chủ CÓ trả lời) ⇒ false, KHÔNG gợi ý đổi địa chỉ", () => {
    expect(laLoiKhongNoiDuocMayChu(new LoiHttp(401, "sai mật khẩu"))).toBe(false);
  });

  it("★★★ NHÁNH KIA — LoiHttp 500 (lỗi phía máy chủ, máy chủ CÓ trả lời) ⇒ false", () => {
    expect(laLoiKhongNoiDuocMayChu(new LoiHttp(500, "lỗi máy chủ"))).toBe(false);
  });

  it("★★★ NHÁNH KIA — Error trần từ goiMutation khi !res.ok (\"tRPC x trả 403\", KHÔNG .cause) ⇒ false", () => {
    // Hình dạng thật của `mang/duyetGhi.ts#goiMutation` — ném `new Error(...)`, không gắn `.cause`.
    // ⚠ KHÔNG dùng nguyên văn tên RPC cửa duyệt (census.unit.test.ts quét CHUỖI đó trên toàn bộ
    //   tập vào bundle, kể cả tệp lưới — dùng một tên RPC khác vẫn đúng hình dạng cần kiểm).
    expect(laLoiKhongNoiDuocMayChu(new Error("tRPC repoWorkspace.listProjects trả 403"))).toBe(false);
  });

  it("★ .cause có mặt nhưng KHÔNG mang mã lỗi mạng (vd lỗi lập trình bọc nhầm) ⇒ false", () => {
    const loi = new Error("gì đó khác");
    (loi as unknown as { cause: unknown }).cause = new Error("không có .code");
    expect(laLoiKhongNoiDuocMayChu(loi)).toBe(false);
  });

  it("★ không phải Error (chuỗi trần, null, undefined) ⇒ false, không ném", () => {
    expect(laLoiKhongNoiDuocMayChu("chuỗi trần")).toBe(false);
    expect(laLoiKhongNoiDuocMayChu(null)).toBe(false);
    expect(laLoiKhongNoiDuocMayChu(undefined)).toBe(false);
  });

  it("★ AbortError của người dùng bấm Dừng (DOMException, không .cause mã mạng) ⇒ false — huỷ được lớp trên xử RIÊNG", () => {
    expect(laLoiKhongNoiDuocMayChu(new DOMException("aborted", "AbortError"))).toBe(false);
  });
});

describe("moTaLoiKhongNoiDuocMayChu", () => {
  it("★★★ in NGUYÊN VĂN địa chỉ đang thử — không bịa, không giấu", () => {
    const s = moTaLoiKhongNoiDuocMayChu("http://10.0.0.55:3000");
    expect(s).toContain("http://10.0.0.55:3000");
  });

  it("★★★ B4 — nói RÕ không cần khởi động lại VSCode (ĐO ĐƯỢC: mọi lượt đọc cfg mới, không cache)", () => {
    const s = moTaLoiKhongNoiDuocMayChu("http://localhost:3000");
    expect(s).toContain("KHÔNG cần khởi động lại VSCode");
  });
});
